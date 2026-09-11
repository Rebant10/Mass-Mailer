/**
 * Mass Mailer — Side Panel UI Logic
 * Handles step navigation, sheet connection, template editing,
 * placeholder insertion, campaign controls, and the live dashboard.
 */

/* global chrome, parsePlaceholders */

// ─── Globals ─────────────────────────────────────────────────────
let sheetData    = null;   // { headers, rows, tabs, sheetId, sheetName }
let attachment   = null;   // { name, mimeType, base64Data } | null
let currentStep  = 1;
let lastFocused  = null;   // last focused input/textarea (for placeholder insertion)
let delayConfig  = { min: 10000, max: 20000 };
let sendingMode  = 'realtime';
let accountInfo  = null;   // { email, accountType, isWorkspace, dailyLimitRealtime, dailyLimitCloud }

// ─── DOM refs ────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  // Header
  syncBtn:         $('syncBtn'),
  accountBadge:    $('accountBadge'),
  accountType:     $('accountType'),
  quotaLabel:      $('quotaLabel'),
  dailyCount:      $('dailyCount'),

  // Step 1
  sheetUrl:    $('sheetUrl'),
  connectBtn:  $('connectBtn'),
  sheetInfo:   $('sheetInfo'),
  tabSelect:   $('tabSelect'),
  rowCount:    $('rowCount'),
  columnChips: $('columnChips'),
  toStep2:     $('toStep2'),

  // Step 2
  subjectInput:     $('subjectInput'),
  bodyInput:        $('bodyInput'),
  placeholderBar:   $('placeholderBar'),
  templateSelect:   $('templateSelect'),
  saveTemplateBtn:  $('saveTemplateBtn'),
  attachmentInput:  $('attachmentInput'),
  fileName:         $('fileName'),
  removeAttachment: $('removeAttachment'),

  // Step 3
  modeRealtime:          $('modeRealtime'),
  modeBackground:        $('modeBackground'),
  realtimeDelayGroup:    $('realtimeDelayGroup'),
  delayPresets:          $('delayPresets'),
  customDelay:           $('customDelay'),
  customDelayToggle:     $('customDelayToggle'),
  minDelaySlider:        $('minDelaySlider'),
  maxDelaySlider:        $('maxDelaySlider'),
  minDelayVal:           $('minDelayVal'),
  maxDelayVal:           $('maxDelayVal'),
  cloudScheduleSettings: $('cloudScheduleSettings'),
  schedTypeDates:        $('schedTypeDates'),
  schedTypeDays:         $('schedTypeDays'),
  schedDatesSection:     $('schedDatesSection'),
  schedDaysSection:      $('schedDaysSection'),
  scheduleStartDate:     $('scheduleStartDate'),
  scheduleEndDate:       $('scheduleEndDate'),
  scheduleDays:          $('scheduleDays'),
  scheduleDaysStartDate: $('scheduleDaysStartDate'),
  scheduleStartTime:     $('scheduleStartTime'),
  scheduleEndTime:       $('scheduleEndTime'),
  scheduleBatchSize:     $('scheduleBatchSize'),
  scheduleBatchDelay:    $('scheduleBatchDelay'),
  scheduleDailyLimit:    $('scheduleDailyLimit'),
  companyLimitsContainer:$('companyLimitsContainer'),
  companyLimitsList:     $('companyLimitsList'),
  addCompanyLimitBtn:    $('addCompanyLimitBtn'),
  noCompanyNotice:       $('noCompanyNotice'),

  // Step 4
  previewEmails:        $('previewEmails'),
  summaryTotal:         $('summaryTotal'),
  summarySkip:          $('summarySkip'),
  summaryToSend:        $('summaryToSend'),
  summaryMode:          $('summaryMode'),
  duplicateWarning:     $('duplicateWarning'),
  duplicateCountText:   $('duplicateCountText'),
  limitWarning:         $('limitWarning'),
  companyBreakdownCard: $('companyBreakdownCard'),
  companyBreakdownList: $('companyBreakdownList'),
  startCampaignBtn:     $('startCampaignBtn'),

  // Dashboard
  progressBar:    $('progressBar'),
  progressText:   $('progressText'),
  statSent:       $('statSent'),
  statFailed:     $('statFailed'),
  statPending:    $('statPending'),
  statSkipped:    $('statSkipped'),
  statusBadge:    $('statusBadge'),
  pauseBtn:       $('pauseBtn'),
  resumeBtn:      $('resumeBtn'),
  stopBtn:        $('stopBtn'),
  stopCloudBtn:   $('stopCloudBtn'),
  newCampaignBtn: $('newCampaignBtn'),

  // General
  toastContainer:  $('toastContainer'),
  stepIndicator:   $('stepIndicator')
};

// ═══════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  wireEvents();
  initScheduleDefaults();
  await loadTemplates();
  await refreshDailyCount();
  await detectAccount();

  // Restore last connected sheet URL if available
  try {
    const stored = await chrome.storage.local.get('lastConnectedSheetUrl');
    if (stored.lastConnectedSheetUrl && els.sheetUrl && !els.sheetUrl.value) {
      els.sheetUrl.value = stored.lastConnectedSheetUrl;
    }
  } catch {}
});

// Listen for messages from background (campaign updates)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== 'campaignUpdate') return;
  switch (msg.type) {
    case 'state':
      updateDashboard(msg.state);
      break;
    case 'error':
      toast(msg.message, 'error');
      break;
    case 'complete':
      updateDashboard(msg.state);
      onCampaignComplete();
      break;
    case 'backgroundComplete':
      updateDashboard(msg.state);
      onBackgroundComplete(msg.queuedCount);
      break;
  }
});

// ═══════════════════════════════════════════════════════════════════
//  EVENT WIRING
// ═══════════════════════════════════════════════════════════════════

function wireEvents() {
  // ── Header sync ──
  els.syncBtn.addEventListener('click', syncSheet);

  // ── Step navigation ──
  $('connectBtn').addEventListener('click', connectSheet);
  $('toStep2').addEventListener('click',    () => goToStep(2));
  $('backToStep1').addEventListener('click', () => goToStep(1));
  $('toStep3').addEventListener('click',    () => goToStep(3));
  $('backToStep2').addEventListener('click', () => goToStep(2));
  $('toStep4').addEventListener('click',    () => { buildPreview(); goToStep(4); });
  $('backToStep3').addEventListener('click', () => goToStep(3));

  // ── Sheet tab change ──
  els.tabSelect.addEventListener('change', switchTab);

  // ── Track last focused text field (for placeholder insertion) ──
  els.subjectInput.addEventListener('focus', () => { lastFocused = els.subjectInput; });
  els.bodyInput.addEventListener('focus',    () => { lastFocused = els.bodyInput; });

  // ── Attachment ──
  els.attachmentInput.addEventListener('change', handleAttachment);
  els.removeAttachment.addEventListener('click', clearAttachment);

  // ── Mode toggle ──
  els.modeRealtime.addEventListener('click', () => setMode('realtime'));
  els.modeBackground.addEventListener('click', () => setMode('background'));

  // ── Delay presets ──
  els.delayPresets.addEventListener('click', e => {
    const btn = e.target.closest('.delay-btn');
    if (!btn) return;
    document.querySelectorAll('.delay-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (btn.dataset.min === 'custom') {
      els.customDelay.classList.remove('hidden');
      updateCustomDelay();
    } else {
      els.customDelay.classList.add('hidden');
      delayConfig = { min: +btn.dataset.min, max: +btn.dataset.max };
    }
  });

  els.minDelaySlider.addEventListener('input', updateCustomDelay);
  els.maxDelaySlider.addEventListener('input', updateCustomDelay);

  // ── Cloud schedule type switcher ──
  if (els.schedTypeDates) {
    els.schedTypeDates.addEventListener('click', () => setScheduleType('dates'));
  }
  if (els.schedTypeDays) {
    els.schedTypeDays.addEventListener('click', () => setScheduleType('days'));
  }

  // ── Cloud schedule day toggles ──
  if (els.scheduleDays) {
    els.scheduleDays.addEventListener('click', e => {
      const pill = e.target.closest('.day-pill');
      if (pill) pill.classList.toggle('active');
    });
  }

  // ── Company limits ──
  if (els.addCompanyLimitBtn) {
    els.addCompanyLimitBtn.addEventListener('click', () => addCompanyLimitRow());
  }

  // ── Templates ──
  els.saveTemplateBtn.addEventListener('click', saveTemplate);
  els.templateSelect.addEventListener('change', loadSelectedTemplate);

  // ── Campaign ──
  els.startCampaignBtn.addEventListener('click', startCampaign);
  els.pauseBtn.addEventListener('click', () => sendBg('pauseCampaign'));
  els.resumeBtn.addEventListener('click', () => sendBg('resumeCampaign'));
  els.stopBtn.addEventListener('click',  () => sendBg('stopCampaign'));
  if (els.stopCloudBtn) {
    els.stopCloudBtn.addEventListener('click', stopCloudCampaign);
  }
  els.newCampaignBtn.addEventListener('click', resetToStep1);
}

// ═══════════════════════════════════════════════════════════════════
//  STEP NAVIGATION
// ═══════════════════════════════════════════════════════════════════

function goToStep(n) {
  currentStep = n;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.step').forEach(s => {
    const sn = +s.dataset.step;
    s.classList.remove('active', 'done');
    if (sn < n) s.classList.add('done');
    if (sn === n) s.classList.add('active');
  });
  $(`step${n}`).classList.add('active');
}

function showDashboard() {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  $('dashboard').classList.add('active');
  // Hide step indicator active state
  document.querySelectorAll('.step').forEach(s => s.classList.add('done'));

  if (sendingMode === 'background') {
    els.pauseBtn.classList.add('hidden');
    els.resumeBtn.classList.add('hidden');
    els.stopBtn.classList.add('hidden');
    if (els.stopCloudBtn) els.stopCloudBtn.classList.remove('hidden');
    els.statusBadge.className = 'status-badge running';
    els.statusBadge.textContent = 'Queuing Drafts…';
    startDashboardPolling();
  }
}

// ═══════════════════════════════════════════════════════════════════
//  STEP 1 — CONNECT SHEET
// ═══════════════════════════════════════════════════════════════════

async function connectSheet() {
  const url = els.sheetUrl.value.trim();
  if (!url) { toast('Please enter a Google Sheets URL.', 'error'); return; }

  els.connectBtn.disabled = true;
  els.connectBtn.textContent = 'Connecting…';

  try {
    // Authenticate first
    await sendBg('authenticate');
    await detectAccount();

    // Fetch sheet
    const res = await sendBg('fetchSheet', { sheetUrl: url });
    if (!res.success) throw new Error(res.error);

    sheetData = res.data;
    renderSheetInfo();
    await refreshDailyCount();
    chrome.storage.local.set({ lastConnectedSheetUrl: url }).catch(() => {});
    toast('Sheet connected!', 'success');
  } catch (err) {
    toast(err.message || 'Failed to connect sheet.', 'error');
  } finally {
    els.connectBtn.disabled = false;
    els.connectBtn.textContent = 'Connect';
  }
}

function renderSheetInfo() {
  els.sheetInfo.classList.remove('hidden');

  // Tabs
  els.tabSelect.innerHTML = sheetData.tabs
    .map(t => `<option value="${t.name}" ${t.name === sheetData.sheetName ? 'selected' : ''}>${t.name}</option>`)
    .join('');

  // Row count
  els.rowCount.textContent = sheetData.rows.length;

  // Column chips
  renderColumnChips(sheetData.headers);
  refreshCompanyLimitsUI();
  refreshDailyCount();
}

function renderColumnChips(headers) {
  // Chips in the Step 1 info card
  els.columnChips.innerHTML = headers
    .filter(h => !['Status', 'Sent At', 'Draft ID'].includes(h))
    .map(h => `<span class="chip" data-col="${h}">${h}</span>`)
    .join('');

  // Chips in the Step 2 placeholder bar
  const bar = els.placeholderBar;
  // Keep the label, remove old chips
  bar.querySelectorAll('.chip').forEach(c => c.remove());
  headers
    .filter(h => !['Status', 'Sent At', 'Draft ID'].includes(h))
    .forEach(h => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.col = h;
      chip.textContent = h;
      chip.addEventListener('click', () => insertPlaceholder(h));
      bar.appendChild(chip);
    });
}

async function switchTab() {
  const tabName = els.tabSelect.value;
  try {
    const res = await sendBg('fetchTab', { sheetId: sheetData.sheetId, tabName });
    if (!res.success) throw new Error(res.error);
    sheetData.headers   = res.data.headers;
    sheetData.rows      = res.data.rows;
    sheetData.sheetName = tabName;
    els.rowCount.textContent = sheetData.rows.length;
    renderColumnChips(sheetData.headers);
    refreshCompanyLimitsUI();
    await refreshDailyCount();
    toast(`Switched to tab "${tabName}"`, 'info');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function syncSheet(silent = false) {
  if (!sheetData || !sheetData.sheetId) {
    const url = els.sheetUrl ? els.sheetUrl.value.trim() : '';
    if (url) {
      return connectSheet();
    }
    if (!silent) toast('Please connect a Google Sheet first.', 'error');
    return;
  }

  if (!silent) {
    els.syncBtn.classList.add('syncing');
    els.syncBtn.disabled = true;
  }

  try {
    const currentTab = (sheetData && sheetData.sheetName) || (els.tabSelect && els.tabSelect.value) || 'Sheet1';
    const res = await sendBg('syncSheet', {
      sheetId: sheetData.sheetId,
      sheetName: currentTab,
      tabName: currentTab
    });
    if (!res.success) throw new Error(res.error);

    sheetData.headers   = res.data.headers;
    sheetData.rows      = res.data.rows;
    els.rowCount.textContent = sheetData.rows.length;

    renderColumnChips(sheetData.headers);
    refreshCompanyLimitsUI();
    await refreshDailyCount();

    if ($('dashboard') && $('dashboard').classList.contains('active')) {
      updateDashboardFromSheetRows(sheetData.rows);
    } else if (currentStep === 4) {
      buildPreview();
    }

    if (!silent) toast(`Synced sheet data (${sheetData.rows.length} rows)`, 'success');
  } catch (err) {
    if (!silent) toast(err.message || 'Failed to sync sheet.', 'error');
  } finally {
    if (!silent) {
      els.syncBtn.classList.remove('syncing');
      els.syncBtn.disabled = false;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  STEP 2 — COMPOSE
// ═══════════════════════════════════════════════════════════════════

/**
 * Insert a {placeholder} at the cursor position in the last-focused field.
 */
function insertPlaceholder(colName) {
  const target = lastFocused || els.bodyInput;
  const tag = `{${colName}}`;
  const start = target.selectionStart;
  const end   = target.selectionEnd;
  const val   = target.value;

  target.value = val.substring(0, start) + tag + val.substring(end);
  target.focus();
  const newPos = start + tag.length;
  target.setSelectionRange(newPos, newPos);
}

// ── Attachment ──

function handleAttachment(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const base64Full = reader.result; // data:mime;base64,XXXX
    const base64Data = base64Full.split(',')[1];
    attachment = {
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      base64Data
    };
    els.fileName.textContent = `📎 ${file.name}`;
    els.fileName.classList.add('file-name');
    els.removeAttachment.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearAttachment() {
  attachment = null;
  els.attachmentInput.value = '';
  els.fileName.textContent = 'Click to select a file (e.g. resume.pdf)';
  els.fileName.classList.remove('file-name');
  els.removeAttachment.classList.add('hidden');
}

// ── Templates ──

async function loadTemplates() {
  const result = await chrome.storage.local.get('templates');
  const templates = result.templates || [];
  els.templateSelect.innerHTML = '<option value="">— Load Template —</option>';
  templates.forEach((t, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = t.name;
    els.templateSelect.appendChild(opt);
  });
}

function loadSelectedTemplate() {
  const idx = els.templateSelect.value;
  if (idx === '') return;
  chrome.storage.local.get('templates', result => {
    const t = (result.templates || [])[+idx];
    if (t) {
      els.subjectInput.value = t.subject;
      els.bodyInput.value    = t.body;
      toast(`Template "${t.name}" loaded.`, 'info');
    }
  });
}

async function saveTemplate() {
  const subject = els.subjectInput.value.trim();
  const body    = els.bodyInput.value.trim();
  if (!subject && !body) { toast('Write something first!', 'error'); return; }

  // Show a simple prompt via a modal
  const name = await promptModal('Save Template', 'Give this template a name:');
  if (!name) return;

  const result = await chrome.storage.local.get('templates');
  const templates = result.templates || [];
  templates.push({ name, subject, body });
  await chrome.storage.local.set({ templates });
  await loadTemplates();
  toast(`Template "${name}" saved!`, 'success');
}

// ═══════════════════════════════════════════════════════════════════
//  STEP 3 — CONFIG & SCHEDULE
// ═══════════════════════════════════════════════════════════════════

function setMode(mode) {
  sendingMode = mode;
  els.modeRealtime.classList.toggle('active',   mode === 'realtime');
  els.modeBackground.classList.toggle('active', mode === 'background');
  if (els.realtimeDelayGroup) els.realtimeDelayGroup.classList.toggle('hidden', mode !== 'realtime');
  if (els.cloudScheduleSettings) els.cloudScheduleSettings.classList.toggle('hidden', mode !== 'background');
  updateQuotaDisplay();
}

function updateCustomDelay() {
  let min = +els.minDelaySlider.value;
  let max = +els.maxDelaySlider.value;
  if (max <= min) { max = min + 1; els.maxDelaySlider.value = max; }
  els.minDelayVal.textContent = min;
  els.maxDelayVal.textContent = max;
  delayConfig = { min: min * 1000, max: max * 1000 };
}

let currentScheduleType = 'dates';

function setScheduleType(type) {
  currentScheduleType = type;
  if (els.schedTypeDates) els.schedTypeDates.classList.toggle('active', type === 'dates');
  if (els.schedTypeDays) els.schedTypeDays.classList.toggle('active', type === 'days');
  if (els.schedDatesSection) els.schedDatesSection.classList.toggle('hidden', type !== 'dates');
  if (els.schedDaysSection) els.schedDaysSection.classList.toggle('hidden', type !== 'days');
}

function initScheduleDefaults() {
  const today = new Date().toISOString().split('T')[0];
  if (els.scheduleStartDate && !els.scheduleStartDate.value) {
    els.scheduleStartDate.value = today;
  }
  if (els.scheduleDaysStartDate && !els.scheduleDaysStartDate.value) {
    els.scheduleDaysStartDate.value = today;
  }
}

async function detectAccount() {
  try {
    const res = await sendBg('getAccountInfo');
    const info = res?.accountInfo || res?.account;
    if (info) {
      accountInfo = info;
      if (els.accountType) els.accountType.textContent = accountInfo.accountType;
      if (els.accountBadge) {
        els.accountBadge.classList.toggle('personal', !accountInfo.isWorkspace);
        els.accountBadge.classList.toggle('workspace', !!accountInfo.isWorkspace);
      }
    } else {
      if (els.accountType) els.accountType.textContent = 'Ready to connect';
    }
  } catch (err) {
    console.warn('Account detection note:', err);
    if (els.accountType) els.accountType.textContent = 'Ready to connect';
  } finally {
    updateQuotaDisplay();
  }
}

function updateQuotaDisplay() {
  const isWorkspace = accountInfo ? accountInfo.isWorkspace : false;
  let limit;
  if (sendingMode === 'realtime') {
    limit = isWorkspace ? 2000 : 500;
    if (els.quotaLabel) els.quotaLabel.textContent = `Daily Quota (Real-Time: ${limit}/day):`;
  } else {
    limit = isWorkspace ? 1500 : 100;
    if (els.quotaLabel) els.quotaLabel.textContent = `Daily Quota (Cloud: ${limit}/day):`;
  }
}

// ── Company Limit Helpers ──

function findCompanyCol(headers) {
  if (!headers || !headers.length) return null;
  const exact = ['Company', 'company', 'Company Name', 'Organization', 'Employer', 'Company name'];
  return headers.find(h => exact.includes(h))
      || headers.find(h => h.toLowerCase().includes('company'))
      || null;
}

function getUnsentCompanies() {
  if (!sheetData || !sheetData.rows || !sheetData.headers) return [];
  const compCol = findCompanyCol(sheetData.headers);
  if (!compCol) return [];

  const set = new Set();
  sheetData.rows.forEach(r => {
    // Only companies with pending/unsent rows
    if (r['Status'] !== 'Sent ✓') {
      const val = (r[compCol] || '').toString().trim();
      if (val) set.add(val);
    }
  });

  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function populateCompanySelect(selectEl, selectedVal = '') {
  const currentVal = (selectedVal !== undefined && selectedVal !== '') ? selectedVal : selectEl.value;
  const unsentCompanies = getUnsentCompanies();

  selectEl.innerHTML = '';

  // Master Cap option
  const masterOpt = document.createElement('option');
  masterOpt.value = '__ALL__';
  masterOpt.textContent = '⭐ All Companies (Master Cap)';
  selectEl.appendChild(masterOpt);

  unsentCompanies.forEach(comp => {
    const opt = document.createElement('option');
    opt.value = comp;
    opt.textContent = comp;
    selectEl.appendChild(opt);
  });

  if (currentVal && Array.from(selectEl.options).some(o => o.value === currentVal)) {
    selectEl.value = currentVal;
  } else {
    selectEl.value = '__ALL__';
  }
}

function addCompanyLimitRow(defaultCompany = '__ALL__', defaultCap = 2) {
  if (!els.companyLimitsList) return;
  const row = document.createElement('div');
  row.className = 'company-limit-row';

  const select = document.createElement('select');
  select.className = 'input company-limit-select';

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'input company-limit-input';
  input.min = '1';
  input.max = '500';
  input.value = defaultCap;
  input.placeholder = 'Max emails';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-remove-limit';
  removeBtn.title = 'Remove Limit';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => {
    row.remove();
  });

  populateCompanySelect(select, defaultCompany);

  row.appendChild(select);
  row.appendChild(input);
  row.appendChild(removeBtn);

  els.companyLimitsList.appendChild(row);
}

function refreshCompanyLimitsUI() {
  if (!sheetData || !sheetData.headers) return;
  const compCol = findCompanyCol(sheetData.headers);
  if (!compCol) {
    if (els.noCompanyNotice) els.noCompanyNotice.classList.remove('hidden');
    if (els.addCompanyLimitBtn) els.addCompanyLimitBtn.classList.add('hidden');
    if (els.companyLimitsList) els.companyLimitsList.classList.add('hidden');
    return;
  }

  if (els.noCompanyNotice) els.noCompanyNotice.classList.add('hidden');
  if (els.addCompanyLimitBtn) els.addCompanyLimitBtn.classList.remove('hidden');
  if (els.companyLimitsList) els.companyLimitsList.classList.remove('hidden');

  const rows = els.companyLimitsList.querySelectorAll('.company-limit-row');
  rows.forEach(r => {
    const select = r.querySelector('.company-limit-select');
    if (select) {
      populateCompanySelect(select, select.value);
    }
  });
}

function collectCompanyLimits() {
  if (!els.companyLimitsList) return { all: null, companies: {}, masterCap: null, specific: {} };
  const rows = els.companyLimitsList.querySelectorAll('.company-limit-row');
  let masterCap = null;
  const specific = {};

  rows.forEach(r => {
    const select = r.querySelector('.company-limit-select');
    const input = r.querySelector('.company-limit-input');
    if (!select || !input) return;

    const comp = select.value;
    const cap = parseInt(input.value, 10);
    if (isNaN(cap) || cap <= 0) return;

    if (comp === '__ALL__') {
      masterCap = cap;
    } else if (comp) {
      specific[comp] = cap;
    }
  });

  return {
    all: masterCap,
    companies: specific,
    masterCap,
    specific
  };
}

function collectScheduleConfig() {
  const isDates = currentScheduleType === 'dates';
  let activeDays = [];
  if (!isDates && els.scheduleDays) {
    activeDays = Array.from(els.scheduleDays.querySelectorAll('.day-pill.active')).map(p => parseInt(p.dataset.day, 10));
  }

  const startDate = isDates
    ? (els.scheduleStartDate && els.scheduleStartDate.value ? els.scheduleStartDate.value : '')
    : (els.scheduleDaysStartDate && els.scheduleDaysStartDate.value ? els.scheduleDaysStartDate.value : '');

  const endDate = isDates && els.scheduleEndDate && els.scheduleEndDate.value
    ? els.scheduleEndDate.value
    : '';

  const batchSize = els.scheduleBatchSize && els.scheduleBatchSize.value
    ? Math.max(1, parseInt(els.scheduleBatchSize.value, 10) || 2)
    : 2;

  const delaySeconds = els.scheduleBatchDelay && els.scheduleBatchDelay.value
    ? Math.max(1, parseInt(els.scheduleBatchDelay.value, 10) || 5)
    : 5;

  return {
    scheduleType: currentScheduleType,
    startDate,
    endDate,
    activeDays,
    days: activeDays,
    startTime:    (els.scheduleStartTime && els.scheduleStartTime.value) ? els.scheduleStartTime.value : '09:00',
    endTime:      (els.scheduleEndTime && els.scheduleEndTime.value) ? els.scheduleEndTime.value : '17:00',
    batchSize,
    delaySeconds,
    dailyLimit:   (els.scheduleDailyLimit && els.scheduleDailyLimit.value) ? (parseInt(els.scheduleDailyLimit.value, 10) || 40) : 40
  };
}

// ═══════════════════════════════════════════════════════════════════
//  STEP 4 — PREVIEW & SEND
// ═══════════════════════════════════════════════════════════════════

function buildPreview() {
  if (!sheetData) return;
  const subject = els.subjectInput.value;
  const body    = els.bodyInput.value;
  const rows    = sheetData.rows;

  // Find columns
  const emailCol = findEmailCol(sheetData.headers);
  const companyCol = findCompanyCol(sheetData.headers);
  const companyLimits = collectCompanyLimits();

  // Count already-sent
  const alreadySent = rows.filter(r => r['Status'] === 'Sent ✓').length;
  const unsent = rows.filter(r => r['Status'] !== 'Sent ✓');

  // Duplicate email detection among unsent rows
  const unsentEmailCounts = {};
  unsent.forEach(r => {
    const email = emailCol && r[emailCol] ? r[emailCol].trim().toLowerCase() : '';
    if (email) {
      unsentEmailCounts[email] = (unsentEmailCounts[email] || 0) + 1;
    }
  });

  let duplicateCount = 0;
  Object.values(unsentEmailCounts).forEach(c => {
    if (c > 1) duplicateCount += (c - 1);
  });

  if (duplicateCount > 0) {
    if (els.duplicateCountText) {
      els.duplicateCountText.textContent = `${duplicateCount} duplicate email(s) detected in unsent rows — only the first occurrence will be sent.`;
    }
    if (els.duplicateWarning) els.duplicateWarning.classList.remove('hidden');
  } else {
    if (els.duplicateWarning) els.duplicateWarning.classList.add('hidden');
  }

  // Calculate which rows will actually be sent (respecting duplicate guard & company caps)
  const seenEmails = new Set();
  const companySentCount = {};
  const willSendRows = [];

  // Breakdown stats: company -> { totalPending: number, willSend: number, cap: number | 'None' }
  const companyStats = {};

  unsent.forEach(row => {
    const email = emailCol && row[emailCol] ? row[emailCol].trim().toLowerCase() : '';
    const company = (companyCol ? (row[companyCol] || '').trim() : '') || 'Other';

    if (!companyStats[company]) {
      const capVal = (companyLimits.specific && companyLimits.specific[company] !== undefined)
        ? companyLimits.specific[company]
        : (companyLimits.masterCap !== null ? companyLimits.masterCap : Infinity);

      companyStats[company] = {
        totalPending: 0,
        willSend: 0,
        cap: capVal
      };
    }
    companyStats[company].totalPending += 1;

    // Check duplicate email guard
    if (!email || seenEmails.has(email)) {
      return; // Duplicate or empty, will not send
    }

    // Check company cap
    const cap = companyStats[company].cap;
    const currentSent = companySentCount[company] || 0;
    if (currentSent < cap) {
      companySentCount[company] = currentSent + 1;
      seenEmails.add(email);
      willSendRows.push(row);
      companyStats[company].willSend += 1;
    }
  });

  // Render first 3 preview emails from willSendRows (or unsent if empty)
  const previewSlice = (willSendRows.length ? willSendRows : unsent).slice(0, 3);
  els.previewEmails.innerHTML = previewSlice.map((row, i) => {
    const filledSubject = parsePlaceholders(subject, row);
    const filledBody    = parsePlaceholders(body, row);
    const email         = emailCol ? row[emailCol] : '(no email column)';
    const attachLabel   = attachment ? `<div class="preview-attachment">📎 ${attachment.name}</div>` : '';

    return `
      <div class="preview-email">
        <div class="preview-label">Email ${i + 1}</div>
        <div class="preview-to">To: ${escapeHtml(email || '')}</div>
        <div class="preview-subject">${escapeHtml(filledSubject)}</div>
        <div class="preview-body">${escapeHtml(filledBody)}</div>
        ${attachLabel}
      </div>`;
  }).join('');

  // Summary counts
  els.summaryTotal.textContent  = rows.length;
  els.summarySkip.textContent   = rows.length - willSendRows.length;
  els.summaryToSend.textContent = willSendRows.length;

  const sched = collectScheduleConfig();
  if (sendingMode === 'realtime') {
    els.summaryMode.textContent = '⚡ Real-time';
  } else if (sched.scheduleType === 'dates') {
    const range = sched.startDate
      ? (sched.endDate ? `${sched.startDate} to ${sched.endDate}` : `From ${sched.startDate}`)
      : (sched.endDate ? `Until ${sched.endDate}` : 'Every day');
    els.summaryMode.textContent = `☁️ Dates (${range} | ${sched.batchSize}/5m | ${sched.startTime}-${sched.endTime})`;
  } else {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const daysStr = (sched.activeDays && sched.activeDays.length)
      ? sched.activeDays.map(d => dayNames[d]).join(',')
      : 'None';
    const startStr = sched.startDate ? `From ${sched.startDate} | ` : '';
    els.summaryMode.textContent = `☁️ Days (${startStr}${daysStr} | ${sched.batchSize}/5m | ${sched.startTime}-${sched.endTime})`;
  }

  // Company Cap Breakdown card (Step 4)
  const hasLimits = companyLimits.masterCap !== null || Object.keys(companyLimits.specific).length > 0;
  const companiesList = Object.keys(companyStats);

  if (hasLimits && companiesList.length > 0 && companyCol) {
    if (els.companyBreakdownCard) els.companyBreakdownCard.classList.remove('hidden');
    if (els.companyBreakdownList) {
      els.companyBreakdownList.innerHTML = companiesList.map(comp => {
        const stat = companyStats[comp];
        const capLabel = stat.cap === Infinity ? 'None' : stat.cap;
        return `
          <div class="company-breakdown-row">
            <span class="breakdown-name">${escapeHtml(comp)}</span>
            <span class="breakdown-stat"><strong>${stat.willSend}</strong> / ${stat.totalPending} (Cap: ${capLabel})</span>
          </div>
        `;
      }).join('');
    }
  } else {
    if (els.companyBreakdownCard) els.companyBreakdownCard.classList.add('hidden');
  }

  // Daily limit warning
  getDailyCount().then(count => {
    const isWorkspace = accountInfo ? accountInfo.isWorkspace : false;
    const maxLimit = sendingMode === 'realtime' ? (isWorkspace ? 2000 : 500) : (isWorkspace ? 1500 : 100);
    if (els.limitWarning) {
      els.limitWarning.classList.toggle('hidden', (count + willSendRows.length) < (maxLimit * 0.9));
    }
  });
}

async function startCampaign() {
  if (!sheetData) { toast('Connect a sheet first.', 'error'); return; }
  const subject = els.subjectInput.value.trim();
  const body    = els.bodyInput.value.trim();
  if (!subject) { toast('Subject is required.', 'error'); return; }
  if (!body)    { toast('Body is required.', 'error'); return; }

  els.startCampaignBtn.disabled = true;

  try {
    const companyLimits = collectCompanyLimits();
    const schedule = collectScheduleConfig();

    await sendBg('startCampaign', {
      config: {
        rows:          sheetData.rows,
        headers:       sheetData.headers,
        template:      { subject, body },
        attachment,
        sheetId:       sheetData.sheetId,
        sheetName:     sheetData.sheetName,
        mode:          sendingMode,
        delay:         delayConfig,
        companyLimits,
        schedule
      }
    });
    showDashboard();
  } catch (err) {
    toast(err.message, 'error');
    els.startCampaignBtn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════

function updateDashboard(state) {
  if (!state) return;
  const { sentCount, failedCount, skippedCount, totalRows, isPaused, isRunning } = state;
  const processed = sentCount + failedCount + skippedCount;
  const pending   = totalRows - processed;
  const pct       = totalRows > 0 ? Math.round((processed / totalRows) * 100) : 0;

  els.progressBar.style.width = `${pct}%`;
  els.progressText.textContent = `${pct} %`;

  els.statSent.textContent    = sentCount;
  els.statFailed.textContent  = failedCount;
  els.statPending.textContent = pending;
  els.statSkipped.textContent = skippedCount;

  // Status badge
  if (!isRunning) {
    if (els.statusBadge.textContent !== 'Stopped 🛑' && !els.statusBadge.textContent.includes('Drafts Queued')) {
      els.statusBadge.className = 'status-badge stopped';
      els.statusBadge.textContent = 'Stopped';
    }
  } else if (isPaused) {
    els.statusBadge.className = 'status-badge paused';
    els.statusBadge.textContent = 'Paused';
  } else {
    els.statusBadge.className = 'status-badge running';
    els.statusBadge.textContent = (state.mode === 'background' || sendingMode === 'background') ? 'Queuing Drafts…' : 'Running…';
  }

  // Buttons
  if (state.mode === 'background' || sendingMode === 'background') {
    els.pauseBtn.classList.add('hidden');
    els.resumeBtn.classList.add('hidden');
    els.stopBtn.classList.add('hidden');
    if (els.stopCloudBtn) {
      els.stopCloudBtn.classList.toggle('hidden', els.statusBadge.textContent === 'Stopped 🛑');
    }
    els.newCampaignBtn.classList.toggle('hidden', isRunning);
  } else {
    if (els.stopCloudBtn) els.stopCloudBtn.classList.add('hidden');
    els.pauseBtn.classList.toggle('hidden', isPaused || !isRunning);
    els.resumeBtn.classList.toggle('hidden', !isPaused);
    els.stopBtn.classList.toggle('hidden', !isRunning);
    els.newCampaignBtn.classList.toggle('hidden', isRunning);
  }

  // Update daily counter
  if (state.dailySentCount !== undefined) {
    els.dailyCount.textContent = state.dailySentCount;
  }
}

function onCampaignComplete() {
  stopDashboardPolling();
  els.statusBadge.className = 'status-badge complete';
  els.statusBadge.textContent = 'Complete ✓';
  els.pauseBtn.classList.add('hidden');
  els.resumeBtn.classList.add('hidden');
  els.stopBtn.classList.add('hidden');
  els.newCampaignBtn.classList.remove('hidden');
  refreshDailyCount();
  toast('Campaign complete! 🎉', 'success');
}

function onBackgroundComplete(queuedCount) {
  els.statusBadge.className = 'status-badge queued';
  els.statusBadge.textContent = `${queuedCount} Drafts Queued`;
  els.pauseBtn.classList.add('hidden');
  els.resumeBtn.classList.add('hidden');
  els.stopBtn.classList.add('hidden');
  if (els.stopCloudBtn) els.stopCloudBtn.classList.remove('hidden');
  els.newCampaignBtn.classList.remove('hidden');

  if (sheetData && sheetData.rows) {
    updateDashboardFromSheetRows(sheetData.rows);
  }
  refreshDailyCount();
  startDashboardPolling();
  toast(`${queuedCount} drafts created! Cloud campaign active.`, 'success');
}

async function stopCloudCampaign() {
  stopDashboardPolling();
  if (!sheetData || !sheetData.sheetId) {
    toast('No active sheet connected', 'error');
    return;
  }
  els.stopCloudBtn.disabled = true;
  els.stopCloudBtn.textContent = 'Stopping…';
  try {
    const res = await sendBg('stopCloudCampaign', {
      sheetId: sheetData.sheetId,
      targetTab: sheetData.sheetName || 'Sheet1'
    });
    if (!res.success) throw new Error(res.error);
    toast('Cloud campaign stopped & marked Stopped in sheet!', 'success');
    els.statusBadge.className = 'status-badge stopped';
    els.statusBadge.textContent = 'Stopped 🛑';
    if (els.stopCloudBtn) els.stopCloudBtn.classList.add('hidden');
    els.newCampaignBtn.classList.remove('hidden');

    // Show informative cancellation popup detailing automated vs manual steps
    showCancellationModal(res);
  } catch (err) {
    toast(err.message || 'Failed to stop cloud campaign', 'error');
  } finally {
    if (els.stopCloudBtn) {
      els.stopCloudBtn.disabled = false;
      els.stopCloudBtn.textContent = '🛑 Stop & Cancel Cloud Campaign';
    }
  }
}

function showCancellationModal(details = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal cancel-summary-modal">
      <div class="modal-top">
        <span class="cancel-modal-badge">🛑 Cloud Campaign Cancelled</span>
      </div>
      
      <div class="cancel-modal-content">
        <div class="cancel-card auto-card">
          <div class="cancel-card-header">
            <strong>⚡ Automated Actions Done for You:</strong>
          </div>
          <ul class="cancel-card-list">
            <li>Marked <code>status</code> as <strong>Stopped</strong> in <code>_MailerConfig</code>.</li>
            <li>Cleared <strong>${details.clearedRows || 0}</strong> queued / pending row(s) in your sheet back to clean.</li>
            <li>Deleted <strong>${details.deletedDrafts || 0}</strong> created draft(s) from your Gmail drafts folder.</li>
          </ul>
        </div>

        <div class="cancel-card manual-card">
          <div class="cancel-card-header">
            <strong>⚠️ What You Need to Do (In Apps Script):</strong>
          </div>
          <p class="cancel-card-desc">
            If you previously ran <code>setup</code> to enable the 5-minute recurring cloud trigger:
          </p>
          <ol class="cancel-card-steps">
            <li>In Google Sheets, click <strong>Extensions → Apps Script</strong></li>
            <li>Select <strong>teardown</strong> from the function dropdown at the top</li>
            <li>Click <strong>▶ Run</strong> to delete the cloud trigger</li>
          </ol>
          <p class="cancel-card-note">
            <em>(Note: Even if you do this later, Apps Script is already blocked from sending because <code>status</code> is set to <strong>Stopped</strong> in your sheet).</em>
          </p>
        </div>
      </div>

      <div class="btn-row" style="justify-content:flex-end;margin-top:14px;">
        <button class="btn btn-primary" id="cancelModalCloseBtn">Got it, thanks!</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#cancelModalCloseBtn').addEventListener('click', () => {
    overlay.remove();
  });
}

function resetToStep1() {
  stopDashboardPolling();
  sheetData   = null;
  attachment  = null;
  currentStep = 1;
  els.sheetUrl.value       = '';
  els.templateSelect.value = '';
  els.subjectInput.value   = '';
  els.bodyInput.value      = '';
  els.sheetInfo.classList.add('hidden');
  if (els.companyLimitsList) els.companyLimitsList.innerHTML = '';
  if (els.duplicateWarning) els.duplicateWarning.classList.add('hidden');
  if (els.companyBreakdownCard) els.companyBreakdownCard.classList.add('hidden');
  if (els.stopCloudBtn) els.stopCloudBtn.classList.add('hidden');
  clearAttachment();
  els.startCampaignBtn.disabled = false;
  goToStep(1);
}

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Send a message to the background service worker and get a response.
 */
function sendBg(action, extra = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, ...extra }, res => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (res && !res.success) {
        reject(new Error(res.error || 'Unknown error'));
      } else {
        resolve(res || {});
      }
    });
  });
}

function findEmailCol(headers) {
  const exact = ['Email', 'email', 'EMAIL', 'E-mail', 'e-mail',
                 'Mail', 'mail', 'Email Address', 'email address'];
  return headers.find(h => exact.includes(h))
      || headers.find(h => h.toLowerCase().includes('email'))
      || null;
}

async function refreshDailyCount() {
  const count = await getDailyCount();
  els.dailyCount.textContent = count;
}

async function getDailyCount() {
  let localCount = 0;
  try {
    const res = await sendBg('getDailySentCount');
    localCount = res.count || 0;
  } catch {}

  let sheetCount = 0;
  if (sheetData && sheetData.rows) {
    sheetCount = countTodaySentFromRows(sheetData.rows, sheetData.headers);
  }

  const effective = Math.max(localCount, sheetCount);

  // Synchronize local storage if sheet has higher count (e.g. sent via Apps Script in background)
  if (sheetCount > localCount) {
    chrome.storage.local.set({
      dailySent: {
        date: new Date().toDateString(),
        count: sheetCount
      }
    }).catch(() => {});
  }

  return effective;
}

function countTodaySentFromRows(rows, headers = []) {
  if (!rows || !rows.length) return 0;
  const statusCol = (headers && headers.find(h => /status/i.test(h))) || 'Status';
  const sentAtCol = (headers && headers.find(h => /sent\s*(at|date)|timestamp/i.test(h))) || 'Sent At';

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');

  const patterns = [
    `${dd}/${mm}/${yyyy}`,
    `${parseInt(dd, 10)}/${parseInt(mm, 10)}/${yyyy}`,
    `${parseInt(dd, 10)}/${mm}/${yyyy}`,
    `${dd}/${parseInt(mm, 10)}/${yyyy}`,
    `${dd}-${mm}-${yyyy}`,
    `${yyyy}-${mm}-${dd}`
  ];

  let count = 0;
  rows.forEach(r => {
    const status = String(r[statusCol] || '').trim();
    if (status !== 'Sent ✓') return;

    const sentVal = r[sentAtCol] ? String(r[sentAtCol]).trim() : '';
    if (sentVal) {
      const matches = patterns.some(p => sentVal.includes(p));
      if (matches || isSameDay(sentVal, now)) {
        count++;
      }
    } else {
      count++;
    }
  });

  return count;
}

function isSameDay(dateStr, today) {
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() === today.getFullYear() &&
             d.getMonth() === today.getMonth() &&
             d.getDate() === today.getDate();
    }
  } catch {}
  return false;
}

function updateDashboardFromSheetRows(rows = []) {
  if (!rows || !rows.length) return;

  const total = rows.length;
  let sent = 0;
  let failed = 0;
  let queued = 0;
  let pending = 0;

  rows.forEach(r => {
    const s = String(r['Status'] || '').trim();
    if (s === 'Sent ✓') {
      sent++;
    } else if (s.startsWith('Failed')) {
      failed++;
    } else if (s === 'Queued 📋') {
      queued++;
    } else if (s === 'Pending ⏳') {
      pending++;
    }
  });

  const skipped = Math.max(0, total - (sent + failed + queued + pending));
  const processed = sent + failed + skipped;
  const remainingPending = queued + pending;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  els.progressBar.style.width = `${pct}%`;
  els.progressText.textContent = `${pct} %`;

  els.statSent.textContent    = sent;
  els.statFailed.textContent  = failed;
  els.statPending.textContent = remainingPending;
  els.statSkipped.textContent = skipped;

  if (sent === total && total > 0) {
    els.statusBadge.className = 'status-badge complete';
    els.statusBadge.textContent = 'Complete ✓';
    if (els.stopCloudBtn) els.stopCloudBtn.classList.add('hidden');
    els.newCampaignBtn.classList.remove('hidden');
    stopDashboardPolling();
  } else if (queued > 0) {
    els.statusBadge.className = 'status-badge queued';
    els.statusBadge.textContent = (sent > 0)
      ? `${sent} Sent (${queued} Queued)`
      : `${queued} Drafts Queued`;
  } else if (sent > 0) {
    els.statusBadge.className = 'status-badge running';
    els.statusBadge.textContent = `${sent} Sent ✓`;
  }
}

let dashboardPollInterval = null;

function startDashboardPolling() {
  stopDashboardPolling();
  dashboardPollInterval = setInterval(() => {
    if ($('dashboard') && $('dashboard').classList.contains('active') && sheetData && sheetData.sheetId) {
      syncSheet(true /* silent sync */);
    } else {
      stopDashboardPolling();
    }
  }, 15000);
}

function stopDashboardPolling() {
  if (dashboardPollInterval) {
    clearInterval(dashboardPollInterval);
    dashboardPollInterval = null;
  }
}

// ── Toast notifications ──

function toast(message, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  els.toastContainer.appendChild(t);
  setTimeout(() => { t.classList.add('fade-out'); }, 3500);
  setTimeout(() => { t.remove(); }, 3800);
}

// ── Prompt modal ──

function promptModal(title, label) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>${title}</h3>
        <div class="input-group">
          <label class="label">${label}</label>
          <input type="text" class="input" id="modalInput" placeholder="e.g. Cold Outreach v1">
        </div>
        <div class="btn-row">
          <button class="btn btn-ghost" id="modalCancel">Cancel</button>
          <button class="btn btn-primary" id="modalOk">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#modalInput');
    input.focus();

    overlay.querySelector('#modalOk').addEventListener('click', () => {
      const val = input.value.trim();
      overlay.remove();
      resolve(val || null);
    });
    overlay.querySelector('#modalCancel').addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') overlay.querySelector('#modalOk').click();
    });
  });
}



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

// ─── DOM refs ────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
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
  modeRealtime:    $('modeRealtime'),
  modeBackground:  $('modeBackground'),
  delayPresets:    $('delayPresets'),
  customDelay:     $('customDelay'),
  customDelayToggle: $('customDelayToggle'),
  minDelaySlider:  $('minDelaySlider'),
  maxDelaySlider:  $('maxDelaySlider'),
  minDelayVal:     $('minDelayVal'),
  maxDelayVal:     $('maxDelayVal'),
  backgroundInfo:  $('backgroundInfo'),

  // Step 4
  previewEmails:   $('previewEmails'),
  summaryTotal:    $('summaryTotal'),
  summarySkip:     $('summarySkip'),
  summaryToSend:   $('summaryToSend'),
  summaryMode:     $('summaryMode'),
  limitWarning:    $('limitWarning'),
  startCampaignBtn:$('startCampaignBtn'),

  // Dashboard
  progressBar:  $('progressBar'),
  progressText: $('progressText'),
  statSent:     $('statSent'),
  statFailed:   $('statFailed'),
  statPending:  $('statPending'),
  statSkipped:  $('statSkipped'),
  statusBadge:  $('statusBadge'),
  pauseBtn:     $('pauseBtn'),
  resumeBtn:    $('resumeBtn'),
  stopBtn:      $('stopBtn'),
  newCampaignBtn: $('newCampaignBtn'),

  // General
  dailyCount:      $('dailyCount'),
  toastContainer:  $('toastContainer'),
  stepIndicator:   $('stepIndicator')
};

// ═══════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  wireEvents();
  await loadTemplates();
  await refreshDailyCount();
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

  // ── Templates ──
  els.saveTemplateBtn.addEventListener('click', saveTemplate);
  els.templateSelect.addEventListener('change', loadSelectedTemplate);

  // ── Campaign ──
  els.startCampaignBtn.addEventListener('click', startCampaign);
  els.pauseBtn.addEventListener('click', () => sendBg('pauseCampaign'));
  els.resumeBtn.addEventListener('click', () => sendBg('resumeCampaign'));
  els.stopBtn.addEventListener('click',  () => sendBg('stopCampaign'));
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

    // Fetch sheet
    const res = await sendBg('fetchSheet', { sheetUrl: url });
    if (!res.success) throw new Error(res.error);

    sheetData = res.data;
    renderSheetInfo();
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
    toast(`Switched to tab "${tabName}"`, 'info');
  } catch (err) {
    toast(err.message, 'error');
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
//  STEP 3 — CONFIG
// ═══════════════════════════════════════════════════════════════════

function setMode(mode) {
  sendingMode = mode;
  els.modeRealtime.classList.toggle('active',   mode === 'realtime');
  els.modeBackground.classList.toggle('active', mode === 'background');
  els.backgroundInfo.classList.toggle('hidden',  mode !== 'background');
}

function updateCustomDelay() {
  let min = +els.minDelaySlider.value;
  let max = +els.maxDelaySlider.value;
  if (max <= min) { max = min + 1; els.maxDelaySlider.value = max; }
  els.minDelayVal.textContent = min;
  els.maxDelayVal.textContent = max;
  delayConfig = { min: min * 1000, max: max * 1000 };
}

// ═══════════════════════════════════════════════════════════════════
//  STEP 4 — PREVIEW & SEND
// ═══════════════════════════════════════════════════════════════════

function buildPreview() {
  if (!sheetData) return;
  const subject = els.subjectInput.value;
  const body    = els.bodyInput.value;
  const rows    = sheetData.rows;

  // Find email column
  const emailCol = findEmailCol(sheetData.headers);

  // Count already-sent
  const alreadySent = rows.filter(r => r['Status'] === 'Sent ✓').length;
  const toSend      = rows.length - alreadySent;

  // Preview first 3 unsent
  const unsent = rows.filter(r => r['Status'] !== 'Sent ✓').slice(0, 3);
  els.previewEmails.innerHTML = unsent.map((row, i) => {
    const filledSubject = parsePlaceholders(subject, row);
    const filledBody    = parsePlaceholders(body, row);
    const email         = emailCol ? row[emailCol] : '(no email column)';
    const attachLabel   = attachment ? `<div class="preview-attachment">📎 ${attachment.name}</div>` : '';

    return `
      <div class="preview-email">
        <div class="preview-label">Email ${i + 1}</div>
        <div class="preview-to">To: ${email}</div>
        <div class="preview-subject">${escapeHtml(filledSubject)}</div>
        <div class="preview-body">${escapeHtml(filledBody)}</div>
        ${attachLabel}
      </div>`;
  }).join('');

  // Summary
  els.summaryTotal.textContent  = rows.length;
  els.summarySkip.textContent   = alreadySent;
  els.summaryToSend.textContent = toSend;
  els.summaryMode.textContent   = sendingMode === 'realtime' ? '⚡ Real-time' : '☁️ Background';

  // Daily limit warning
  getDailyCount().then(count => {
    els.limitWarning.classList.toggle('hidden', (count + toSend) < 450);
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
    await sendBg('startCampaign', {
      config: {
        rows:      sheetData.rows,
        headers:   sheetData.headers,
        template:  { subject, body },
        attachment,
        sheetId:   sheetData.sheetId,
        sheetName: sheetData.sheetName,
        mode:      sendingMode,
        delay:     delayConfig
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
    els.statusBadge.className = 'status-badge stopped';
    els.statusBadge.textContent = 'Stopped';
  } else if (isPaused) {
    els.statusBadge.className = 'status-badge paused';
    els.statusBadge.textContent = 'Paused';
  } else {
    els.statusBadge.className = 'status-badge running';
    els.statusBadge.textContent = 'Running…';
  }

  // Buttons
  els.pauseBtn.classList.toggle('hidden', isPaused || !isRunning);
  els.resumeBtn.classList.toggle('hidden', !isPaused);
  els.stopBtn.classList.toggle('hidden', !isRunning);
  els.newCampaignBtn.classList.toggle('hidden', isRunning);

  // Update daily counter
  if (state.dailySentCount !== undefined) {
    els.dailyCount.textContent = state.dailySentCount;
  }
}

function onCampaignComplete() {
  els.statusBadge.className = 'status-badge complete';
  els.statusBadge.textContent = 'Complete ✓';
  els.pauseBtn.classList.add('hidden');
  els.resumeBtn.classList.add('hidden');
  els.stopBtn.classList.add('hidden');
  els.newCampaignBtn.classList.remove('hidden');
  toast('Campaign complete! 🎉', 'success');
}

function onBackgroundComplete(queuedCount) {
  els.statusBadge.className = 'status-badge queued';
  els.statusBadge.textContent = `${queuedCount} Drafts Queued`;
  els.pauseBtn.classList.add('hidden');
  els.resumeBtn.classList.add('hidden');
  els.stopBtn.classList.add('hidden');
  els.newCampaignBtn.classList.remove('hidden');
  toast(`${queuedCount} drafts created! Deploy the Apps Script to send them automatically.`, 'success');
}

function resetToStep1() {
  sheetData   = null;
  attachment  = null;
  currentStep = 1;
  els.sheetUrl.value       = '';
  els.templateSelect.value = '';
  els.subjectInput.value   = '';
  els.bodyInput.value      = '';
  els.sheetInfo.classList.add('hidden');
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
  try {
    const res = await sendBg('getDailySentCount');
    return res.count || 0;
  } catch { return 0; }
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



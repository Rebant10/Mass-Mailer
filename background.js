/**
 * Mass Mailer — Background Service Worker
 * Handles OAuth2, Google API calls, and the campaign execution engine.
 */

/* global chrome, parsePlaceholders, buildMimeMessage, base64UrlEncode,
          extractSheetId, randomDelay, formatStatus, getTimestamp, columnToLetter */

// ─── Campaign State ──────────────────────────────────────────────
let campaign = {
  isRunning: false,
  isPaused: false,
  currentIndex: 0,
  totalRows: 0,
  sentCount: 0,
  failedCount: 0,
  skippedCount: 0,
  dailySentCount: 0,
  rows: [],
  headers: [],
  template: { subject: '', body: '' },
  attachment: null,
  sheetId: '',
  sheetName: '',
  mode: 'realtime',
  delay: { min: 10000, max: 20000 },
  statusColIndex: -1,
  sentAtColIndex: -1,
  draftIdColIndex: -1
};

// ─── Side Panel Behaviour ────────────────────────────────────────
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ─── Import shared utils into the service-worker scope ───────────
try { importScripts('utils.js'); } catch (_) { /* loaded via <script> in panel */ }

// ─── Message Router ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(err =>
    sendResponse({ success: false, error: err.message })
  );
  return true; // keep channel open for async
});

async function handleMessage(msg) {
  switch (msg.action) {
    // Auth
    case 'authenticate':
      return { success: true, token: await getAuthToken() };

    // Sheets
    case 'fetchSheet':
      return { success: true, data: await fetchSheetData(msg.sheetUrl) };
    case 'fetchTab':
      return { success: true, data: await fetchSheetTab(msg.sheetId, msg.tabName) };

    // Campaign controls
    case 'startCampaign':
      await startCampaign(msg.config);
      return { success: true };
    case 'pauseCampaign':
      pauseCampaign();
      return { success: true };
    case 'resumeCampaign':
      resumeCampaign();
      return { success: true };
    case 'stopCampaign':
      stopCampaign();
      return { success: true };

    // State
    case 'getCampaignState':
      return { success: true, state: uiState() };
    case 'getDailySentCount':
      return { success: true, count: await getDailySentCount() };

    default:
      return { success: false, error: `Unknown action: ${msg.action}` };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════════

function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, token => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'Auth failed'));
      } else {
        resolve(token);
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
//  GOOGLE SHEETS API
// ═══════════════════════════════════════════════════════════════════

async function apiFetch(url) {
  const token = await getAuthToken();
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API ${res.status}`);
  }
  return res.json();
}

async function apiPut(url, body) {
  const token = await getAuthToken();
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API PUT ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch spreadsheet metadata + first-tab data.
 */
async function fetchSheetData(sheetUrl) {
  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) throw new Error('Invalid Google Sheets URL');

  // Metadata — sheet tabs
  const meta = await apiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`
  );
  const tabs = meta.sheets.map(s => ({
    name: s.properties.title,
    id: s.properties.sheetId
  }));

  // First tab data
  const firstTab = tabs[0].name;
  const parsed = await fetchSheetTab(sheetId, firstTab);

  return { ...parsed, tabs, sheetId, sheetName: firstTab };
}

/**
 * Fetch all rows from a specific tab.
 */
async function fetchSheetTab(sheetId, tabName) {
  const data = await apiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabName)}`
  );
  const values = data.values || [];
  if (values.length < 2) throw new Error('Sheet needs at least a header row and one data row');

  const headers = values[0].map(h => String(h || '').trim());
  const rows = values.slice(1).map((row, idx) => {
    const obj = {};
    headers.forEach((h, i) => {
      const val = row[i] !== undefined && row[i] !== null ? String(row[i]).trim() : '';
      obj[h] = val;
    });
    obj._rowIndex = idx + 2; // 1-based, skip header
    return obj;
  });

  return { headers, rows };
}

/**
 * Write a single cell value.
 */
async function writeCell(sheetId, tabName, row, col, value) {
  const range = `${tabName}!${columnToLetter(col)}${row}`;
  await apiPut(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { values: [[value]] }
  );
}

/**
 * Ensure Status, Sent At (and Draft ID for background mode) columns exist.
 * Returns their 1-based column indices.
 */
async function ensureStatusColumns(sheetId, tabName, headers) {
  let statusCol  = headers.indexOf('Status');
  let sentAtCol  = headers.indexOf('Sent At');
  let draftIdCol = headers.indexOf('Draft ID');

  const toAdd = [];
  if (statusCol  === -1) { statusCol  = headers.length + toAdd.length; toAdd.push('Status');   }
  if (sentAtCol  === -1) { sentAtCol  = headers.length + toAdd.length; toAdd.push('Sent At');  }
  if (campaign.mode === 'background' && draftIdCol === -1) {
    draftIdCol = headers.length + toAdd.length;
    toAdd.push('Draft ID');
  }

  if (toAdd.length) {
    const startCol = columnToLetter(headers.length + 1);
    const endCol   = columnToLetter(headers.length + toAdd.length);
    const range    = `${tabName}!${startCol}1:${endCol}1`;
    await apiPut(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      { values: [toAdd] }
    );
  }

  return {
    statusCol:  statusCol  + 1,
    sentAtCol:  sentAtCol  + 1,
    draftIdCol: draftIdCol !== -1 ? draftIdCol + 1 : -1
  };
}

// ═══════════════════════════════════════════════════════════════════
//  GMAIL API
// ═══════════════════════════════════════════════════════════════════

async function sendEmailViaAPI(to, subject, body, attachment) {
  const token = await getAuthToken();
  const mime  = buildMimeMessage(to, subject, body, attachment);
  const raw   = base64UrlEncode(mime);

  const res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw })
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const code = res.status;
    throw new Error(err.error?.message || `Gmail error ${code}`);
  }
  return res.json();
}

async function createDraftViaAPI(to, subject, body, attachment) {
  const token = await getAuthToken();
  const mime  = buildMimeMessage(to, subject, body, attachment);
  const raw   = base64UrlEncode(mime);

  const res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: { raw } })
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Draft error ${res.status}`);
  }
  return res.json();
}

// ═══════════════════════════════════════════════════════════════════
//  CAMPAIGN ENGINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Identify the email column (case-insensitive search across headers).
 */
function findEmailColumn(headers) {
  const exact = ['Email', 'email', 'EMAIL', 'E-mail', 'e-mail',
                 'Mail', 'mail', 'Email Address', 'email address'];
  return headers.find(h => exact.includes(h))
      || headers.find(h => h.toLowerCase().includes('email'))
      || null;
}

async function startCampaign(config) {
  const { rows, headers, template, attachment,
          sheetId, sheetName, mode, delay } = config;

  Object.assign(campaign, {
    isRunning: true, isPaused: false,
    currentIndex: 0, totalRows: rows.length,
    sentCount: 0, failedCount: 0, skippedCount: 0,
    rows, headers, template, attachment,
    sheetId, sheetName, mode, delay
  });

  // Ensure Status / Sent At columns
  const cols = await ensureStatusColumns(sheetId, sheetName, headers);
  campaign.statusColIndex  = cols.statusCol;
  campaign.sentAtColIndex  = cols.sentAtCol;
  campaign.draftIdColIndex = cols.draftIdCol;

  campaign.dailySentCount = await getDailySentCount();
  await persistState();
  broadcast('state');

  if (mode === 'realtime') {
    executeRealtime();
  } else {
    executeBackground();
  }
}

// ─── Real-time sending ───────────────────────────────────────────

async function executeRealtime() {
  const emailCol = findEmailColumn(campaign.headers);
  if (!emailCol) {
    broadcast('error', 'No "Email" column found in sheet headers.');
    stopCampaign();
    return;
  }

  for (let i = campaign.currentIndex; i < campaign.rows.length; i++) {
    // Stopped?
    if (!campaign.isRunning) break;

    // Paused — spin until resumed or stopped
    while (campaign.isPaused) {
      await new Promise(r => setTimeout(r, 500));
      if (!campaign.isRunning) return;
    }

    campaign.currentIndex = i;
    const row   = campaign.rows[i];

    // Skip rows already sent
    if (row['Status'] === 'Sent ✓') {
      campaign.skippedCount++;
      broadcast('state');
      continue;
    }

    const email = (row[emailCol] || '').trim();
    if (!email || !email.includes('@')) {
      campaign.failedCount++;
      await markRow(row._rowIndex, 'failed', 'Invalid email');
      broadcast('state');
      continue;
    }

    // Daily limit guard (stop at 490 to leave headroom)
    if (campaign.dailySentCount >= 490) {
      broadcast('error', 'Approaching Gmail daily limit (500). Campaign paused.');
      pauseCampaign();
      continue;
    }

    try {
      await markRow(row._rowIndex, 'pending');
      broadcast('state');

      const subject = parsePlaceholders(campaign.template.subject, row);
      const body    = parsePlaceholders(campaign.template.body, row);

      await sendEmailViaAPI(email, subject, body, campaign.attachment);

      campaign.sentCount++;
      campaign.dailySentCount++;
      await markRow(row._rowIndex, 'sent');
      await incrementDailySent();
      broadcast('state');

      // Smart delay (skip after last email)
      if (i < campaign.rows.length - 1 && campaign.isRunning && !campaign.isPaused) {
        await randomDelay(campaign.delay.min, campaign.delay.max);
      }
    } catch (err) {
      campaign.failedCount++;
      await markRow(row._rowIndex, 'failed', err.message);
      broadcast('state');

      // Exponential back-off on rate-limit
      if (err.message.includes('429') || err.message.toLowerCase().includes('rate')) {
        broadcast('error', 'Rate-limited by Gmail. Waiting 60 s …');
        await new Promise(r => setTimeout(r, 60000));
      }
    }
  }

  // Campaign finished
  if (campaign.isRunning) {
    campaign.isRunning = false;
    broadcast('complete');
  }
}

// ─── Background (draft) mode ────────────────────────────────────

async function executeBackground() {
  const emailCol = findEmailColumn(campaign.headers);
  if (!emailCol) {
    broadcast('error', 'No "Email" column found in sheet headers.');
    stopCampaign();
    return;
  }

  let queued = 0;

  for (let i = 0; i < campaign.rows.length; i++) {
    if (!campaign.isRunning) break;

    campaign.currentIndex = i;
    const row = campaign.rows[i];

    // Skip already processed rows
    if (row['Status'] === 'Sent ✓' || row['Status'] === 'Queued 📋') {
      campaign.skippedCount++;
      broadcast('state');
      continue;
    }

    const email = (row[emailCol] || '').trim();
    if (!email || !email.includes('@')) {
      campaign.failedCount++;
      await markRow(row._rowIndex, 'failed', 'Invalid email');
      broadcast('state');
      continue;
    }

    try {
      const subject = parsePlaceholders(campaign.template.subject, row);
      const body    = parsePlaceholders(campaign.template.body, row);

      const draft = await createDraftViaAPI(email, subject, body, campaign.attachment);

      // Store draft ID in sheet for the Apps Script to pick up
      if (campaign.draftIdColIndex > 0) {
        await writeCell(campaign.sheetId, campaign.sheetName,
                        row._rowIndex, campaign.draftIdColIndex, draft.id);
      }

      await markRow(row._rowIndex, 'queued');
      queued++;
      broadcast('state');
    } catch (err) {
      campaign.failedCount++;
      await markRow(row._rowIndex, 'failed', err.message);
      broadcast('state');
    }
  }

  campaign.isRunning = false;
  broadcast('backgroundComplete', { queuedCount: queued });
}

// ─── Controls ────────────────────────────────────────────────────

function pauseCampaign() {
  campaign.isPaused = true;
  broadcast('state');
  persistState();
}

function resumeCampaign() {
  campaign.isPaused = false;
  broadcast('state');
}

function stopCampaign() {
  campaign.isRunning = false;
  campaign.isPaused  = false;
  broadcast('state');
  persistState();
}

// ─── Row helpers ─────────────────────────────────────────────────

async function markRow(rowIndex, status, errorMsg) {
  await writeCell(campaign.sheetId, campaign.sheetName,
                  rowIndex, campaign.statusColIndex,
                  formatStatus(status, errorMsg));
  if (status === 'sent') {
    await writeCell(campaign.sheetId, campaign.sheetName,
                    rowIndex, campaign.sentAtColIndex,
                    getTimestamp());
  }
}

// ═══════════════════════════════════════════════════════════════════
//  STATE & DAILY TRACKING
// ═══════════════════════════════════════════════════════════════════

function uiState() {
  return {
    isRunning:      campaign.isRunning,
    isPaused:       campaign.isPaused,
    currentIndex:   campaign.currentIndex,
    totalRows:      campaign.totalRows,
    sentCount:      campaign.sentCount,
    failedCount:    campaign.failedCount,
    skippedCount:   campaign.skippedCount,
    dailySentCount: campaign.dailySentCount,
    mode:           campaign.mode
  };
}

function broadcast(type, extra = {}) {
  chrome.runtime.sendMessage({
    action: 'campaignUpdate',
    type,
    state: uiState(),
    ...extra
  }).catch(() => {}); // no listener is fine
}

async function persistState() {
  await chrome.storage.local.set({
    campaignState: {
      isRunning:    campaign.isRunning,
      isPaused:     campaign.isPaused,
      currentIndex: campaign.currentIndex,
      sentCount:    campaign.sentCount,
      failedCount:  campaign.failedCount,
      skippedCount: campaign.skippedCount,
      sheetId:      campaign.sheetId,
      sheetName:    campaign.sheetName,
      mode:         campaign.mode
    }
  });
}

async function getDailySentCount() {
  const r = await chrome.storage.local.get('dailySent');
  if (r.dailySent && r.dailySent.date === new Date().toDateString()) {
    return r.dailySent.count;
  }
  return 0;
}

async function incrementDailySent() {
  const today = new Date().toDateString();
  const r     = await chrome.storage.local.get('dailySent');
  const count = (r.dailySent?.date === today) ? r.dailySent.count : 0;
  await chrome.storage.local.set({ dailySent: { date: today, count: count + 1 } });
}

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
  accountMode: 'single',
  senders: [],
  currentSenderIndex: -1,
  delay: { min: 10000, max: 20000 },
  statusColIndex: -1,
  sentAtColIndex: -1,
  draftIdColIndex: -1,
  sentFromColIndex: -1,
  attachmentColIndex: -1
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
    // Auth & Account
    case 'authenticate':
      return { success: true, token: await getAuthToken() };
    case 'getAccountInfo':
      const accountData = await getAccountInfo();
      return { success: true, account: accountData, accountInfo: accountData };
    case 'addGoogleAccount':
      const newAccount = await addGoogleAccount(msg.webClientId);
      return { success: true, account: newAccount };

    // Sheets
    case 'fetchSheet':
      return { success: true, data: await fetchSheetData(msg.sheetUrl) };
    case 'fetchTab':
      return { success: true, data: await fetchSheetTab(msg.sheetId, msg.tabName || msg.sheetName) };
    case 'syncSheet':
      const syncTab = msg.tabName || msg.sheetName || 'Sheet1';
      return { success: true, data: await fetchSheetTab(msg.sheetId, syncTab) };

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
    case 'stopCloudCampaign':
      const stopResult = await stopCloudCampaign(msg.sheetId, msg.targetTab || msg.sheetName);
      stopCampaign();
      return { success: true, ...stopResult };

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
//  AUTH & ACCOUNT
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

/**
 * Fetch Gmail profile to detect Personal vs. Google Workspace account.
 */
async function getAccountInfo() {
  const token = await getAuthToken();
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Profile fetch failed: ${res.status}`);
  }
  const profile = await res.json();
  const email = (profile.emailAddress || '').trim();
  const isWorkspace = !/@(gmail|googlemail)\.com$/i.test(email);
  const accountType = isWorkspace ? 'Workspace' : 'Personal';

  return {
    email,
    accountType,
    isWorkspace,
    dailyLimitRealtime: isWorkspace ? 2000 : 500,
    dailyLimitCloud: isWorkspace ? 1500 : 100
  };
}

/**
 * Authenticate an additional Google Account via OAuth2 Web Auth Flow.
 * Enables connecting 2nd, 3rd, 4th, 5th+ Personal or Workspace accounts to the sender pool.
 */
async function addGoogleAccount(overrideClientId = null) {
  const stored = await chrome.storage.local.get('webClientId');
  const clientId = overrideClientId || stored.webClientId || chrome.runtime.getManifest().oauth2?.client_id;
  if (!clientId) {
    throw new Error('OAuth2 client_id not found.');
  }

  const redirectUrl = chrome.identity.getRedirectURL();
  const scopes = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/spreadsheets'
  ].join(' ');

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=token` +
    `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&prompt=select_account`;

  const responseUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      (res) => {
        if (chrome.runtime.lastError || !res) {
          const rawErr = chrome.runtime.lastError?.message || '';
          if (rawErr.includes('redirect_uri_mismatch') || rawErr.includes('bad request') || !res) {
            reject(new Error(rawErr || 'Authentication was cancelled or failed.'));
          } else {
            reject(new Error(rawErr));
          }
        } else {
          resolve(res);
        }
      }
    );
  });

  // Extract access token from URL fragment: ...#access_token=...&expires_in=...
  const urlObj = new URL(responseUrl);
  const hashParams = new URLSearchParams(urlObj.hash.substring(1));
  const token = hashParams.get('access_token');
  const expiresIn = parseInt(hashParams.get('expires_in') || '3600', 10);

  if (!token) {
    throw new Error('Failed to retrieve access token from Google.');
  }

  // Fetch account profile using the newly acquired access token
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Profile fetch failed: ${res.status}`);
  }
  const profile = await res.json();
  const email = (profile.emailAddress || '').trim();
  const isWorkspace = !/@(gmail|googlemail)\.com$/i.test(email);

  return {
    id: 'sender_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    email,
    name: email.split('@')[0],
    title: '',
    signature: '',
    phone: '',
    isWorkspace,
    accountType: isWorkspace ? 'Workspace' : 'Personal',
    dailyLimitRealtime: isWorkspace ? 2000 : 500,
    dailyLimitCloud: isWorkspace ? 1500 : 100,
    dailyLimit: isWorkspace ? 2000 : 500,
    token,
    tokenExpiresAt: Date.now() + (expiresIn * 1000),
    isPrimary: false,
    attachment: null
  };
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

async function apiPost(url, body) {
  const token = await getAuthToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API POST ${res.status}`);
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

async function apiDelete(url) {
  const token = await getAuthToken();
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API DELETE ${res.status}`);
  }
  return true;
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
  const safeTab = tabName || 'Sheet1';
  const data = await apiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(safeTab)}`
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
 * Ensure Status, Sent At (and Draft ID for background mode, plus Sent From & Attachment Sent for multi-account) columns exist.
 * Returns their 1-based column indices.
 */
async function ensureStatusColumns(sheetId, tabName, headers, isMultiAccount = false) {
  let statusCol     = headers.indexOf('Status');
  let sentAtCol     = headers.indexOf('Sent At');
  let draftIdCol    = headers.indexOf('Draft ID');
  let sentFromCol   = headers.indexOf('Sent From');
  let attachmentCol = headers.indexOf('Attachment Sent');

  const toAdd = [];
  if (statusCol  === -1) { statusCol  = headers.length + toAdd.length; toAdd.push('Status');   }
  if (sentAtCol  === -1) { sentAtCol  = headers.length + toAdd.length; toAdd.push('Sent At');  }
  if (isMultiAccount) {
    if (sentFromCol   === -1) { sentFromCol   = headers.length + toAdd.length; toAdd.push('Sent From'); }
    if (attachmentCol === -1) { attachmentCol = headers.length + toAdd.length; toAdd.push('Attachment Sent'); }
  }
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
    statusCol:     statusCol     + 1,
    sentAtCol:     sentAtCol     + 1,
    draftIdCol:    draftIdCol    !== -1 ? draftIdCol    + 1 : -1,
    sentFromCol:   sentFromCol   !== -1 ? sentFromCol   + 1 : -1,
    attachmentCol: attachmentCol !== -1 ? attachmentCol + 1 : -1
  };
}

// ═══════════════════════════════════════════════════════════════════
//  GMAIL API
// ═══════════════════════════════════════════════════════════════════

async function sendEmailViaAPI(to, subject, body, attachment, customToken = null) {
  const token = customToken || await getAuthToken();
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

async function createDraftViaAPI(to, subject, body, attachment, customToken = null) {
  const token = customToken || await getAuthToken();
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

/**
 * Pick next available sender in round-robin order that hasn't hit their daily limit.
 * Returns { sender, index } or null if all senders exhausted.
 */
function getNextAvailableSender(senders, lastIndex = -1) {
  if (!senders || senders.length === 0) return null;
  const n = senders.length;
  for (let step = 1; step <= n; step++) {
    const idx = (lastIndex + step) % n;
    const s = senders[idx];
    const sent = s.sentToday || 0;
    const limit = s.dailyLimit || (s.isWorkspace ? 2000 : 500);
    if (sent < limit) {
      return { sender: s, index: idx };
    }
  }
  return null;
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

/**
 * Identify the company column (case-insensitive search across headers).
 */
function findCompanyColumn(headers) {
  const exact = ['Company', 'company', 'COMPANY', 'Company Name', 'company name',
                 'Organization', 'organization', 'Employer', 'employer'];
  return headers.find(h => exact.includes(h))
      || headers.find(h => h.toLowerCase().includes('company'))
      || null;
}

/**
 * Write campaign configuration and schedule to _MailerConfig tab in Google Sheets.
 */
async function writeSheetConfig(sheetId, config) {
  if (!sheetId || !config) return;
  try {
    const meta = await apiFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`
    );
    const tabs = meta.sheets || [];
    const configTabExists = tabs.some(s => s.properties.title === '_MailerConfig');

    if (!configTabExists) {
      await apiPost(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
        {
          requests: [
            {
              addSheet: {
                properties: {
                  title: '_MailerConfig',
                  gridProperties: { rowCount: 25, columnCount: 3 }
                }
              }
            }
          ]
        }
      );
    }

    const schedule = config.schedule || {};
    const values = [
      ['Setting', 'Value'],
      ['status', 'Active'],
      ['scheduleType', schedule.scheduleType || 'dates'],
      ['targetTab', config.sheetName || 'Sheet1'],
      ['subject', config.template?.subject || ''],
      ['body', config.template?.body || ''],
      ['startDate', schedule.startDate || ''],
      ['endDate', schedule.endDate || ''],
      ['activeDays', schedule.scheduleType === 'days' && Array.isArray(schedule.activeDays) ? schedule.activeDays.join(',') : ''],
      ['startTime', schedule.startTime || '09:00'],
      ['endTime', schedule.endTime || '17:00'],
      ['batchSize', String(schedule.batchSize || 2)],
      ['delaySeconds', String(schedule.delaySeconds || 5)],
      ['dailyLimit', String(schedule.dailyLimit || 40)],
      ['allCompanyLimit', (config.companyLimits?.all !== null && config.companyLimits?.all !== undefined) ? String(config.companyLimits.all) : ''],
      ['companyLimits', JSON.stringify(config.companyLimits?.companies || {})],
      ['lastConfiguredAt', new Date().toISOString()]
    ];

    await apiPut(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/_MailerConfig!A1:B${values.length}?valueInputOption=RAW`,
      { values }
    );
  } catch (err) {
    console.error('Failed to write _MailerConfig tab:', err);
  }
}

async function stopCloudCampaign(sheetId, targetTab) {
  let clearedRowsCount = 0;
  let deletedDraftsCount = 0;

  try {
    // 1. Mark _MailerConfig status as Stopped
    try {
      const cfgData = await apiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/_MailerConfig!A1:B25`
      ).catch(() => null);

      let statusRow = 2;
      if (cfgData && cfgData.values) {
        const idx = cfgData.values.findIndex(r => r[0] && String(r[0]).trim().toLowerCase() === 'status');
        if (idx !== -1) statusRow = idx + 1;
      }

      await apiPut(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/_MailerConfig!A${statusRow}:B${statusRow}?valueInputOption=RAW`,
        { values: [['status', 'Stopped']] }
      );
    } catch (e) {
      console.warn('Could not update _MailerConfig status:', e);
    }

    // 2. Clear any 'Queued 📋' or 'Pending ⏳' rows in target tab & delete Gmail drafts
    if (targetTab) {
      const data = await apiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(targetTab)}`
      );
      const values = data.values || [];
      if (values.length >= 2) {
        const headers = values[0];
        const statusIdx = headers.indexOf('Status');
        const draftIdIdx = headers.indexOf('Draft ID');
        if (statusIdx !== -1) {
          const updates = [];
          for (let i = 1; i < values.length; i++) {
            const statusVal = values[i][statusIdx];
            if (statusVal === 'Queued 📋' || statusVal === 'Pending ⏳') {
              const rowNum = i + 1;
              clearedRowsCount++;

              // Delete corresponding draft from Gmail if ID exists
              if (draftIdIdx !== -1 && values[i][draftIdIdx]) {
                const draftId = values[i][draftIdIdx];
                try {
                  await apiDelete(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`);
                  deletedDraftsCount++;
                } catch (e) {
                  console.warn(`Could not delete draft ${draftId}:`, e);
                }
                const draftLetter = columnToLetter(draftIdIdx + 1);
                updates.push({
                  range: `${targetTab}!${draftLetter}${rowNum}`,
                  values: [['']]
                });
              }

              const colLetter = columnToLetter(statusIdx + 1);
              updates.push({
                range: `${targetTab}!${colLetter}${rowNum}`,
                values: [['']]
              });
            }
          }
          if (updates.length > 0) {
            await apiPost(
              `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
              {
                valueInputOption: 'RAW',
                data: updates
              }
            );
          }
        }
      }
    }

    return {
      clearedRows: clearedRowsCount,
      deletedDrafts: deletedDraftsCount
    };
  } catch (err) {
    console.error('Failed to stop cloud campaign:', err);
    throw err;
  }
}

async function startCampaign(config) {
  const { rows, headers, template, attachment,
          sheetId, sheetName, mode, delay,
          companyLimits, schedule,
          accountMode, senders } = config;

  const isMulti = accountMode === 'multi' && Array.isArray(senders) && senders.length > 0;

  Object.assign(campaign, {
    isRunning: true, isPaused: false,
    currentIndex: 0, totalRows: rows.length,
    sentCount: 0, failedCount: 0, skippedCount: 0,
    rows, headers, template, attachment,
    sheetId, sheetName, mode, delay,
    accountMode: isMulti ? 'multi' : 'single',
    senders: isMulti ? senders : (senders && senders.length > 0 ? [senders[0]] : []),
    currentSenderIndex: -1,
    companyLimits: companyLimits || { all: null, companies: {} },
    schedule: schedule || {},
    config
  });

  // Load today's sent count for all senders in the pool
  if (campaign.senders.length > 0) {
    for (const s of campaign.senders) {
      s.sentToday = await getSenderDailySent(s.email);
    }
  }

  // Ensure Status / Sent At (and Sent From / Attachment Sent if multi-account) columns
  const cols = await ensureStatusColumns(sheetId, sheetName, headers, isMulti);
  campaign.statusColIndex     = cols.statusCol;
  campaign.sentAtColIndex     = cols.sentAtCol;
  campaign.draftIdColIndex    = cols.draftIdCol;
  campaign.sentFromColIndex   = cols.sentFromCol;
  campaign.attachmentColIndex = cols.attachmentCol;

  campaign.dailySentCount = await getDailySentCount();
  await persistState();
  broadcast('state');

  if (mode === 'background') {
    await writeSheetConfig(sheetId, config);
    executeBackground();
  } else {
    executeRealtime();
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

  const companyCol = findCompanyColumn(campaign.headers);

  // Pre-seed company sent counts from existing rows marked 'Sent ✓', 'Queued 📋', or 'Pending ⏳'
  const companySentCount = {};
  if (companyCol) {
    for (const r of campaign.rows) {
      const s = String(r['Status'] || '').trim();
      if (s === 'Sent ✓' || s === 'Queued 📋' || s === 'Pending ⏳') {
        const c = (r[companyCol] || '').trim();
        if (c) companySentCount[c] = (companySentCount[c] || 0) + 1;
      }
    }
  }

  // Pre-seed seen emails to protect against duplicates (including already sent or reserved)
  const seenEmails = new Set();
  for (const r of campaign.rows) {
    const s = String(r['Status'] || '').trim();
    if (s === 'Sent ✓' || s === 'Queued 📋' || s === 'Pending ⏳') {
      const e = (r[emailCol] || '').trim().toLowerCase();
      if (e) seenEmails.add(e);
    }
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

    // Skip rows already sent or reserved by scheduler
    const rowStatus = String(row['Status'] || '').trim();
    if (rowStatus === 'Sent ✓' || rowStatus === 'Queued 📋' || rowStatus === 'Pending ⏳') {
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

    // Duplicate email protection: bypass if this email was already sent/seen
    const emailLower = email.toLowerCase();
    if (seenEmails.has(emailLower)) {
      campaign.skippedCount++;
      broadcast('state');
      continue; // Bypass without writing "Skipped" to sheet
    }

    // Company cap protection: check if company reached limit
    if (companyCol && campaign.companyLimits) {
      const company = (row[companyCol] || '').trim();
      const cap = (campaign.companyLimits.companies && campaign.companyLimits.companies[company] !== undefined)
        ? campaign.companyLimits.companies[company]
        : campaign.companyLimits.all;

      if (cap !== null && cap !== undefined && (companySentCount[company] || 0) >= cap) {
        campaign.skippedCount++;
        broadcast('state');
        continue; // Bypass without writing "Skipped" to sheet
      }
    }

    // Determine sender for this row
    let currentSender = null;
    if (campaign.accountMode === 'multi' && campaign.senders.length > 0) {
      const next = getNextAvailableSender(campaign.senders, campaign.currentSenderIndex);
      if (!next) {
        broadcast('error', 'All accounts in the sender pool have reached their daily limit. Campaign paused.');
        pauseCampaign();
        continue;
      }
      currentSender = next.sender;
      campaign.currentSenderIndex = next.index;
    } else if (campaign.senders.length > 0) {
      currentSender = campaign.senders[0];
      const limit = currentSender.dailyLimit || (currentSender.isWorkspace ? 2000 : 500);
      if ((currentSender.sentToday || 0) >= limit - 5) {
        broadcast('error', 'Approaching Gmail daily limit for active account. Campaign paused.');
        pauseCampaign();
        continue;
      }
    } else {
      // Fallback if no sender profile list attached
      if (campaign.dailySentCount >= 490) {
        broadcast('error', 'Approaching Gmail daily limit. Campaign paused.');
        pauseCampaign();
        continue;
      }
    }

    // Attachment priority: Sender-specific attachment override → Campaign master attachment
    const rowAttachment = (currentSender && currentSender.attachment) ? currentSender.attachment : campaign.attachment;
    const attachmentName = rowAttachment ? rowAttachment.name : '';

    try {
      await markRow(row._rowIndex, 'pending');
      broadcast('state');

      const subject = parsePlaceholders(campaign.template.subject, row, currentSender);
      const body    = parsePlaceholders(campaign.template.body, row, currentSender);
      const customToken = (currentSender && !currentSender.isPrimary && currentSender.token) ? currentSender.token : null;

      await sendEmailViaAPI(email, subject, body, rowAttachment, customToken);

      campaign.sentCount++;
      campaign.dailySentCount++;
      seenEmails.add(emailLower);
      if (companyCol) {
        const company = (row[companyCol] || '').trim();
        if (company) companySentCount[company] = (companySentCount[company] || 0) + 1;
      }

      if (currentSender) {
        currentSender.sentToday = (currentSender.sentToday || 0) + 1;
        currentSender.sentCount = (currentSender.sentCount || 0) + 1;
        await incrementSenderDailySent(currentSender.email);
      }

      await markRow(row._rowIndex, 'sent', null, currentSender?.email, attachmentName);
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

  const companyCol = findCompanyColumn(campaign.headers);

  // Pre-seed company sent counts from existing rows marked 'Sent ✓', 'Queued 📋', or 'Pending ⏳'
  const companySentCount = {};
  if (companyCol) {
    for (const r of campaign.rows) {
      const s = String(r['Status'] || '').trim();
      if (s === 'Sent ✓' || s === 'Queued 📋' || s === 'Pending ⏳') {
        const c = (r[companyCol] || '').trim();
        if (c) companySentCount[c] = (companySentCount[c] || 0) + 1;
      }
    }
  }

  // Pre-seed seen emails to protect against duplicates (including already sent or queued)
  const seenEmails = new Set();
  for (const r of campaign.rows) {
    const s = String(r['Status'] || '').trim();
    if (s === 'Sent ✓' || s === 'Queued 📋' || s === 'Pending ⏳') {
      const e = (r[emailCol] || '').trim().toLowerCase();
      if (e) seenEmails.add(e);
    }
  }

  let queued = 0;

  for (let i = 0; i < campaign.rows.length; i++) {
    if (!campaign.isRunning) break;

    campaign.currentIndex = i;
    const row = campaign.rows[i];

    // Skip already processed rows
    const rowStatus = String(row['Status'] || '').trim();
    if (rowStatus === 'Sent ✓' || rowStatus === 'Queued 📋' || rowStatus === 'Pending ⏳') {
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

    // Duplicate email protection
    const emailLower = email.toLowerCase();
    if (seenEmails.has(emailLower)) {
      campaign.skippedCount++;
      broadcast('state');
      continue;
    }

    // Company cap protection
    if (companyCol && campaign.companyLimits) {
      const company = (row[companyCol] || '').trim();
      const cap = (campaign.companyLimits.companies && campaign.companyLimits.companies[company] !== undefined)
        ? campaign.companyLimits.companies[company]
        : campaign.companyLimits.all;

      if (cap !== null && cap !== undefined && (companySentCount[company] || 0) >= cap) {
        campaign.skippedCount++;
        broadcast('state');
        continue;
      }
    }

    // Determine sender for this draft
    let currentSender = null;
    if (campaign.accountMode === 'multi' && campaign.senders.length > 0) {
      const next = getNextAvailableSender(campaign.senders, campaign.currentSenderIndex);
      if (next) {
        currentSender = next.sender;
        campaign.currentSenderIndex = next.index;
      }
    } else if (campaign.senders.length > 0) {
      currentSender = campaign.senders[0];
    }

    const rowAttachment = (currentSender && currentSender.attachment) ? currentSender.attachment : campaign.attachment;
    const attachmentName = rowAttachment ? rowAttachment.name : '';

    try {
      const subject = parsePlaceholders(campaign.template.subject, row, currentSender);
      const body    = parsePlaceholders(campaign.template.body, row, currentSender);
      const customToken = (currentSender && !currentSender.isPrimary && currentSender.token) ? currentSender.token : null;

      const draft = await createDraftViaAPI(email, subject, body, rowAttachment, customToken);

      // Store draft ID in sheet for the Apps Script to pick up
      if (campaign.draftIdColIndex > 0) {
        await writeCell(campaign.sheetId, campaign.sheetName,
                        row._rowIndex, campaign.draftIdColIndex, draft.id);
      }

      await markRow(row._rowIndex, 'queued', null, currentSender?.email, attachmentName);
      queued++;
      seenEmails.add(emailLower);
      if (companyCol) {
        const company = (row[companyCol] || '').trim();
        if (company) companySentCount[company] = (companySentCount[company] || 0) + 1;
      }
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

async function markRow(rowIndex, status, errorMsg, senderEmail = null, attachmentName = null) {
  await writeCell(campaign.sheetId, campaign.sheetName,
                  rowIndex, campaign.statusColIndex,
                  formatStatus(status, errorMsg));
  if (status === 'sent') {
    await writeCell(campaign.sheetId, campaign.sheetName,
                    rowIndex, campaign.sentAtColIndex,
                    getTimestamp());
    if (campaign.sentFromColIndex > 0 && senderEmail) {
      await writeCell(campaign.sheetId, campaign.sheetName,
                      rowIndex, campaign.sentFromColIndex,
                      senderEmail);
    }
    if (campaign.attachmentColIndex > 0 && attachmentName) {
      await writeCell(campaign.sheetId, campaign.sheetName,
                      rowIndex, campaign.attachmentColIndex,
                      attachmentName);
    }
  } else if (status === 'queued') {
    if (campaign.sentFromColIndex > 0 && senderEmail) {
      await writeCell(campaign.sheetId, campaign.sheetName,
                      rowIndex, campaign.sentFromColIndex,
                      senderEmail);
    }
    if (campaign.attachmentColIndex > 0 && attachmentName) {
      await writeCell(campaign.sheetId, campaign.sheetName,
                      rowIndex, campaign.attachmentColIndex,
                      attachmentName);
    }
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

async function getSenderDailySent(email) {
  if (!email) return 0;
  const key = `dailySent_${email.toLowerCase()}`;
  const r = await chrome.storage.local.get(key);
  if (r[key] && r[key].date === new Date().toDateString()) {
    return r[key].count || 0;
  }
  return 0;
}

async function incrementSenderDailySent(email) {
  if (!email) return;
  const today = new Date().toDateString();
  const key = `dailySent_${email.toLowerCase()}`;
  const r = await chrome.storage.local.get(key);
  const count = (r[key]?.date === today) ? (r[key].count || 0) : 0;
  await chrome.storage.local.set({ [key]: { date: today, count: count + 1 } });
}

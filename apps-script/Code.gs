/**
 * Mass Mailer — Google Apps Script (Autonomous Cloud Scheduler)
 *
 * This script runs 24/7 on Google Cloud even when your laptop is turned OFF.
 * All settings (status, schedule dates/days, hours, batch size, delays, caps)
 * are read transparently and dynamically from the `_MailerConfig` tab in your sheet.
 *
 * It respects:
 *   - Campaign status (if marked "Stopped", sending ceases immediately)
 *   - Schedule method:
 *       • Specific Dates: sends every day in the date range during business hours
 *       • Days of Week: sends only on selected recurring days of the week
 *   - Configurable batch size & delay (set directly from the extension)
 *   - Company-level email limits (leaves capped rows clean & untouched)
 *   - Duplicate email guards (only sends once per email address)
 *   - Daily send limits
 *   - Live sheet additions (new rows added while laptop is off get sent automatically!)
 *
 * QUICK SETUP (One-Time):
 *   1. Open your Google Sheet
 *   2. Click "Extensions" → "Apps Script" (or paste this into https://script.google.com)
 *   3. If this script is NOT bound to the sheet, set SHEET_ID below.
 *   4. Select "setup" from the function dropdown and click "Run".
 *   5. Grant permissions when prompted. That's it!
 *
 * TO STOP: Select "teardown" and click "Run" (or click Stop in the extension).
 */

// ═══════════════════════════════════════════════════════════════════
//  CONFIG — Optional if bound to your Google Sheet
// ═══════════════════════════════════════════════════════════════════

/** Spreadsheet ID (only needed if using standalone Apps Script project) */
const SHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID_HERE';

/** Fallback tab name if _MailerConfig is not present */
const DEFAULT_SHEET_TAB = 'Sheet1';

// ═══════════════════════════════════════════════════════════════════
//  TRIGGERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Creates the automated background trigger (runs every 5 minutes).
 */
function setup() {
  teardown();

  ScriptApp.newTrigger('processQueue')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('✅ Trigger created! Mass Mailer Cloud Scheduler will run every 5 minutes.');
}

/**
 * Removes all active triggers and stops cloud sending.
 */
function teardown() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'processQueue') {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log('🛑 All processQueue triggers removed.');
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN PROCESSOR
// ═══════════════════════════════════════════════════════════════════

function processQueue() {
  const ss = getSpreadsheet();
  if (!ss) {
    Logger.log('❌ Could not open spreadsheet. Check SHEET_ID or bind script to the sheet.');
    return;
  }

  // 1. Read configuration from _MailerConfig tab
  const config = readMailerConfig(ss) || {};

  // Check Status
  if (config.status === 'Stopped' || config.Status === 'Stopped') {
    Logger.log('🛑 Campaign is marked Stopped in _MailerConfig. Skipping run.');
    return;
  }

  const targetTabName = config.targetTab || DEFAULT_SHEET_TAB;
  const sheet = ss.getSheetByName(targetTabName);

  if (!sheet) {
    Logger.log(`❌ Target tab "${targetTabName}" not found.`);
    return;
  }

  // 2. Check schedule gatekeeper (Dates vs Days, Working Hours)
  if (!isWithinSchedule(config)) {
    return;
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    Logger.log('📭 Sheet has no data rows.');
    return;
  }

  const headers = data[0].map(h => String(h).trim());

  // Find column indexes
  const statusIdx   = findCol(headers, ['Status']);
  const sentAtIdx   = findCol(headers, ['Sent At', 'SentAt', 'Sent Date']);
  const draftIdIdx  = findCol(headers, ['Draft ID', 'DraftId']);
  const emailIdx    = findCol(headers, ['Email', 'email', 'E-mail', 'Mail', 'Email Address']);
  const compIdx     = findCol(headers, ['Company', 'company', 'Company Name', 'Organization', 'Employer']);
  const sentFromIdx = findCol(headers, ['Sent From', 'SentFrom', 'Sender Email', 'Sent By']);

  if (statusIdx === -1) {
    Logger.log('❌ "Status" column not found. Connect the sheet in the extension first.');
    return;
  }

  // 3. Daily limit & batch size check (read dynamically from config)
  const dailyLimit = parseInt(config.dailyLimit, 10) || 40;
  const batchSize = parseInt(config.batchSize, 10) || 2;
  const delaySeconds = parseInt(config.delaySeconds, 10) || 5;

  let todaySentCount = countTodaySent(sheet, sentAtIdx);
  if (todaySentCount >= dailyLimit) {
    Logger.log(`🎯 Daily send limit of ${dailyLimit} reached for today (${todaySentCount} already sent).`);
    return;
  }

  // 4. Parse company caps
  let masterCap = null;
  if (config.allCompanyLimit !== undefined && config.allCompanyLimit !== '' && !isNaN(parseInt(config.allCompanyLimit, 10))) {
    masterCap = parseInt(config.allCompanyLimit, 10);
  }
  let specificCaps = {};
  if (config.companyLimits) {
    try {
      specificCaps = (typeof config.companyLimits === 'object') ? config.companyLimits : JSON.parse(config.companyLimits);
    } catch (e) {}
  }

  // 5. Pre-seed seen emails & company counts from existing 'Sent ✓' rows
  const seenEmails = {};
  const companySentCount = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[statusIdx] === 'Sent ✓') {
      if (emailIdx !== -1) {
        const e = String(row[emailIdx] || '').trim().toLowerCase();
        if (e) seenEmails[e] = true;
      }
      if (compIdx !== -1) {
        const c = String(row[compIdx] || '').trim();
        if (c) companySentCount[c] = (companySentCount[c] || 0) + 1;
      }
    }
  }

  // 6. Find and send candidate rows
  const maxToSend = Math.min(batchSize, dailyLimit - todaySentCount);
  let sentInThisRun = 0;

  for (let i = 1; i < data.length && sentInThisRun < maxToSend; i++) {
    const row = data[i];
    const status = String(row[statusIdx] || '').trim();
    const draftId = draftIdIdx !== -1 ? String(row[draftIdIdx] || '').trim() : '';
    const email = emailIdx !== -1 ? String(row[emailIdx] || '').trim() : '';
    const company = compIdx !== -1 ? String(row[compIdx] || '').trim() : '';
    const rowNum = i + 1;

    // Skip already sent rows
    if (status === 'Sent ✓') continue;

    // Must have an email address
    if (!email || !email.includes('@')) {
      continue;
    }

    // Duplicate email guard: skip without tagging
    const emailLower = email.toLowerCase();
    if (seenEmails[emailLower]) {
      continue;
    }

    // Company cap guard: skip without tagging
    if (compIdx !== -1) {
      const cap = (specificCaps && specificCaps[company] !== undefined)
        ? specificCaps[company]
        : (masterCap !== null ? masterCap : Infinity);

      if ((companySentCount[company] || 0) >= cap) {
        continue; // Company reached cap, leave clean
      }
    }

    // Ready to send
    try {
      sheet.getRange(rowNum, statusIdx + 1).setValue('Pending ⏳');
      SpreadsheetApp.flush();

      if (draftId) {
        // Send existing Gmail draft
        const draft = GmailApp.getDraft(draftId);
        draft.send();
        if (draftIdIdx !== -1) {
          sheet.getRange(rowNum, draftIdIdx + 1).setValue('');
        }
      } else {
        // Direct zero-touch send using template in _MailerConfig
        const rowMap = {};
        headers.forEach((h, colI) => { rowMap[h] = row[colI]; });

        const subjectTemplate = config.subject || 'Follow up';
        const bodyTemplate    = config.body || '';

        const subject = parsePlaceholders(subjectTemplate, rowMap);
        const body    = parsePlaceholders(bodyTemplate, rowMap);
        const html    = bodyToHtml(body);

        GmailApp.sendEmail(email, subject, body, {
          htmlBody: html
        });
      }

      // Mark Sent
      sheet.getRange(rowNum, statusIdx + 1).setValue('Sent ✓');
      if (sentAtIdx !== -1) {
        const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
        sheet.getRange(rowNum, sentAtIdx + 1).setValue(nowStr);
      }
      if (sentFromIdx !== -1) {
        const activeSender = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
        if (activeSender) {
          sheet.getRange(rowNum, sentFromIdx + 1).setValue(activeSender);
        }
      }

      sentInThisRun++;
      todaySentCount++;
      seenEmails[emailLower] = true;
      if (company) {
        companySentCount[company] = (companySentCount[company] || 0) + 1;
      }

      Logger.log(`✅ Sent email to ${email} (Row ${rowNum})`);

      // Configurable jitter delay between multiple sends in the same batch
      if (sentInThisRun < maxToSend) {
        const jitterMs = Math.max(1000, delaySeconds * 1000 + Math.floor((Math.random() - 0.5) * 2000));
        Utilities.sleep(jitterMs);
      }

    } catch (err) {
      sheet.getRange(rowNum, statusIdx + 1).setValue('Failed ✗ (' + err.message + ')');
      Logger.log(`❌ Error sending row ${rowNum}: ${err.message}`);
    }
  }

  if (sentInThisRun === 0) {
    Logger.log('📭 No eligible unsent emails found in this run.');
  } else {
    Logger.log(`📤 Cloud Scheduler sent ${sentInThisRun} email(s) this run. Today's total: ${todaySentCount}/${dailyLimit}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════

function getSpreadsheet() {
  if (typeof SHEET_ID !== 'undefined' && SHEET_ID && SHEET_ID !== 'PASTE_YOUR_SPREADSHEET_ID_HERE') {
    try {
      return SpreadsheetApp.openById(SHEET_ID);
    } catch (e) {
      Logger.log('Could not open spreadsheet by ID: ' + e.message);
    }
  }
  try {
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    return null;
  }
}

function readMailerConfig(ss) {
  const cfgSheet = ss.getSheetByName('_MailerConfig');
  if (!cfgSheet) return null;

  const data = cfgSheet.getDataRange().getValues();
  const config = {};
  for (let i = 1; i < data.length; i++) {
    const k = String(data[i][0]).trim();
    const v = data[i][1];
    if (k) config[k] = v;
  }
  return config;
}

function isWithinSchedule(config) {
  const now = new Date();
  const tz = Session.getScriptTimeZone();
  const todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  const scheduleType = config.scheduleType || (config.activeDays ? 'days' : 'dates');

  if (scheduleType === 'dates') {
    // 1. Date Range Check (strictly dates — day-of-week is NOT restricted)
    if (config.startDate && todayStr < String(config.startDate).trim()) {
      Logger.log(`⏸ Start date ${config.startDate} not reached yet (today is ${todayStr}).`);
      return false;
    }
    if (config.endDate && String(config.endDate).trim() && todayStr > String(config.endDate).trim()) {
      Logger.log(`⏸ End date ${config.endDate} has passed (today is ${todayStr}).`);
      return false;
    }
  } else {
    // 2. Days of Week Check (recurring weekly schedule)
    if (config.startDate && todayStr < String(config.startDate).trim()) {
      Logger.log(`⏸ Start date ${config.startDate} not reached yet (today is ${todayStr}).`);
      return false;
    }
    if (config.activeDays !== undefined && config.activeDays !== '') {
      const todayDay = now.getDay();
      const allowed = String(config.activeDays).split(',').map(d => parseInt(d.trim(), 10));
      if (allowed.indexOf(todayDay) === -1) {
        Logger.log(`⏸ Today (day ${todayDay}) is not an active scheduled day.`);
        return false;
      }
    }
  }

  // 3. Time Window Check (e.g. 09:00 - 17:00)
  const startTime = config.startTime || '09:00';
  const endTime   = config.endTime   || '17:00';
  const nowTime   = Utilities.formatDate(now, tz, 'HH:mm');

  if (nowTime < startTime || nowTime > endTime) {
    Logger.log(`⏸ Outside active hours (${startTime} to ${endTime}). Current time: ${nowTime}`);
    return false;
  }

  return true;
}

function countTodaySent(sheet, sentAtIdx) {
  if (sentAtIdx === -1) return 0;
  const data = sheet.getDataRange().getValues();
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const val = String(data[i][sentAtIdx] || '');
    if (val.indexOf(todayStr) !== -1) {
      count++;
    }
  }
  return count;
}

function findCol(headers, candidates) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i]).trim().toLowerCase();
    for (let j = 0; j < candidates.length; j++) {
      if (h === candidates[j].toLowerCase()) return i;
    }
  }
  return -1;
}

function parsePlaceholders(template, rowData, senderProfile) {
  if (!template) return '';
  return template.replace(/\{\{?([A-Za-z0-9_.\s]+)\}?\}/g, (match, rawKey) => {
    const key = rawKey.trim();
    if (key.startsWith('Sender.')) {
      const field = key.slice(7).toLowerCase();
      const profile = senderProfile || {
        email: Session.getActiveUser().getEmail() || '',
        name: (Session.getActiveUser().getEmail() || '').split('@')[0]
      };
      if (field === 'name') return profile.name || profile.email || '';
      if (field === 'email') return profile.email || '';
      if (field === 'title') return profile.title || '';
      if (field === 'signature') return profile.signature || '';
      if (field === 'phone') return profile.phone || '';
      return profile[key.slice(7)] || '';
    }
    if (rowData && Object.prototype.hasOwnProperty.call(rowData, key)) {
      const val = rowData[key];
      return (val !== undefined && val !== null) ? String(val).trim() : '';
    }
    return match;
  });
}

function bodyToHtml(bodyText) {
  if (!bodyText) return '';
  const normalized = bodyText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = normalized.split(/\n\s*\n+/);

  const htmlParagraphs = paragraphs.map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    const escapedLines = lines.map(l => escapeHtml(l));
    return `<p style="margin:0 0 14px 0;line-height:1.6;font-family:sans-serif;color:#202124;font-size:14px;">${escapedLines.join('<br>')}</p>`;
  }).filter(Boolean);

  return `<div style="font-family:sans-serif;font-size:14px;color:#202124;line-height:1.6;">${htmlParagraphs.join('')}</div>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

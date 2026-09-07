/**
 * Mass Mailer — Google Apps Script (Background Sender)
 *
 * This script runs in Google's cloud on a timed trigger.
 * It reads your Google Sheet, finds rows marked "Queued 📋",
 * sends the corresponding Gmail draft, and updates the status.
 *
 * SETUP (one-time):
 *   1. Go to https://script.google.com  →  New Project
 *   2. Paste this entire file into Code.gs
 *   3. Update SHEET_ID and SHEET_TAB below
 *   4. Run  setup()  once  (it will ask for permissions)
 *   5. Done! The trigger will send one draft every minute.
 *
 * To STOP sending, run  teardown()  to remove the trigger.
 */

// ═══════════════════════════════════════════════════════════════════
//  CONFIG — Update these two values
// ═══════════════════════════════════════════════════════════════════

/** Spreadsheet ID (from the sheet URL: /spreadsheets/d/<THIS_PART>/edit) */
const SHEET_ID  = 'PASTE_YOUR_SPREADSHEET_ID_HERE';

/** Tab / sheet name containing the campaign data */
const SHEET_TAB = 'Sheet1';

// ─── How many drafts to send per trigger execution ───────────────
const BATCH_SIZE = 1;  // Keep at 1 for safety; increase if comfortable

// ═══════════════════════════════════════════════════════════════════
//  SETUP & TEARDOWN
// ═══════════════════════════════════════════════════════════════════

/**
 * Run this once to create a time-based trigger (every 1 minute).
 * You can change the interval below.
 */
function setup() {
  // Remove existing triggers first
  teardown();

  ScriptApp.newTrigger('processQueue')
    .timeBased()
    .everyMinutes(1)   // Change to 5, 10, etc. for larger delays
    .create();

  Logger.log('✅ Trigger created. Drafts will be sent every 1 minute.');
}

/**
 * Run this to stop all sending.
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
//  MAIN — Called by the timed trigger
// ═══════════════════════════════════════════════════════════════════

function processQueue() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_TAB);
  if (!sheet) {
    Logger.log(`❌ Tab "${SHEET_TAB}" not found.`);
    return;
  }

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];

  // Find column indices
  const statusIdx  = headers.indexOf('Status');
  const sentAtIdx  = headers.indexOf('Sent At');
  const draftIdIdx = headers.indexOf('Draft ID');

  if (statusIdx === -1 || draftIdIdx === -1) {
    Logger.log('❌ Missing "Status" or "Draft ID" column. Did the extension run first?');
    return;
  }

  let sent = 0;

  for (let i = 1; i < data.length && sent < BATCH_SIZE; i++) {
    const row     = data[i];
    const status  = row[statusIdx];
    const draftId = row[draftIdIdx];

    // Only process queued rows with a draft ID
    if (status !== 'Queued 📋' || !draftId) continue;

    const rowNum = i + 1; // 1-indexed for sheet

    try {
      // Mark as Pending
      sheet.getRange(rowNum, statusIdx + 1).setValue('Pending ⏳');
      SpreadsheetApp.flush();

      // Send the draft
      const draft = GmailApp.getDraft(draftId);
      draft.send();

      // Mark as Sent
      sheet.getRange(rowNum, statusIdx + 1).setValue('Sent ✓');
      if (sentAtIdx !== -1) {
        const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
        sheet.getRange(rowNum, sentAtIdx + 1).setValue(now);
      }
      // Clear draft ID (draft no longer exists after sending)
      sheet.getRange(rowNum, draftIdIdx + 1).setValue('');

      sent++;
      Logger.log(`✅ Row ${rowNum}: Sent successfully.`);

    } catch (err) {
      sheet.getRange(rowNum, statusIdx + 1).setValue('Failed ✗ (' + err.message + ')');
      Logger.log(`❌ Row ${rowNum}: ${err.message}`);
    }
  }

  if (sent === 0) {
    Logger.log('📭 No queued drafts found. Queue is empty or all sent.');
    // Optional: auto-remove trigger when done
    // teardown();
  } else {
    Logger.log(`📤 Sent ${sent} email(s) this run.`);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITY — Manual test
// ═══════════════════════════════════════════════════════════════════

/**
 * Run this to check how many queued drafts remain.
 */
function checkQueue() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_TAB);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const statusIdx = headers.indexOf('Status');

  let queued = 0, sent = 0, failed = 0;
  for (let i = 1; i < data.length; i++) {
    const s = data[i][statusIdx];
    if (s === 'Queued 📋') queued++;
    else if (s === 'Sent ✓') sent++;
    else if (String(s).startsWith('Failed')) failed++;
  }

  Logger.log(`📊 Queue status: ${queued} queued, ${sent} sent, ${failed} failed`);
}

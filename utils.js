/**
 * Mass Mailer — Shared Utilities
 * Placeholder replacement, MIME building, and helper functions.
 */

/**
 * Replace {placeholder} tokens in a template with values from row data.
 * Matching is CASE-SENSITIVE: {Company Name} ≠ {company name}.
 *
 * @param {string} template - Template string with {placeholder} syntax
 * @param {Object} rowData  - Column header → cell value map from the sheet row
 * @returns {string} Template with placeholders filled in
 */
function parsePlaceholders(template, rowData) {
  return template.replace(/\{([^}]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(rowData, key)) {
      return rowData[key] ?? '';
    }
    return match; // Leave unmatched placeholders as-is
  });
}

/**
 * Build an RFC 2822 MIME message.
 * Plain-text only.  Supports an optional binary attachment encoded as base64.
 *
 * @param {string}      to         - Recipient email address
 * @param {string}      subject    - Email subject line
 * @param {string}      body       - Plain-text body
 * @param {Object|null} attachment - { name: string, mimeType: string, base64Data: string } or null
 * @returns {string} Complete MIME message
 */
function buildMimeMessage(to, subject, body, attachment = null) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

  // Encode subject for UTF-8 safety (RFC 2047)
  const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;

  let message = '';

  if (attachment) {
    message += `To: ${to}\r\n`;
    message += `Subject: ${encodedSubject}\r\n`;
    message += `MIME-Version: 1.0\r\n`;
    message += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
    message += `\r\n`;
    // Text part
    message += `--${boundary}\r\n`;
    message += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    message += `Content-Transfer-Encoding: 7bit\r\n`;
    message += `\r\n`;
    message += `${body}\r\n`;
    // Attachment part
    message += `--${boundary}\r\n`;
    message += `Content-Type: ${attachment.mimeType}; name="${attachment.name}"\r\n`;
    message += `Content-Disposition: attachment; filename="${attachment.name}"\r\n`;
    message += `Content-Transfer-Encoding: base64\r\n`;
    message += `\r\n`;
    // Split base64 into 76-char lines per RFC 2045
    const b64 = attachment.base64Data;
    for (let i = 0; i < b64.length; i += 76) {
      message += b64.substring(i, i + 76) + '\r\n';
    }
    message += `--${boundary}--`;
  } else {
    message += `To: ${to}\r\n`;
    message += `Subject: ${encodedSubject}\r\n`;
    message += `MIME-Version: 1.0\r\n`;
    message += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    message += `Content-Transfer-Encoding: 7bit\r\n`;
    message += `\r\n`;
    message += body;
  }

  return message;
}

/**
 * Encode a string to base64url (used by the Gmail API raw field).
 * Handles UTF-8 correctly.
 *
 * @param {string} str
 * @returns {string} base64url-encoded string
 */
function base64UrlEncode(str) {
  const encoder = new TextEncoder();
  const bytes   = encoder.encode(str);
  let binary    = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Extract the spreadsheet ID from any Google Sheets URL format.
 *
 * @param {string} url - Full URL or bare ID
 * @returns {string|null} Spreadsheet ID, or null if unparseable
 */
function extractSheetId(url) {
  if (!url) return null;
  url = url.trim();

  const patterns = [
    /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,   // Standard URL
    /\/d\/([a-zA-Z0-9_-]+)/,                  // Shortened
    /^([a-zA-Z0-9_-]{20,})$/                   // Bare ID (20+ chars)
  ];

  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Promise-based random delay between min and max milliseconds.
 *
 * @param {number} minMs
 * @param {number} maxMs
 * @returns {Promise<void>}
 */
function randomDelay(minMs, maxMs) {
  const ms = Math.floor(minMs + Math.random() * (maxMs - minMs));
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format a status string with emoji for display in the sheet.
 *
 * @param {'sent'|'failed'|'pending'|'queued'} status
 * @param {string} [errorMsg]
 * @returns {string}
 */
function formatStatus(status, errorMsg = '') {
  switch (status) {
    case 'sent':    return 'Sent ✓';
    case 'failed':  return `Failed ✗${errorMsg ? ' (' + errorMsg + ')' : ''}`;
    case 'pending': return 'Pending ⏳';
    case 'queued':  return 'Queued 📋';
    default:        return status;
  }
}

/**
 * Localised timestamp for the "Sent At" sheet column.
 * @returns {string}
 */
function getTimestamp() {
  return new Date().toLocaleString('en-IN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
}

/**
 * Convert a 1-based column number to a spreadsheet letter (1 → A, 27 → AA).
 * @param {number} col
 * @returns {string}
 */
function columnToLetter(col) {
  let letter = '';
  while (col > 0) {
    const mod = (col - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

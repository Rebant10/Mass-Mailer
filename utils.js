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
      const val = rowData[key];
      return (val !== undefined && val !== null) ? String(val).trim() : '';
    }
    return match; // Leave unmatched placeholders as-is
  });
}

/**
 * Convert a UTF-8 string to base64.
 * Safe across browser window, Chrome extension service workers, and Node.js.
 *
 * @param {string} str
 * @returns {string} base64-encoded string
 */
function toBase64Utf8(str) {
  if (typeof TextEncoder !== 'undefined') {
    const encoder = new TextEncoder();
    const bytes   = encoder.encode(str);
    let binary    = '';
    const len     = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64');
  }
  return btoa(unescape(encodeURIComponent(str)));
}

/**
 * Wrap base64 string into 76-character lines per RFC 2045.
 *
 * @param {string} b64
 * @returns {string}
 */
function wrapBase64(b64) {
  if (!b64) return '';
  const clean = b64.replace(/[\r\n]/g, '');
  let res = '';
  for (let i = 0; i < clean.length; i += 76) {
    res += clean.substring(i, i + 76) + '\r\n';
  }
  return res.trimEnd();
}

/**
 * Escape HTML special characters for safe email embedding.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Convert plain-text email body into responsive, beautifully styled HTML.
 * Double newlines create paragraphs (<p>), and every line break intentionally
 * added by the user (Enter) is preserved with <br>, while continuous sentences
 * reflow responsively across all screen sizes.
 *
 * @param {string} bodyText
 * @returns {string} Complete responsive HTML document string
 */
function bodyToHtml(bodyText) {
  if (!bodyText) return '';
  const normalized = bodyText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = normalized.split(/\n\s*\n+/);

  const htmlParagraphs = paragraphs.map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';

    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return '';

    // If the user explicitly pressed Enter to create separate lines, preserve them
    const formattedLines = lines.map(line => escapeHtml(line)).join('<br>\n');
    return `<p style="margin: 0 0 1em 0; line-height: 1.6;">${formattedLines}</p>`;
  }).filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #222222; margin: 0; padding: 0;">
${htmlParagraphs}
</body>
</html>`;
}

/**
 * Build an RFC 2822 / RFC 2046 MIME message.
 * Generates multipart/alternative with both text/plain and responsive text/html
 * (both base64 encoded for UTF-8 and line-length safety), nested in multipart/mixed
 * if an attachment is provided.
 *
 * @param {string}      to         - Recipient email address
 * @param {string}      subject    - Email subject line
 * @param {string}      body       - Email body
 * @param {Object|null} attachment - { name: string, mimeType: string, base64Data: string } or null
 * @returns {string} Complete MIME message
 */
function buildMimeMessage(to, subject, body, attachment = null) {
  const boundaryMixed = `boundary_mixed_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const boundaryAlt   = `boundary_alt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Encode subject for UTF-8 safety (RFC 2047)
  const encodedSubject = `=?UTF-8?B?${toBase64Utf8(subject)}?=`;

  const htmlBody     = bodyToHtml(body);
  const plainBodyB64 = wrapBase64(toBase64Utf8(body));
  const htmlBodyB64  = wrapBase64(toBase64Utf8(htmlBody));

  let message = '';

  if (attachment) {
    message += `To: ${to}\r\n`;
    message += `Subject: ${encodedSubject}\r\n`;
    message += `MIME-Version: 1.0\r\n`;
    message += `Content-Type: multipart/mixed; boundary="${boundaryMixed}"\r\n`;
    message += `\r\n`;

    // Alternative part (text + html)
    message += `--${boundaryMixed}\r\n`;
    message += `Content-Type: multipart/alternative; boundary="${boundaryAlt}"\r\n`;
    message += `\r\n`;

    message += `--${boundaryAlt}\r\n`;
    message += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    message += `Content-Transfer-Encoding: base64\r\n`;
    message += `\r\n`;
    message += `${plainBodyB64}\r\n`;

    message += `--${boundaryAlt}\r\n`;
    message += `Content-Type: text/html; charset="UTF-8"\r\n`;
    message += `Content-Transfer-Encoding: base64\r\n`;
    message += `\r\n`;
    message += `${htmlBodyB64}\r\n`;

    message += `--${boundaryAlt}--\r\n`;

    // Attachment part
    message += `--${boundaryMixed}\r\n`;
    message += `Content-Type: ${attachment.mimeType}; name="${attachment.name}"\r\n`;
    message += `Content-Disposition: attachment; filename="${attachment.name}"\r\n`;
    message += `Content-Transfer-Encoding: base64\r\n`;
    message += `\r\n`;
    message += `${wrapBase64(attachment.base64Data)}\r\n`;

    message += `--${boundaryMixed}--`;
  } else {
    message += `To: ${to}\r\n`;
    message += `Subject: ${encodedSubject}\r\n`;
    message += `MIME-Version: 1.0\r\n`;
    message += `Content-Type: multipart/alternative; boundary="${boundaryAlt}"\r\n`;
    message += `\r\n`;

    message += `--${boundaryAlt}\r\n`;
    message += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    message += `Content-Transfer-Encoding: base64\r\n`;
    message += `\r\n`;
    message += `${plainBodyB64}\r\n`;

    message += `--${boundaryAlt}\r\n`;
    message += `Content-Type: text/html; charset="UTF-8"\r\n`;
    message += `Content-Transfer-Encoding: base64\r\n`;
    message += `\r\n`;
    message += `${htmlBodyB64}\r\n`;

    message += `--${boundaryAlt}--`;
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

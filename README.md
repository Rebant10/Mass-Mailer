# Mass Mailer — Chrome Extension

> Send personalised cold emails from Gmail using Google Sheets data, with smart delays, resume support, and background sending.

## Features

- 📊 **Google Sheets integration** — auto-detects columns from your sheet headers
- ✉️ **Case-sensitive placeholders** — use `{Column Header}` in both subject and body
- 📎 **Attachment support** — attach your resume or any file
- ⏱️ **Customisable smart delays** — presets (Fast/Safe/Stealth) or custom range with randomisation
- ⚡ **Real-time mode** — sends directly from your browser
- ☁️ **Background mode** — queues as drafts, a Google Apps Script sends them from the cloud (no browser needed)
- 📋 **Status tracking** — writes `Sent ✓` / `Failed ✗` / `Pending ⏳` back to your sheet
- ⏸️ **Pause & Resume** — skips already-sent rows automatically
- 💾 **Template saving** — save and reuse email templates
- 🔢 **Daily limit counter** — tracks sends to keep you under Gmail's 500/day limit

---

## Setup (One-Time)

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **New Project** → name it "Mass Mailer" → **Create**
3. Select the project

### 2. Enable APIs

1. Go to **APIs & Services** → **Library**
2. Search for and enable:
   - **Gmail API**
   - **Google Sheets API**

### 3. Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** → **Create**
3. Fill in:
   - App name: `Mass Mailer`
   - User support email: your email
   - Developer contact: your email
4. Click **Save and Continue** through the remaining steps
5. Under **Test users**, add your own Gmail address

### 4. Create OAuth Client ID

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth Client ID**
3. Application type: **Chrome Extension**
4. Name: `Mass Mailer`
5. Extension ID: (you'll get this in the next step — you can update it later)
6. Click **Create** and copy the **Client ID**

### 5. Install the Extension

1. Open the file `manifest.json` in a text editor
2. Replace `YOUR_CLIENT_ID.apps.googleusercontent.com` with your actual Client ID
3. Open Chrome → go to `chrome://extensions`
4. Enable **Developer mode** (toggle in top right)
5. Click **Load unpacked** → select the `Mass Mailer` folder
6. Copy the **Extension ID** shown on the card
7. Go back to Google Cloud Console → **Credentials** → edit your OAuth Client ID → paste the Extension ID → **Save**

### 6. (Optional) Set Up Background Sending

If you want to use the **☁️ Background** mode:
- See [apps-script/setup-guide.md](apps-script/setup-guide.md) for instructions

---

## Usage

1. **Open Gmail** in Chrome
2. **Click the Mass Mailer icon** in the toolbar → side panel opens
3. **Paste your Google Sheet URL** and click Connect
4. **Write your email template** using `{Column Header}` placeholders
   - Works in both subject and body
   - Placeholders are **case-sensitive** — `{Company Name}` must match the exact column header
5. **Attach a file** if needed (e.g., your resume)
6. **Configure delays and sending mode**
7. **Preview** the first 3 emails to verify everything looks right
8. **Start the campaign** 🚀

---

## Google Sheet Format

Your sheet just needs a header row. The extension auto-detects columns:

| Name | Company Name | Email | Role |
|------|-------------|-------|------|
| Alice | Acme Corp | alice@acme.com | CTO |
| Bob | Beta Inc | bob@beta.com | VP Eng |

- An **Email** column is required (case-insensitive detection: "Email", "email", "E-mail", etc.)
- All other columns become available as placeholders
- The extension adds **Status** and **Sent At** columns automatically

---

## Sending Limits

| Account Type | Daily Limit |
|---|---|
| Personal Gmail (@gmail.com) | 500 emails / 24 hours |
| Google Workspace | 2,000 emails / 24 hours |

The extension tracks your daily sends and warns you before hitting the limit.

---

## File Structure

```
Mass Mailer/
├── manifest.json          # Extension config
├── background.js          # Service worker (API calls, campaign engine)
├── sidepanel.html         # Side panel UI
├── sidepanel.css          # Styles
├── sidepanel.js           # UI logic
├── utils.js               # Shared utilities
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── apps-script/
│   ├── Code.gs            # Google Apps Script for background sending
│   └── setup-guide.md     # Apps Script deployment instructions
└── README.md
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Auth failed" | Make sure your Client ID is correct in manifest.json and your Google account is added as a test user |
| "Invalid Google Sheets URL" | Paste the full URL including `https://docs.google.com/spreadsheets/d/...` |
| "Sheet needs at least a header row and one data row" | Your sheet needs at least 2 rows (1 header + 1 data) |
| Extension icon doesn't appear | Click the puzzle piece icon in Chrome toolbar → pin Mass Mailer |
| Emails going to spam | This is a Gmail reputation issue — avoid sending too many too fast, personalise content |
| "Rate limited by Gmail" | The extension will auto-pause and retry after 60 seconds |

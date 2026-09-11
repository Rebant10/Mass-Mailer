# Mass Mailer — Chrome Extension

> Autonomous cold outreach extension for Gmail & Google Sheets with smart throttling, company-level capping, live sheet synchronization, and 24/7 background cloud scheduling.

---

## 🌟 Key Features

### 1. 🔄 Live Sheet Sync & Persistent Header
- **Instant Sheet Sync (`🔄 Sync`)**: Refresh headers, new rows, and cell statuses at any step without losing your drafted templates or configured company limits.
- **Account Type Detection**: Automatically identifies whether you are logged into a **Personal Gmail** (`@gmail.com`) or a **Google Workspace** domain.
- **Dynamic Quota Counter**: Automatically adjusts your daily send limits based on your account type and mode:
  - **⚡ Real-Time Mode**: `500 / day` (Personal) or `2,000 / day` (Workspace).
  - **☁️ Cloud Mode**: `100 / day` (Personal) or `1,500 / day` (Workspace).
- **Sheet-Aware Tracking**: The header counter dynamically tracks today's sent emails directly from your active Google Sheet.

### 2. 🏢 Smart Company-Level Email Capping
- **Granular Caps**: Set a **Master Cap** (e.g. max 2 emails per company across all companies) or specific overrides for individual companies.
- **Dynamic Unsent Dropdown**: The company selector automatically filters out companies that have already reached their limit or are completely `Sent ✓`.
- **Clean Sheet Guarantee**: Remaining contacts for a company that reached its cap are left untouched with blank status cells—never cluttering your sheet with "Skipped" tags.
- **Visual Breakdown**: Step 4 displays a dedicated Company Cap Breakdown card (`willSend / totalPending (Cap: X)`) before launching.

### 3. 🛡️ Duplicate Email Guard
- **Automatic Protection**: Detects identical email addresses among unsent rows and only sends to the first occurrence.
- **Warning Banner**: Step 4 flags any detected duplicates before you hit send.

### 4. ☁️ Autonomous Cloud Scheduling (Runs with Laptop OFF)
- **Schedule Method Toggle**:
  - **`📅 Specific Dates`**: Define a Start Date and optional End Date. Sends every day within the window during business hours, unrestricted by day of week.
  - **`📆 Days of Week`**: Set a Start Date and choose recurring active days of the week (**Mon–Sun** pills). Apps Script will not start sending before your Start Date.
- **Sending Window**: Restrict delivery to business hours (e.g. `09:00` to `17:00`).
- **Fully Configurable Cadence**: Set your **Batch Size per 5 min** (e.g. 2 emails/cycle) and **Pause Delay** directly from the UI—no hardcoded values.
- **Autonomous `_MailerConfig`**: The extension automatically generates and updates a `_MailerConfig` tab in your Google Sheet with all campaign parameters.
- **Zero-Touch New Rows**: Add new contacts to your Google Sheet while your laptop is off; Google Cloud automatically reads the live sheet, fills in your template, and sends them in the next cycle.

### 5. 🛑 One-Click Cloud Stop & Cancel
- **Stop & Cancel Cloud Campaign**: Prominently accessible in the Campaign Dashboard.
- **Automated Cleanup**:
  - Sets campaign `status` to **`Stopped`** in `_MailerConfig` (Apps Script halts immediately).
  - Automatically **deletes all created drafts from your Gmail Drafts folder** via Gmail API.
  - Clears `Queued 📋` and `Pending ⏳` cells in your Google Sheet back to blank.
- **Cancellation Summary Modal**: Displays a detailed breakdown of automated actions and instructions for removing the Apps Script 5-minute trigger via `teardown`.

### 6. ⚡ Real-Time In-Browser Mode
- **Smart Delays**: Choose presets (**🐇 Fast** `5–8s`, **🐢 Safe** `10–20s`, **🦥 Stealth` `30–60s`) or set custom minimum and maximum delay sliders with natural jitter.
- **Controls**: Pause, resume, or stop on demand.

### 7. 🎨 Modern Dark Mode Interface
- Glassmorphism dark theme with Google Fonts (`Outfit` / `Inter`).
- Custom application logo icon.
- Full high-contrast dark select menus and input controls.

---

## 🚀 Setup & Installation (One-Time)

### 1. Create a Google Cloud Project & Enable APIs
1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click **New Project** → name it `Mass Mailer` → click **Create**.
3. Go to **APIs & Services** → **Library**.
4. Search for and enable:
   - **Gmail API**
   - **Google Sheets API**

### 2. Configure OAuth Consent Screen
1. Go to **APIs & Services** → **OAuth consent screen**.
2. Choose **External** → click **Create**.
3. Fill in:
   - **App name**: `Mass Mailer`
   - **User support email**: your email
   - **Developer contact**: your email
4. Click **Save and Continue** through the scopes step.
5. Under **Test users**, add your own Gmail address (and any testing accounts) → click **Save and Continue**.

### 3. Create OAuth Client ID
1. Go to **APIs & Services** → **Credentials**.
2. Click **Create Credentials** → **OAuth client ID**.
3. Choose **Chrome extension** as the application type.
4. Fill in:
   - **Name**: `Mass Mailer`
   - **Extension ID**: Leave blank or fill in after Step 4 below.
5. Click **Create** and copy your **Client ID**.

### 4. Install Extension in Chrome
1. In your local folder, open `manifest.json`.
2. Replace `YOUR_CLIENT_ID.apps.googleusercontent.com` with your actual OAuth Client ID.
   *(Note: Never commit your personal Client ID to public repositories).*
3. Open Google Chrome and go to `chrome://extensions`.
4. Enable **Developer mode** (toggle in the top-right corner).
5. Click **Load unpacked** and select the `Mass Mailer` project directory.
6. Copy the **ID** generated for the extension (e.g. `abcdefghijklmnop...`).
7. Return to Google Cloud Console → **Credentials** → edit your OAuth Client ID → paste the **Extension ID** → click **Save**.

### 5. (Optional) Set Up Autonomous Cloud Sending
If you wish to use **☁️ Background Mode** to send emails 24/7 with your computer off:
- Follow the simple 2-minute guide in [`apps-script/setup-guide.md`](apps-script/setup-guide.md).

---

## 📖 How to Use

1. Open **Gmail** in Chrome and open the **Mass Mailer** side panel (or click the toolbar icon).
2. **Step 1 — Connect Sheet**: Paste your Google Sheet URL and click **Connect**.
3. **Step 2 — Compose**: Write your subject and body. Click column chips to insert dynamic placeholders (e.g. `{{First Name}}`, `{{Company}}`). Attach any PDF or file if needed.
4. **Step 3 — Settings**:
   - Select **⚡ Real-time** (with smart delay presets) OR **☁️ Background** (with Specific Dates or Days of Week schedule, batch size, and business hours).
   - Configure **Company Limits** (optional).
5. **Step 4 — Preview & Send**: Review the calculated sending summary, duplicate warnings, company cap breakdown, and sample personalized emails.
6. Click **🚀 Start Campaign**!

---

## 📊 Google Sheet Format

Your sheet only requires a header row. All columns are automatically detected and converted into placeholder chips:

| First Name | Company | Email | Role |
| :--- | :--- | :--- | :--- |
| Sarah | Acme Corp | sarah@acme.com | VP Engineering |
| Alex | Beta Labs | alex@betalabs.io | Founder |

- **Email column**: Automatically detected (supports `Email`, `email`, `E-mail`, `Email Address`, etc.).
- **Automatic tracking columns**: The extension automatically appends and manages `Status`, `Sent At`, and `Draft ID` columns.
- **Config tab**: Background mode automatically creates and maintains a `_MailerConfig` tab with all parameters.

---

## 📁 Repository Structure

```text
Mass Mailer/
├── manifest.json          # Chrome Extension Manifest V3 configuration
├── background.js          # Background service worker (Gmail & Sheets API, batch scheduler)
├── sidepanel.html         # Side panel user interface
├── sidepanel.css          # Dark-mode design system and animations
├── sidepanel.js           # UI logic, state management, and real-time syncing
├── utils.js               # MIME encoding, placeholder replacement, and helpers
├── icons/                 # Extension logos (16x16, 48x48, 128x128)
├── apps-script/
│   ├── Code.gs            # Google Apps Script engine for 24/7 cloud sending
│   └── setup-guide.md     # 2-minute deployment guide for Apps Script
└── README.md              # Project documentation
```

---

## 🛡️ Privacy & Security

- **Direct API Communication**: All requests are made directly between your browser / Google Apps Script and official Google APIs (`gmail.googleapis.com` and `sheets.googleapis.com`).
- **No Third-Party Servers**: No telemetry, tracking, or intermediary servers are involved.
- **Client ID Protection**: OAuth tokens stay strictly within Chrome's secure identity storage.

# Mass Mailer — Chrome Extension

> Autonomous cold outreach extension for Gmail & Google Sheets with smart throttling, company-level capping, live sheet synchronization, multi-account inbox pooling & rotation, and 24/7 background cloud scheduling.

---

## 🌟 Key Features

### 1. 👥 Multi-Account Inbox Pool & Smart Rotation
- **Mode Switcher (Step 1)**: Easily toggle between **`👤 Single Account`** (active Chrome profile) and **`👥 Multi-Pool`** (rotates across 2, 3, 4, 5+ connected Google inboxes).
- **Scale Past Google's Daily Limits**: Connect multiple Personal (`@gmail.com` — 500/day) and Google Workspace or College accounts (`@domain.com` / `@college.edu` — 2,000/day) into a single campaign.
  - *Example*: 3 personal accounts + 1 college account = **3,500 emails/day** aggregate capacity!
- **Safe Round-Robin Engine**: Distributes sends evenly across all accounts in the pool (`Account 1 → Account 2 → Account 3 → Account 1...`).
- **Cap Exhaustion Bypass**: If an account reaches its daily limit, the engine automatically bypasses it and routes remaining emails through available accounts.
- **Dynamic Sender Placeholders**:
  - `{Sender.Name}`: Sender's full name.
  - `{Sender.Email}`: Active sending account's email.
  - `{Sender.Title}`: Custom job/role title.
  - `{Sender.Phone}`: Contact phone number.
  - `{Sender.Signature}`: Multi-line custom signature block.
- **Emerald Sender Chips Bar (Step 2)**: One-click insert buttons for all sender placeholders directly into your subject or body.
- **Per-Account Custom Attachment Overrides**: Upload a master general attachment in Step 2, and optionally override it with an account-specific resume/CV in Step 1 (e.g. Academic CV for your college email, Developer Resume for your personal email).
- **Transparent Audit Columns in Google Sheets**:
  - `Sent From`: Logs the exact Google email account used to deliver each row.
  - `Attachment Sent`: Logs the exact attachment filename sent to each recipient.
- **Senders Pool Breakdown Card (Step 4)**: Shows the distribution of emails across each inbox in the pool before launching.

---

### 2. 🔄 Persistent Sheet Link & Live Sync
- **Persistent Document Connection**: The connected Google Sheet URL remains permanently saved in the extension's local storage and auto-reconnects on launch. It stays connected until you explicitly click **`✕ Remove / Change`**.
- **Instant Sheet Sync (`🔄 Sync`)**: Refresh headers, new rows, and cell statuses at any step without losing drafted templates or configured limits.
- **Account Type Detection**: Automatically identifies whether you are logged into a **Personal Gmail** (`@gmail.com`) or a **Google Workspace** domain.
- **Dynamic Quota Counter**: Automatically aggregates daily send limits across your active inboxes:
  - **⚡ Real-Time Mode**: `500 / day` per Personal inbox, `2,000 / day` per Workspace inbox.
  - **☁️ Cloud Mode**: `100 / day` per Personal inbox, `1,500 / day` per Workspace inbox.
- **Live Sheet Count Sync**: Dynamically tracks today's sent emails directly from your active Google Sheet.

---

### 3. 🏢 Smart Company-Level Email Capping
- **Granular Caps**: Set a **Master Cap** (e.g. max 2 emails per company across all companies) or specific overrides for individual companies.
- **Dynamic Unsent Dropdown**: Automatically filters out companies that have already reached their limit or are completely `Sent ✓`.
- **Clean Sheet Guarantee**: Remaining contacts for a company that reached its cap are left untouched with blank status cells—never cluttering your sheet with "Skipped" tags.
- **Visual Breakdown**: Step 4 displays a dedicated Company Cap Breakdown card (`willSend / totalPending (Cap: X)`) before launching.

---

### 4. 🛡️ Duplicate Email Guard
- **Automatic Protection**: Detects identical email addresses among unsent rows and only sends to the first occurrence.
- **Warning Banner**: Step 4 flags any detected duplicates before you hit send.

---

### 5. ☁️ Autonomous Cloud Scheduling (Runs with Laptop OFF)
- **Schedule Method Toggle**:
  - **`📅 Specific Dates`**: Define a Start Date and optional End Date. Sends every day within the window during business hours, unrestricted by day of week.
  - **`📆 Days of Week`**: Set a Start Date and choose recurring active days of the week (**Mon–Sun** pills). Apps Script will not start sending before your Start Date.
- **Sending Window**: Restrict delivery to business hours (e.g. `09:00` to `17:00`).
- **Fully Configurable Cadence**: Set your **Batch Size per 5 min** (e.g. 2 emails/cycle) and **Pause Delay** directly from the UI—no hardcoded values.
- **Autonomous `_MailerConfig`**: The extension automatically generates and updates a `_MailerConfig` tab in your Google Sheet with all campaign parameters.
- **Zero-Touch New Rows**: Add new contacts to your Google Sheet while your laptop is off; Google Cloud automatically reads the live sheet, fills in your template, and sends them in the next cycle.

---

### 6. 🛑 One-Click Cloud Stop & Cancel
- **Stop & Cancel Cloud Campaign**: Prominently accessible in the Campaign Dashboard.
- **Automated Cleanup**:
  - Sets campaign `status` to **`Stopped`** in `_MailerConfig` (Apps Script halts immediately).
  - Automatically **deletes all created drafts from your Gmail Drafts folder** via Gmail API.
  - Clears `Queued 📋` and `Pending ⏳` cells in your Google Sheet back to blank.
- **Cancellation Summary Modal**: Displays a detailed breakdown of automated actions and instructions for removing the Apps Script 5-minute trigger via `teardown`.

---

### 7. ⚡ Real-Time In-Browser Mode
- **Smart Delays**: Choose presets (**🐇 Fast** `5–8s`, **🐢 Safe** `10–20s`, **🦥 Stealth** `30–60s`) or set custom minimum and maximum delay sliders with natural jitter.
- **Controls**: Pause, resume, or stop on demand.

---

### 8. 🎨 Modern Dark Mode Interface
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
5. Under **Test users**, add your own Gmail address (and any testing accounts you plan to use in your pool) → click **Save and Continue**.

### 3. Create Primary OAuth Client ID (Chrome Extension)
1. Go to **APIs & Services** → **Credentials**.
2. Click **Create Credentials** → **OAuth client ID**.
3. Choose **Chrome extension** as the application type.
4. Fill in:
   - **Name**: `Mass Mailer Extension`
   - **Extension ID**: (leave blank initially or fill in after Step 4 below).
5. Click **Create** and copy your **Client ID**.

### 4. Install Extension in Chrome
1. In your local project folder, open `manifest.json`.
2. Replace `YOUR_CLIENT_ID.apps.googleusercontent.com` with your actual Chrome Extension OAuth Client ID.
   *(Note: Never commit your personal Client ID to public git repositories).*
3. Open Google Chrome and go to `chrome://extensions`.
4. Enable **Developer mode** (toggle in the top-right corner).
5. Click **Load unpacked** and select the `Mass Mailer` project directory.
6. Copy the **ID** generated for the extension (e.g. `abcdefghijklmnop...`).
7. Return to Google Cloud Console → **Credentials** → edit your Chrome Extension OAuth Client ID → paste the **Extension ID** → click **Save**.

### 5. (Optional) Set Up Multi-Account Pool (Web Application Client ID)
If you wish to use **`👥 Multi-Pool`** to rotate sends across multiple Google inboxes:
1. In your side panel, switch to **`👥 Multi-Pool`**.
2. Copy your **Extension Redirect URI** (e.g. `https://<your-extension-id>.chromiumapp.org/`) using the **📋 Copy** button.
3. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), click **Create Credentials** → **OAuth client ID**.
4. Choose **Web application** as the application type.
5. Under **Authorized redirect URIs**, click **+ Add URI** and paste your Extension Redirect URI.
6. Click **Create**, copy the new Web Client ID, and paste it into the **Web OAuth Client ID** box in the extension side panel.
7. Click **Save**. You can now click **`➕ Add Google Account to Pool`** to connect any number of personal or college accounts!

### 6. (Optional) Set Up Autonomous Cloud Sending
If you wish to use **☁️ Background Mode** to send emails 24/7 with your computer off:
- Follow the simple 2-minute guide in [`apps-script/setup-guide.md`](apps-script/setup-guide.md).

---

## 📖 How to Use

1. Open **Gmail** in Chrome and open the **Mass Mailer** side panel (or click the toolbar icon).
2. **Step 1 — Connect Sheet & Senders**:
   - Paste your Google Sheet URL and click **Connect**. (Your sheet link stays saved and auto-reconnects automatically).
   - Choose **`👤 Single`** (default) or **`👥 Multi-Pool`** (add 2+ inboxes, personalize signatures, and attach specific resumes).
3. **Step 2 — Compose**:
   - Write your subject and body.
   - Click column chips (e.g. `{First Name}`, `{Company}`) or sender chips (e.g. `{Sender.Name}`, `{Sender.Signature}`) to insert dynamic placeholders.
   - Attach a master PDF/resume if needed.
4. **Step 3 — Settings**:
   - Select **⚡ Real-time** (with smart delay presets) OR **☁️ Background** (with Specific Dates or Days of Week schedule, batch size, and business hours).
   - Configure **Company Limits** (optional).
5. **Step 4 — Preview & Send**:
   - Review the calculated sending summary, duplicate warnings, company cap breakdown, and Senders Pool breakdown.
   - Inspect alternating sample email previews showing each sender's identity and custom resume.
6. Click **🚀 Start Campaign**!

---

## 📊 Google Sheet Format

Your sheet only requires a header row. All columns are automatically detected and converted into placeholder chips:

| First Name | Company | Email | Role |
| :--- | :--- | :--- | :--- |
| Sarah | Acme Corp | sarah@acme.com | VP Engineering |
| Alex | Beta Labs | alex@betalabs.io | Founder |

- **Email column**: Automatically detected (supports `Email`, `email`, `E-mail`, `Email Address`, etc.).
- **Automatic tracking columns**: The extension automatically appends and manages:
  - `Status`: `Sent ✓`, `Pending ⏳`, `Queued 📋`, `Failed ✗`
  - `Sent At`: Delivery timestamp
  - `Sent From`: The exact Google account used for that row
  - `Attachment Sent`: The exact attachment file delivered
  - `Draft ID`: Internal draft ID for cloud scheduler
- **Config tab**: Background mode automatically creates and maintains a `_MailerConfig` tab with all parameters.

---

## 📁 Repository Structure

```text
Mass Mailer/
├── manifest.json          # Chrome Extension Manifest V3 configuration
├── background.js          # Background service worker (Gmail & Sheets API, pool rotation, scheduler)
├── sidepanel.html         # Side panel UI (single/multi switcher, pool cards, sender chips)
├── sidepanel.css          # Dark-mode design system and animations
├── sidepanel.js           # UI logic, state management, persistent sheet connection, real-time syncing
├── utils.js               # MIME encoding, dynamic sender placeholder replacement, helpers
├── icons/                 # Extension logos (16x16, 48x48, 128x128)
├── apps-script/
│   ├── Code.gs            # Google Apps Script engine for 24/7 cloud sending (with Sent From logging)
│   └── setup-guide.md     # 2-minute deployment guide for Apps Script
└── README.md              # Project documentation
```

---

## 🛡️ Privacy & Security

- **Direct API Communication**: All requests are made directly between your browser / Google Apps Script and official Google APIs (`gmail.googleapis.com` and `sheets.googleapis.com`).
- **No Third-Party Servers**: No telemetry, tracking, or intermediary servers are involved.
- **Client ID Protection**: OAuth tokens stay strictly within Chrome's secure identity storage.

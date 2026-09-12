# Google Apps Script Setup Guide — Autonomous Cloud Mode

> Run your cold outreach campaigns 24/7 on Google Cloud even when your computer is completely turned OFF.

All campaign settings (status, dates, active days of week, business hours, batch size, delays, and company caps) are automatically created and updated by the Chrome Extension in your sheet's `_MailerConfig` tab.

**Time needed:** ~2 minutes (one-time setup).

---

## ⚡ Quick Setup

### Step 1: Open Apps Script
1. Open your outreach Google Sheet in your browser.
2. In the top menu, click **Extensions** → **Apps Script**.
   *(Alternatively, visit [script.google.com](https://script.google.com) and click **New Project**).*

### Step 2: Paste `Code.gs`
1. In the Apps Script editor, replace any default code in `Code.gs` with the full contents of [`Code.gs`](Code.gs).
2. Click the **💾 Save** icon (or press `Ctrl + S`).

### Step 3: Set Sheet ID (Only if using Standalone Script)
* **If opened from your Google Sheet (Bound Script)**: You don't need to configure anything! The script automatically connects to the open sheet.
* **If created as a Standalone Project**: Paste your spreadsheet ID on line 34:
  ```javascript
  const SHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
  ```

### Step 4: Run `setup` (One-Time)
1. In the top toolbar, select **`setup`** from the function dropdown.
2. Click **▶ Run**.
3. A Google authorization popup will appear:
   - Click **Review Permissions**.
   - Choose your Google account.
   - Click **Advanced** → **Go to [Project Name] (unsafe)** → **Allow**.
4. Check the **Execution Log** at the bottom. You will see:
   > `✅ Trigger created! Mass Mailer Cloud Scheduler will run every 5 minutes.`

**You're all done!** You can now close Google Sheets and shut down your computer.

---

## 🎮 How to Control Cloud Campaigns

| Action | How to do it | What happens |
| :--- | :--- | :--- |
| **Activate 24/7 Schedule** | Select **`setup`** → click **▶ Run** | Installs a 5-minute Google Cloud trigger that checks your schedule and sends batches. |
| **Test 1 Batch Immediately** | Select **`processQueue`** → click **▶ Run** | Executes a single batch right now and logs execution details in the log console. |
| **Stop / Cancel Cloud Campaign** | Click **`🛑 Stop & Cancel Cloud Campaign`** in the Chrome Extension OR select **`teardown`** in Apps Script → click **▶ Run** | Sets status to `Stopped`, deletes queued Gmail drafts, clears sheet cells, and removes the 5-minute trigger. |

---

## 🧠 Autonomous Intelligence Features

1. **Gatekeeper Scheduling**:
   - **Specific Dates Mode**: Sends every day between start and end dates within working hours.
   - **Days of Week Mode**: Adheres to your Start Date, then recurs weekly only on selected active days (e.g. Mon–Fri) during working hours.
2. **Dynamic Batch Sizing**:
   - Reads your configured batch size (e.g. 2 per 5 min) directly from `_MailerConfig`.
3. **Zero-Touch Live Additions**:
   - Add or paste new rows into your Google Sheet from any device (laptop, tablet, phone) at any time. Apps Script automatically detects new blank rows, personalizes your email template, and sends them during the next active window.
4. **Safety Guards**:
   - Automatically prevents duplicate sends to the same email address.
   - Enforces company-level email limits (leaving capped contacts clean and un-sent for future outreach).
   - Automatically logs delivery timestamps (`Sent At`) and active sender account (`Sent From`).
   - Halts immediately if daily limits are approached.

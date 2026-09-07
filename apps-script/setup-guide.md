# Apps Script Setup Guide — Background Sending Mode

This guide walks you through deploying the Google Apps Script that sends your queued Gmail drafts automatically from the cloud.

**Time needed:** ~3 minutes (one-time setup)

---

## Step 1: Open Google Apps Script

Go to **[script.google.com](https://script.google.com)** → click **New Project**

## Step 2: Paste the Code

1. Delete any existing code in the editor
2. Open the file `Code.gs` from this folder
3. Copy the **entire** contents and paste it into the Apps Script editor

## Step 3: Update Configuration

Near the top of the script, find these two lines and update them:

```javascript
const SHEET_ID  = 'PASTE_YOUR_SPREADSHEET_ID_HERE';
const SHEET_TAB = 'Sheet1';
```

- **SHEET_ID**: The long ID from your Google Sheet URL
  - Example URL: `https://docs.google.com/spreadsheets/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit`
  - The ID is: `1aBcDeFgHiJkLmNoPqRsTuVwXyZ`
- **SHEET_TAB**: The name of the tab containing your campaign data (usually `Sheet1`)

## Step 4: Run Setup

1. In the toolbar, select **`setup`** from the function dropdown
2. Click **▶ Run**
3. A permissions dialog will appear — click **Review Permissions**
4. Select your Google account
5. Click **Advanced** → **Go to [project name] (unsafe)** → **Allow**
6. Check the **Execution log** — you should see: `✅ Trigger created`

## Step 5: Verify

1. Select **`checkQueue`** from the function dropdown
2. Click **▶ Run**
3. The log should show how many drafts are queued

---

## Controlling the Trigger

| Action | How |
|--------|-----|
| **Pause sending** | Run `teardown()` |
| **Resume sending** | Run `setup()` |
| **Change interval** | Edit the `everyMinutes(1)` value in `setup()` and re-run it |
| **Check status** | Run `checkQueue()` |

## Adjusting Send Speed

In the `setup()` function, change the trigger interval:

```javascript
// Every 1 minute (fast — sends 60/hour)
.everyMinutes(1)

// Every 5 minutes (moderate — sends 12/hour)
.everyMinutes(5)

// Every 10 minutes (slow — sends 6/hour)
.everyMinutes(10)
```

After changing, run `setup()` again to apply.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Draft not found" | The draft may have been manually deleted from Gmail |
| "Authorization required" | Re-run `setup()` and re-authorize |
| Emails not sending | Check **Executions** tab in Apps Script editor for error logs |
| Want to stop immediately | Run `teardown()` |

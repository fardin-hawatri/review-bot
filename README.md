# Review Queue Bot

A Slack bot that does exactly what Ayan described:
- Any reviewer can run `/queue` to instantly see how many items are assigned to them.
- Any team member can right-click a message → **Add to Review Queue**, assign it to a reviewer, and the bot posts a threaded reply with a **✅ Mark Done** button.
- Clicking that button closes the review — no separate step, no leaving Slack.

Works in both #content-review-hindi and #content-review-english (any channel the bot is added to) automatically — no per-channel setup needed.

---

## What you need to do (steps I can't do for you)

### 1. Create the Slack app
1. Go to https://api.slack.com/apps → **Create New App** → **From an app manifest**
2. Pick your **Bodycareglobal** workspace
3. Paste in the contents of `manifest.yaml` (included in this folder)
4. Click **Create**

### 2. Install it to your workspace
1. In the app's settings, go to **Install App** → **Install to Workspace** → Allow
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`) — you'll need it in step 4

### 3. Generate the Socket Mode token
1. Go to **Basic Information** → scroll to **App-Level Tokens** → **Generate Token and Scopes**
2. Name it anything (e.g. "socket"), add the scope `connections:write`, click **Generate**
3. Copy the token (starts with `xapp-`)
4. Also copy the **Signing Secret** from the top of **Basic Information**

### 4. Add your three secrets
Rename `.env.example` to `.env` and fill in the three values you just copied:
```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
```
**Never share this `.env` file or paste these values in Slack/chat** — they're equivalent to a password for the bot.

### 5. Install dependencies and run it
```
npm install
npm start
```
You should see `⚡️ Review Queue Bot is running (Socket Mode)`.

### 6. Add the bot to your channels
In both #content-review-hindi and #content-review-english, type:
```
/invite @Review Queue Bot
```

### 7. Try it
- Right-click any message → **More message shortcuts** → **Add to Review Queue** → pick an assignee → Assign
- The assignee runs `/queue` anywhere to see their count
- Click **✅ Mark Done** on the threaded reply to close it

---

## Keeping it running — Render (free, no credit card)

This process needs to stay running at all times — closing your laptop stops it. **Render** is the pick here: genuinely free, no card needed, and its free tier (750 hours/month) covers a full month of continuous uptime.

### 1. Put the code on GitHub (free, no card)
1. Create a free account at https://github.com if you don't have one
2. Create a new repository (e.g. `review-queue-bot`)
3. Upload this whole folder to it (drag-and-drop works on github.com, or use `git push` if you're comfortable with git) — **except don't upload your `.env` file**, only `.env.example`

### 2. Deploy on Render
1. Create a free account at https://render.com (no card required) — you can sign up with your GitHub account directly
2. Click **New +** → **Web Service**
3. Connect the `review-queue-bot` repo you just created
4. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Under **Environment**, add your three secrets from `.env` (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`) — Render keeps these secure, don't put them in the code itself
6. Click **Create Web Service** — it'll build and start automatically. Once live, the logs should show `⚡️ Review Queue Bot is running (Socket Mode)`

### 3. Stop it from sleeping
Render's free tier sleeps after 15 minutes without an incoming web request. The bot includes a small `/` endpoint just for this purpose — ping it regularly with a free monitor:
1. Create a free account at https://uptimerobot.com (no card required)
2. Add a new monitor → HTTP(s) → paste your Render service's URL (something like `https://review-queue-bot.onrender.com`)
3. Set the check interval to every 10 minutes
4. Save — this keeps the service awake continuously, at no cost

Since the bot itself uses Socket Mode for all its actual Slack functionality, this keep-alive ping is purely to stop Render from sleeping — it has nothing to do with how the bot talks to Slack.

## Data

Everything is stored in `data/queue.json` — a plain file, no external database needed. Back it up occasionally if you want history preserved long-term.

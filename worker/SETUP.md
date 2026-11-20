# Turning on AI chat in Galaxy Gridiron 🏈🌌

**Time:** about 30 minutes, at a computer (Mac or Windows). Howdy will walk you through it.
**Cost:** $10 one time, prepaid. Cloudflare is free. It can't charge you more than you prepay.

**Golden rule:** your AI key is like a password. Only paste it into the **terminal prompt** in step 13, which hides what you type. Never paste it in chat, in a text, or in the app.

### Why this way
We use the terminal with 4 short commands. The Cloudflare website route takes about 15 clicks across screens that change often. The commands are copy-paste, they set up storage automatically, and they let you paste the key into a hidden prompt.

---

## Part A: OpenAI (the AI brain), about 10 min
One account covers both AI tiers: **Budget** (`gpt-6-luna`) and **Better** (`gpt-6.1-sol`).

1. Go to **platform.openai.com** and sign up or log in. It may ask to verify your phone.
2. Open **Settings (gear) → Billing**. Click **Add payment details** and add your card.
3. Choose **$10** as the credit amount. **Before you confirm, switch OFF "Use auto-reload"** (it starts out ON). Then confirm.
   ✅ Check: Billing shows a $10 balance and says auto-reload/auto-recharge is **off**.
4. Set a hard spend limit. Open **Settings → Project (Default project) → Limits → Spend → Edit spend limit**. Enter **5**, turn on **Enforce a hard limit**, and click **Save**.
   This is a second safety net: the provider itself stops at $5 a month.
5. Open **API keys** (platform.openai.com/api-keys) and click **Create new secret key**. Name it `galaxy-gridiron` and click **Create**.
   **Leave this tab open.** You'll copy the key in step 13. It's shown only once; if you lose it, just make a new one.

## Part B: Cloudflare (the free middleman), about 3 min
6. Go to **dash.cloudflare.com/sign-up** and create a free account. Click the link in the verification email.
   You don't need a website or domain, and you don't need a paid plan.

## Part C: Install and launch, about 15 min
7. Install **Node.js**. Go to **nodejs.org**, download the **LTS** version, and run the installer with all the default options.
8. Download the **galaxy-gridiron-ai-worker.zip** file Howdy sends you. Unzip it, for example to your **Desktop**.
9. Open a terminal in that folder:
   - **Mac:** open the **Terminal** app, type `cd ` (with a space after it), drag the unzipped folder into the window, and press Enter.
   - **Windows:** open the unzipped folder, click the address bar, type `cmd`, and press Enter. (Use this, not PowerShell.)
10. Paste these commands one at a time, pressing Enter after each:
    ```
    npm install
    npx wrangler login
    ```
    A browser window opens. Log in to Cloudflare and click **Allow**, then come back to the terminal.
11. Launch it:
    ```
    npx wrangler deploy
    ```
    If it asks to register a **workers.dev subdomain**, type a name you like (for example `my-gg`) and press Enter.
    When it finishes, it prints a web address like `https://galaxy-gridiron-ai.my-gg.workers.dev`. **Copy that address.** It's your **Worker URL**.
12. Choose a **pairing code**: 3–4 random words with a number, like `purple-tacos-saturn-27`. You'll type it once on each phone. Don't use a password you use anywhere else.
13. Save your two secrets. Run each command below and paste when it asks. The text stays hidden as you type; that's normal.
    ```
    npx wrangler secret put OPENAI_API_KEY
    ```
    → Copy the key from the OpenAI tab (step 5), paste it, and press Enter. Then close that OpenAI tab.
    ```
    npx wrangler secret put PAIRING_CODE
    ```
    → Type your pairing code and press Enter.
14. Quick check: open your Worker URL in a browser. You should see `"ok":true`.

## Part D: Your phone, about 2 min
15. In Galaxy Gridiron, open **Settings → AI**.
16. Enter the **Worker URL** from step 11 and your **pairing code** from step 12. Tap **Pair**.
17. Open the **Chat** tab and choose **Budget AI** or **Better AI** with the picker. **Rules** stays free and works offline.
    Above the text box, you'll see this chat's cost and this month's spend out of $5.

---

## What it costs
| Tier | Typical cost per question | What $5 buys |
|---|---|---|
| Rules | free | unlimited |
| Budget AI | about $0.0006 (1,600 questions per $1) | thousands of questions |
| Better AI | about $0.015 (1–2¢) | about 300 questions |

**Built-in limits:** $5 a month for all phones combined, and 30 AI questions per phone per day. Both reset at midnight Central. OpenAI also stops at $5 a month (step 4), and with auto-reload off it can never charge more than your $10.

## How to shut it off
- **Pause it:** in the app's chat picker, choose **Rules**. It costs nothing.
- **Stop all AI spending right away:** go to platform.openai.com/api-keys and click **Revoke** on `galaxy-gridiron`. The app falls back to Rules.
- **Remove everything:** in the same terminal folder, run `npx wrangler delete`. Or go to dash.cloudflare.com → **Workers & Pages** → `galaxy-gridiron-ai` → **Settings** → **Delete**.
- **Change the limits:** ask Howdy. You edit two numbers and run `npx wrangler deploy` again.
- **Lost phone:** the most it could spend is the same $5/month cap. To cut it off, revoke the key as above, create a new key, and run step 13's first command again. Howdy can also remove that phone's pairing.

# Coop Book v3 — Deployment & Bubblewrap Guide


**What's new in v3:** vaccination scheduling (with a standard template you can apply per flock), a full poultry calculator suite (FCR, feed/water estimators, heat stress index, stocking density, equipment planner, ventilation, water dilution scaling, bedding estimator, EPEF), 4 new languages (Indonesian, Urdu, Bengali, Portuguese — 9 total), and a new icon combining the chick motif with a data/chart element. All calculator and vaccination features are free for all users — only multi-flock, smart alerts, 30-day trends, and export remain behind the $20 Pro unlock.

**Important note on the dilution/medicine calculator:** it only scales quantities the farmer enters from their own vet or product label — it does not recommend any drug, active ingredient, or dosage amount. This is a deliberate safety boundary; do not add specific medicine recommendations to this calculator without qualified veterinary review, since incorrect dosing guidance could harm animals or affect food safety.

---

## Step 1: Deploy the web files first (required before Bubblewrap)

Bubblewrap wraps a **live, hosted** website — it can't wrap local files. Deploy this folder to any static host:

1. Unzip this package
2. Go to **https://vercel.com** (or Netlify, Cloudflare Pages — any static host works)
3. Sign up free, create a new project, upload/drag this folder
4. You'll get a URL like `https://coopbook.vercel.app` — **write this down**, you need it for Bubblewrap
5. Visit the URL on your phone and confirm the app loads correctly, language picker appears on first run, and navigation works

**Important:** your site must be served over **HTTPS** (Vercel/Netlify/Cloudflare all do this automatically) — Bubblewrap and Play Billing require it.

---

## Step 2: Update the config files with your real domain

Before running Bubblewrap, edit `twa-manifest.json` in this folder:
- Replace every `REPLACE_WITH_YOUR_DEPLOYED_DOMAIN.com` with your actual domain from Step 1 (e.g. `coopbook.vercel.app`)
- Replace `com.yourcompany.coopbook` with your own reverse-domain package ID (e.g. `com.johndoe.coopbook`) — this must be unique on the Play Store and **cannot be changed after you publish**, so choose carefully

---

## Step 3: Install Bubblewrap

On your computer (needs Node.js installed — https://nodejs.org):

```
npm i -g @bubblewrap/cli
bubblewrap init --manifest=https://YOUR-DOMAIN/manifest.json
```

Bubblewrap will ask a series of questions (app name, package ID, colors) — it can mostly auto-detect these from your `manifest.json`, or you can point it at the `twa-manifest.json` in this folder as a starting reference.

---

## Step 4: Build the Android App Bundle

```
bubblewrap build
```

This produces an `.aab` file (Android App Bundle) and a `.apk` for testing, plus a `android.keystore` signing key — **back this keystore file up somewhere safe**. If you lose it, you cannot publish updates to the same app listing ever again.

---

## Step 5: Set up Google Play Console + Play Billing

1. Create a Google Play Developer account at https://play.google.com/console ($25 one-time fee)
2. Create a new app, fill in the store listing (description, screenshots, privacy policy — required)
3. Go to **Monetize → Products → In-app products**
4. Create a new in-app product with:
   - **Product ID:** `coopbook_lifetime_unlock` (must match exactly what's in `billing.js` — already set for you)
   - **Price:** set your $20 equivalent (Play Console lets you set a base price and auto-converts across countries)
   - **Type:** Managed product (one-time purchase, not subscription)
5. Upload your `.aab` from Step 4 to a testing track (Internal Testing is fastest to start)
6. Add your own Google account as a tester, install via the testing link, and try the real purchase flow

---

## How the billing code works (already built in)

- `billing.js` checks whether the app is running inside a real Play-Store-installed TWA with Play Billing available (`Billing.isPlayBillingReady()`)
- If yes → real Google Play purchase flow via the Digital Goods API + Payment Request API
- If no (e.g. testing in a normal browser) → shows a **test-mode confirmation dialog** so you can preview the unlocked UI without a live Play Store listing. This fallback will simply stop triggering once your TWA is properly installed from Play — no code changes needed later.

**Note on server verification:** this v1 trusts the client-side purchase confirmation from Google Play directly (since the payment already went through Google's real, secure checkout). For most solo-developer use cases this is fine. If you later want server-side receipt verification (extra protection against edge-case fraud), that would need a small backend using the Google Play Developer API — let me know if you want that built once you're at that stage.

---

## What's gated behind the $20 unlock

- **Flocks:** free = 1 flock, Pro = unlimited
- **Smart alerts:** free = generic "steady" message only, Pro = full rule-based analysis (egg drop %, mortality spikes, feed trends, benchmark comparisons)
- **Trend history:** free = 7 days, Pro = 30 days
- **Data export:** CSV and JSON backup are Pro-only

All gating logic lives in `app.js` — search for `isProUser()` to see every checkpoint if you want to adjust what's free vs. paid later.

---

## Setting up ads (free tier only)

Free users see a small adaptive banner ad on **every screen** — Dashboard, Log, Finance, Reports, Vaccines, and both the Calculator list and individual calculator results. Each banner sits below the real content on its screen, never overlapping content or blocking any button. It disappears immediately and permanently, on every screen at once, for anyone who buys the $20 unlock — this is enforced by a single `isProUser()` check that every ad placement relies on.

1. Create a free Google AdSense account: https://www.google.com/adsense
2. Add your deployed site (the same URL from Step 1 above) and go through AdSense's site approval process — this can take anywhere from a few days to a couple of weeks; the app works completely normally while you wait, the ad slot just stays empty
3. Once approved, create an ad unit in your AdSense dashboard and copy its **Slot ID**
4. Open `ads.js` in this folder and replace:
   - `ADSENSE_CLIENT_ID` with your AdSense **Client ID** (looks like `ca-pub-XXXXXXXXXXXXXXXX`)
   - `ADSENSE_SLOT_ID` with the ad unit's **Slot ID**
5. Redeploy the updated `ads.js` to your host — ads will start appearing for free users automatically

**Note:** since this app runs as a Trusted Web Activity, it uses web-based AdSense rather than native AdMob — native AdMob SDKs don't load inside a TWA's browser tab without a separate native wrapper, which is real added complexity not worth taking on at this stage.

---



Tap the globe icon in the header any time to change language. The choice is saved and persists across sessions. All screens, buttons, and category names are translated; only user-entered text (flock names, notes) stays as typed.

---

## When you're ready to go live

1. Move from Internal Testing → Closed Testing → Production in Play Console (Google requires this staged rollout for new developer accounts)
2. Google's review typically takes a few days for the first submission
3. Once approved, your app is publicly listed and the real purchase flow is live for all users

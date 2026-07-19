// ---------- Ads (free tier only — automatically disabled once isPro is true) ----------
//
// Uses Google AdSense's adaptive banner format — a fixed-position, responsive-width
// banner that adjusts height based on screen size (not the general "auto" in-content
// format). This works inside a Trusted Web Activity, unlike native AdMob, which needs
// a separate native wrapper and won't load inside a TWA's browser tab.
//
// SETUP REQUIRED BEFORE ADS WILL SHOW:
// 1. Create a free Google AdSense account: https://www.google.com/adsense
// 2. Add your deployed site (e.g. coopbook.vercel.app) as an AdSense site and get approved
//    (approval can take a few days to a couple weeks — ads simply won't show until then,
//    the rest of the app works fine in the meantime)
// 3. Replace ADSENSE_CLIENT_ID below with your real client ID (looks like "ca-pub-XXXXXXXXXXXXXXXX")
// 4. Replace ADSENSE_SLOT_ID with the ad unit slot ID you create in your AdSense dashboard
//    — create it as an "Adaptive" display ad unit (not "In-article" or "In-feed") for best results
//
// Until both are set, every ad slot renders as an empty placeholder (no broken UI, no errors).

const ADSENSE_CLIENT_ID = "ca-pub-REPLACE_WITH_YOUR_CLIENT_ID";
const ADSENSE_SLOT_ID = "REPLACE_WITH_YOUR_SLOT_ID";

const Ads = {
  scriptLoaded: false,
  slotCounter: 0,

  configured() {
    return !ADSENSE_CLIENT_ID.includes('REPLACE') && !ADSENSE_SLOT_ID.includes('REPLACE');
  },

  loadScript() {
    if (this.scriptLoaded || !this.configured()) return;
    const s = document.createElement('script');
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`;
    s.async = true;
    s.crossOrigin = 'anonymous';
    document.head.appendChild(s);
    this.scriptLoaded = true;
  },

  // Returns HTML for one adaptive banner slot. Safe to call multiple times per
  // render (e.g. once per screen) — each call gets a unique element so AdSense can
  // fill them independently. Only ever called from places that already check
  // !isProUser().
  bannerHTML() {
    if (!this.configured()) {
      return `
        <div class="ad-slot ad-slot-placeholder">
          <span>Ad space — configure AdSense in ads.js to activate</span>
        </div>
      `;
    }
    this.slotCounter++;
    return `
      <div class="ad-slot" data-ad-container="${this.slotCounter}">
        <ins class="adsbygoogle"
          style="display:block;width:100%"
          data-ad-client="${ADSENSE_CLIENT_ID}"
          data-ad-slot="${ADSENSE_SLOT_ID}"
          data-ad-format="auto"
          data-full-width-responsive="true"></ins>
      </div>
    `;
  },

  // Call once after banner HTML has been inserted into the DOM for the current
  // screen, so AdSense can find and fill every un-filled <ins> tag present.
  // Safe to call repeatedly across tab switches — already-filled slots are skipped
  // automatically by AdSense's own script.
  requestAd() {
    if (!this.configured()) return;
    this.loadScript();
    try {
      const unfilled = document.querySelectorAll('ins.adsbygoogle:not([data-ad-status])');
      unfilled.forEach(() => {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      });
    } catch (e) {
      console.warn('AdSense push failed:', e);
    }
  },

  // Convenience helper: returns the labeled banner block (label + slot), or empty
  // string for Pro users. Use this from every screen so placement stays consistent.
  block() {
    if (isProUser()) return '';
    return `<div class="ad-label">Advertisement</div>${this.bannerHTML()}`;
  }
};

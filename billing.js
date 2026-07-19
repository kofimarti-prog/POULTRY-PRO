// ---------- Billing layer ----------
// Uses the Digital Goods API (available when this app runs as a Trusted Web Activity
// built via Bubblewrap and published on Google Play). Falls back to a simulated
// "test unlock" flow when running in a normal browser, so you can build/test the UI
// before you have a real Play Store listing.
//
// PRODUCT ID: set this to match the in-app product you create in Google Play Console.
const PRODUCT_ID = "coopbook_lifetime_unlock";

const Billing = {
  service: null,
  available: false,

  async init() {
    // The Digital Goods API is exposed to TWAs served over the right origin
    // once your app is installed from Google Play with Play Billing configured.
    if ('getDigitalGoodsService' in window) {
      try {
        this.service = await window.getDigitalGoodsService('https://play.google.com/billing');
        this.available = true;
      } catch (e) {
        console.warn('Digital Goods Service unavailable:', e);
        this.available = false;
      }
    } else {
      this.available = false;
    }
  },

  // Returns true if the Play Billing purchase flow can be used (real device, real listing)
  isPlayBillingReady() {
    return this.available && this.service !== null && !!window.PaymentRequest;
  },

  async getPrice() {
    if (this.isPlayBillingReady()) {
      try {
        const details = await this.service.getDetails([PRODUCT_ID]);
        if (details && details[0]) return details[0].price.value + ' ' + details[0].price.currency;
      } catch (e) { console.warn(e); }
    }
    return '$20.00'; // fallback display price for browser/testing
  },

  // Kicks off the real Play Billing purchase flow via the Payment Request API.
  async purchase() {
    if (this.isPlayBillingReady()) {
      try {
        const request = new PaymentRequest(
          [{ supportedMethods: 'https://play.google.com/billing', data: { sku: PRODUCT_ID } }],
          { total: { label: 'Coop Book Lifetime Unlock', amount: { currency: 'USD', value: '20.00' } } }
        );
        const response = await request.show();
        // Acknowledge the purchase with Google Play
        const purchaseToken = response.details.purchaseToken;
        await response.complete('success');
        // In a full implementation with a backend, verify purchaseToken server-side
        // before granting entitlement. For a no-backend v1, we trust the client-side
        // confirmation from Play Billing itself, since the purchase already went
        // through Google's real payment flow.
        await this.service.consume(purchaseToken).catch(() => {});
        return { success: true, token: purchaseToken };
      } catch (e) {
        console.error('Purchase failed or cancelled:', e);
        return { success: false, error: e.message };
      }
    } else {
      // Browser/dev fallback — simulates a successful purchase so you can test
      // the unlocked UI without a Play Store listing. Remove reliance on this
      // once your TWA is live; it will simply stop triggering since
      // isPlayBillingReady() will be true on a real device.
      return new Promise((resolve) => {
        const ok = window.confirm(
          'TEST MODE (not real Play Billing — this only appears in a browser, not in your published Android app):\n\nSimulate a successful $20 purchase?'
        );
        resolve({ success: ok, token: ok ? 'test-token-' + Date.now() : null });
      });
    }
  }
};

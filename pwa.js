/* ==========================================================================
   Installing the site as an app, and turning notifications on.

   Two small things, both of which have to be asked for at the right moment:

   - The install prompt is held until the browser offers it AND the visitor
     has actually looked around. Asking someone to install an app they have
     been on for four seconds is how the banner gets dismissed for ever.

   - Notification permission is never requested on load. A browser that is
     asked without a reason remembers the refusal, and there is no second
     chance. It is asked only when somebody presses a button that says what
     it is for.
   ========================================================================== */
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  // ---------------------------------------------------------------- register

  navigator.serviceWorker.register('/sw.js').catch(() => {
    // No worker means no offline and no notifications. Everything else on
    // the site works exactly as before, so there is nothing to tell anyone.
  });

  // ---------------------------------------------------------------- install

  const STORE_KEY = 'cdm-install-dismissed';
  let deferred = null;

  function dismissedRecently() {
    try {
      const at = Number(localStorage.getItem(STORE_KEY) || 0);
      // A month. Long enough not to nag, short enough that somebody who
      // comes back for a second booking is offered it again.
      return at && Date.now() - at < 30 * 24 * 60 * 60 * 1000;
    } catch (e) {
      return false;
    }
  }

  function remember() {
    try { localStorage.setItem(STORE_KEY, String(Date.now())); } catch (e) { /* private mode */ }
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (dismissedRecently()) return;
    // Let them read something first.
    setTimeout(showBanner, 12000);
  });

  window.addEventListener('appinstalled', () => {
    remember();
    const banner = document.getElementById('pwa-banner');
    if (banner) banner.remove();
  });

  function showBanner() {
    if (!deferred || document.getElementById('pwa-banner')) return;

    const style = document.createElement('style');
    style.textContent = `
      #pwa-banner{
        position:fixed; left:12px; right:12px; bottom:12px; z-index:940;
        max-width:440px; margin:0 auto;
        display:flex; align-items:center; gap:13px;
        background:#0D1B2A; color:#fff; border-radius:16px; padding:14px 16px;
        box-shadow:0 14px 40px rgba(13,27,42,.4);
        font-family:'Hind Siliguri',system-ui,-apple-system,'Segoe UI',sans-serif;
      }
      #pwa-banner img{width:40px;height:40px;border-radius:10px;flex:0 0 40px}
      #pwa-banner .t{flex:1;min-width:0}
      #pwa-banner strong{display:block;font-size:14px;line-height:1.3}
      #pwa-banner span{display:block;font-size:12px;color:#9FB0C8;margin-top:2px;line-height:1.4}
      #pwa-banner button{
        border:0;border-radius:10px;font:inherit;font-size:13.5px;font-weight:700;
        padding:9px 15px;cursor:pointer;flex:0 0 auto;
      }
      #pwa-banner .go{background:#E2613C;color:#fff}
      #pwa-banner .no{background:transparent;color:#8FA3BF;padding:9px 4px}
      @media (max-width:420px){ #pwa-banner{gap:10px;padding:12px} }
    `;
    document.head.appendChild(style);

    const banner = document.createElement('div');
    banner.id = 'pwa-banner';
    banner.innerHTML =
      '<img src="/images/icon-192.png" alt="">' +
      '<div class="t"><strong>Add to your phone</strong>' +
      '<span>Opens like an app, and works without a signal</span></div>' +
      '<button class="go" type="button">Add</button>' +
      '<button class="no" type="button" aria-label="Not now">&times;</button>';
    document.body.appendChild(banner);

    banner.querySelector('.go').addEventListener('click', async () => {
      banner.remove();
      if (!deferred) return;
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome !== 'accepted') remember();
      deferred = null;
    });

    banner.querySelector('.no').addEventListener('click', () => {
      remember();
      banner.remove();
    });
  }

  // ---------------------------------------------------------------- push

  const urlBase64ToUint8Array = (base64) => {
    const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4))
      .replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(padded);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };

  /** Turns notifications on. Returns a short sentence to show the person:
   *  every failure here has a different fix, and "something went wrong"
   *  helps with none of them. */
  async function enablePush() {
    if (!('PushManager' in window)) {
      return { ok: false, message: 'This browser cannot do notifications. On an iPhone, add the site to your home screen first.' };
    }
    if (Notification.permission === 'denied') {
      return { ok: false, message: 'Notifications are blocked for this site. Turn them back on in your browser settings.' };
    }

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, message: 'Not switched on. You can press this again whenever you like.' };
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const { publicKey } = await fetch('/api/push-key').then((r) => r.json());
      if (!publicKey) return { ok: false, message: 'Notifications are not set up on the server yet.' };

      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        // Web push requires this: every notification must be visible. It is
        // not a setting we could turn off even if we wanted to.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save this device.');

      return { ok: true, message: 'Notifications are on for this device.' };
    } catch (e) {
      return { ok: false, message: e.message || 'Could not turn notifications on.' };
    }
  }

  async function disablePush() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return { ok: true, message: 'Already off.' };
      await fetch('/api/push-unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
      return { ok: true, message: 'Notifications are off for this device.' };
    } catch (e) {
      return { ok: false, message: e.message || 'Could not turn them off.' };
    }
  }

  async function pushState() {
    if (!('PushManager' in window)) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return subscription ? 'on' : 'off';
    } catch (e) {
      return 'off';
    }
  }

  // Used by the admin panel and the bookings page.
  window.CDMPush = { enable: enablePush, disable: disablePush, state: pushState };

  // Standalone means it is running as an installed app, not a browser tab.
  window.CDMInstalled = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
})();

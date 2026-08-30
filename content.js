// ==========================================================================
// Loads live content from /content/*.json (edited through the /admin CMS)
// and fills it into the pages. Packages are fully data-driven: adding or
// removing an entry in content/packages.json adds/removes it everywhere
// (shop grid, mobile menu, footer, related sections) and its detail page
// is served generically by product.html?slug=<slug> - no per-package HTML
// file needed. If the fetch fails (offline, JS disabled, opened as a local
// file), pages fall back to whatever was last baked into the HTML -
// nothing breaks.
// ==========================================================================

const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const HEART_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 000-7.8z"/></svg>';

function fetchJSON(path) {
  return fetch(path, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
}

function packageUrl(pkg) {
  return `product.html?slug=${encodeURIComponent(pkg.slug)}`;
}

// A package can exist before its photo has been uploaded. An empty src renders
// as a broken-image icon, so show a labelled placeholder instead.
const PLACEHOLDER = 'images/logo-mark.png';

function imageOrPlaceholder(src) {
  return src || PLACEHOLDER;
}

function productCardHTML(pkg) {
  const url = packageUrl(pkg);
  const code = pkg.code
    ? `<div class="product-code">Package Code: <span>${pkg.code}</span></div>`
    : '';
  // A freshly added package has no badge, discount or old price yet. These
  // render as coloured pills, so an empty one would show as a blank chip.
  const badge = pkg.badge ? `<span class="product-badge">${pkg.badge}</span>` : '';
  const discount = pkg.discount ? `<span class="product-discount">${pkg.discount}</span>` : '';
  const oldPrice = pkg.old_price ? `<span class="old">${pkg.old_price}</span>` : '';
  return (
    `<div class="product-card" data-cat="${pkg.categories.join(' ')}">` +
    `<a href="${url}"><div class="product-thumb">` +
    badge + discount +
    `<img class="${pkg.main_image ? '' : 'is-placeholder'}" src="${imageOrPlaceholder(pkg.main_image)}" alt="${pkg.name}"></div></a>` +
    `<div class="product-body">` +
    `<a href="${url}"><h3 class="product-name">${pkg.name}</h3></a>` +
    code +
    `<div class="product-loc">${PIN_SVG}Cox's Bazar</div>` +
    (pkg.price
      ? `<div class="product-price"><span class="from">শুরু</span>${oldPrice}${pkg.price}</div>`
      : '') +
    `<div class="product-actions"><button class="wish-btn">${HEART_SVG}</button>` +
    `<a href="${url}" class="book-btn">Book Now</a></div></div></div>`
  );
}

// Same markup as productCardHTML - kept as a separate name because the
// two spots (shop grid vs. related section) are easy to diverge on
// purpose later.
const relatedCardHTML = productCardHTML;

// ---------------------------------------------------------------- settings (every page)
// wa.me and tel: want bare digits. Admins reasonably type the number the way
// they'd write it ("+880 1898-841305"), which produced links like
// "https://wa.me/+880 1898-841305" that no client could open, so strip
// everything that isn't a digit before building a link.
function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function applySettings(settings) {
  if (!settings) return;

  // script.js builds the booking deep-link and has no access to settings,
  // so hand it the current number here rather than hard-coding one there.
  document.body.dataset.waNumber = phoneDigits(settings.whatsapp_number);

  const topbarSpan = document.querySelector('.topbar .container span');
  if (topbarSpan) topbarSpan.textContent = settings.topbar_announcement;
  const topbarLink = document.querySelector('.topbar .container a');
  if (topbarLink) {
    topbarLink.textContent = settings.phone_display;
    topbarLink.setAttribute('href', `https://wa.me/${phoneDigits(settings.whatsapp_number)}`);
  }

  document.querySelectorAll('a.float-wa').forEach(a => a.setAttribute('href', `https://wa.me/${phoneDigits(settings.whatsapp_number)}`));

  const footerDesc = document.querySelector('.footer-desc');
  if (footerDesc) footerDesc.textContent = settings.footer_desc;

  document.querySelectorAll('.footer-col a[href^="tel:"]').forEach(a => {
    a.setAttribute('href', `tel:+${phoneDigits(settings.whatsapp_number)}`);
    a.textContent = settings.phone_display;
  });
  document.querySelectorAll('.footer-col a[href^="mailto:"]').forEach(a => {
    a.setAttribute('href', `mailto:${settings.email}`);
    a.textContent = settings.email;
  });
  document.querySelectorAll('.footer-col').forEach(col => {
    const h4 = col.querySelector('h4');
    const p = col.querySelector('p');
    if (h4 && p && h4.textContent.trim() === 'যোগাযোগ') p.textContent = settings.address;
  });
}

// The cover design puts the closing line of the headline in gold. Rather
// than make whoever edits the CMS hand-write a <span>, the last <br>
// separated line is highlighted automatically - they just type plain text
// with <br> between lines. An explicit hero-accent span is left as-is so
// a hand-tuned headline still wins.
function headingHTML(raw) {
  const text = String(raw || '');
  if (/hero-accent/.test(text)) return text;
  const lines = text.split(/<br\s*\/?>/i);
  if (lines.length < 2) return text;
  const last = lines.pop();
  return `${lines.join('<br>')}<br><span class="hero-accent">${last}</span>`;
}

function applyHero(hero) {
  if (!hero) return;
  const eyebrow = document.getElementById('hero-eyebrow');
  const heading = document.getElementById('hero-heading');
  const sub = document.getElementById('hero-sub');
  const cta = document.getElementById('hero-cta');
  const img = document.getElementById('hero-image');
  if (eyebrow) eyebrow.textContent = hero.eyebrow;
  if (heading) heading.innerHTML = headingHTML(hero.heading);
  if (sub) sub.textContent = hero.subheading;
  if (cta) cta.textContent = hero.cta_text;
  if (img) img.setAttribute('src', hero.image);
}

// ---------------------------------------------------------------- mobile menu / footer links
// Both are fully rebuilt from the current package list (not just
// text-patched) so adding or deleting a package via the CMS changes the
// count of links here too, on every page, automatically.
function buildMobileMenu(packages) {
  const wrap = document.getElementById('mm-categories');
  if (!wrap) return;
  wrap.innerHTML = packages.map(p => `<a class="mm-sub" href="${packageUrl(p)}">${p.name}</a>`).join('');
  window.initMobileMenu();
}

function buildFooterPackageLinks(packages) {
  document.querySelectorAll('#footer-packages').forEach(wrap => {
    wrap.innerHTML = packages.map(p => `<a href="${packageUrl(p)}">${p.name}</a>`).join('');
  });
}

// ---------------------------------------------------------------- shop grid
function applyShopGrid(packages) {
  // #shop-grid is the shop page's own grid section - scoping to it keeps
  // this from ever touching the related-products grid on product.html.
  const realGrid = document.querySelector('#shop-grid > .product-grid');
  if (!realGrid) return;

  realGrid.innerHTML = packages.map(productCardHTML).join('');
  window.initWishButtons();
  window.initShopFilters();
}


// ---------------------------------------------------------------- booking add-ons
// Extras sit on top of the package price and are offered on every package page.
// They are editable in site settings; this is the fallback for a volume whose
// settings.json predates the field.
//
// An extra with no fee is quoted on request rather than free - it is marked as
// such, left out of the total, and flagged in the booking message so the
// customer knows the price is still to be agreed.
const ADDON_DEFAULTS = [
  { label: 'Drone Shot (Cinematic Special Drone Video)', fee: '2000' },
  { label: 'Special Dinner', fee: '' },
];

const ON_REQUEST_LABEL = '\u0986\u09b2\u09cb\u099a\u09a8\u09be \u09b8\u09be\u09aa\u09c7\u0995\u09cd\u09b7\u09c7';

// Prices are authored as display strings ("\u09f314,999"), so read the amount out of
// the digits and keep whatever symbol the owner typed.
function priceAmount(text) {
  const digits = String(text || '').replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

function priceSymbol(text) {
  const m = /^[^0-9]*/.exec(String(text || ''));
  // Falls back to the Taka sign when the price is not set yet, so an
  // add-on fee never renders as a bare number.
  return (m && m[0].trim()) || '\u09f3';
}

function formatPrice(amount, symbol) {
  return `${symbol}${amount.toLocaleString('en-US')}`;
}

function bookingAddons(settings) {
  let configured = settings && settings.addons;
  if (!Array.isArray(configured) || !configured.length) {
    // settings.json from before extras became a list carried a single one
    const legacy = settings && settings.drone_addon;
    configured = legacy ? [legacy] : ADDON_DEFAULTS;
  }
  return configured
    .filter(a => a && a.label)
    .map(a => ({ label: a.label, fee: priceAmount(a.fee) }));
}

// ---------------------------------------------------------------- product detail page (product.html?slug=...)
function applyProductDetail(packages) {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug') || document.body.getAttribute('data-package');
  if (!slug) return;

  const pkg = packages.find(p => p.slug === slug);
  if (!pkg) {
    // Package no longer exists (deleted via CMS, or a stale/typo'd link) -
    // send visitors somewhere useful instead of a blank page.
    window.location.replace('shop.html');
    return;
  }

  document.title = `${pkg.name} | Cox's Dream Moment`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content', (pkg.description || '').slice(0, 155));

  document.querySelectorAll('.page-banner h1, .pd-info h1').forEach(h1 => (h1.textContent = pkg.name));
  const crumb = document.querySelector('.crumb-current');
  if (crumb) crumb.textContent = pkg.name;

  const trustText = document.querySelector('.pd-trust-text');
  if (trustText) {
    trustText.textContent = [pkg.trust_extra, pkg.discount, "Cox's Bazar"]
      .filter(Boolean).join(' · ');
  }

  // Stashed on <body> so the booking buttons in script.js can pull the code
  // into the WhatsApp message without re-parsing any rendered text.
  const codeEl = document.querySelector('.pd-code');
  if (pkg.code) {
    document.body.dataset.packageCode = pkg.code;
    if (codeEl) {
      codeEl.innerHTML = `Package Code: <span>${pkg.code}</span>`;
      codeEl.hidden = false;
    }
  } else {
    delete document.body.dataset.packageCode;
    if (codeEl) codeEl.hidden = true;
  }

  const inclusionsList = document.querySelector('.pd-inclusions');
  if (inclusionsList) inclusionsList.innerHTML = pkg.inclusions.map(li => `<li>${li}</li>`).join('');

  const mainImg = document.querySelector('.pd-main-img img');
  if (mainImg) {
    mainImg.setAttribute('src', imageOrPlaceholder(pkg.main_image));
    mainImg.setAttribute('alt', pkg.name);
    mainImg.classList.toggle('is-placeholder', !pkg.main_image);
  }
  const thumbs = document.querySelector('.pd-thumbs');
  if (thumbs) {
    thumbs.innerHTML = pkg.thumbnails.map((t, i) =>
      `<div class="pd-thumb${i === 0 ? ' active' : ''}"><img src="${t.image}" alt="${t.alt}"></div>`
    ).join('');
    window.initPdThumbs();
  }

  const priceValue = document.querySelector('.bb-price-value');
  if (priceValue) {
    const oldPrice = pkg.old_price ? `<span class="old">${pkg.old_price}</span>` : '';
    priceValue.innerHTML = `${oldPrice}${pkg.price || ''}`;
    // No price yet - hide the whole row rather than leave a dangling label.
    const priceRow = priceValue.closest('.bb-price-row');
    if (priceRow) priceRow.hidden = !pkg.price;
  }

  setupAddons(pkg);

  const descP = document.querySelector('.pd-tab-content[data-tab-content="desc"] p');
  if (descP) descP.textContent = pkg.description;
  const policyP = document.querySelector('.pd-tab-content[data-tab-content="policy"] p');
  if (policyP && pkg.booking_policy) policyP.textContent = pkg.booking_policy;
  const faqP = document.querySelector('.pd-tab-content[data-tab-content="faq"] p');
  if (faqP && pkg.faq) faqP.textContent = pkg.faq;

  const relatedGrid = document.querySelector('.related-section .product-grid');
  if (relatedGrid) {
    const others = packages.filter(p => p.slug !== slug);
    relatedGrid.innerHTML = others.map(relatedCardHTML).join('');
    window.initWishButtons();
  }
}

// ---------------------------------------------------------------- gallery page
function applyGallery(gallery) {
  const grid = document.querySelector('.gallery-grid');
  if (!grid || !gallery) return;
  grid.innerHTML = gallery.items.map(item =>
    `<figure class="gal-item${item.size ? ' ' + item.size : ''}">` +
    `<img src="${item.image}" alt="${item.alt}" loading="lazy">` +
    `<figcaption>${item.caption}</figcaption></figure>`
  ).join('');
  const note = document.querySelector('.gallery-note');
  if (note && gallery.note) note.textContent = gallery.note;
}

// ---------------------------------------------------------------- contact page
function applyContactPage(settings) {
  const cards = document.querySelector('.contact-cards');
  if (!cards || !settings) return;

  const waLink = cards.querySelector('a[href^="https://wa.me/"]');
  if (waLink) {
    waLink.setAttribute('href', `https://wa.me/${phoneDigits(settings.whatsapp_number)}`);
    waLink.textContent = settings.phone_display;
  }
  const fbLink = cards.querySelector('a[href*="facebook.com"]');
  if (fbLink) {
    fbLink.setAttribute('href', settings.facebook_url);
    fbLink.textContent = settings.facebook_label;
  }
  const phoneLink = cards.querySelector('a[href^="tel:"]');
  if (phoneLink) {
    phoneLink.setAttribute('href', `tel:+${phoneDigits(settings.whatsapp_number)}`);
    phoneLink.textContent = settings.phone_display;
  }
  const mailLink = cards.querySelector('a[href^="mailto:"]');
  if (mailLink) {
    mailLink.setAttribute('href', `mailto:${settings.email}`);
    mailLink.textContent = settings.email;
  }
  const serviceArea = cards.querySelector('.cc-plain');
  if (serviceArea) serviceArea.textContent = settings.service_area;

  const sideWaBtn = document.querySelector('.side-wa-btn');
  if (sideWaBtn) sideWaBtn.setAttribute('href', `https://wa.me/${phoneDigits(settings.whatsapp_number)}`);

  const hoursRows = document.querySelectorAll('.hours-card p:not(.hours-note)');
  settings.hours.forEach((h, i) => {
    if (!hoursRows[i]) return;
    const spans = hoursRows[i].querySelectorAll('span');
    if (spans[0]) spans[0].textContent = h.days;
    if (spans[1]) spans[1].textContent = h.time;
  });
  const hoursNote = document.querySelector('.hours-card .hours-note');
  if (hoursNote) hoursNote.textContent = settings.hours_note;
}

// ---------------------------------------------------------------- boot
document.addEventListener('DOMContentLoaded', function () {
  Promise.all([
    fetchJSON('content/settings.json'),
    fetchJSON('content/packages.json'),
    fetchJSON('content/gallery.json'),
  ]).then(([settings, packagesData, gallery]) => {
    const packages = packagesData ? packagesData.packages : null;

    // applyProductDetail() needs the add-on fee, which lives in settings.
    window.__siteSettings = settings || {};

    if (settings) {
      applySettings(settings);
      applyHero(settings.hero);
      applyContactPage(settings);
    }
    if (packages) {
      buildMobileMenu(packages);
      buildFooterPackageLinks(packages);
      applyShopGrid(packages);
      applyProductDetail(packages);
    }
    if (gallery) applyGallery(gallery);
  });
});

// Keeps the total, the checkbox label and the values script.js reads for the
// WhatsApp message in step with each other.
function setupAddons(pkg) {
  const wrap = document.querySelector('.bb-addons-list');
  const section = document.querySelector('.bb-addons');
  const totalValue = document.querySelector('.bb-total-value');
  const totalNote = document.querySelector('.bb-total-note');
  if (!wrap) return;

  const addons = bookingAddons(window.__siteSettings);
  const base = priceAmount(pkg.price);
  const symbol = priceSymbol(pkg.price);

  if (section) section.hidden = !addons.length;

  wrap.innerHTML = addons.map((a, i) => {
    const fee = a.fee === null
      ? `<span class="bb-addon-fee is-on-request">${ON_REQUEST_LABEL}</span>`
      : `<span class="bb-addon-fee">+${formatPrice(a.fee, symbol)}</span>`;
    return `<label class="bb-addon" for="bb-addon-${i}">`
      + `<input type="checkbox" id="bb-addon-${i}" data-addon-index="${i}">`
      + `<span class="bb-addon-name">${a.label}</span>${fee}</label>`;
  }).join('');

  const boxes = Array.from(wrap.querySelectorAll('input[data-addon-index]'));

  const render = () => {
    const chosen = boxes
      .map((b, i) => (b.checked ? addons[i] : null))
      .filter(Boolean);

    // script.js reads these off <body> when it builds the booking message.
    if (chosen.length) {
      document.body.dataset.addons = chosen
        .map(a => a.fee === null
          ? `${a.label} (${ON_REQUEST_LABEL})`
          : `${a.label} \u2014 +${formatPrice(a.fee, symbol)}`)
        .join(', ');
    } else {
      delete document.body.dataset.addons;
    }

    const extra = chosen.reduce((sum, a) => sum + (a.fee || 0), 0);
    const onRequest = chosen.some(a => a.fee === null);

    if (totalNote) {
      totalNote.hidden = !onRequest;
      if (onRequest) {
        totalNote.textContent = '* '
          + chosen.filter(a => a.fee === null).map(a => a.label).join(', ')
          + '-\u098f\u09b0 \u09ae\u09c2\u09b2\u09cd\u09af \u0986\u09b2\u09cb\u099a\u09a8\u09be \u09b8\u09be\u09aa\u09c7\u0995\u09cd\u09b7\u09c7 \u09a8\u09bf\u09b0\u09cd\u09a7\u09be\u09b0\u09bf\u09a4 \u09b9\u09ac\u09c7\u0964';
      }
    }

    if (!totalValue) return;
    if (base === null) {
      // No price on this package yet - show the extras alone rather than
      // inventing a total.
      totalValue.textContent = extra ? `+${formatPrice(extra, symbol)}` : '';
      return;
    }
    totalValue.textContent = formatPrice(base + extra, symbol);
  };

  boxes.forEach(b => b.addEventListener('change', render));
  render();
}

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

// ---------------------------------------------------------------- pricing
//
// The owner types one number and, if there is an offer on, a percentage. The
// figure the customer pays is worked out here rather than typed, because a
// price and a discount typed separately drift apart the moment one of them
// changes, and the wrong number on a price tag is the one mistake a customer
// always notices.
//
// `price_amount` is the full price in taka. `discount_percent` is 0 when
// there is no offer. The older `price` / `old_price` strings are still read
// for any package that has not been moved over.

const tk = (n) => '৳' + Math.round(n).toLocaleString('en-IN');

function priceOf(pkg) {
  const full = Number(pkg.price_amount) || 0;
  const pct = Math.min(Math.max(Number(pkg.discount_percent) || 0, 0), 95);

  if (full > 0) {
    const now = Math.round(full * (1 - pct / 100));
    return {
      has: true,
      now: tk(now),
      was: pct > 0 ? tk(full) : '',
      off: pct > 0 ? pct + '% OFF' : '',
      saved: pct > 0 ? tk(full - now) : '',
      amount: now,
    };
  }

  // A package still carrying the old hand-typed strings.
  if (pkg.price) {
    return {
      has: true,
      now: pkg.price,
      was: pkg.old_price || '',
      off: pkg.discount || '',
      saved: '',
      amount: 0,
    };
  }

  return { has: false, now: '', was: '', off: '', saved: '', amount: 0 };
}

// Exposed so the booking form can show the price beside each package name.
window.cdmPriceOf = priceOf;

function imageOrPlaceholder(src) {
  return src || PLACEHOLDER;
}

function productCardHTML(pkg, isFeatured) {
  const url = packageUrl(pkg);
  const code = pkg.code
    ? `<div class="product-code">Package Code: <span>${pkg.code}</span></div>`
    : '';
  // A freshly added package has no badge, discount or old price yet. These
  // render as coloured pills, so an empty one would show as a blank chip.
  const badge = pkg.badge ? `<span class="product-badge">${pkg.badge}</span>` : '';
  // A discount is a reduction from a price. Without a price there is nothing
  // for it to reduce, so neither the pill nor the struck-through old price is
  // drawn on a package that is quoted in conversation.
  const money = priceOf(pkg);
  const discount = money.off ? `<span class="product-discount">${money.off}</span>` : '';
  const oldPrice = money.was ? `<span class="old">${money.was}</span>` : '';
  return (
    `<div class="product-card${isFeatured ? ' is-featured' : ''}" data-cat="${pkg.categories.join(' ')}">` +
    `<a href="${url}"><div class="product-thumb">` +
    badge + discount +
    `<img class="${pkg.main_image ? '' : 'is-placeholder'}" src="${imageOrPlaceholder(pkg.main_image)}" alt="${pkg.name}"></div></a>` +
    `<div class="product-body">` +
    `<a href="${url}"><h3 class="product-name">${pkg.name}</h3></a>` +
    code +
    `<div class="product-loc">${PIN_SVG}Cox's Bazar</div>` +
    (money.has
      // The price they pay is the biggest thing here; the old one sits beside
      // it, struck through and small, so the saving reads at a glance.
      ? `<div class="product-price">${oldPrice}<span class="now">${money.now}</span></div>`
        + (money.saved ? `<div class="product-saved">You save ${money.saved}</div>` : '')
      // No price set: say so, rather than leaving a gap where one would be.
      : `<div class="is-on-request">${ON_REQUEST_LABEL}</div>`) +
    `<div class="product-actions"><button class="wish-btn">${HEART_SVG}</button>` +
    `<a href="${url}" class="book-btn">Book Now</a></div></div></div>`
  );
}

// Same markup as productCardHTML - kept as a separate name because the
// two spots (shop grid vs. related section) are easy to diverge on
// purpose later.
const relatedCardHTML = productCardHTML;

// ---------------------------------------------------------------- media services
//
// Drone and camera work is sold alongside a setup, never instead of one, so
// it gets its own row rather than a card in the grid where it would read as
// a sixth beach package.

const isMedia = (pkg) => pkg.kind === 'media';

const DRONE_SVG =
  '<svg viewBox="0 0 24 24"><path d="M5 5l3 3M19 5l-3 3M5 19l3-3M19 19l-3-3"/>' +
  '<rect x="8" y="8" width="8" height="8" rx="2"/>' +
  '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>' +
  '<circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></svg>';

const CAMERA_SVG =
  '<svg viewBox="0 0 24 24"><path d="M3 7h3l2-2h8l2 2h3a1 1 0 011 1v11a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1z"/>' +
  '<circle cx="12" cy="13" r="4"/></svg>';

function mediaCardHTML(pkg) {
  const url = packageUrl(pkg);
  const money = priceOf(pkg);
  const icon = pkg.slug === 'drone-video' ? DRONE_SVG : CAMERA_SVG;

  const price = money.has
    ? `<span class="m-price">${money.was ? `<span class="old">${money.was}</span>` : ''}${money.now}</span>`
    : `<span class="m-ask">${ON_REQUEST_LABEL}</span>`;

  return (
    `<article class="media-card">` +
    `<div class="m-icon">${icon}</div>` +
    `<h3>${pkg.name}</h3>` +
    (pkg.trust_extra ? `<p class="m-tag">${pkg.trust_extra}</p>` : '') +
    `<ul>${(pkg.inclusions || []).map(i => `<li>${i}</li>`).join('')}</ul>` +
    `<div class="m-foot">${price}<a class="m-btn" href="${url}">See details</a></div>` +
    `</article>`
  );
}

/** Fills any .media-grid on the page, and hides its section when there is
 *  nothing to put in it — an empty dark band would look like a bug. */
function applyMediaSection(packages) {
  const grid = document.querySelector('.media-grid');
  if (!grid) return;
  const media = packages.filter(isMedia);
  const section = grid.closest('.media-section');

  if (!media.length) {
    if (section) section.hidden = true;
    return;
  }
  if (section) section.hidden = false;
  grid.innerHTML = media.map(mediaCardHTML).join('');
}

// ---------------------------------------------------------------- settings (every page)
// wa.me and tel: want bare digits. Admins reasonably type the number the way
// they'd write it ("+880 1347-059522"), which produced links like
// "https://wa.me/+880 1347-059522" that no client could open, so strip
// everything that isn't a digit before building a link.
function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

// What the booking box promises, and the warning under it. Both come from
// settings so the owner can change them; the defaults below are only what a
// brand-new install starts with.
const TRUST_DEFAULTS = [
  'We are a registered Cox\u2019s Bazar business \u2014 our own team, our own equipment',
  'Your date is held the moment we confirm; a 30% advance secures it',
  'Free date change if it rains, and free up to 48 hours before',
  'We arrive two hours early and set up before you get there',
  'Pay after you see the setup, or send the advance to our own account',
];

const FAKE_WARNING_DEFAULT =
  'We work only through this website, our own WhatsApp number and our verified Facebook page. '
  + 'Several pages copy our name and our photographs. Before paying anyone, check the number '
  + 'against the one shown here \u2014 we will never ask you to send money to a different account.';

function applyTrust(settings) {
  const list = document.querySelector('.bb-trust');
  if (list) {
    const points = Array.isArray(settings.trust_points) && settings.trust_points.length
      ? settings.trust_points
      : TRUST_DEFAULTS;
    list.innerHTML = points
      .filter(Boolean)
      .map(t => `<li>${t}</li>`)
      .join('');
  }

  const box = document.querySelector('.bb-warning');
  if (box) {
    // An empty string is the owner switching the warning off on purpose,
    // which is different from never having set one.
    const text = settings.fake_warning === undefined
      ? FAKE_WARNING_DEFAULT
      : settings.fake_warning;
    const p = box.querySelector('p');
    if (p) p.textContent = text;
    box.hidden = !text;
  }
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

  // The helpline is a separate number: a phone that is answered on the day of
  // an event, when a WhatsApp message is no use to anybody. It falls back to
  // the main number so a settings file that predates the field still works.
  const helplineDigits = phoneDigits(settings.helpline_number) || phoneDigits(settings.whatsapp_number);
  const helplineCard = document.getElementById('helpline-card');
  if (helplineCard) {
    helplineCard.setAttribute('href', `tel:+${helplineDigits}`);
    const display = document.getElementById('helpline-display');
    if (display) display.textContent = settings.helpline_display || settings.phone_display || `+${helplineDigits}`;
    const note = document.getElementById('helpline-note');
    if (note && settings.helpline_note) note.textContent = settings.helpline_note;
  }

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
    if (h4 && p && h4.textContent.trim() === 'Contact') p.textContent = settings.address;
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
  if (eyebrow) eyebrow.textContent = hero.eyebrow;
  if (heading) heading.innerHTML = headingHTML(hero.heading);
  if (sub) sub.textContent = hero.subheading;
  if (cta) cta.textContent = hero.cta_text;
  // The hero carries no photograph any more; hero.image is left in settings
  // so an existing volume is not invalidated, and is simply unused.
}

// ---------------------------------------------------------------- about + stats
// Both are editable in site settings, so the owner can rewrite who they are
// and what the numbers say without touching the markup.
function applyAbout(settings) {
  if (!settings) return;

  const about = settings.about;
  if (about) {
    const eyebrow = document.getElementById('about-eyebrow');
    const heading = document.getElementById('about-heading');
    const body = document.getElementById('about-body');
    const note = document.getElementById('about-note');

    if (eyebrow && about.eyebrow) eyebrow.textContent = about.eyebrow;
    if (heading && about.heading) heading.textContent = about.heading;

    if (body && about.body) {
      // A blank line starts a new paragraph. Built as elements rather than
      // innerHTML so anything typed into the admin panel is text, not markup.
      body.textContent = '';
      String(about.body).split(/\n\s*\n/).forEach(part => {
        const trimmed = part.trim();
        if (!trimmed) return;
        const el = document.createElement('p');
        el.textContent = trimmed;
        body.appendChild(el);
      });
    }

    if (note) {
      note.textContent = about.note || '';
      note.hidden = !about.note;
    }
  }

  const grid = document.getElementById('stat-grid');
  if (grid && Array.isArray(settings.stats) && settings.stats.length) {
    grid.textContent = '';
    settings.stats.forEach(stat => {
      const li = document.createElement('li');
      const value = document.createElement('strong');
      value.textContent = stat.value || '';
      const label = document.createElement('span');
      label.textContent = stat.label || '';
      li.append(value, label);
      grid.appendChild(li);
    });
  }
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

  // Decoration setups only. Photography has its own row further down, and a
  // drone package sitting among the beach setups reads as a sixth setup.
  const setups = packages.filter(p => !isMedia(p));

  // The ones marked `featured` go in their own row above everything else:
  // the owner decides what people should see first, and a customer looking
  // for a place to start should not have to open every page to find one.
  const featured = setups.filter(p => p.featured);
  const rest = setups.filter(p => !p.featured);

  const section = document.getElementById('featured-grid');
  if (section) {
    if (featured.length) {
      section.hidden = false;
      const grid = section.querySelector('.product-grid');
      if (grid) grid.innerHTML = featured.map(p => productCardHTML(p, true)).join('');
    } else {
      section.hidden = true;
    }
  }

  // With no featured section on the page, nothing is dropped - everything is
  // shown in the main grid as before.
  realGrid.innerHTML = (section ? rest : setups).map(p => productCardHTML(p)).join('');

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

const ON_REQUEST_LABEL = 'For contact';

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
    window.location.replace('/');
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
    // De-duplicated: the location is appended, but trust_extra has said it
    // before now, and "Cox's Bazar · Cox's Bazar" reads as a bug.
    const parts = [pkg.trust_extra, priceOf(pkg).off, "Cox's Bazar"]
      .filter(Boolean)
      .filter((part, i, all) => all.indexOf(part) === i);
    trustText.textContent = parts.join(' · ');
  }

  // Stashed on <body> so the booking buttons in script.js can pull the code
  // into the WhatsApp message without re-parsing any rendered text. The slug
  // goes with it: "Book on this website" hands it to the booking form so the
  // enquiry is tied to a package rather than to whatever the heading says.
  if (pkg.slug) document.body.dataset.packageSlug = pkg.slug;
  else delete document.body.dataset.packageSlug;

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

  const mainBox = document.querySelector('.pd-main-img');
  if (mainBox) {
    const loader = mainBox.querySelector('.pd-loading');
    if (loader) {
      // Replace the loading block with a real <img> the rest of this
      // function can set a source on.
      loader.remove();
      const img = document.createElement('img');
      img.alt = pkg.name || '';
      mainBox.appendChild(img);
    }
    mainBox.classList.remove('is-loading');
  }

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

  const money = priceOf(pkg);
  const priceValue = document.querySelector('.bb-price-value');
  if (priceValue) {
    priceValue.innerHTML =
      (money.was ? `<span class="old">${money.was}</span>` : '') +
      `<span class="now">${money.now}</span>` +
      (money.off ? `<span class="off-pill">${money.off}</span>` : '');
    // No price yet - hide the whole row rather than leave a dangling label.
    const priceRow = priceValue.closest('.bb-price-row');
    if (priceRow) priceRow.hidden = !money.has;
  }

  // The total under the booking box has to agree with the price above it.
  const totalValue = document.querySelector('.bb-total-value');
  if (totalValue && money.has) totalValue.textContent = money.now;

  setupAddons(pkg, packages);

  const descP = document.querySelector('.pd-tab-content[data-tab-content="desc"] p');
  if (descP) descP.textContent = pkg.description;
  const policyP = document.querySelector('.pd-tab-content[data-tab-content="policy"] p');
  if (policyP && pkg.booking_policy) policyP.textContent = pkg.booking_policy;
  const faqP = document.querySelector('.pd-tab-content[data-tab-content="faq"] p');
  if (faqP && pkg.faq) faqP.textContent = pkg.faq;

  const relatedGrid = document.querySelector('.related-section .product-grid');
  if (relatedGrid) {
    const others = packages.filter(p => p.slug !== slug && isMedia(p) === isMedia(pkg));
    relatedGrid.innerHTML = others.map(relatedCardHTML).join('');
    window.initWishButtons();
  }
}

// ---------------------------------------------------------------- gallery page
function applyGallery(gallery) {
  const grid = document.querySelector('.gallery-grid');
  if (!grid || !gallery) return;

  const items = Array.isArray(gallery.items) ? gallery.items : [];

  if (items.length === 0) {
    // An empty grid is just a gap, and a gap reads as a broken page. Say what
    // is happening and give the visitor the one thing they can still do.
    grid.classList.add('is-empty');
    grid.innerHTML =
      '<div class="gallery-empty">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
      '<rect x="3" y="5" width="18" height="14" rx="2"/>' +
      '<circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5L5 19"/></svg>' +
      '<p>Photographs from our events are being added here.</p>' +
      '<a class="btn-ghost" href="/">See the packages</a>' +
      '</div>';
  } else {
    grid.classList.remove('is-empty');
    grid.innerHTML = items.map(item =>
      `<figure class="gal-item${item.size ? ' ' + item.size : ''}">` +
      `<img src="${item.image}" alt="${item.alt || ''}" loading="lazy">` +
      (item.caption ? `<figcaption>${item.caption}</figcaption>` : '') +
      `</figure>`
    ).join('');
  }

  const note = document.querySelector('.gallery-note');
  // With nothing in the gallery the note repeats what the empty state says.
  if (note) note.hidden = items.length === 0;
  if (note && gallery.note) note.textContent = gallery.note;
}

// ---------------------------------------------------------------- contact page
function applyContactPage(settings) {
  const cards = document.querySelector('.contact-cards');
  if (!cards || !settings) return;

  // Every selector here is scoped to .cc-body - the link *inside* a card.
  // The helpline card is itself an <a href="tel:">, so an unscoped
  // `a[href^="tel:"]` matched the whole card and replaced its markup with a
  // bare phone number.
  const waLink = cards.querySelector('.cc-body a[href^="https://wa.me/"]');
  if (waLink) {
    waLink.setAttribute('href', `https://wa.me/${phoneDigits(settings.whatsapp_number)}`);
    waLink.textContent = settings.phone_display;
  }
  const fbLink = cards.querySelector('.cc-body a[href*="facebook.com"]');
  if (fbLink) {
    fbLink.setAttribute('href', settings.facebook_url);
    fbLink.textContent = settings.facebook_label;
  }
  const phoneLink = cards.querySelector('.cc-body a[href^="tel:"]');
  if (phoneLink) {
    phoneLink.setAttribute('href', `tel:+${phoneDigits(settings.whatsapp_number)}`);
    phoneLink.textContent = settings.phone_display;
  }
  const mailLink = cards.querySelector('.cc-body a[href^="mailto:"]');
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
      applyAbout(settings);
  applyTrust(settings);
    }
    if (packages) {
      buildMobileMenu(packages);
      buildFooterPackageLinks(packages);
      applyShopGrid(packages);
      applyProductDetail(packages);
    }
    if (gallery) applyGallery(gallery);
  })
  .catch(() => {
    // A failed fetch leaves whatever the HTML shipped with, which is better
    // than an empty page - but the loader has to come off either way.
  })
  .finally(() => {
    // Lifted only once the live content is in place, so the first thing seen
    // is the real catalogue rather than the fallback baked into the HTML.
    if (window.__liftLoader) window.__liftLoader();
  });
});

// ---------------------------------------------------------------- extras
//
// What can be added to a booking. These used to be two lines of text typed
// into settings; they are now the photo-and-video packages themselves, so
// what a customer sees here is the same name, price and picture they would
// find on that package's own page, and changing it in one place changes it
// everywhere.
//
// Keeps the total, the tick boxes and the values script.js reads for the
// booking message in step with each other.
function setupAddons(pkg, packages) {
  const wrap = document.querySelector('.bb-addons-list');
  const section = document.querySelector('.bb-addons');
  const totalValue = document.querySelector('.bb-total-value');
  const totalNote = document.querySelector('.bb-total-note');
  if (!wrap) return;

  // A media package never offers itself as its own extra.
  const extras = (packages || []).filter(p => isMedia(p) && p.slug !== pkg.slug);

  if (section) section.hidden = !extras.length;
  if (!extras.length) return;

  const base = priceOf(pkg);

  wrap.innerHTML = extras.map((extra, i) => {
    const money = priceOf(extra);
    const photo = extra.main_image
      ? `<img src="${extra.main_image}" alt="">`
      : `<img class="is-placeholder" src="${PLACEHOLDER}" alt="">`;
    const fee = money.has
      ? `<span class="bb-addon-fee">+${money.now}</span>`
      : `<span class="bb-addon-fee is-on-request">${ON_REQUEST_LABEL}</span>`;

    return `<label class="bb-addon" for="bb-addon-${i}">`
      + `<input type="checkbox" id="bb-addon-${i}" data-addon-index="${i}">`
      + `<span class="bb-addon-tick"></span>`
      + `<span class="bb-addon-photo">${photo}</span>`
      + `<span class="bb-addon-text">`
      +   `<span class="bb-addon-name">${extra.name}</span>`
      +   (extra.trust_extra ? `<span class="bb-addon-sub">${extra.trust_extra}</span>` : '')
      + `</span>${fee}</label>`;
  }).join('');

  const boxes = Array.from(wrap.querySelectorAll('input[data-addon-index]'));

  const render = () => {
    const chosen = boxes.map((b, i) => (b.checked ? extras[i] : null)).filter(Boolean);

    // script.js reads these off <body> when it builds the booking message and
    // the link into the booking form.
    if (chosen.length) {
      document.body.dataset.addons = chosen
        .map(e => {
          const m = priceOf(e);
          return m.has ? `${e.name} \u2014 +${m.now}` : `${e.name} (${ON_REQUEST_LABEL})`;
        })
        .join(', ');
      document.body.dataset.addonSlugs = chosen.map(e => e.slug).join(',');
    } else {
      delete document.body.dataset.addons;
      delete document.body.dataset.addonSlugs;
    }

    const extraTotal = chosen.reduce((sum, e) => sum + priceOf(e).amount, 0);
    const onRequest = chosen.some(e => !priceOf(e).has);

    if (totalNote) {
      totalNote.hidden = !onRequest;
      if (onRequest) {
        totalNote.textContent = '* '
          + chosen.filter(e => !priceOf(e).has).map(e => e.name).join(', ')
          + ' \u2014 price agreed with you before the booking is confirmed.';
      }
    }

    if (!totalValue) return;
    if (!base.has) {
      // No price on this package yet: show the extras alone rather than
      // inventing a total.
      totalValue.textContent = extraTotal ? '+' + tk(extraTotal) : '';
      return;
    }
    totalValue.textContent = tk(base.amount + extraTotal);
  };

  boxes.forEach(b => b.addEventListener('change', render));
  render();
}
document.addEventListener('DOMContentLoaded', function () {
  window.initMobileMenu();
  window.initPdThumbs();

  // Tabs
  document.querySelectorAll('.pd-tab-head').forEach(head => {
    head.addEventListener('click', () => {
      const target = head.getAttribute('data-tab');
      document.querySelectorAll('.pd-tab-head').forEach(h => h.classList.remove('active'));
      document.querySelectorAll('.pd-tab-content').forEach(c => c.classList.remove('active-tab'));
      head.classList.add('active');
      const content = document.querySelector(`.pd-tab-content[data-tab-content="${target}"]`);
      if (content) content.classList.add('active-tab');
    });
  });

  // Booking box total (guests can add-on price, kept simple: total = base price)
  const bookBtn = document.querySelector('.bb-book-btn');
  const waBtn = document.querySelector('.bb-wa-btn');
  // content.js publishes the number from site settings; the literal is only a
  // fallback for when the settings request has not landed yet.
  const waNumber = () => document.body.dataset.waNumber || '8801347059522';

  function buildMessage() {
    const productName = document.querySelector('.pd-info h1') ? document.querySelector('.pd-info h1').textContent.trim() : 'Package';
    const packageCode = document.body.dataset.packageCode || '';
    const location = document.querySelector('#bb-location') ? document.querySelector('#bb-location').value : "Cox's Bazar";
    const date = document.querySelector('#bb-date') ? document.querySelector('#bb-date').value : '';
    const guests = document.querySelector('#bb-guests') ? document.querySelector('#bb-guests').value : '2';
    const slot = document.querySelector('#bb-slot') ? document.querySelector('#bb-slot').value : '';
    const occasion = document.querySelector('#bb-occasion') ? document.querySelector('#bb-occasion').value : '';
    const total = document.querySelector('.bb-total-value') ? document.querySelector('.bb-total-value').textContent.trim() : '';

    const addons = document.body.dataset.addons || '';

    const codeLine = packageCode ? `%0A🔖 Package code: ${encodeURIComponent(packageCode)}` : '';
    const addonLine = addons ? `%0A➕ Add-ons: ${encodeURIComponent(addons)}` : '';

    return `Hello! I would like to book.%0A%0A🎁 Package: ${encodeURIComponent(productName)}${codeLine}%0A📍 Location: ${encodeURIComponent(location)}%0A📅 Date: ${encodeURIComponent(date)}%0A👥 Guests: ${encodeURIComponent(guests)}%0A⏰ Time: ${encodeURIComponent(slot)}%0A💐 Occasion: ${encodeURIComponent(occasion)}${addonLine}%0A💰 Total: ${encodeURIComponent(total)}`;
  }

  if (bookBtn) {
    bookBtn.addEventListener('click', function (e) {
      e.preventDefault();
      const text = buildMessage();
      window.open(`https://wa.me/${waNumber()}?text=${text}`, '_blank');
    });
  }
  if (waBtn) {
    waBtn.addEventListener('click', function (e) {
      e.preventDefault();
      const text = buildMessage();
      window.open(`https://wa.me/${waNumber()}?text=${text}`, '_blank');
    });
  }

  window.initWishButtons();
  window.initShopFilters();
});

// ---------------------------------------------------------------------
// Everything below is re-bindable: content.js rebuilds the product-grid,
// mobile-menu package links and thumbnails from the live CMS content
// (packages can be added/removed), then calls these again so the freshly
// created elements get their click handlers. Each one guards itself with
// a dataset.wired flag so re-running never double-binds.
// ---------------------------------------------------------------------

window.initMobileMenu = function () {
  const toggle = document.querySelector('.nav-toggle');
  const mobileMenu = document.querySelector('.mobile-menu');
  const closeBtn = document.querySelector('.mobile-menu .close-btn');
  if (!toggle || !mobileMenu) return;

  if (!toggle.dataset.wired) {
    toggle.dataset.wired = '1';
    toggle.addEventListener('click', () => mobileMenu.classList.add('open'));
  }
  if (closeBtn && !closeBtn.dataset.wired) {
    closeBtn.dataset.wired = '1';
    closeBtn.addEventListener('click', () => mobileMenu.classList.remove('open'));
  }
  mobileMenu.querySelectorAll('a').forEach(a => {
    if (a.dataset.wired) return;
    a.dataset.wired = '1';
    a.addEventListener('click', () => mobileMenu.classList.remove('open'));
  });
};

window.initWishButtons = function () {
  document.querySelectorAll('.wish-btn').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => btn.classList.toggle('is-wished'));
  });
};

window.initPdThumbs = function () {
  document.querySelectorAll('.pd-thumb').forEach(thumb => {
    if (thumb.dataset.wired) return;
    thumb.dataset.wired = '1';
    thumb.addEventListener('click', () => {
      document.querySelectorAll('.pd-thumb').forEach(t => t.classList.remove('active'));
      thumb.classList.add('active');
      const mainImg = document.querySelector('.pd-main-img img');
      const newSrc = thumb.querySelector('img').getAttribute('src');
      if (mainImg) mainImg.setAttribute('src', newSrc);
    });
  });
};

// ---------------------------------------------------------------
// Category filtering (shop page).
// The nav no longer surfaces categories, but packages still carry them
// in the CMS, so a shared shop.html?cat=<slug> link keeps working.
// ---------------------------------------------------------------
window.initShopFilters = function () {
  const grid = document.querySelector('#shop-grid > .product-grid');
  const cards = grid ? Array.from(grid.querySelectorAll('.product-card[data-cat]')) : [];
  if (!cards.length) return;

  const params = new URLSearchParams(window.location.search);
  const cat = params.get('cat') || 'all';
  if (cat === 'all') return;

  cards.forEach(card => {
    const cats = (card.getAttribute('data-cat') || '').split(/\s+/);
    card.hidden = cats.indexOf(cat) === -1;
  });
};

// ==========================================================================
// Contact page — the booking enquiry form.
//
// There is no mail server behind this site and the business runs on WhatsApp,
// so the honest thing is to say so: the form does not "submit" anywhere. It
// composes the message the customer would otherwise have to type, opens
// WhatsApp with it ready, and leaves them to press Send. Nothing is stored
// here, and nothing can be silently lost on its way to an inbox nobody reads.
// ==========================================================================

(function () {
  const form = document.getElementById('enquiry-form');
  if (!form) return;

  // Populate the package list from the same content the rest of the site uses,
  // so a package added or removed in the CMS appears here too.
  const select = document.getElementById('ef-package');
  if (select) {
    fetch('content/packages.json', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const list = (data && data.packages) || [];
        for (const pkg of list) {
          const option = document.createElement('option');
          option.value = pkg.code ? `${pkg.name} (${pkg.code})` : pkg.name;
          option.textContent = option.value;
          select.appendChild(option);
        }

        // Arriving from a package page with ?package=<slug> preselects it, so
        // the context is not lost on the way here.
        const wanted = new URLSearchParams(location.search).get('package');
        if (!wanted) return;
        const match = list.find(p => p.slug === wanted);
        if (match) select.value = match.code ? `${match.name} (${match.code})` : match.name;
      })
      .catch(() => {
        // The list is a convenience. Without it the form still works, and the
        // customer writes the package name in the message box instead.
      });
  }

  // A Bangladeshi number can be typed as 01712..., +88017..., or 88017...
  // All three are the same person; normalise before showing it back.
  function tidyPhone(value) {
    const digits = value.replace(/\D/g, '');
    if (digits.startsWith('880')) return '+' + digits;
    if (digits.startsWith('0')) return '+88' + digits;
    if (digits.length === 10) return '+880' + digits;
    return value.trim();
  }

  // 2026-04-18 reads as nothing in particular; 18 April 2026 reads as a date.
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];

  function prettyDate(value) {
    if (!value) return '';
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return value;
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }

  function showError(field, message) {
    field.classList.add('has-error');
    let note = field.parentElement.querySelector('.ef-error');
    if (!note) {
      note = document.createElement('span');
      note.className = 'ef-error';
      field.parentElement.appendChild(note);
    }
    note.textContent = message;
  }

  function clearError(field) {
    field.classList.remove('has-error');
    const note = field.parentElement.querySelector('.ef-error');
    if (note) note.remove();
  }

  form.querySelectorAll('input, select, textarea').forEach(field => {
    field.addEventListener('input', () => clearError(field));
  });

  form.addEventListener('submit', event => {
    event.preventDefault();

    const name = document.getElementById('ef-name');
    const phone = document.getElementById('ef-phone');

    // Only the two things we genuinely cannot proceed without are required.
    // Asking for more up front loses people who are only enquiring.
    let ok = true;

    if (!name.value.trim()) {
      showError(name, 'Enter your name');
      ok = false;
    }

    const digits = phone.value.replace(/\D/g, '');
    if (digits.length < 10) {
      showError(phone, 'Enter a valid mobile number');
      ok = false;
    }

    if (!ok) {
      form.querySelector('.has-error').focus();
      return;
    }

    const value = id => (document.getElementById(id).value || '').trim();

    const lines = [
      "Hello! I would like to book with Cox's Dream Moment.",
      '',
      `Name: ${name.value.trim()}`,
      `Mobile: ${tidyPhone(phone.value)}`,
    ];

    // Everything optional is only mentioned if it was filled in, so the
    // message never arrives full of blank labels.
    const optional = [
      ['Packages', value('ef-package')],
      ['Date', prettyDate(value('ef-date'))],
      ['Time', value('ef-time')],
      ['People', value('ef-people')],
      ['Occasion', value('ef-occasion')],
    ];

    for (const [label, text] of optional) {
      if (text) lines.push(`${label}: ${text}`);
    }

    const note = value('ef-note');
    if (note) lines.push('', `Special request: ${note}`);

    lines.push('', 'Could you let me know if this date is free?');

    // The number lives in content/settings.json and content.js puts it on the
    // body, so the admin can change it in one place.
    const number = document.body.dataset.waNumber || '8801347059522';
    const url = `https://wa.me/${number}?text=${encodeURIComponent(lines.join('\n'))}`;

    window.open(url, '_blank', 'noopener');

    const button = form.querySelector('.ef-submit');
    if (button) {
      const original = button.innerHTML;
      button.classList.add('is-sent');
      button.innerHTML = 'WhatsApp is open — press Send';
      setTimeout(() => {
        button.classList.remove('is-sent');
        button.innerHTML = original;
      }, 6000);
    }
  });
})();

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
  const waNumber = '8801889530421';

  function buildMessage() {
    const productName = document.querySelector('.pd-info h1') ? document.querySelector('.pd-info h1').textContent.trim() : 'প্যাকেজ';
    const location = document.querySelector('#bb-location') ? document.querySelector('#bb-location').value : "Cox's Bazar";
    const date = document.querySelector('#bb-date') ? document.querySelector('#bb-date').value : '';
    const guests = document.querySelector('#bb-guests') ? document.querySelector('#bb-guests').value : '2';
    const slot = document.querySelector('#bb-slot') ? document.querySelector('#bb-slot').value : '';
    const occasion = document.querySelector('#bb-occasion') ? document.querySelector('#bb-occasion').value : '';
    const total = document.querySelector('.bb-total-value') ? document.querySelector('.bb-total-value').textContent.trim() : '';

    return `আসসালামু আলাইকুম, আমি বুকিং করতে চাই।%0A%0A🎁 প্যাকেজ: ${encodeURIComponent(productName)}%0A📍 লোকেশন: ${encodeURIComponent(location)}%0A📅 তারিখ: ${encodeURIComponent(date)}%0A👥 গেস্ট: ${encodeURIComponent(guests)}%0A⏰ স্লট: ${encodeURIComponent(slot)}%0A💐 উপলক্ষ: ${encodeURIComponent(occasion)}%0A💰 টোটাল: ${encodeURIComponent(total)}`;
  }

  if (bookBtn) {
    bookBtn.addEventListener('click', function (e) {
      e.preventDefault();
      const text = buildMessage();
      window.open(`https://wa.me/${waNumber}?text=${text}`, '_blank');
    });
  }
  if (waBtn) {
    waBtn.addEventListener('click', function (e) {
      e.preventDefault();
      const text = buildMessage();
      window.open(`https://wa.me/${waNumber}?text=${text}`, '_blank');
    });
  }

  window.initWishButtons();
  window.initShopFilters();
  window.initNavTouch();

  // Category rail arrows (simple scroll)
  const rail = document.querySelector('.cat-rail');
  document.querySelectorAll('.rail-arrow').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = btn.getAttribute('data-dir') === 'next' ? 1 : -1;
      if (rail) rail.scrollBy({ left: dir * 240, behavior: 'smooth' });
    });
  });
});

// ---------------------------------------------------------------------
// Everything below is re-bindable: content.js rebuilds the product-grid,
// nav dropdowns, mobile-menu category links and thumbnails from the live
// CMS content (packages can be added/removed), then calls these again so
// the freshly-created elements get their click handlers. Each one guards
// itself with a dataset.wired flag so re-running never double-binds.
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

// Mobile: tapping a nav parent opens its dropdown instead of navigating
window.initNavTouch = function () {
  document.querySelectorAll('.nav-item').forEach(item => {
    const link = item.querySelector('.nav-link');
    if (!link || link.dataset.wiredTouch) return;
    link.dataset.wiredTouch = '1';
    link.addEventListener('click', e => {
      if (window.matchMedia('(hover: none)').matches && !item.classList.contains('open')) {
        e.preventDefault();
        item.classList.add('open');
      }
    });
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
// Category filtering (shop page)
// Categories come from ?cat=<slug> so nav links work across pages;
// the rail and the dropdown filter in place without a reload.
// ---------------------------------------------------------------
window.initShopFilters = function () {
  const grid = document.querySelector('.product-grid');
  const cards = grid ? Array.from(grid.querySelectorAll('.product-card[data-cat]')) : [];
  if (!cards.length) return;

  const emptyState = document.querySelector('#shop-empty');
  const countEl = document.querySelector('#results-count');
  const catSelect = document.querySelector('#cat-filter');
  const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

  function toBengali(n) {
    return String(n).split('').map(d => bnDigits[+d]).join('');
  }

  function applyFilter(cat, push) {
    cat = cat || 'all';
    let shown = 0;
    cards.forEach(card => {
      const cats = (card.getAttribute('data-cat') || '').split(/\s+/);
      const match = cat === 'all' || cats.indexOf(cat) !== -1;
      card.hidden = !match;
      if (match) shown++;
    });

    if (emptyState) emptyState.hidden = shown !== 0;
    if (countEl) countEl.textContent = toBengali(shown) + 'টি প্যাকেজ পাওয়া গেছে';
    if (catSelect) catSelect.value = cat;

    document.querySelectorAll('.nav-link[data-cat]').forEach(a => {
      a.classList.toggle('active', a.getAttribute('data-cat') === cat);
    });
    document.querySelectorAll('.cat-item[data-cat]').forEach(item => {
      item.classList.toggle('is-active', item.getAttribute('data-cat') === cat);
    });

    if (push && window.history && history.replaceState) {
      history.replaceState(null, '', cat === 'all' ? 'shop.html' : 'shop.html?cat=' + cat);
    }
  }

  function currentCat() {
    const q = new URLSearchParams(window.location.search).get('cat');
    if (q) return q;
    const h = window.location.hash.match(/cat=([\w-]+)/); // fallback when opened as a file
    return h ? h[1] : 'all';
  }

  applyFilter(currentCat(), false);

  document.querySelectorAll('.nav-link[data-cat], .cat-item[data-cat]').forEach(el => {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    el.addEventListener('click', e => {
      e.preventDefault();
      applyFilter(el.getAttribute('data-cat'), true);
      window.scrollTo({ top: grid.offsetTop - 160, behavior: 'smooth' });
    });
  });

  if (catSelect && !catSelect.dataset.wired) {
    catSelect.dataset.wired = '1';
    catSelect.addEventListener('change', () => applyFilter(catSelect.value, true));
  }
};

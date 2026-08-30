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
  const waNumber = () => document.body.dataset.waNumber || '8801898841305';

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

    const codeLine = packageCode ? `%0A🔖 প্যাকেজ কোড: ${encodeURIComponent(packageCode)}` : '';
    const addonLine = addons ? `%0A➕ অতিরিক্ত সার্ভিস: ${encodeURIComponent(addons)}` : '';

    return `আসসালামু আলাইকুম, আমি বুকিং করতে চাই।%0A%0A🎁 প্যাকেজ: ${encodeURIComponent(productName)}${codeLine}%0A📍 লোকেশন: ${encodeURIComponent(location)}%0A📅 তারিখ: ${encodeURIComponent(date)}%0A👥 গেস্ট: ${encodeURIComponent(guests)}%0A⏰ সময়: ${encodeURIComponent(slot)}%0A💐 উপলক্ষ: ${encodeURIComponent(occasion)}${addonLine}%0A💰 সর্বমোট: ${encodeURIComponent(total)}`;
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

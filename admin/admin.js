// ==========================================================================
// Custom admin dashboard - talks to the Express API in server.js.
// No build step, no framework: plain DOM manipulation over a small amount
// of local state that mirrors content/*.json.
// ==========================================================================

const state = {
  settings: null,
  packagesData: null,
  gallery: null,
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function toast(message, type) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 3500);
}

async function api(path, options) {
  const res = await fetch(path, {
    method: (options && options.method) || 'GET',
    headers: options && options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options && options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// ---------------------------------------------------------------- auth
async function checkSession() {
  const { authenticated } = await api('/admin/api/session');
  if (authenticated) {
    await enterDashboard();
  } else {
    $('#login-screen').hidden = false;
    $('#dashboard').hidden = true;
  }
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const password = $('#login-password').value;
  const errorEl = $('#login-error');
  errorEl.hidden = true;
  try {
    await api('/admin/api/login', { method: 'POST', body: { password } });
    $('#login-password').value = '';
    await enterDashboard();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/admin/api/logout', { method: 'POST' });
  location.reload();
});

async function enterDashboard() {
  $('#login-screen').hidden = true;
  $('#dashboard').hidden = false;
  const data = await api('/admin/api/data');
  state.settings = data.settings;
  state.packagesData = data.packages && data.packages.packages ? data.packages : { packages: [] };
  state.gallery = data.gallery && data.gallery.items ? data.gallery : { items: [] };
  renderSettings();
  renderPackages();
  renderGallery();
}

// ---------------------------------------------------------------- tabs
$$('.admin-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.admin-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.admin-panel').forEach(p => (p.hidden = true));
    $('#tab-' + btn.dataset.tab).hidden = false;
  });
});

// ---------------------------------------------------------------- image field helper
function buildImageField(initialPath, onChange) {
  const tpl = $('#tpl-image-field').content.cloneNode(true);
  const wrap = tpl.querySelector('.image-field');
  const img = tpl.querySelector('.image-preview');
  const pathSpan = tpl.querySelector('.image-path');
  const fileInput = tpl.querySelector('.image-input');
  const uploadBtn = tpl.querySelector('.image-upload-btn');

  function setPath(p) {
    img.src = p || '';
    pathSpan.textContent = p || '(no image)';
  }
  setPath(initialPath);

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    uploadBtn.textContent = 'Uploading...';
    uploadBtn.disabled = true;
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch('/admin/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setPath(data.path);
      onChange(data.path);
      toast('Image uploaded', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      uploadBtn.textContent = 'Change image';
      uploadBtn.disabled = false;
      fileInput.value = '';
    }
  });

  return wrap;
}

// ---------------------------------------------------------------- settings tab
const SETTINGS_TEXT_FIELDS = [
  ['topbar_announcement', 'Top bar announcement'],
  ['phone_display', 'Phone number (as displayed)'],
  ['whatsapp_number', 'WhatsApp number (digits only, including country code)'],
  ['email', 'Email'],
  ['facebook_url', 'Facebook page link'],
  ['facebook_label', 'Facebook label text'],
  ['service_area', 'Service area'],
  ['address', 'Address'],
  ['hours_note', 'Small note under the hours'],
];

function renderSettings() {
  const s = state.settings;
  const root = $('#settings-form');
  root.innerHTML = '';

  const section1 = document.createElement('div');
  section1.className = 'section-title';
  section1.textContent = 'Contact and announcements';
  root.appendChild(section1);

  SETTINGS_TEXT_FIELDS.forEach(([key, label]) => {
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `<label>${label}</label><input data-key="${key}" value="${escapeAttr(s[key] || '')}">`;
    root.appendChild(field);
  });

  const descField = document.createElement('div');
  descField.className = 'field full';
  descField.innerHTML = `<label>Footer description</label><textarea data-key="footer_desc">${escapeHTML(s.footer_desc || '')}</textarea>`;
  root.appendChild(descField);

  const hoursTitle = document.createElement('div');
  hoursTitle.className = 'section-title';
  hoursTitle.textContent = 'Opening hours';
  root.appendChild(hoursTitle);

  const hoursWrap = document.createElement('div');
  hoursWrap.className = 'full';
  hoursWrap.id = 'hours-repeater';
  root.appendChild(hoursWrap);
  renderHours(hoursWrap);

  const addonTitle = document.createElement('div');
  addonTitle.className = 'section-title';
  addonTitle.textContent = 'Booking extras';
  root.appendChild(addonTitle);

  // Offered on every package page. A blank fee means the price is agreed with
  // the customer rather than shown, so leave it empty for those.
  if (!Array.isArray(s.addons)) {
    s.addons = s.drone_addon ? [s.drone_addon] : [];
    delete s.drone_addon;
  }
  const addonsWrap = document.createElement('div');
  addonsWrap.className = 'full';
  addonsWrap.id = 'addons-repeater';
  root.appendChild(addonsWrap);
  renderAddons(addonsWrap);

  const heroTitle = document.createElement('div');
  heroTitle.className = 'section-title';
  heroTitle.textContent = 'Homepage hero section';
  root.appendChild(heroTitle);

  const hero = s.hero || (s.hero = {});
  [['eyebrow', 'Small line above the headline'], ['heading', 'Headline (write <br> to split it over two lines)'], ['cta_text', 'Button text']].forEach(([key, label]) => {
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `<label>${label}</label><input data-hero-key="${key}" value="${escapeAttr(hero[key] || '')}">`;
    root.appendChild(field);
  });
  const subField = document.createElement('div');
  subField.className = 'field full';
  subField.innerHTML = `<label>Subheadline</label><textarea data-hero-key="subheading">${escapeHTML(hero.subheading || '')}</textarea>`;
  root.appendChild(subField);

  const heroImgField = document.createElement('div');
  heroImgField.className = 'field full';
  heroImgField.innerHTML = '<label>Hero image</label>';
  heroImgField.appendChild(buildImageField(hero.image, path => (hero.image = path)));
  root.appendChild(heroImgField);
}

function renderAddons(wrap) {
  const list = state.settings.addons;
  wrap.innerHTML = '';

  list.forEach((addon, i) => {
    const row = document.createElement('div');
    row.className = 'repeater-item';
    row.innerHTML = `
      <input placeholder="Extra service name" value="${escapeAttr(addon.label || '')}"
             data-addon-idx="${i}" data-addon-field="label">
      <input placeholder="Fee \u2014 leave blank to quote on request"
             value="${escapeAttr(addon.fee || '')}"
             data-addon-idx="${i}" data-addon-field="fee">
      <button type="button" class="remove-btn" title="\u09b8\u09b0\u09be\u09a8">&times;</button>`;
    row.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', e => {
        list[e.target.dataset.addonIdx][e.target.dataset.addonField] = e.target.value;
      });
    });
    row.querySelector('.remove-btn').addEventListener('click', () => {
      list.splice(i, 1);
      renderAddons(wrap);
    });
    wrap.appendChild(row);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'add-row-btn';
  addBtn.textContent = '+ Add an extra service';
  addBtn.addEventListener('click', () => {
    list.push({ label: '', fee: '' });
    renderAddons(wrap);
  });
  wrap.appendChild(addBtn);
}

function renderHours(container) {
  container.innerHTML = '';
  (state.settings.hours || []).forEach((row, i) => {
    const item = document.createElement('div');
    item.className = 'repeater-item';
    item.innerHTML = `
      <input placeholder="Days" value="${escapeAttr(row.days || '')}" data-hours-idx="${i}" data-hours-field="days">
      <input placeholder="Time" value="${escapeAttr(row.time || '')}" data-hours-idx="${i}" data-hours-field="time">
      <button type="button" class="remove-btn" data-remove-hours="${i}">✕</button>
    `;
    container.appendChild(item);
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'add-row-btn';
  addBtn.textContent = '+ Add an hours row';
  addBtn.addEventListener('click', () => {
    state.settings.hours.push({ days: '', time: '' });
    renderHours(container);
  });
  container.appendChild(addBtn);

  $$('[data-remove-hours]', container).forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.hours.splice(Number(btn.dataset.removeHours), 1);
      renderHours(container);
    });
  });
  $$('[data-hours-idx]', container).forEach(input => {
    input.addEventListener('input', () => {
      state.settings.hours[Number(input.dataset.hoursIdx)][input.dataset.hoursField] = input.value;
    });
  });
}

function collectSettings() {
  const s = state.settings;
  $$('#settings-form [data-key]').forEach(el => (s[el.dataset.key] = el.value));
  $$('#settings-form [data-hero-key]').forEach(el => (s.hero[el.dataset.heroKey] = el.value));
  return s;
}

$('#save-settings-btn').addEventListener('click', async () => {
  try {
    const payload = collectSettings();
    await api('/admin/api/settings', { method: 'PUT', body: payload });
    toast('Settings saved ✓', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------------------------------------------------------------- packages tab
function blankPackage() {
  return {
    slug: '',
    // Left blank on purpose: the server assigns the next free "CDM <n>"
    // on save, so nobody has to track the numbering by hand.
    code: '',
    name: 'New package',
    badge: 'New',
    trust_extra: '',
    price: '৳0',
    old_price: '৳0',
    discount: '0% OFF',
    categories: ['proposal'],
    main_image: '',
    thumbnails: [],
    inclusions: [],
    description: '',
    booking_policy: '',
    faq: '',
  };
}

function renderPackages() {
  const root = $('#packages-list');
  root.innerHTML = '';
  state.packagesData.packages.forEach((pkg, idx) => root.appendChild(renderPackageCard(pkg, idx)));
}

function renderPackageCard(pkg, idx) {
  const card = document.createElement('div');
  card.className = 'package-card';

  const head = document.createElement('div');
  head.className = 'package-card-head';
  head.innerHTML = `
    <div class="package-card-head-title">
      <span>${escapeHTML(pkg.name || '(no name)')}</span>
      <span class="slug-badge">${escapeHTML(pkg.slug || 'no slug')}</span>
      <span class="code-badge">${escapeHTML(pkg.code || 'code assigned on save')}</span>
    </div>
    <span class="package-card-toggle">Click to open ▾</span>
  `;
  head.addEventListener('click', () => card.classList.toggle('open'));
  card.appendChild(head);

  const body = document.createElement('div');
  body.className = 'package-card-body';
  card.appendChild(body);

  const grid = document.createElement('div');
  grid.className = 'form-grid';
  body.appendChild(grid);

  function field(labelText, key, full) {
    const f = document.createElement('div');
    f.className = 'field' + (full ? ' full' : '');
    f.innerHTML = `<label>${labelText}</label><input value="${escapeAttr(pkg[key] || '')}">`;
    const input = f.querySelector('input');
    input.addEventListener('input', () => {
      pkg[key] = input.value;
      if (key === 'name' || key === 'slug' || key === 'code') {
        head.querySelector('.package-card-head-title span').textContent = pkg.name || '(no name)';
        head.querySelector('.slug-badge').textContent = pkg.slug || 'no slug';
        head.querySelector('.code-badge').textContent = pkg.code || 'code assigned on save';
      }
    });
    grid.appendChild(f);
  }

  field('Slug (unique — lowercase letters, numbers and hyphens)', 'slug');
  field('Package code (e.g. CDM 101 — leave blank to assign automatically)', 'code');
  field('Package name', 'name');
  field('Badge', 'badge');
  field('Trust line text', 'trust_extra');
  field('Price', 'price');
  field('Old price (struck through)', 'old_price');
  field('Discount label', 'discount');

  // categories
  const catField = document.createElement('div');
  catField.className = 'field full';
  catField.innerHTML = '<label>Categories</label>';
  const chipRow = document.createElement('div');
  chipRow.className = 'chip-row';
  [['sunset', 'Sunset (সূর্যাস্তের সময়)'], ['night', 'Night (রাতের আয়োজন)']].forEach(([val, label]) => {
    const chip = document.createElement('label');
    chip.className = 'chip-check';
    const checked = (pkg.categories || []).includes(val);
    chip.innerHTML = `<input type="checkbox" value="${val}" ${checked ? 'checked' : ''}> ${label}`;
    chip.querySelector('input').addEventListener('change', e => {
      pkg.categories = pkg.categories || [];
      if (e.target.checked) {
        if (!pkg.categories.includes(val)) pkg.categories.push(val);
      } else {
        pkg.categories = pkg.categories.filter(c => c !== val);
      }
    });
    chipRow.appendChild(chip);
  });
  catField.appendChild(chipRow);
  grid.appendChild(catField);

  // main image
  const mainImgField = document.createElement('div');
  mainImgField.className = 'field full';
  mainImgField.innerHTML = '<label>Main image</label>';
  mainImgField.appendChild(buildImageField(pkg.main_image, path => (pkg.main_image = path)));
  grid.appendChild(mainImgField);

  // thumbnails
  const thumbField = document.createElement('div');
  thumbField.className = 'field full';
  thumbField.innerHTML = '<label>Thumbnail images</label>';
  const thumbList = document.createElement('div');
  thumbField.appendChild(thumbList);
  grid.appendChild(thumbField);
  renderThumbnails(thumbList, pkg);

  // inclusions
  const incField = document.createElement('div');
  incField.className = 'field full';
  incField.innerHTML = '<label>What&rsquo;s included</label>';
  const incList = document.createElement('div');
  incField.appendChild(incList);
  grid.appendChild(incField);
  renderInclusions(incList, pkg);

  function textareaField(labelText, key) {
    const f = document.createElement('div');
    f.className = 'field full';
    f.innerHTML = `<label>${labelText}</label><textarea>${escapeHTML(pkg[key] || '')}</textarea>`;
    f.querySelector('textarea').addEventListener('input', e => (pkg[key] = e.target.value));
    grid.appendChild(f);
  }
  textareaField('Description (Description tab)', 'description');
  textareaField('Booking policy', 'booking_policy');
  textareaField('FAQ', 'faq');

  const deleteRow = document.createElement('div');
  deleteRow.className = 'field full';
  deleteRow.innerHTML = '<button type="button" class="btn-danger-sm">Delete this package</button>';
  deleteRow.querySelector('button').addEventListener('click', () => {
    if (!confirm(`Delete the "${pkg.name}" package? It will disappear from the site immediately.`)) return;
    state.packagesData.packages.splice(idx, 1);
    renderPackages();
  });
  grid.appendChild(deleteRow);

  return card;
}

function renderThumbnails(container, pkg) {
  container.innerHTML = '';
  pkg.thumbnails = pkg.thumbnails || [];
  pkg.thumbnails.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'repeater-item';
    const imgWrap = document.createElement('div');
    imgWrap.style.flex = '0 0 auto';
    imgWrap.appendChild(buildImageField(t.image, path => (t.image = path)));
    row.appendChild(imgWrap);
    const altInput = document.createElement('input');
    altInput.placeholder = 'Alt text';
    altInput.value = t.alt || '';
    altInput.addEventListener('input', () => (t.alt = altInput.value));
    row.appendChild(altInput);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      pkg.thumbnails.splice(i, 1);
      renderThumbnails(container, pkg);
    });
    row.appendChild(removeBtn);
    container.appendChild(row);
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'add-row-btn';
  addBtn.textContent = '+ Add a thumbnail';
  addBtn.addEventListener('click', () => {
    pkg.thumbnails.push({ image: '', alt: '' });
    renderThumbnails(container, pkg);
  });
  container.appendChild(addBtn);
}

function renderInclusions(container, pkg) {
  container.innerHTML = '';
  pkg.inclusions = pkg.inclusions || [];
  pkg.inclusions.forEach((text, i) => {
    const row = document.createElement('div');
    row.className = 'repeater-item';
    const input = document.createElement('input');
    input.value = text;
    input.addEventListener('input', () => (pkg.inclusions[i] = input.value));
    row.appendChild(input);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      pkg.inclusions.splice(i, 1);
      renderInclusions(container, pkg);
    });
    row.appendChild(removeBtn);
    container.appendChild(row);
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'add-row-btn';
  addBtn.textContent = '+ Add an item';
  addBtn.addEventListener('click', () => {
    pkg.inclusions.push('');
    renderInclusions(container, pkg);
  });
  container.appendChild(addBtn);
}

$('#add-package-btn').addEventListener('click', () => {
  state.packagesData.packages.push(blankPackage());
  renderPackages();
  const cards = $$('.package-card');
  const last = cards[cards.length - 1];
  if (last) {
    last.classList.add('open');
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

$('#save-packages-btn').addEventListener('click', async () => {
  const slugs = state.packagesData.packages.map(p => p.slug);
  const emptySlug = slugs.some(s => !s || !/^[a-z0-9-]+$/.test(s));
  if (emptySlug) return toast('Every package needs a slug — lowercase letters, numbers and hyphens only', 'error');
  if (new Set(slugs).size !== slugs.length) return toast('Two packages cannot share the same slug', 'error');
  try {
    await api('/admin/api/packages', { method: 'PUT', body: state.packagesData });
    toast('Packages saved ✓', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------------------------------------------------------------- gallery tab
function renderGallery() {
  const root = $('#gallery-list');
  root.innerHTML = '';
  state.gallery.items = state.gallery.items || [];

  state.gallery.items.forEach((item, i) => {
    const card = document.createElement('div');
    card.className = 'package-card open';
    const body = document.createElement('div');
    body.className = 'package-card-body';
    body.style.display = 'block';

    const grid = document.createElement('div');
    grid.className = 'form-grid';
    body.appendChild(grid);

    const imgField = document.createElement('div');
    imgField.className = 'field full';
    imgField.innerHTML = '<label>Image</label>';
    imgField.appendChild(buildImageField(item.image, path => (item.image = path)));
    grid.appendChild(imgField);

    [['alt', 'Alt text'], ['caption', 'Caption']].forEach(([key, label]) => {
      const f = document.createElement('div');
      f.className = 'field';
      f.innerHTML = `<label>${label}</label><input value="${escapeAttr(item[key] || '')}">`;
      f.querySelector('input').addEventListener('input', e => (item[key] = e.target.value));
      grid.appendChild(f);
    });

    const sizeField = document.createElement('div');
    sizeField.className = 'field';
    sizeField.innerHTML = `<label>Size</label>
      <select>
        <option value="" ${!item.size ? 'selected' : ''}>Normal</option>
        <option value="tall" ${item.size === 'tall' ? 'selected' : ''}>Tall</option>
        <option value="wide" ${item.size === 'wide' ? 'selected' : ''}>Wide</option>
      </select>`;
    sizeField.querySelector('select').addEventListener('change', e => (item.size = e.target.value));
    grid.appendChild(sizeField);

    const removeField = document.createElement('div');
    removeField.className = 'field full';
    removeField.innerHTML = '<button type="button" class="btn-danger-sm">Delete this image</button>';
    removeField.querySelector('button').addEventListener('click', () => {
      state.gallery.items.splice(i, 1);
      renderGallery();
    });
    grid.appendChild(removeField);

    card.appendChild(body);
    root.appendChild(card);
  });

  const noteField = document.createElement('div');
  noteField.className = 'field full';
  noteField.style.marginTop = '12px';
  noteField.innerHTML = `<label>Note text below</label><input id="gallery-note-input" value="${escapeAttr(state.gallery.note || '')}">`;
  noteField.querySelector('input').addEventListener('input', e => (state.gallery.note = e.target.value));
  root.appendChild(noteField);
}

$('#add-gallery-btn').addEventListener('click', () => {
  state.gallery.items.push({ image: '', alt: '', caption: '', size: '' });
  renderGallery();
});

$('#save-gallery-btn').addEventListener('click', async () => {
  try {
    await api('/admin/api/gallery', { method: 'PUT', body: state.gallery });
    toast('Gallery saved ✓', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------------------------------------------------------------- utils
function escapeHTML(str) {
  return String(str).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}
function escapeAttr(str) {
  return escapeHTML(str).replace(/"/g, '&quot;');
}

checkSession();

/* ==========================================================================
   Website content — packages, site settings and the gallery.

   This is the part of the Control Room that changes what visitors see. It is
   deliberately one view among four rather than the whole admin panel: running
   the business is bookings and money, and editing the site is something the
   owner does occasionally.

   Everything is edited in memory and written with an explicit Save, so a
   half-typed package name never reaches the live site.
   ========================================================================== */
'use strict';

window.ContentEditor = (function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const esc = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const state = { settings: null, packages: null, gallery: null, tab: 'packages', loaded: false };

  const toast = (m, k) => window.Admin.toast(m, k);
  const api = (p, o) => window.Admin.api(p, o);

  const SETTINGS_FIELDS = [
    ['topbar_announcement', 'Top bar announcement'],
    ['phone_display', 'Phone number (as displayed)'],
    ['whatsapp_number', 'WhatsApp number — digits only, with country code'],
    ['helpline_display', 'Helpline number (as displayed)'],
    ['helpline_number', 'Helpline number — digits only, with country code'],
    ['helpline_note', 'Small line under the helpline'],
    ['email', 'Email'],
    ['facebook_url', 'Facebook page link'],
    ['facebook_label', 'Facebook label'],
    ['service_area', 'Service area'],
    ['address', 'Address'],
    ['hours_note', 'Small note under the opening hours'],
    ['footer_desc', 'Footer description'],
  ];

  // ------------------------------------------------------------- loading

  async function load() {
    const data = await api('/admin/api/data');
    state.settings = data.settings || {};
    state.packages = data.packages || { packages: [] };
    state.gallery = data.gallery || { items: [] };
    state.loaded = true;
  }

  /** The booking editor's package dropdown reads this, so a package renamed
   *  here shows up there without a page reload. */
  function packageList() {
    const list = (state.packages && state.packages.packages) || [];
    return list.map((p) => ({
      slug: p.slug,
      name: p.name,
      kind: p.kind || '',
      price: finalPrice(p),
    }));
  }

  // ------------------------------------------------------------- mount

  let host = null;

  async function mount(el) {
    host = el;
    if (!state.loaded) {
      el.innerHTML = '<div class="empty">Loading…</div>';
      try { await load(); } catch (e) { el.innerHTML = `<div class="empty"><strong>Could not load</strong>${esc(e.message)}</div>`; return; }
    }
    draw();
  }

  function draw() {
    host.innerHTML = `
      <div class="cnt-tabs">
        ${[['packages', 'Packages'], ['settings', 'Site details'], ['payment', 'How to pay'], ['gallery', 'Gallery']]
          .map(([id, label]) => `<button class="chip ${state.tab === id ? 'is-on' : ''}" data-tab="${id}">${label}</button>`).join('')}
      </div>
      <div id="cnt-panel"></div>`;

    $$('[data-tab]', host).forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; draw(); }));

    const panel = $('#cnt-panel', host);
    if (state.tab === 'packages') drawPackages(panel);
    else if (state.tab === 'settings') drawSettings(panel);
    else if (state.tab === 'payment') drawPayment(panel);
    else drawGallery(panel);
  }

  // ------------------------------------------------------------- image field

  /** An image picker: shows the current image, uploads a replacement, and
   *  lets a path be typed for an image already on the server. */
  function imageField(currentPath, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'imgfield';
    wrap.innerHTML = `
      <img alt="" src="${currentPath ? '../' + esc(currentPath) : ''}">
      <div class="g">
        <input type="text" value="${esc(currentPath || '')}" placeholder="images/example.jpg">
        <div style="margin-top:6px;display:flex;gap:6px;align-items:center">
          <label class="btn btn-sm" style="margin:0">
            Upload<input type="file" accept="image/*" hidden>
          </label>
          <span class="hint" style="margin:0"></span>
        </div>
      </div>`;

    const img = $('img', wrap);
    const input = $('input[type="text"]', wrap);
    const file = $('input[type="file"]', wrap);
    const note = $('.hint', wrap);

    const set = (path) => {
      input.value = path;
      img.src = path ? '../' + path : '';
      onChange(path);
    };

    input.addEventListener('input', () => set(input.value.trim()));

    file.addEventListener('change', async () => {
      const chosen = file.files && file.files[0];
      if (!chosen) return;
      note.textContent = 'Uploading…';
      try {
        const body = new FormData();
        body.append('image', chosen);
        // Not api(): this is multipart, so the JSON content-type must not be set.
        const res = await fetch('/admin/api/upload', { method: 'POST', body });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        set(data.path);
        note.textContent = 'Uploaded';
      } catch (e) {
        note.textContent = '';
        toast(e.message, 'bad');
      } finally {
        file.value = '';
      }
    });

    return wrap;
  }

  /** A list of short text lines (inclusions, stats, hours…) with add, remove
   *  and reorder. Mutates [arr] in place. */
  function lineList(arr, placeholder, onRender) {
    const box = document.createElement('div');

    function paint() {
      box.innerHTML = '';
      arr.forEach((value, i) => {
        const row = document.createElement('div');
        row.className = 'listrow';
        row.innerHTML = `
          <input value="${esc(value)}" placeholder="${esc(placeholder)}">
          <button type="button" class="btn btn-sm" data-up ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn btn-sm" data-down ${i === arr.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="btn btn-sm btn-danger" data-rm>✕</button>`;
        $('input', row).addEventListener('input', (e) => { arr[i] = e.target.value; });
        $('[data-rm]', row).addEventListener('click', () => { arr.splice(i, 1); paint(); });
        $('[data-up]', row).addEventListener('click', () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; paint(); });
        $('[data-down]', row).addEventListener('click', () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; paint(); });
        box.appendChild(row);
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn btn-sm';
      add.textContent = '+ Add';
      add.addEventListener('click', () => { arr.push(''); paint(); });
      box.appendChild(add);
      if (onRender) onRender();
    }

    paint();
    return box;
  }

  // ------------------------------------------------------------- packages

  // The same arithmetic the website does, so the admin sees exactly the
  // figure the customer will see rather than a second opinion about it.
  const tk = (n) => '৳' + Math.round(n).toLocaleString('en-IN');

  function finalPrice(pkg) {
    const full = Number(pkg.price_amount) || 0;
    if (!full) return 0;
    const pct = Math.min(Math.max(Number(pkg.discount_percent) || 0, 0), 95);
    return Math.round(full * (1 - pct / 100));
  }

  function blankPackage() {
    return {
      slug: '', code: '', name: 'New package', badge: '', trust_extra: '',
      kind: '', price_amount: 0, discount_percent: 0,
      price: '', old_price: '', discount: '', featured: false, categories: [],
      main_image: '', thumbnails: [], inclusions: [], description: '',
      booking_policy: '', faq: '',
    };
  }

  function drawPackages(panel) {
    const list = state.packages.packages;
    const setups = list.filter((p) => p.kind !== 'media');
    const media = list.filter((p) => p.kind === 'media');

    panel.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" id="pk-save">Save packages</button>
        <button class="btn" id="pk-add">+ Add a package</button>
        <span class="hint" style="margin:0">${setups.length} decoration \u00b7 ${media.length} photo &amp; video</span>
      </div>

      <div class="pk-group">
        <h2 class="section-title" style="margin:0 0 4px">Decoration packages</h2>
        <p class="hint" style="margin:0 0 12px">
          The order here is the order on the site. Put what you want people to see first at the top,
          and tick <strong>Featured</strong> to lift it into the row above the grid.</p>
        <div id="pk-list"></div>
      </div>

      <div class="pk-group" style="margin-top:22px">
        <h2 class="section-title" style="margin:0 0 4px">Photo &amp; video</h2>
        <p class="hint" style="margin:0 0 12px">
          Shown in their own dark row and offered as an extra on every decoration package \u2014
          never mixed in with the setups.</p>
        <div id="pk-media"></div>
      </div>`;

    const wrap = $('#pk-list', panel);
    const mediaWrap = $('#pk-media', panel);

    // Index against the real array, so moving a card moves the right one.
    list.forEach((pkg, i) => {
      const card = packageCard(pkg, i);
      (pkg.kind === 'media' ? mediaWrap : wrap).appendChild(card);
    });

    if (!setups.length) wrap.innerHTML = '<p class="hint" style="margin:0">No decoration packages yet.</p>';
    if (!media.length) mediaWrap.innerHTML = '<p class="hint" style="margin:0">No photo or video packages yet.</p>';

    $('#pk-add', panel).addEventListener('click', () => {
      list.unshift(blankPackage());
      drawPackages(panel);
    });

    $('#pk-save', panel).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api('/admin/api/packages', { method: 'PUT', body: JSON.stringify(state.packages) });
        await load();
        drawPackages(panel);
        toast('Packages saved', 'good');
      } catch (err) {
        toast(err.message, 'bad');
      } finally {
        btn.disabled = false;
      }
    });
  }

  function packageCard(pkg, index) {
    const card = document.createElement('div');
    card.className = 'pkg';
    card.innerHTML = `
      <div class="pkg-head">
        <img alt="" src="${pkg.main_image ? '../' + esc(pkg.main_image) : ''}">
        <div class="t">
          <strong>${esc(pkg.name)}</strong>
          <span>${esc(pkg.code || 'code assigned on save')}${pkg.featured ? ' · featured' : ''}${pkg.kind === 'media' ? ' · photo/video' : ''}${finalPrice(pkg) ? ' · ' + esc(tk(finalPrice(pkg))) : ''}</span>
        </div>
        <button type="button" class="btn btn-sm" data-up title="Move up">\u2191</button>
        <button type="button" class="btn btn-sm" data-down title="Move down">\u2193</button>
        <button type="button" class="btn btn-sm" data-toggle>Edit</button>
      </div>
      <div class="pkg-body" hidden></div>`;

    const bodyEl = $('.pkg-body', card);
    const head = $('.pkg-head', card);
    let built = false;

    const toggle = () => {
      if (!built) { buildBody(bodyEl, pkg, index, card); built = true; }
      bodyEl.hidden = !bodyEl.hidden;
      $('[data-toggle]', card).textContent = bodyEl.hidden ? 'Edit' : 'Done';
    };
    head.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') toggle(); });
    $('[data-toggle]', card).addEventListener('click', toggle);

    // Moving swaps with the nearest package of the same kind, so a
    // decoration setup can never be pushed into the photography row.
    const move = (direction) => {
      const all = state.packages.packages;
      const kind = pkg.kind === 'media' ? 'media' : '';
      for (let i = index + direction; i >= 0 && i < all.length; i += direction) {
        const other = all[i];
        if ((other.kind === 'media' ? 'media' : '') !== kind) continue;
        all[index] = other;
        all[i] = pkg;
        drawPackages($('#cnt-panel', host));
        return;
      }
    };
    $('[data-up]', card).addEventListener('click', () => move(-1));
    $('[data-down]', card).addEventListener('click', () => move(1));

    return card;
  }

  function buildBody(bodyEl, pkg, index, card) {
    const text = (label, key, hint) => `
      <div class="field">
        <label>${label}</label>
        <input data-k="${key}" value="${esc(pkg[key] || '')}">
        ${hint ? `<p class="hint" style="margin:6px 0 0">${hint}</p>` : ''}
      </div>`;

    bodyEl.innerHTML = `
      <div class="field-row">
        ${text('Package name', 'name')}
        ${text('Web address (slug)', 'slug', 'Leave blank and one is made from the name on save.')}
      </div>
      <div class="field-row">
        ${text('Package code', 'code', 'Leave blank and one is assigned on save.')}
        ${text('Badge', 'badge')}
      </div>
      ${text('Trust line', 'trust_extra')}
      <div class="field">
        <label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13.5px;color:var(--ink)">
          <input type="checkbox" data-featured ${pkg.featured ? 'checked' : ''} style="width:auto">
          Featured — shown at the top of the shop
        </label>
        <label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13.5px;color:var(--ink);margin-top:8px">
          <input type="checkbox" data-media ${pkg.kind === 'media' ? 'checked' : ''} style="width:auto">
          Photo &amp; video service — shown in its own dark row, not with the beach setups
        </label>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Full price (৳)</label>
          <input data-money="price_amount" type="number" min="0" step="100" value="${esc(pkg.price_amount || '')}">
          <p class="hint" style="margin:6px 0 0">Leave at 0 and the site shows “For contact”.</p>
        </div>
        <div class="field">
          <label>Discount (%)</label>
          <input data-money="discount_percent" type="number" min="0" max="95" step="1" value="${esc(pkg.discount_percent || '')}">
          <p class="hint" style="margin:6px 0 0">0 means no offer.</p>
        </div>
      </div>
      <div class="price-preview" data-preview></div>

      <div class="field"><label>Main image</label><div data-main></div></div>
      <div class="field"><label>Extra photos</label><div data-thumbs></div>
        <button type="button" class="btn btn-sm" data-add-thumb style="margin-top:8px">+ Add a photo</button></div>
      <div class="field"><label>What's included</label><div data-inclusions></div></div>

      <div class="field"><label>Description</label><textarea data-k="description" rows="4">${esc(pkg.description || '')}</textarea></div>
      <div class="field"><label>Booking policy</label><textarea data-k="booking_policy" rows="3">${esc(pkg.booking_policy || '')}</textarea></div>
      <div class="field"><label>FAQ</label><textarea data-k="faq" rows="4">${esc(pkg.faq || '')}</textarea></div>

      <button type="button" class="btn btn-sm btn-danger" data-del>Delete this package</button>`;

    $$('[data-k]', bodyEl).forEach((input) => {
      input.addEventListener('input', () => {
        pkg[input.dataset.k] = input.value;
        if (input.dataset.k === 'name') $('.pkg-head strong', card).textContent = input.value;
      });
    });

    $('[data-featured]', bodyEl).addEventListener('change', (e) => { pkg.featured = e.target.checked; });

    // The customer-facing result, updated as you type. A price and a
    // percentage in two boxes are easy to get wrong; seeing the answer is
    // the only reliable check.
    const preview = $('[data-preview]', bodyEl);
    function drawPreview() {
      const full = Number(pkg.price_amount) || 0;
      const pct = Math.min(Math.max(Number(pkg.discount_percent) || 0, 0), 95);
      const now = finalPrice(pkg);

      if (!full) {
        preview.innerHTML = '<span class="pp-none">No price — the site will show “For contact”.</span>';
      } else if (pct > 0) {
        preview.innerHTML =
          `<span class="pp-label">Customer sees</span>` +
          `<span class="pp-old">${tk(full)}</span>` +
          `<span class="pp-now">${tk(now)}</span>` +
          `<span class="pp-off">${pct}% OFF</span>` +
          `<span class="pp-save">they save ${tk(full - now)}</span>`;
      } else {
        preview.innerHTML =
          `<span class="pp-label">Customer sees</span><span class="pp-now">${tk(full)}</span>`;
      }
      $('.pkg-head span', card).textContent =
        (pkg.code || 'code assigned on save') +
        (pkg.featured ? ' · featured' : '') +
        (pkg.kind === 'media' ? ' · photo/video' : '') +
        (now ? ' · ' + tk(now) : '');
    }

    $$('[data-money]', bodyEl).forEach((input) => {
      input.addEventListener('input', () => {
        pkg[input.dataset.money] = Number(input.value) || 0;
        // Clear the old hand-typed strings, or the site would still prefer
        // them on a package that has not been touched since.
        pkg.price = '';
        pkg.old_price = '';
        pkg.discount = '';
        drawPreview();
      });
    });
    drawPreview();

    $('[data-media]', bodyEl).addEventListener('change', (e) => {
      pkg.kind = e.target.checked ? 'media' : '';
      drawPreview();
    });

    $('[data-main]', bodyEl).appendChild(imageField(pkg.main_image, (path) => {
      pkg.main_image = path;
      $('.pkg-head img', card).src = path ? '../' + path : '';
    }));

    const thumbsBox = $('[data-thumbs]', bodyEl);
    function paintThumbs() {
      thumbsBox.innerHTML = '';
      pkg.thumbnails = pkg.thumbnails || [];
      pkg.thumbnails.forEach((path, i) => {
        const row = imageField(path, (p) => { pkg.thumbnails[i] = p; });
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn btn-sm btn-danger';
        rm.textContent = '✕';
        rm.addEventListener('click', () => { pkg.thumbnails.splice(i, 1); paintThumbs(); });
        row.appendChild(rm);
        thumbsBox.appendChild(row);
      });
    }
    paintThumbs();
    $('[data-add-thumb]', bodyEl).addEventListener('click', () => {
      pkg.thumbnails = pkg.thumbnails || [];
      pkg.thumbnails.push('');
      paintThumbs();
    });

    pkg.inclusions = pkg.inclusions || [];
    $('[data-inclusions]', bodyEl).appendChild(lineList(pkg.inclusions, 'e.g. Mineral water'));

    $('[data-del]', bodyEl).addEventListener('click', async () => {
      const ok = await window.Admin.confirmDialog(
        `Delete the "${pkg.name}" package? It comes off the website straight away.`);
      if (!ok) return;

      // Found by slug rather than by position: the list may have been
      // reordered since this card was drawn.
      const list = state.packages.packages;
      const at = list.findIndex((x) => x === pkg || (pkg.slug && x.slug === pkg.slug));
      if (at < 0) return;
      const removed = list.splice(at, 1)[0];

      // Saved now. A delete that only takes effect after a second button
      // is a delete that comes back.
      try {
        await api('/admin/api/packages', { method: 'PUT', body: JSON.stringify(state.packages) });
        toast(`${removed.name} deleted`, 'good');
      } catch (e) {
        list.splice(at, 0, removed);
        toast(e.message, 'bad');
      }
      drawPackages($('#cnt-panel', host));
    });
  }

  // ------------------------------------------------------------- settings

  function drawSettings(panel) {
    const s = state.settings;
    s.hero = s.hero || {};
    s.about = s.about || {};
    s.stats = s.stats || [];
    s.addons = s.addons || [];
    s.hours = s.hours || [];

    panel.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" id="st-save">Save site details</button>
      </div>

      <div class="card card-pad" style="margin-bottom:14px">
        <h2 class="section-title">Contact and header</h2>
        <div class="field-row">
          ${SETTINGS_FIELDS.map(([key, label]) => `
            <div class="field"><label>${esc(label)}</label>
              <input data-s="${key}" value="${esc(s[key] || '')}"></div>`).join('')}
        </div>
      </div>

      <div class="card card-pad" style="margin-bottom:14px">
        <h2 class="section-title">Home page headline</h2>
        <div class="field"><label>Eyebrow</label><input data-hero="eyebrow" value="${esc(s.hero.eyebrow || '')}"></div>
        <div class="field"><label>Heading</label><input data-hero="heading" value="${esc(s.hero.heading || '')}">
          <p class="hint" style="margin:6px 0 0">&lt;br&gt; breaks the line.</p></div>
        <div class="field"><label>Sub heading</label><textarea data-hero="subheading" rows="2">${esc(s.hero.subheading || '')}</textarea></div>
        <div class="field"><label>Button text</label><input data-hero="cta_text" value="${esc(s.hero.cta_text || '')}"></div>
      </div>

      <div class="card card-pad" style="margin-bottom:14px">
        <h2 class="section-title">About section</h2>
        <div class="field"><label>Eyebrow</label><input data-about="eyebrow" value="${esc(s.about.eyebrow || '')}"></div>
        <div class="field"><label>Heading</label><input data-about="heading" value="${esc(s.about.heading || '')}"></div>
        <div class="field"><label>Body</label><textarea data-about="body" rows="6">${esc(s.about.body || '')}</textarea>
          <p class="hint" style="margin:6px 0 0">A blank line starts a new paragraph.</p></div>
        <div class="field"><label>Small note underneath</label><input data-about="note" value="${esc(s.about.note || '')}"></div>
      </div>

      <div class="card card-pad" style="margin-bottom:14px">
        <h2 class="section-title">Numbers on the home page</h2>
        <div id="st-stats"></div>
      </div>

      <div class="card card-pad" style="margin-bottom:14px">
        <h2 class="section-title">Why people can trust us</h2>
        <p class="hint" style="margin:-4px 0 12px">
          Shown under the booking button on every package page. Write things a customer can
          check \u2014 “Safe booking” persuades nobody, “we arrive two hours early” does.</p>
        <div id="st-trust"></div>
      </div>

      <div class="card card-pad" style="margin-bottom:14px">
        <h2 class="section-title">Warning about fake pages</h2>
        <p class="hint" style="margin:-4px 0 12px">
          Shown in an amber box under the trust points. Leave it empty to hide the box.</p>
        <div class="field" style="margin:0">
          <textarea data-s="fake_warning" rows="4">${esc(s.fake_warning === undefined ? '' : s.fake_warning)}</textarea>
        </div>
      </div>

      <div class="card card-pad" style="margin-bottom:14px">
        <h2 class="section-title">Paid extras</h2>
        <div id="st-addons"></div>
      </div>

      <div class="card card-pad">
        <h2 class="section-title">Opening hours</h2>
        <div id="st-hours"></div>
      </div>`;

    $$('[data-s]', panel).forEach((i) => i.addEventListener('input', () => { s[i.dataset.s] = i.value; }));
    $$('[data-hero]', panel).forEach((i) => i.addEventListener('input', () => { s.hero[i.dataset.hero] = i.value; }));
    $$('[data-about]', panel).forEach((i) => i.addEventListener('input', () => { s.about[i.dataset.about] = i.value; }));

    pairEditor($('#st-stats', panel), s.stats, [['value', 'Number'], ['label', 'What it counts']], () => ({ value: '', label: '' }));

    s.trust_points = s.trust_points || [];
    $('#st-trust', panel).appendChild(
      lineList(s.trust_points, 'e.g. We arrive two hours early and set up before you get there'));
    pairEditor($('#st-addons', panel), s.addons, [['label', 'Extra'], ['fee', 'Fee (blank = on request)']], () => ({ label: '', fee: '' }));
    pairEditor($('#st-hours', panel), s.hours, [['days', 'Days'], ['time', 'Hours']], () => ({ days: '', time: '' }));

    $('#st-save', panel).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api('/admin/api/settings', { method: 'PUT', body: JSON.stringify(state.settings) });
        toast('Site details saved', 'good');
      } catch (err) {
        toast(err.message, 'bad');
      } finally {
        btn.disabled = false;
      }
    });
  }

  /** A list of small objects with the same two or three keys — stats, addons,
   *  opening hours. One editor rather than three near-identical ones. */
  function pairEditor(box, arr, keys, makeBlank) {
    function paint() {
      box.innerHTML = '';
      arr.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = 'listrow';
        row.innerHTML = keys.map(([k, label]) =>
          `<input data-k="${k}" value="${esc(item[k] || '')}" placeholder="${esc(label)}">`).join('') +
          '<button type="button" class="btn btn-sm btn-danger" data-rm>✕</button>';
        $$('[data-k]', row).forEach((input) => {
          input.addEventListener('input', () => { item[input.dataset.k] = input.value; });
        });
        $('[data-rm]', row).addEventListener('click', () => { arr.splice(i, 1); paint(); });
        box.appendChild(row);
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn btn-sm';
      add.textContent = '+ Add';
      add.addEventListener('click', () => { arr.push(makeBlank()); paint(); });
      box.appendChild(add);
    }
    paint();
  }

  // ------------------------------------------------------------- how to pay
  //
  // The account numbers a customer sends money to. Kept here, editable, and
  // never written into the code: a bKash number changes, and when it does
  // the owner must be able to fix it in a minute without a deploy.

  const METHOD_TYPES = ['bKash', 'Nagad', 'Rocket', 'Bank', 'Other'];

  function drawPayment(panel) {
    const s = state.settings;
    s.payment = s.payment || {};
    const pay = s.payment;
    pay.methods = pay.methods || [];

    panel.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" id="pay-save">Save payment details</button>
      </div>

      <div class="card card-pad" style="margin-bottom:14px">
        <h2 class="section-title">What the customer reads</h2>
        <div class="field"><label>Short instruction above the numbers</label>
          <textarea data-p="intro" rows="2" placeholder="Send the advance to any of the numbers below, then attach the screenshot.">${esc(pay.intro || '')}</textarea></div>
        <div class="field"><label>Note about the advance</label>
          <input data-p="advance_note" placeholder="A 30% advance confirms the booking." value="${esc(pay.advance_note || '')}"></div>
      </div>

      <div class="card card-pad" style="margin-bottom:14px">
        <h2 class="section-title">QR code</h2>
        <p class="hint" style="margin:-4px 0 12px">Upload the Bangla QR image from your bKash or bank app. Customers scan it instead of typing a number.</p>
        <div data-qr></div>
      </div>

      <div class="card card-pad">
        <h2 class="section-title">Numbers and accounts</h2>
        <div id="pay-methods"></div>
        <button type="button" class="btn btn-sm" id="pay-add" style="margin-top:8px">+ Add a number or account</button>
        <p class="hint" style="margin:12px 0 0">
          These appear on the booking page exactly as written here. Check every digit —
          a wrong one sends a customer's money to a stranger.</p>
      </div>`;

    $$('[data-p]', panel).forEach((i) => i.addEventListener('input', () => { pay[i.dataset.p] = i.value; }));
    $('[data-qr]', panel).appendChild(imageField(pay.qr_image, (path) => { pay.qr_image = path; }));

    const box = $('#pay-methods', panel);
    function paint() {
      box.innerHTML = '';
      if (!pay.methods.length) {
        box.innerHTML = '<p class="hint" style="margin:0">Nothing added yet — the booking page will only show WhatsApp.</p>';
      }
      pay.methods.forEach((m, i) => {
        const row = document.createElement('div');
        row.className = 'pay-method';
        row.innerHTML = `
          <div class="field-row">
            <div class="field" style="margin-bottom:10px"><label>Type</label>
              <select data-m="type">${METHOD_TYPES.map((t) =>
                `<option ${m.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            <div class="field" style="margin-bottom:10px"><label>Shown as</label>
              <input data-m="label" value="${esc(m.label || '')}" placeholder="bKash (Personal)"></div>
          </div>
          <div class="field" style="margin-bottom:10px"><label>Number / account</label>
            <input data-m="number" value="${esc(m.number || '')}" placeholder="01XXXXXXXXX"></div>
          <div class="field" style="margin-bottom:10px"><label>Extra line</label>
            <input data-m="note" value="${esc(m.note || '')}" placeholder="Account name, branch, Send Money only…"></div>
          <button type="button" class="btn btn-sm btn-danger" data-rm>Remove</button>`;
        $$('[data-m]', row).forEach((input) => {
          input.addEventListener('input', () => { m[input.dataset.m] = input.value; });
          input.addEventListener('change', () => { m[input.dataset.m] = input.value; });
        });
        $('[data-rm]', row).addEventListener('click', () => { pay.methods.splice(i, 1); paint(); });
        box.appendChild(row);
      });
    }
    paint();

    $('#pay-add', panel).addEventListener('click', () => {
      pay.methods.push({ type: 'bKash', label: '', number: '', note: '' });
      paint();
    });

    $('#pay-save', panel).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api('/admin/api/settings', { method: 'PUT', body: JSON.stringify(state.settings) });
        toast('Payment details saved', 'good');
      } catch (err) {
        toast(err.message, 'bad');
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------- gallery

  function drawGallery(panel) {
    state.gallery.items = state.gallery.items || [];
    const items = state.gallery.items;

    panel.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" id="gl-save">Save gallery</button>
        <button class="btn" id="gl-add">+ Add a photo</button>
        <span class="hint" style="margin:0">${items.length} photo${items.length === 1 ? '' : 's'}</span>
      </div>
      <div class="card card-pad" id="gl-list"></div>`;

    const list = $('#gl-list', panel);

    function paint() {
      list.innerHTML = '';
      if (!items.length) {
        list.innerHTML = '<div class="empty"><strong>The gallery is empty</strong>Add a photo and press Save.</div>';
        return;
      }
      items.forEach((item, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'border-bottom:1px solid var(--line);padding:14px 0';
        row.innerHTML = `
          <div class="field-row" style="margin-bottom:8px">
            <div class="field" style="margin:0"><label>Caption</label><input data-cap value="${esc(item.caption || '')}"></div>
            <div class="field" style="margin:0"><label>Tag</label><input data-tag value="${esc(item.tag || '')}"></div>
          </div>
          <div data-img></div>
          <button type="button" class="btn btn-sm btn-danger" data-rm>Remove</button>`;
        $('[data-cap]', row).addEventListener('input', (e) => { item.caption = e.target.value; });
        $('[data-tag]', row).addEventListener('input', (e) => { item.tag = e.target.value; });
        $('[data-img]', row).appendChild(imageField(item.image, (p) => { item.image = p; }));
        $('[data-rm]', row).addEventListener('click', () => { items.splice(i, 1); paint(); });
        list.appendChild(row);
      });
    }
    paint();

    $('#gl-add', panel).addEventListener('click', () => { items.push({ image: '', caption: '', tag: '' }); paint(); });

    $('#gl-save', panel).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api('/admin/api/gallery', { method: 'PUT', body: JSON.stringify(state.gallery) });
        toast('Gallery saved', 'good');
      } catch (err) {
        toast(err.message, 'bad');
      } finally {
        btn.disabled = false;
      }
    });
  }

  /** Loads the catalogue if nothing has yet, so the booking dialog has
   *  prices to offer without the Content tab having been opened first. */
  async function ensureLoaded() {
    if (!state.loaded) await load();
  }

  return { mount, packageList, ensureLoaded };
})();

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

  // Two ways to book, and they are genuinely different. Both buttons used to
  // open WhatsApp, which made one of them a lie.
  //
  //   Book on this website — the form, which creates the customer's account
  //                           and lets them follow the booking afterwards.
  //   Book on WhatsApp      — straight into a chat, for people who would
  //                           rather just talk to someone.
  if (bookBtn) {
    bookBtn.addEventListener('click', function (e) {
      e.preventDefault();
      // Carry the choices already made here, so the form opens filled in
      // rather than asking the same four questions again.
      const params = new URLSearchParams();
      const slug = document.body.dataset.packageSlug || '';
      if (slug) params.set('package', slug);

      const date = document.querySelector('#bb-date');
      if (date && date.value) params.set('date', date.value);

      const slot = document.querySelector('#bb-slot');
      if (slot && slot.value) params.set('time', slot.value);

      const guests = document.querySelector('#bb-guests');
      if (guests && guests.value) params.set('people', guests.value);

      const occasion = document.querySelector('#bb-occasion');
      if (occasion && occasion.value) params.set('occasion', occasion.value);

      window.location.href = 'contact?' + params.toString();
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

  // ------------------------------------------------------------------
  // Paying the advance.
  //
  // The whole section stays hidden until the site actually has somewhere to
  // send money. Showing "pay us" with no number under it is worse than not
  // asking at all.
  // ------------------------------------------------------------------
  let uploadedReceipt = '';

  const payBox = document.getElementById('ef-pay');
  if (payBox) {
    fetch('/api/payment-info', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(info => {
        if (!info) return;
        const methods = (info.methods || []).filter(m => m.number || m.label);
        if (!methods.length && !info.qr_image) return;

        payBox.hidden = false;

        const intro = document.getElementById('ef-pay-intro');
        intro.textContent = info.intro ||
          'If you would like to pay the advance now, send it to one of these and attach the screenshot below.';

        const advance = document.getElementById('ef-pay-advance');
        if (info.advance_note) {
          advance.textContent = info.advance_note;
          advance.hidden = false;
        }

        if (info.qr_image) {
          document.getElementById('ef-pay-qr-img').src = info.qr_image;
          document.getElementById('ef-pay-qr').hidden = false;
        }

        const box = document.getElementById('ef-pay-methods');
        for (const m of methods) {
          const row = document.createElement('div');
          row.className = 'ef-pay-method';

          const label = document.createElement('div');
          label.className = 'm-label';
          label.textContent = m.label || m.type || 'Payment';
          row.appendChild(label);

          const numberRow = document.createElement('div');
          numberRow.className = 'm-number';
          const numberText = document.createElement('span');
          numberText.textContent = m.number || '';
          numberRow.appendChild(numberText);

          // Typing an account number by hand is how money goes to the wrong
          // place. One tap copies it instead.
          if (m.number && navigator.clipboard) {
            const copy = document.createElement('button');
            copy.type = 'button';
            copy.className = 'm-copy';
            copy.textContent = 'Copy';
            copy.addEventListener('click', () => {
              navigator.clipboard.writeText(m.number).then(() => {
                copy.textContent = 'Copied';
                setTimeout(() => { copy.textContent = 'Copy'; }, 1800);
              }).catch(() => {});
            });
            numberRow.appendChild(copy);
          }
          row.appendChild(numberRow);

          if (m.note) {
            const note = document.createElement('div');
            note.className = 'm-note';
            note.textContent = m.note;
            row.appendChild(note);
          }
          box.appendChild(row);
        }
      })
      .catch(() => {
        // No payment details, no payment section. The enquiry still works.
      });

    // The screenshot is uploaded the moment it is chosen, so submitting is
    // instant and a large photo on a slow connection does not look like a
    // form that has frozen.
    const fileInput = document.getElementById('ef-receipt');
    const fileNote = document.getElementById('ef-receipt-note');
    const defaultNote = fileNote ? fileNote.textContent : '';

    fileInput.addEventListener('change', async () => {
      const chosen = fileInput.files && fileInput.files[0];
      uploadedReceipt = '';
      if (!chosen) {
        fileNote.textContent = defaultNote;
        return;
      }
      if (chosen.size > 6 * 1024 * 1024) {
        fileNote.textContent = 'That image is over 6MB. Please send a smaller screenshot.';
        fileInput.value = '';
        return;
      }
      fileNote.textContent = 'Uploading…';
      try {
        const body = new FormData();
        body.append('receipt', chosen);
        const res = await fetch('/api/receipt', { method: 'POST', body });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        uploadedReceipt = data.file;
        fileNote.textContent = 'Screenshot attached — it will be sent with your booking.';
      } catch (err) {
        fileNote.textContent = err.message + ' You can still send it on WhatsApp.';
        fileInput.value = '';
      }
    });
  }

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
          // The price goes in the label but not the value: the value is what
          // gets written into the WhatsApp message and matched in the admin
          // panel, and a price frozen into it would go stale the day it
          // changes. window.cdmPriceOf comes from content.js.
          const money = window.cdmPriceOf ? window.cdmPriceOf(pkg) : { has: false };
          option.textContent = money.has
            ? `${option.value} — ${money.now}${money.off ? ' (' + money.off + ')' : ''}`
            : option.value;
          option.dataset.slug = pkg.slug || '';
          option.dataset.name = pkg.name || '';
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

  // "Book on this website" carries the date, time, guests and occasion the
  // customer already chose on the package page. Asking them the same four
  // questions again is how a booking gets abandoned halfway.
  (function prefillFromQuery() {
    const q = new URLSearchParams(location.search);
    const map = { date: 'ef-date', time: 'ef-time', people: 'ef-people', occasion: 'ef-occasion' };
    for (const key in map) {
      const value = q.get(key);
      if (!value) continue;
      const field = document.getElementById(map[key]);
      if (!field) continue;

      // A <select> can only take a value it actually offers; anything else
      // would silently blank the field.
      if (field.tagName === 'SELECT') {
        const ok = Array.from(field.options).some(o => o.value === value);
        if (ok) field.value = value;
      } else {
        field.value = value;
      }
    }
    // The form is the point of the page when someone arrives this way.
    if (q.get('package') || q.get('date')) {
      const form = document.getElementById('enquiry-form');
      if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  })();

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

    // Optional: plenty of customers here do not use email, and demanding one
    // loses the booking. A typed address is still checked, because a wrong
    // one is worse than none — it looks like we can reach them when we cannot.
    const email = document.getElementById('ef-email');
    const typedEmail = email ? email.value.trim() : '';
    if (typedEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(typedEmail)) {
      showError(email, 'That email address does not look right');
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

    // If they paid, say so in the message — the owner then knows to look for
    // a screenshot rather than quoting a price from scratch.
    if (uploadedReceipt) {
      const paid = value('ef-paid');
      const how = value('ef-method');
      lines.push('', `I have already paid${paid ? ' Tk ' + paid : ''}${how ? ' by ' + how : ''} and attached the screenshot on the website.`);
      lines.push('I am sending the screenshot here as well.');
    }

    lines.push('', 'Could you let me know if this date is free?');

    // The number lives in content/settings.json and content.js puts it on the
    // body, so the admin can change it in one place.
    const number = document.body.dataset.waNumber || '8801347059522';
    const url = `https://wa.me/${number}?text=${encodeURIComponent(lines.join('\n'))}`;

    // The enquiry is saved to the site first so it reaches the owner's
    // Control Room even if the customer never presses Send in WhatsApp —
    // which, on a phone with WhatsApp missing or a tab closed too early, is
    // exactly how enquiries used to disappear.
    //
    // It is fire-and-forget on purpose: a failure here must not stop the
    // WhatsApp hand-off, which is still the fastest way to reach the owner.
    const chosen = document.getElementById('ef-package');
    const option = chosen && chosen.selectedOptions && chosen.selectedOptions[0];
    fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.value.trim(),
        phone: tidyPhone(phone.value),
        email: value('ef-email').toLowerCase(),
        receipt: uploadedReceipt,
        paymentMethod: value('ef-method'),
        paidAmount: value('ef-paid'),
        packageSlug: (option && option.dataset.slug) || '',
        packageName: (option && option.dataset.name) || '',
        eventDate: value('ef-date'),
        eventTime: value('ef-time'),
        people: value('ef-people'),
        occasion: value('ef-occasion'),
        note: note,
        website: (document.getElementById('ef-website') || {}).value || '',
      }),
    }).catch(() => {});

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

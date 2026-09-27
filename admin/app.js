/* ==========================================================================
   Control Room — shell, dashboard, bookings and accounts.
   The website content editor lives in content.js and is mounted as one view.
   ========================================================================== */
'use strict';

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const state = {
  role: null,          // 'owner' | 'staff'
  name: '',
  bookings: [],
  expenses: [],
  summary: null,
  staff: [],
  staffSummary: null,
  customers: [],
  mailReady: false,
  filter: { status: 'all', q: '' },
};

const isOwner = () => state.role === 'owner';

const STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const METHODS = ['Cash', 'bKash', 'Nagad', 'Rocket', 'Bank', 'Other'];

const EXPENSE_CATEGORIES = [
  'Decoration', 'Flowers', 'Cake', 'Transport', 'Staff',
  'Equipment', 'Marketing', 'Other',
];

// ---------------------------------------------------------------- utilities

function toast(message, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' is-' + kind : '');
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function api(path, options) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
  if (res.status === 401) {
    showLogin();
    throw new Error('Session expired — sign in again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const esc = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Money, always with the taka sign and grouped digits. */
const tk = (n) => '৳' + Number(n || 0).toLocaleString('en-IN');

/** A date the owner reads, not an ISO string. Blank stays blank. */
function humanDate(value) {
  if (!value) return '';
  const d = new Date(value.length <= 10 ? value + 'T00:00:00' : value);
  if (isNaN(d)) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const today = () => new Date().toISOString().slice(0, 10);

/** Digits only, for a wa.me link. */
const waNumber = (phone) => String(phone || '').replace(/\D/g, '');

// ---------------------------------------------------------------- auth

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
}

async function boot() {
  try {
    const session = await api('/admin/api/session');
    if (session.authenticated) return enter(session);
  } catch (e) { /* fall through to the login screen */ }
  showLogin();
}

// The owner signs in with a password alone; a team member also needs the
// email their account was made with. One form, switched rather than two
// pages, because most of the time it is the owner and the extra field would
// only be something else to skip past.
let staffMode = false;
$('#login-switch').addEventListener('click', () => {
  staffMode = !staffMode;
  $('#email-row').hidden = !staffMode;
  $('#password-label').textContent = staffMode ? 'Your password' : 'Admin password';
  $('#login-switch').textContent = staffMode ? 'I am the owner' : 'I am a team member';
  $('#login-error').hidden = true;
  (staffMode ? $('#email') : $('#password')).focus();
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  const err = $('#login-error');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    await api('/admin/api/login', {
      method: 'POST',
      body: JSON.stringify({
        password: $('#password').value,
        email: staffMode ? $('#email').value.trim() : '',
      }),
    });
    $('#password').value = '';
    await enter();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/admin/api/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

async function enter(session) {
  const who = session || await api('/admin/api/session');
  state.role = who.role;
  state.name = who.name || '';

  $('#login').hidden = true;
  $('#app').hidden = false;

  // Owner-only entries are removed from the sidebar for staff rather than
  // greyed out: a disabled button still tells them what they are missing.
  $('#app').classList.toggle('is-staff', !isOwner());
  $('#who').textContent = isOwner() ? "Cox's Dream Moment" : (state.name || 'Team member');

  await refresh();
  go('dashboard');
}

/** Pulls everything the dashboard and lists read. One call site, so a
 *  screen can never render against half-stale data. */
async function refresh() {
  const expenses = await api('/admin/api/expenses');
  state.expenses = expenses.expenses || [];

  if (!isOwner()) {
    // A staff session would be refused by these, and asking anyway would
    // log them out on the 401.
    state.staffSummary = await api('/admin/api/staff-summary');
    return;
  }

  const [bookings, summary, staff, customers] = await Promise.all([
    api('/admin/api/bookings'),
    api('/admin/api/summary'),
    api('/admin/api/staff'),
    api('/admin/api/customers'),
  ]);
  state.bookings = bookings.bookings || [];
  state.summary = summary;
  state.staff = staff.staff || [];
  state.customers = customers.customers || [];
  state.mailReady = !!customers.mailReady;

  const newCount = state.bookings.filter((b) => b.status === 'new').length;
  const badge = $('#nav-new');
  badge.textContent = newCount;
  badge.hidden = newCount === 0;

  // How many people are still waiting to be told something by hand.
  const waiting = state.customers.reduce((sum, c) => sum + c.waiting.length, 0);
  const waitBadge = $('#nav-waiting');
  waitBadge.textContent = waiting;
  waitBadge.hidden = waiting === 0;
}

// ---------------------------------------------------------------- routing

const VIEWS = {
  dashboard: { title: 'Dashboard', render: () => (isOwner() ? renderDashboard() : renderStaffHome()) },
  bookings: { title: 'Bookings', owner: true, render: renderBookings },
  accounts: { title: 'Accounts', render: () => (isOwner() ? renderAccounts() : renderStaffCosts()) },
  customers: { title: 'Customers', owner: true, render: renderCustomers },
  team: { title: 'Team', owner: true, render: renderTeam },
  content: { title: 'Website content', render: () => window.ContentEditor.mount($('#view-content')) },
};

function go(name) {
  let view = VIEWS[name] || VIEWS.dashboard;
  // Belt and braces: the sidebar already hides these, but a stale hash or a
  // stray call must not land a staff member on an empty owner screen.
  if (view.owner && !isOwner()) { name = 'dashboard'; view = VIEWS.dashboard; }
  if (name === 'accounts' && !isOwner()) $('#view-title').textContent = 'My costs';
  $$('.nav-item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + name));
  $('#view-title').textContent = view.title;
  $('#topbar-actions').innerHTML = '';
  $('#app').classList.remove('nav-open');
  view.render();
}

$$('.nav-item').forEach((btn) => btn.addEventListener('click', () => go(btn.dataset.view)));
$('#menu-btn').addEventListener('click', () => $('#app').classList.toggle('nav-open'));
$('#scrim').addEventListener('click', () => $('#app').classList.remove('nav-open'));

// ---------------------------------------------------------------- dialog

/** Opens the shared dialog. [build] fills the body; [onSave] runs when the
 *  primary button is pressed and may return false to keep it open. */
function openSheet({ title, body, saveLabel, onSave, extraFoot }) {
  const dlg = $('#sheet');
  const form = $('#sheet-inner');
  form.innerHTML = `
    <div class="sheet-head">
      <h2>${esc(title)}</h2>
      <button type="button" class="btn btn-ghost btn-sm" style="margin-left:auto" data-close>Close</button>
    </div>
    <div class="sheet-body" id="sheet-body"></div>
    <div class="sheet-foot">
      ${extraFoot || ''}
      <span class="spacer"></span>
      <button type="button" class="btn" data-close>Cancel</button>
      ${onSave ? `<button type="button" class="btn btn-primary" data-save>${esc(saveLabel || 'Save')}</button>` : ''}
    </div>`;
  const bodyEl = $('#sheet-body', form);
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);

  $$('[data-close]', form).forEach((b) => b.addEventListener('click', () => dlg.close()));
  const saveBtn = $('[data-save]', form);
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        const result = await onSave(bodyEl);
        if (result !== false) dlg.close();
      } catch (e) {
        toast(e.message, 'bad');
      } finally {
        saveBtn.disabled = false;
      }
    });
  }
  dlg.showModal();
  return { dialog: dlg, body: bodyEl };
}

function confirmDialog(message, confirmLabel) {
  return new Promise((resolve) => {
    const { dialog } = openSheet({
      title: 'Are you sure?',
      body: `<p style="margin:0;line-height:1.55">${esc(message)}</p>`,
      saveLabel: confirmLabel || 'Delete',
      onSave: () => { resolve(true); return true; },
    });
    dialog.addEventListener('close', () => resolve(false), { once: true });
  });
}

// ================================================================ DASHBOARD

function renderDashboard() {
  const s = state.summary;
  if (!s) return;
  const t = s.totals;
  const el = $('#view-dashboard');

  const maxBar = Math.max(1, ...s.months.map((m) => Math.max(m.income, m.spent)));

  el.innerHTML = `
    <div class="grid grid-stats" style="margin-bottom:18px">
      <div class="stat is-good">
        <div class="stat-label">Received this month</div>
        <div class="stat-value">${tk(t.receivedThisMonth)}</div>
        <div class="stat-note">${tk(t.received)} in total</div>
      </div>
      <div class="stat is-warn">
        <div class="stat-label">Still to collect</div>
        <div class="stat-value">${tk(t.due)}</div>
        <div class="stat-note">across all live bookings</div>
      </div>
      <div class="stat">
        <div class="stat-label">Spent this month</div>
        <div class="stat-value">${tk(t.spentThisMonth)}</div>
        <div class="stat-note">${tk(t.spent)} in total</div>
      </div>
      <div class="stat ${t.profitThisMonth >= 0 ? 'is-good' : 'is-bad'}">
        <div class="stat-label">Profit this month</div>
        <div class="stat-value">${tk(t.profitThisMonth)}</div>
        <div class="stat-note">received minus spent</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:18px">
      <div class="card card-pad">
        <h2 class="section-title">Last six months</h2>
        <div class="chart">
          ${s.months.map((m) => `
            <div class="chart-col">
              <div class="chart-bars">
                <div class="chart-bar income" style="height:${Math.round((m.income / maxBar) * 100)}%" title="Received ${tk(m.income)}"></div>
                <div class="chart-bar spent" style="height:${Math.round((m.spent / maxBar) * 100)}%" title="Spent ${tk(m.spent)}"></div>
              </div>
              <div class="chart-label">${esc(m.label)}</div>
            </div>`).join('')}
        </div>
        <div class="legend">
          <span><i style="background:var(--coral)"></i>Received</span>
          <span><i style="background:#C9D3E2"></i>Spent</span>
        </div>
      </div>

      <div class="card card-pad">
        <h2 class="section-title">Which packages sell</h2>
        ${s.topPackages.length ? `
          <div class="tablewrap"><table class="tbl">
            <thead><tr><th>Package</th><th class="num">Bookings</th><th class="num">Value</th></tr></thead>
            <tbody>${s.topPackages.map((p) => `
              <tr><td>${esc(p.name)}</td><td class="num">${p.count}</td><td class="num">${tk(p.value)}</td></tr>`).join('')}
            </tbody>
          </table></div>` : `<div class="empty"><strong>No bookings yet</strong>Once bookings come in, the popular packages show here.</div>`}
      </div>
    </div>

    <div class="card">
      <div class="card-pad" style="display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line)">
        <h2 class="section-title" style="margin:0">Latest bookings</h2>
        <button class="btn btn-sm" style="margin-left:auto" data-all>See all</button>
      </div>
      ${bookingTable(s.recent)}
    </div>`;

  $('[data-all]', el).addEventListener('click', () => go('bookings'));
  wireBookingRows(el);

  $('#topbar-actions').innerHTML = '<button class="btn btn-primary" id="tb-add">+ New booking</button>';
  $('#tb-add').addEventListener('click', () => editBooking(null));
}

// ================================================================ BOOKINGS

function bookingTable(list) {
  if (!list.length) {
    return `<div class="empty"><strong>Nothing here yet</strong>Bookings from the website land here automatically.</div>`;
  }
  return `<div class="tablewrap"><table class="tbl">
    <thead><tr>
      <th>Booking</th><th>Customer</th><th>Package</th><th>Date</th>
      <th class="num">Price</th><th class="num">Paid</th><th class="num">Due</th><th>Status</th>
    </tr></thead>
    <tbody>${list.map((b) => `
      <tr class="row-link" data-id="${esc(b.id)}">
        <td><strong>${esc(b.id)}</strong><br><span style="font-size:11.5px;color:var(--muted)">${esc(b.source === 'manual' ? 'Entered by you' : 'From website')}</span></td>
        <td>${esc(b.name)}<br><span style="font-size:11.5px;color:var(--muted)">${esc(b.phone)}</span></td>
        <td>${esc(b.packageName || '—')}</td>
        <td>${esc(humanDate(b.eventDate) || '—')}<br><span style="font-size:11.5px;color:var(--muted)">${esc(b.eventTime || '')}</span></td>
        <td class="num">${b.price ? tk(b.price) : '—'}</td>
        <td class="num">${b.paid ? tk(b.paid) : '—'}</td>
        <td class="num" style="${b.due ? 'color:var(--warn);font-weight:700' : ''}">${b.due ? tk(b.due) : '—'}</td>
        <td><span class="pill pill-${esc(b.status)}">${esc((STATUSES.find((s) => s.id === b.status) || {}).label || b.status)}</span></td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function wireBookingRows(root) {
  $$('.row-link', root).forEach((tr) => {
    tr.addEventListener('click', () => {
      const booking = state.bookings.find((b) => b.id === tr.dataset.id);
      if (booking) editBooking(booking);
    });
  });
}

function renderBookings() {
  const el = $('#view-bookings');
  const f = state.filter;
  const q = f.q.trim().toLowerCase();

  const list = state.bookings.filter((b) => {
    if (f.status !== 'all' && b.status !== f.status) return false;
    if (!q) return true;
    return [b.id, b.name, b.phone, b.packageName, b.occasion]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });

  el.innerHTML = `
    <div class="toolbar">
      <input type="search" id="bk-q" placeholder="Search name, number or booking id" value="${esc(f.q)}">
      <button class="chip ${f.status === 'all' ? 'is-on' : ''}" data-status="all">All (${state.bookings.length})</button>
      ${STATUSES.map((s) => {
        const n = state.bookings.filter((b) => b.status === s.id).length;
        return `<button class="chip ${f.status === s.id ? 'is-on' : ''}" data-status="${s.id}">${s.label} (${n})</button>`;
      }).join('')}
    </div>
    <div class="card">${bookingTable(list)}</div>`;

  const search = $('#bk-q', el);
  search.addEventListener('input', () => {
    state.filter.q = search.value;
    const pos = search.selectionStart;
    renderBookings();
    const again = $('#bk-q');
    again.focus();
    again.setSelectionRange(pos, pos);
  });
  $$('[data-status]', el).forEach((b) => b.addEventListener('click', () => {
    state.filter.status = b.dataset.status;
    renderBookings();
  }));
  wireBookingRows(el);

  $('#topbar-actions').innerHTML = '<button class="btn btn-primary" id="tb-add">+ New booking</button>';
  $('#tb-add').addEventListener('click', () => editBooking(null));
}

/** The booking editor. One dialog for both a new booking and an existing
 *  one — the fields are identical, and two near-copies would drift. */
function editBooking(booking) {
  const isNew = !booking;
  const b = booking || {
    id: '', name: '', phone: '', email: '', packageSlug: '', packageName: '',
    eventDate: '', eventTime: '', people: '', occasion: '', note: '',
    status: 'new', price: 0, cost: 0, payments: [], adminNote: '', source: 'manual',
  };

  const packages = (window.ContentEditor && window.ContentEditor.packageList()) || [];
  const wa = waNumber(b.phone);

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field-row">
      <div class="field"><label>Customer name</label><input id="f-name" value="${esc(b.name)}"></div>
      <div class="field"><label>Mobile number</label><input id="f-phone" value="${esc(b.phone)}"></div>
    </div>
    <div class="field"><label>Package</label>
      <select id="f-package">
        <option value="">Not decided</option>
        ${packages.map((p) => `<option value="${esc(p.slug)}" ${b.packageSlug === p.slug ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        ${b.packageName && !packages.some((p) => p.slug === b.packageSlug)
          ? `<option value="__keep" selected>${esc(b.packageName)}</option>` : ''}
      </select>
    </div>
    <div class="field-row">
      <div class="field"><label>Event date</label><input id="f-date" type="date" value="${esc(b.eventDate)}"></div>
      <div class="field"><label>Time</label>
        <select id="f-time">
          ${['', 'Sunset (5:00 PM – 6:00 PM)', 'Evening (6:00 PM – 8:00 PM)', 'Night (after 8:00 PM)']
            .map((t) => `<option ${b.eventTime === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>People</label><input id="f-people" type="number" min="0" value="${esc(b.people || '')}"></div>
      <div class="field"><label>Occasion</label>
        <select id="f-occasion">
          ${['', 'Proposal', 'Birthday', 'Anniversary', 'Honeymoon', 'Something else']
            .map((o) => `<option ${b.occasion === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="field-row">
      <div class="field"><label>Agreed price (৳)</label><input id="f-price" type="number" min="0" value="${esc(b.price || 0)}"></div>
      <div class="field"><label>Status</label>
        <select id="f-status">
          ${STATUSES.map((s) => `<option value="${s.id}" ${b.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <p class="hint">The agreed price is what this customer pays — it is deliberately separate from the price listed on the site.</p>

    <div class="field"><label>What the customer wrote</label>
      <textarea id="f-note" rows="3">${esc(b.note)}</textarea></div>
    ${noEmail ? `
      <div style="margin:16px 0;padding:12px 14px;border-radius:10px;background:var(--warn-soft);font-size:13px;line-height:1.6">
        <strong>No email address.</strong> This customer will not be told anything automatically.
        Whatever you change here appears under <em>Customers</em> with a WhatsApp button ready to send.
      </div>` : ''}

    <div class="field"><label>Email</label>
      <input id="f-email" type="email" value="${esc(b.email || '')}" placeholder="Add one and they get updates automatically">
    </div>

    <div class="field"><label>Your own note</label>
      <textarea id="f-adminnote" rows="2" placeholder="Anything to remember about this booking">${esc(b.adminNote)}</textarea></div>

    ${isNew || !(b.receipts || []).length ? '' : `
      <h3 class="section-title" style="margin-top:22px">Payment screenshot</h3>
      <p class="hint" style="margin:-6px 0 10px">Sent by the customer when they booked. Check it before recording the payment.</p>
      ${b.receipts.map((r) => `
        <a href="/receipts/${encodeURIComponent(r.file)}" target="_blank" rel="noopener"
           style="display:inline-block;margin:0 8px 8px 0">
          <img src="/receipts/${encodeURIComponent(r.file)}" alt="Payment screenshot"
               style="max-width:160px;border-radius:10px;border:1px solid var(--line);display:block">
          <span class="hint" style="margin:4px 0 0;display:block">
            ${esc(r.method || 'Payment')}${r.amount ? ' · ' + tk(r.amount) : ''} — tap to enlarge
          </span>
        </a>`).join('')}
    `}

    ${isNew ? '' : `
      <h3 class="section-title" style="margin-top:22px">Payments</h3>
      <div id="pay-list"></div>
      <button type="button" class="btn btn-sm" id="pay-add">+ Record a payment</button>`}
  `;

  // Someone with no email hears nothing automatically, so say so here rather
  // than letting the owner assume a confirmation went out.
  const account = state.customers.find((c) => c.id === b.customerId);
  const noEmail = !isNew && !(b.email || (account && account.email));

  const extraFoot = isNew ? '' :
    `${wa ? `<a class="btn btn-sm ${noEmail ? 'btn-primary' : ''}" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
     <button type="button" class="btn btn-sm btn-danger" data-delete>Delete</button>`;

  const sheet = openSheet({
    title: isNew ? 'New booking' : `${b.id} — ${b.name}`,
    body,
    saveLabel: isNew ? 'Create booking' : 'Save changes',
    extraFoot,
    onSave: async (root) => {
      const sel = $('#f-package', root);
      const slug = sel.value === '__keep' ? b.packageSlug : sel.value;
      const pkg = packages.find((p) => p.slug === slug);

      const payload = {
        name: $('#f-name', root).value,
        phone: $('#f-phone', root).value,
        packageSlug: slug === '__keep' ? b.packageSlug : slug,
        packageName: sel.value === '__keep' ? b.packageName : (pkg ? pkg.name : ''),
        eventDate: $('#f-date', root).value,
        eventTime: $('#f-time', root).value,
        people: $('#f-people', root).value,
        occasion: $('#f-occasion', root).value,
        note: $('#f-note', root).value,
        email: $('#f-email', root).value.trim(),
        adminNote: $('#f-adminnote', root).value,
        price: $('#f-price', root).value,
        status: $('#f-status', root).value,
        payments: draftPayments,
        source: b.source,
      };
      if (!payload.name.trim()) { toast('Enter the customer name.', 'bad'); return false; }

      if (isNew) await api('/admin/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
      else await api('/admin/api/bookings/' + encodeURIComponent(b.id), { method: 'PUT', body: JSON.stringify(payload) });

      await refresh();
      go(VIEWS[currentView()] ? currentView() : 'bookings');
      toast(isNew ? 'Booking created' : 'Booking saved', 'good');
    },
  });

  // Payments are edited in the dialog and saved with it, so a half-entered
  // payment is never committed on its own.
  const draftPayments = (b.payments || []).map((p) => Object.assign({}, p));

  function drawPayments() {
    const wrap = $('#pay-list', body);
    if (!wrap) return;
    const paid = draftPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const price = Number($('#f-price', body).value || 0);
    wrap.innerHTML = draftPayments.length ? `
      <div class="tablewrap"><table class="tbl">
        <tbody>${draftPayments.map((p, i) => `
          <tr>
            <td>${esc(humanDate(p.date))}<br><span style="font-size:11.5px;color:var(--muted)">${esc(p.method)}${p.note ? ' · ' + esc(p.note) : ''}</span></td>
            <td class="num"><strong>${tk(p.amount)}</strong></td>
            <td class="num"><button type="button" class="btn btn-sm btn-ghost" data-rm="${i}">Remove</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <p class="hint" style="margin-top:10px">Paid ${tk(paid)}${price ? ` of ${tk(price)} — ${tk(Math.max(price - paid, 0))} still due` : ''}.</p>`
      : '<p class="hint" style="margin:0 0 10px">No payment recorded yet.</p>';

    $$('[data-rm]', wrap).forEach((btn) => btn.addEventListener('click', () => {
      draftPayments.splice(Number(btn.dataset.rm), 1);
      drawPayments();
    }));
  }

  if (!isNew) {
    drawPayments();
    $('#f-price', body).addEventListener('input', drawPayments);

    // The payment form opens inside this dialog rather than as a second one:
    // a nested <dialog> fights the open modal, and swapping the footer out
    // and back leaves stale handlers behind.
    $('#pay-add', body).addEventListener('click', () => {
      if ($('#pay-form', body)) return;

      const price = Number($('#f-price', body).value || 0);
      const paid = draftPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const suggested = Math.max(price - paid, 0);

      const form = document.createElement('div');
      form.id = 'pay-form';
      form.style.cssText = 'border:1px solid var(--line);border-radius:var(--r-md);padding:14px;margin-top:10px;background:#FAFBFD';
      form.innerHTML = `
        <div class="field-row">
          <div class="field"><label>Amount (\u09f3)</label><input id="p-amt" type="number" min="1" value="${suggested || ''}"></div>
          <div class="field"><label>Date</label><input id="p-date" type="date" value="${today()}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Method</label>
            <select id="p-method">${METHODS.map((m) => `<option>${m}</option>`).join('')}</select></div>
          <div class="field"><label>Note</label><input id="p-note" placeholder="e.g. advance"></div>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn btn-sm btn-primary" id="p-ok">Add payment</button>
          <button type="button" class="btn btn-sm" id="p-cancel">Cancel</button>
        </div>`;

      $('#pay-add', body).insertAdjacentElement('afterend', form);
      $('#p-amt', form).focus();

      $('#p-cancel', form).addEventListener('click', () => form.remove());
      $('#p-ok', form).addEventListener('click', () => {
        const amount = Number($('#p-amt', form).value || 0);
        if (!amount || amount < 1) { toast('Enter an amount.', 'bad'); return; }
        draftPayments.push({
          id: 'p' + Date.now(),
          amount,
          date: $('#p-date', form).value || today(),
          method: $('#p-method', form).value,
          note: $('#p-note', form).value,
        });
        form.remove();
        drawPayments();
        toast('Added \u2014 press Save to keep it', 'good');
      });
    });
  }

  const del = $('[data-delete]');
  if (del) {
    del.addEventListener('click', async () => {
      sheet.dialog.close();
      const ok = await confirmDialog(`Delete booking ${b.id} for ${b.name}? This cannot be undone.`);
      if (!ok) return;
      try {
        await api('/admin/api/bookings/' + encodeURIComponent(b.id), { method: 'DELETE' });
        await refresh();
        go('bookings');
        toast('Booking deleted', 'good');
      } catch (e) { toast(e.message, 'bad'); }
    });
  }
}

// ================================================================ STAFF

/** What a team member sees instead of the dashboard. No bookings, no income,
 *  no profit — only their own work and the live catalogue. */
function renderStaffHome() {
  const s = state.staffSummary || {};
  const el = $('#view-dashboard');

  el.innerHTML = `
    <div class="card card-pad" style="margin-bottom:18px">
      <h2 class="section-title" style="margin-bottom:6px">Hello${state.name ? ', ' + esc(state.name) : ''}</h2>
      <p class="hint" style="margin:0">Record what you spend, and keep the packages up to date.</p>
    </div>

    <div class="grid grid-stats" style="margin-bottom:18px">
      <div class="stat"><div class="stat-label">My costs this month</div>
        <div class="stat-value">${tk(s.myCostsThisMonth || 0)}</div>
        <div class="stat-note">${tk(s.myCostsTotal || 0)} in total</div></div>
      <div class="stat"><div class="stat-label">Costs I recorded</div>
        <div class="stat-value">${s.myCostCount || 0}</div></div>
      <div class="stat"><div class="stat-label">Packages live</div>
        <div class="stat-value">${s.packages || 0}</div>
        <div class="stat-note">${s.featured || 0} featured</div></div>
    </div>

    <div class="card card-pad">
      <h2 class="section-title">What you can do</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" data-go="accounts">+ Add a cost</button>
        <button class="btn" data-go="content">Edit the packages</button>
      </div>
    </div>`;

  $$('[data-go]', el).forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  $('#topbar-actions').innerHTML = '<button class="btn btn-primary" id="tb-cost">+ Add a cost</button>';
  $('#tb-cost').addEventListener('click', () => addCost(renderStaffHome));
}

/** The costs a team member has entered. Only their own: another person's
 *  spending is not theirs to audit. */
function renderStaffCosts() {
  const el = $('#view-accounts');
  const mine = state.expenses;

  el.innerHTML = `
    <div class="card">
      <div class="card-pad" style="display:flex;align-items:center;border-bottom:1px solid var(--line)">
        <h2 class="section-title" style="margin:0">Costs I recorded</h2>
        <button class="btn btn-sm btn-primary" style="margin-left:auto" id="ex-add">+ Add a cost</button>
      </div>
      ${mine.length ? `<div class="tablewrap"><table class="tbl">
        <thead><tr><th>Date</th><th>What for</th><th class="num">Amount</th></tr></thead>
        <tbody>${mine.map((e) => `
          <tr><td>${esc(humanDate(e.date))}</td>
              <td>${esc(e.category)}${e.note ? `<br><span style="font-size:11.5px;color:var(--muted)">${esc(e.note)}</span>` : ''}</td>
              <td class="num" style="font-weight:700">${tk(e.amount)}</td></tr>`).join('')}
        </tbody></table></div>`
        : `<div class="empty"><strong>Nothing recorded yet</strong>Add what you spend so it is not forgotten.</div>`}
      <p class="hint" style="padding:0 18px 16px;margin:10px 0 0">
        Once a cost is saved it stays. If you enter one by mistake, ask the owner to remove it.</p>
    </div>`;

  $('#ex-add', el).addEventListener('click', () => addCost(renderStaffCosts));
  $('#topbar-actions').innerHTML = '';
}

// ================================================================ CUSTOMERS
//
// The point of this screen is the people we could NOT email. Everyone else
// has already been told automatically; these are the ones still waiting, and
// each has a button that opens WhatsApp with the message already written.

function renderCustomers() {
  const el = $('#view-customers');
  const list = state.customers;
  const waiting = list.filter((c) => c.waiting.length);

  el.innerHTML = `
    ${state.mailReady ? '' : `
      <div class="card card-pad" style="margin-bottom:14px;border-color:var(--warn);background:var(--warn-soft)">
        <strong style="display:block;margin-bottom:4px">Email is not switched on yet</strong>
        <span style="font-size:13.5px;line-height:1.6">
          Nothing is being emailed to anyone, so every customer below is waiting to hear from you by hand.
          Add your Gmail address and App Password on the server to turn it on.
        </span>
      </div>`}

    ${waiting.length ? `
      <div class="card" style="margin-bottom:18px">
        <div class="card-pad" style="border-bottom:1px solid var(--line)">
          <h2 class="section-title" style="margin:0">Waiting to be told (${waiting.reduce((n, c) => n + c.waiting.length, 0)})</h2>
          <p class="hint" style="margin:6px 0 0">
            These people have no email address, so nothing was sent. Press Send and WhatsApp opens with the message ready.</p>
        </div>
        <div class="tablewrap"><table class="tbl">
          <thead><tr><th>Customer</th><th>What to tell them</th><th></th></tr></thead>
          <tbody>${waiting.map((c) => c.waiting.map((w, i) => `
            <tr>
              ${i === 0 ? `<td rowspan="${c.waiting.length}">
                <strong>${esc(c.name || 'No name')}</strong><br>
                <span style="font-size:11.5px;color:var(--muted)">${esc(c.phone || 'no number')}</span></td>` : ''}
              <td>${esc(w.label)}<br><span style="font-size:11.5px;color:var(--muted)">${esc(w.bookingId)} · ${esc(humanDate(w.at))}</span></td>
              <td class="num" style="white-space:nowrap">
                ${c.phone
                  ? `<a class="btn btn-sm btn-primary" target="_blank" rel="noopener"
                       href="https://wa.me/${waNumber(c.phone)}?text=${encodeURIComponent(w.text)}"
                       data-sent="${esc(c.id)}" data-booking="${esc(w.bookingId)}" data-kind="${esc(w.kind)}">Send</a>`
                  : '<span class="hint" style="margin:0">No number</span>'}
                <button class="btn btn-sm btn-ghost" data-done="${esc(c.id)}"
                        data-booking="${esc(w.bookingId)}" data-kind="${esc(w.kind)}">Done</button>
              </td>
            </tr>`).join('')).join('')}
          </tbody></table></div>
      </div>` : ''}

    <div class="card">
      <div class="card-pad" style="border-bottom:1px solid var(--line)">
        <h2 class="section-title" style="margin:0">Everyone who has booked (${list.length})</h2>
      </div>
      ${list.length ? `<div class="tablewrap"><table class="tbl">
        <thead><tr>
          <th>Name</th><th>Contact</th><th class="num">Bookings</th>
          <th class="num">Paid</th><th class="num">Due</th><th>Reachable by</th>
        </tr></thead>
        <tbody>${list.map((c) => `
          <tr>
            <td><strong>${esc(c.name || 'No name')}</strong>${c.lastBooking ? `<br><span style="font-size:11.5px;color:var(--muted)">last: ${esc(c.lastBooking)}</span>` : ''}</td>
            <td>${esc(c.phone || '—')}${c.email ? `<br><span style="font-size:11.5px;color:var(--muted)">${esc(c.email)}</span>` : ''}</td>
            <td class="num">${c.bookings}</td>
            <td class="num">${c.spent ? tk(c.spent) : '—'}</td>
            <td class="num" style="${c.due ? 'color:var(--warn);font-weight:700' : ''}">${c.due ? tk(c.due) : '—'}</td>
            <td>
              ${c.email ? '<span class="pill pill-completed">Email</span>' : '<span class="pill pill-new">WhatsApp only</span>'}
              ${c.hasGoogle ? '<span class="role-tag">Google</span>' : ''}
            </td>
          </tr>`).join('')}
        </tbody></table></div>`
        : `<div class="empty"><strong>No customers yet</strong>An account is made automatically the first time somebody books.</div>`}
      <p class="hint" style="padding:0 18px 16px;margin:12px 0 0">
        Anyone marked “WhatsApp only” gave no email address, so they get nothing automatically — they appear above when
        there is something to tell them.</p>
    </div>`;

  // Opening WhatsApp and marking it done are the same action, so pressing
  // Send does both. The link still opens normally.
  $$('[data-sent]', el).forEach((a) => a.addEventListener('click', () => {
    markSent(a.dataset.sent, a.dataset.booking, a.dataset.kind, false);
  }));

  $$('[data-done]', el).forEach((b) => b.addEventListener('click', () => {
    markSent(b.dataset.done, b.dataset.booking, b.dataset.kind, true);
  }));

  $('#topbar-actions').innerHTML = '';
}

async function markSent(customerId, bookingId, kind, tell) {
  try {
    await api(`/admin/api/customers/${encodeURIComponent(customerId)}/sent`, {
      method: 'POST',
      body: JSON.stringify({ bookingId, kind }),
    });
    await refresh();
    renderCustomers();
    if (tell) toast('Marked as told', 'good');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

// ================================================================ TEAM

function renderTeam() {
  const el = $('#view-team');

  el.innerHTML = `
    <div class="card">
      <div class="card-pad" style="display:flex;align-items:center;border-bottom:1px solid var(--line)">
        <h2 class="section-title" style="margin:0">Team members</h2>
        <button class="btn btn-sm btn-primary" style="margin-left:auto" id="st-add">+ Add someone</button>
      </div>
      ${state.staff.length ? `<div class="tablewrap"><table class="tbl">
        <thead><tr><th>Name</th><th>Signs in with</th><th>Status</th><th></th></tr></thead>
        <tbody>${state.staff.map((u) => `
          <tr>
            <td><strong>${esc(u.name)}</strong>${u.phone ? `<br><span style="font-size:11.5px;color:var(--muted)">${esc(u.phone)}</span>` : ''}</td>
            <td>${esc(u.email)}</td>
            <td><span class="pill ${u.active ? 'pill-completed' : 'pill-cancelled'}">${u.active ? 'Active' : 'Blocked'}</span></td>
            <td class="num">
              <button class="btn btn-sm" data-edit="${esc(u.id)}">Edit</button>
              <button class="btn btn-sm btn-ghost" data-toggle="${esc(u.id)}">${u.active ? 'Block' : 'Unblock'}</button>
              <button class="btn btn-sm btn-danger" data-del="${esc(u.id)}">Remove</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div>`
        : `<div class="empty"><strong>No team members yet</strong>Add someone and they can record costs and edit the packages.</div>`}
    </div>

    <div class="card card-pad" style="margin-top:14px">
      <h2 class="section-title">What a team member can do</h2>
      <p style="margin:0;line-height:1.7;font-size:13.5px">
        <strong>Yes:</strong> record what they spend, add and edit packages, see the live catalogue.<br>
        <strong>No:</strong> bookings, customers, income, profit, what anyone owes, the site's contact details,
        and removing a cost once it is saved.
      </p>
      <p class="hint" style="margin:10px 0 0">
        They sign in at the same address, pressing “I am a team member”.</p>
    </div>`;

  $('#st-add', el).addEventListener('click', () => staffForm(null));
  $$('[data-edit]', el).forEach((b) => b.addEventListener('click',
    () => staffForm(state.staff.find((u) => u.id === b.dataset.edit))));

  $$('[data-toggle]', el).forEach((b) => b.addEventListener('click', async () => {
    const user = state.staff.find((u) => u.id === b.dataset.toggle);
    try {
      await api('/admin/api/staff/' + encodeURIComponent(user.id), {
        method: 'PUT', body: JSON.stringify({ active: !user.active }),
      });
      await refresh();
      renderTeam();
      toast(user.active ? 'Blocked — they can no longer sign in' : 'Unblocked', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  }));

  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
    const user = state.staff.find((u) => u.id === b.dataset.del);
    const ok = await confirmDialog(
      `Remove ${user.name}? They lose access immediately. The costs they recorded stay in your accounts.`, 'Remove');
    if (!ok) return;
    try {
      await api('/admin/api/staff/' + encodeURIComponent(user.id), { method: 'DELETE' });
      await refresh();
      renderTeam();
      toast('Removed', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  }));

  $('#topbar-actions').innerHTML = '';
}

function staffForm(user) {
  const isNew = !user;
  openSheet({
    title: isNew ? 'Add a team member' : `Edit ${user.name}`,
    body: `
      <div class="field"><label>Name</label><input id="s-name" value="${esc(isNew ? '' : user.name)}"></div>
      <div class="field-row">
        <div class="field"><label>Work email</label>
          <input id="s-email" type="email" value="${esc(isNew ? '' : user.email)}" ${isNew ? '' : 'disabled'}>
          ${isNew ? '' : '<p class="hint" style="margin:6px 0 0">The email cannot be changed — it is how they sign in.</p>'}
        </div>
        <div class="field"><label>Mobile</label><input id="s-phone" value="${esc(isNew ? '' : (user.phone || ''))}"></div>
      </div>
      <div class="field">
        <label>${isNew ? 'Password' : 'New password'}</label>
        <input id="s-pass" type="text" placeholder="${isNew ? 'At least 8 characters' : 'Leave blank to keep the current one'}">
        <p class="hint" style="margin:6px 0 0">
          Shown as plain text on purpose — you have to read it out to them. Tell them in person or on WhatsApp, not by email.</p>
      </div>`,
    saveLabel: isNew ? 'Create account' : 'Save',
    onSave: async (root) => {
      const payload = {
        name: $('#s-name', root).value.trim(),
        phone: $('#s-phone', root).value.trim(),
        password: $('#s-pass', root).value,
      };
      if (isNew) {
        payload.email = $('#s-email', root).value.trim();
        await api('/admin/api/staff', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        if (!payload.password) delete payload.password;
        await api('/admin/api/staff/' + encodeURIComponent(user.id), { method: 'PUT', body: JSON.stringify(payload) });
      }
      await refresh();
      renderTeam();
      toast(isNew ? 'Account created' : 'Saved', 'good');
    },
  });
}

// ---------------------------------------------------------------- shared

/** The add-a-cost dialog. Used by the owner's Accounts screen and by a
 *  staff member's, so the two can never drift apart. */
function addCost(after) {
  openSheet({
    title: 'Add a cost',
    body: `
      <div class="field-row">
        <div class="field"><label>Amount (\৳)</label><input id="e-amt" type="number" min="1" autofocus></div>
        <div class="field"><label>Date</label><input id="e-date" type="date" value="${today()}"></div>
      </div>
      <div class="field"><label>What for</label>
        <select id="e-cat">${EXPENSE_CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Note</label><input id="e-note" placeholder="e.g. flowers for CDM-1003"></div>`,
    saveLabel: 'Add cost',
    onSave: async (root) => {
      const amount = Number($('#e-amt', root).value || 0);
      if (!amount) { toast('Enter an amount.', 'bad'); return false; }
      await api('/admin/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          amount,
          date: $('#e-date', root).value,
          category: $('#e-cat', root).value,
          note: $('#e-note', root).value,
        }),
      });
      await refresh();
      after();
      toast('Cost added', 'good');
    },
  });
}

function currentView() {
  const active = $('.nav-item.is-active');
  return active ? active.dataset.view : 'dashboard';
}

// ================================================================ ACCOUNTS

function renderAccounts() {
  const el = $('#view-accounts');
  const t = state.summary.totals;

  // Every payment across every booking, newest first — the income ledger.
  const income = [];
  for (const b of state.bookings) {
    for (const p of b.payments || []) {
      income.push({ ...p, bookingId: b.id, who: b.name, packageName: b.packageName });
    }
  }
  income.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const dueList = state.bookings
    .filter((b) => b.status !== 'cancelled' && b.due > 0)
    .sort((a, b) => b.due - a.due);

  el.innerHTML = `
    <div class="grid grid-stats" style="margin-bottom:18px">
      <div class="stat is-good"><div class="stat-label">Total received</div><div class="stat-value">${tk(t.received)}</div></div>
      <div class="stat"><div class="stat-label">Total spent</div><div class="stat-value">${tk(t.spent)}</div></div>
      <div class="stat ${t.profit >= 0 ? 'is-good' : 'is-bad'}"><div class="stat-label">Profit</div><div class="stat-value">${tk(t.profit)}</div><div class="stat-note">received minus spent</div></div>
      <div class="stat is-warn"><div class="stat-label">Still to collect</div><div class="stat-value">${tk(t.due)}</div><div class="stat-note">${dueList.length} booking${dueList.length === 1 ? '' : 's'}</div></div>
    </div>

    ${dueList.length ? `
    <div class="card" style="margin-bottom:18px">
      <div class="card-pad" style="border-bottom:1px solid var(--line)"><h2 class="section-title" style="margin:0">Money still owed</h2></div>
      <div class="tablewrap"><table class="tbl">
        <thead><tr><th>Booking</th><th>Customer</th><th>Event</th><th class="num">Price</th><th class="num">Paid</th><th class="num">Due</th></tr></thead>
        <tbody>${dueList.map((b) => `
          <tr class="row-link" data-id="${esc(b.id)}">
            <td><strong>${esc(b.id)}</strong></td>
            <td>${esc(b.name)}<br><span style="font-size:11.5px;color:var(--muted)">${esc(b.phone)}</span></td>
            <td>${esc(humanDate(b.eventDate) || '—')}</td>
            <td class="num">${tk(b.price)}</td>
            <td class="num">${tk(b.paid)}</td>
            <td class="num" style="color:var(--warn);font-weight:700">${tk(b.due)}</td>
          </tr>`).join('')}
        </tbody></table></div>
    </div>` : ''}

    <div class="grid grid-2">
      <div class="card">
        <div class="card-pad" style="border-bottom:1px solid var(--line)"><h2 class="section-title" style="margin:0">Money in</h2></div>
        ${income.length ? `<div class="tablewrap"><table class="tbl">
          <thead><tr><th>Date</th><th>From</th><th class="num">Amount</th></tr></thead>
          <tbody>${income.slice(0, 40).map((p) => `
            <tr><td>${esc(humanDate(p.date))}<br><span style="font-size:11.5px;color:var(--muted)">${esc(p.method)}</span></td>
                <td>${esc(p.who)}<br><span style="font-size:11.5px;color:var(--muted)">${esc(p.bookingId)}${p.packageName ? ' · ' + esc(p.packageName) : ''}</span></td>
                <td class="num" style="color:var(--good);font-weight:700">+${tk(p.amount)}</td></tr>`).join('')}
          </tbody></table></div>`
          : `<div class="empty"><strong>No payments yet</strong>Record a payment inside a booking and it appears here.</div>`}
      </div>

      <div class="card">
        <div class="card-pad" style="display:flex;align-items:center;border-bottom:1px solid var(--line)">
          <h2 class="section-title" style="margin:0">Money out</h2>
          <button class="btn btn-sm btn-primary" style="margin-left:auto" id="ex-add">+ Add cost</button>
        </div>
        ${state.expenses.length ? `<div class="tablewrap"><table class="tbl">
          <thead><tr><th>Date</th><th>What for</th><th class="num">Amount</th><th></th></tr></thead>
          <tbody>${state.expenses.slice(0, 40).map((e) => `
            <tr><td>${esc(humanDate(e.date))}</td>
                <td>${esc(e.category)}${e.note ? `<br><span style="font-size:11.5px;color:var(--muted)">${esc(e.note)}</span>` : ''}${e.byName ? `<br><span style="font-size:11px;color:var(--muted)">by ${esc(e.byName)}</span>` : ''}</td>
                <td class="num" style="color:var(--bad);font-weight:700">−${tk(e.amount)}</td>
                <td class="num"><button class="btn btn-sm btn-ghost" data-ex="${esc(e.id)}">Remove</button></td></tr>`).join('')}
          </tbody></table></div>`
          : `<div class="empty"><strong>No costs recorded</strong>Add what you spend so the profit figure is real.</div>`}
      </div>
    </div>`;

  wireBookingRows(el);

  $('#ex-add', el).addEventListener('click', () => addCost(renderAccounts));

  $$('[data-ex]', el).forEach((btn) => btn.addEventListener('click', async () => {
    const ok = await confirmDialog('Remove this cost from your accounts?', 'Remove');
    if (!ok) return;
    try {
      await api('/admin/api/expenses/' + encodeURIComponent(btn.dataset.ex), { method: 'DELETE' });
      await refresh();
      renderAccounts();
      toast('Removed', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  }));
}

// Exposed so content.js can raise a toast and reuse the dialog.
window.Admin = { toast, api, openSheet, confirmDialog, esc, $, $$, isOwner };

boot();

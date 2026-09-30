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
  threads: [],
  chatUnread: 0,
  openThread: null,
  perms: {},
  permList: [],
  changes: [],
  pendingChanges: 0,
  teamChat: [],
  salaries: null,
  bin: [],
  cash: null,
  filter: { status: 'all', q: '' },
};

// Management: the owner and a super admin. They see and do the same
// things, with one exception below.
const isOwner = () => state.role === 'owner' || state.role === 'super';

// The main admin alone: the one who signs in with the key at /admin. Only
// they see the recycle bin, because it holds the last copy of anything
// deleted and putting that back should need the person whose business it is.
const isMainAdmin = () => state.role === 'owner';

/** What this account may do. The owner may do everything; a staff member
 *  only what the owner ticked for them. Checked on the server too \u2014 this
 *  is for what to draw, not for what to allow. */
const may = (id) => isOwner() || state.perms[id] === true;

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
const atTeamDoor = location.pathname.indexOf('/team') === 0;
let staffMode = atTeamDoor;

(function setDoor() {
  $('#login-switch').hidden = true;
  if (atTeamDoor) {
    $('#email-row').hidden = false;
    $('#password-label').textContent = 'Your password';
    $('.login-card h1').textContent = 'Team sign in';
    document.title = "Team \u2014 Cox's Dream Moment";
  }
})();

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

  // Before anything is drawn: a screen built and then removed is a screen
  // somebody saw.
  try {
    const p = await api('/admin/api/permissions');
    state.perms = p.mine || {};
    state.permList = p.list || [];
  } catch (e) {
    state.perms = {};
  }

  $('#login').hidden = true;
  $('#app').hidden = false;

  // Owner-only entries are removed from the sidebar for staff rather than
  // greyed out: a disabled button still tells them what they are missing.
  $('#app').classList.toggle('is-staff', !isOwner());
  $('#app').classList.toggle('is-main-admin', isMainAdmin());

  // Entries the account cannot use are removed, not greyed out: a disabled
  // button still tells somebody what they are missing.
  $$('.nav-item[data-perm]').forEach((btn) => {
    btn.hidden = !may(btn.dataset.perm);
  });
  $('#who').textContent = isMainAdmin()
    ? "Cox's Dream Moment"
    : `${state.name || 'Team member'}${state.role === 'super' ? ' \u00b7 super admin' : ''}`;

  await refresh();
  go('dashboard');
  drawPushToggle();
}

/** Pulls everything the dashboard and lists read. One call site, so a
 *  screen can never render against half-stale data. */
async function refresh() {
  const expenses = await api('/admin/api/expenses');
  state.expenses = expenses.expenses || [];

  try {
    state.cash = await api('/admin/api/cash');
  } catch (e) {
    state.cash = null;
  }

  if (may('chat')) {
    const chats = await api('/admin/api/chats');
    state.threads = chats.threads || [];
    state.chatUnread = chats.unread || 0;
  } else {
    state.threads = [];
    state.chatUnread = 0;
  }
  $('#nav-chat').hidden = !may('chat');

  const chatBadge = $('#nav-chat');
  chatBadge.textContent = state.chatUnread;
  if (may('chat')) chatBadge.hidden = state.chatUnread === 0;

  try {
    const ch = await api('/admin/api/changes');
    state.changes = ch.changes || [];
    state.pendingChanges = ch.pending || 0;
  } catch (e) { /* staff without the permission simply have none */ }

  const approveBadge = $('#nav-approve');
  if (approveBadge) {
    approveBadge.textContent = state.pendingChanges;
    approveBadge.hidden = state.pendingChanges === 0;
  }

  if (!isOwner()) {
    // A staff session would be refused by these, and asking anyway would
    // log them out on the 401.
    state.staffSummary = await api('/admin/api/staff-summary');
    state.bookings = [];
    state.customers = state.customers || [];
    if (may('bookings_view')) {
      try { state.bookings = (await api('/admin/api/bookings')).bookings || []; } catch (e) { /* permission just removed */ }
    }
    const staffNew = $('#nav-new');
    const n = state.bookings.filter((b) => b.status === 'new').length;
    staffNew.textContent = n;
    staffNew.hidden = n === 0;
    return;
  }

  const [bookings, summary, staff, customers, bin] = await Promise.all([
    api('/admin/api/bookings'),
    api('/admin/api/summary'),
    api('/admin/api/staff'),
    api('/admin/api/customers'),
    isMainAdmin() ? api('/admin/api/bin') : Promise.resolve({ items: [] }),
  ]);
  state.bin = bin.items || [];

  const binBadge = $('#nav-bin');
  if (binBadge) {
    binBadge.textContent = state.bin.length;
    binBadge.hidden = state.bin.length === 0;
  }
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
  'team-chat': { title: 'Team chat', perm: 'team_chat', render: renderTeamChat },
  approvals: { title: 'Approvals', owner: true, render: renderApprovals },
  dashboard: { title: 'Dashboard', render: () => (isOwner() ? renderDashboard() : renderStaffHome()) },
  bookings: { title: 'Bookings', perm: 'bookings_view', render: renderBookings },
  accounts: { title: 'Accounts', render: () => (isOwner() ? renderAccounts() : renderStaffCosts()) },
  messages: { title: 'Messages', perm: 'chat', render: renderMessages },
  customers: { title: 'Customers', owner: true, render: renderCustomers },
  bin: { title: 'Recycle bin', mainAdmin: true, render: renderBin },
  team: { title: 'Team', owner: true, render: renderTeam },
  content: { title: 'Website content', owner: true, render: () => window.ContentEditor.mount($('#view-content')) },
};

let go = function (name) {
  let view = VIEWS[name] || VIEWS.dashboard;
  // Belt and braces: the sidebar already hides these, but a stale hash or a
  // stray call must not land a staff member on an empty owner screen.
  if (view.owner && !isOwner()) { name = 'dashboard'; view = VIEWS.dashboard; }
  if (view.mainAdmin && !isMainAdmin()) { name = 'dashboard'; view = VIEWS.dashboard; }
  if (view.perm && !may(view.perm)) { name = 'dashboard'; view = VIEWS.dashboard; }
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
function openSheet({ title, body, saveLabel, onSave, extraFoot, onDismiss }) {
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

  // A dismissal is reported by the buttons that cause one, not by the
  // dialog's own close event. Every sheet shares one <dialog>, so a close
  // event from the sheet before this one can arrive after this one has
  // opened \u2014 and a listener here would take it as the answer.
  let settled = false;
  const dismiss = () => {
    if (settled) return;
    settled = true;
    if (onDismiss) onDismiss();
  };

  $$('[data-close]', form).forEach((b) => b.addEventListener('click', () => {
    dismiss();
    dlg.close();
  }));

  // Escape closes a dialog without touching any button.
  dlg.oncancel = () => dismiss();
  const saveBtn = $('[data-save]', form);
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        const result = await onSave(bodyEl);
        if (result !== false) {
          settled = true;
          dlg.close();
        }
      } catch (e) {
        toast(e.message, 'bad');
      } finally {
        saveBtn.disabled = false;
      }
    });
  }
  dlg.showModal();
  // Tables inside a dialog need the same column names on a phone.
  if (typeof labelTableCells === 'function') labelTableCells(form);
  return { dialog: dlg, body: bodyEl };
}

/** Asks yes or no. Answered only by a button press or Escape \u2014 never by
 *  a stray close event from the sheet that was open before it, which is
 *  what made Delete on a booking do nothing: the editor's own close arrived
 *  after this opened and was read as "Cancel". */
function confirmDialog(message, confirmLabel) {
  return new Promise((resolve) => {
    openSheet({
      title: 'Are you sure?',
      body: `<p style="margin:0;line-height:1.55">${esc(message)}</p>`,
      saveLabel: confirmLabel || 'Delete',
      onSave: () => { resolve(true); return true; },
      onDismiss: () => resolve(false),
    });
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
  const money = may('bookings_money');
  return `<div class="tablewrap"><table class="tbl">
    <thead><tr>
      <th>Booking</th><th>Customer</th><th>Package</th><th>Date</th>
      ${money ? '<th class="num">Price</th><th class="num">Paid</th><th class="num">Due</th>' : ''}<th>Status</th>
    </tr></thead>
    <tbody>${list.map((b) => `
      <tr class="row-link" data-id="${esc(b.id)}">
        <td><strong>${esc(b.id)}</strong><br><span style="font-size:11.5px;color:var(--muted)">${esc(b.source === 'manual' ? 'Entered by you' : 'From website')}</span></td>
        <td>${esc(b.name)}<br><span style="font-size:11.5px;color:var(--muted)">${esc(b.phone)}</span></td>
        <td>${esc(b.packageName || '—')}</td>
        <td>${esc(humanDate(b.eventDate) || '—')}<br><span style="font-size:11.5px;color:var(--muted)">${esc(prettyTime(b.eventTime))}</span></td>
        ${money ? `<td class="num">${b.price ? tk(b.price) : '—'}</td>
        <td class="num">${b.paid ? tk(b.paid) : '—'}</td>
        <td class="num" style="${b.due ? 'color:var(--warn);font-weight:700' : ''}">${b.due ? tk(b.due) : '—'}</td>` : ''}
        <td>
          <span class="pill pill-${esc(b.status)}">${esc((STATUSES.find((s) => s.id === b.status) || {}).label || b.status)}</span>
          ${b.status === 'new' && isOwner() ? `<button class="btn btn-sm btn-primary" style="margin-left:8px" data-approve="${esc(b.id)}">Approve</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function wireBookingRows(root) {
  $$('.row-link', root).forEach((tr) => {
    tr.addEventListener('click', (e) => {
      // The Approve button lives inside the row; clicking it must not also
      // open the booking behind the dialog.
      if (e.target.closest('[data-approve]')) return;
      const booking = state.bookings.find((b) => b.id === tr.dataset.id);
      if (booking) editBooking(booking);
    });
  });

  $$('[data-approve]', root).forEach((btn) => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const booking = state.bookings.find((b) => b.id === btn.dataset.approve);
    if (booking) approveBooking(booking);
  }));
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

  if (!isOwner()) { $('#topbar-actions').innerHTML = ''; return; }
  $('#topbar-actions').innerHTML = '<button class="btn btn-primary" id="tb-add">+ New booking</button>';
  $('#tb-add').addEventListener('click', () => editBooking(null));
}

/** The booking editor. One dialog for both a new booking and an existing
 *  one — the fields are identical, and two near-copies would drift. */
async function editBooking(booking) {
  // Staff can look at a booking; changing a price is the owner's. Somebody
  // with `bookings_edit` proposes a change instead, which waits under
  // Approvals.
  if (booking && !isOwner()) return viewBooking(booking);

  // Prices come from the catalogue, which may not be loaded yet.
  try {
    if (window.ContentEditor && window.ContentEditor.ensureLoaded) await window.ContentEditor.ensureLoaded();
  } catch (e) { /* the dialog still works; it just cannot fill prices in */ }

  const isNew = !booking;
  const b = booking || {
    id: '', name: '', phone: '', email: '', packageSlug: '', packageName: '',
    eventDate: '', eventTime: '', people: '', occasion: '', note: '',
    status: 'new', price: 0, cost: 0, payments: [], adminNote: '', source: 'manual',
  };

  const packages = (window.ContentEditor && window.ContentEditor.packageList()) || [];
  const setups = packages.filter((p) => p.kind !== 'media');
  const media = packages.filter((p) => p.kind === 'media');
  // Whichever photography package this booking already carries.
  const chosenMedia = ((b.slugs || []).find((slug) => media.some((m) => m.slug === slug))) || '';
  const wa = waNumber(b.phone);

  // Someone with no email hears nothing automatically, so say so here rather
  // than letting the owner assume a confirmation went out.
  const account = state.customers.find((c) => c.id === b.customerId);
  const noEmail = !isNew && !(b.email || (account && account.email));


  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field-row">
      <div class="field"><label>Customer name</label><input id="f-name" value="${esc(b.name)}"></div>
      <div class="field"><label>Mobile number</label><input id="f-phone" value="${esc(b.phone)}"></div>
    </div>
    <div class="field"><label>Decoration package</label>
      <select id="f-package">
        <option value="">Not decided</option>
        ${setups.map((p) => `<option value="${esc(p.slug)}" ${b.packageSlug === p.slug ? 'selected' : ''}>
          ${esc(p.name)}${p.price ? ' — ' + tk(p.price) : ''}</option>`).join('')}
        ${b.packageName && !packages.some((p) => p.slug === b.packageSlug)
          ? `<option value="__keep" selected>${esc(b.packageName)}</option>` : ''}
      </select>
    </div>

    ${media.length ? `
      <div class="field"><label>Drone &amp; video <span style="text-transform:none;font-weight:600">(optional)</span></label>
        <select id="f-media">
          <option value="">None</option>
          ${media.map((p) => `<option value="${esc(p.slug)}" ${chosenMedia === p.slug ? 'selected' : ''}>
            ${esc(p.name)}${p.price ? ' — +' + tk(p.price) : ''}</option>`).join('')}
        </select>
      </div>` : ''}

    <div class="field-row">
      <div class="field"><label>Event date</label><input id="f-date" type="date" value="${esc(b.eventDate)}"></div>
      <div class="field"><label>Time</label>
        <input id="f-time" type="time" step="900" value="${esc(timeValue(b.eventTime))}">
        ${b.eventTime && !timeValue(b.eventTime)
          ? `<p class="hint" style="margin:6px 0 0">Was: ${esc(b.eventTime)}</p>` : ''}
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
      <div class="field"><label>List price (৳)</label>
        <input id="f-list" type="number" min="0" value="${esc(b.listPrice || b.price || 0)}">
        <p class="hint" style="margin:6px 0 0">What the packages cost normally.</p>
      </div>
      <div class="field"><label>Agreed price (৳)</label>
        <input id="f-price" type="number" min="0" value="${esc(b.price || 0)}">
        <p class="hint" style="margin:6px 0 0">What this customer actually pays.</p>
      </div>
    </div>

    <div class="deal-note" id="deal-note" hidden></div>

    <div class="field"><label>Why the discount</label>
      <input id="f-deal" value="${esc(b.dealNote || '')}" placeholder="e.g. friend of Shakib, repeat customer, low season">
      <p class="hint" style="margin:6px 0 0">
        Only needed when the agreed price is lower. Six weeks from now this is the only
        record of why.</p>
    </div>

    <div class="field"><label>Status</label>
      <select id="f-status">
        ${STATUSES.map((s) => `<option value="${s.id}" ${b.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
      </select>
    </div>

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
      <h3 class="section-title" style="margin-top:22px">Send a message</h3>
      <p class="hint" style="margin:-6px 0 10px">
        Emails this customer straight away. Nothing here changes the booking.</p>
      <div id="remind-row" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px"></div>
      <p class="hint" id="remind-note" style="margin:8px 0 0"></p>

      <h3 class="section-title" style="margin-top:22px">Payments</h3>
      <div id="pay-list"></div>
      <button type="button" class="btn btn-sm" id="pay-add">+ Record a payment</button>`}
  `;

  const extraFoot = isNew ? '' :
    `${b.status === 'new' ? '<button type="button" class="btn btn-sm btn-primary" data-approve-now>Approve &amp; notify</button>' : ''}
     ${wa ? `<a class="btn btn-sm ${noEmail ? 'btn-primary' : ''}" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
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
      const mediaSel = $('#f-media', root);
      const extra = mediaSel ? media.find((p) => p.slug === mediaSel.value) : null;

      const names = [
        sel.value === '__keep' ? b.packageName : (pkg ? pkg.name : ''),
        extra ? extra.name : '',
      ].filter(Boolean);

      const payload = {
        name: $('#f-name', root).value,
        phone: $('#f-phone', root).value,
        packageSlug: slug === '__keep' ? b.packageSlug : slug,
        packageName: names.join(' + '),
        slugs: [slug, extra ? extra.slug : ''].filter((x) => x && x !== '__keep'),
        eventDate: $('#f-date', root).value,
        eventTime: $('#f-time', root).value,
        people: $('#f-people', root).value,
        occasion: $('#f-occasion', root).value,
        note: $('#f-note', root).value,
        email: $('#f-email', root).value.trim(),
        adminNote: $('#f-adminnote', root).value,
        price: $('#f-price', root).value,
        listPrice: $('#f-list', root).value,
        dealNote: $('#f-deal', root).value,
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
            <td>${p.heldByName
                  ? (p.transferredAt
                      ? `<span class="pill pill-completed">With you</span>`
                      : `<span class="pill pill-confirmed">${esc(p.heldByName)} holds it</span>`)
                  : ''}</td>
            <td class="num"><strong>${tk(p.amount)}</strong></td>
            <td class="num">
              ${p.id && !p.transferredAt && p.heldById
                ? `<button type="button" class="btn btn-sm" data-handover="${esc(p.id)}">Handed over</button>` : ''}
              <button type="button" class="btn btn-sm btn-ghost" data-rm="${i}">Remove</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <p class="hint" style="margin-top:10px">Paid ${tk(paid)}${price ? ` of ${tk(price)} — ${tk(Math.max(price - paid, 0))} still due` : ''}.</p>`
      : '<p class="hint" style="margin:0 0 10px">No payment recorded yet.</p>';

    $$('[data-rm]', wrap).forEach((btn) => btn.addEventListener('click', () => {
      draftPayments.splice(Number(btn.dataset.rm), 1);
      drawPayments();
    }));

    // Cash a member of the team took, now handed to management. Saved at
    // once rather than with the rest of the form: it is a fact about money
    // changing hands, not a draft.
    $$('[data-handover]', wrap).forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api(`/admin/api/bookings/${encodeURIComponent(b.id)}/payments/${encodeURIComponent(btn.dataset.handover)}/transfer`,
          { method: 'POST' });
        const payment = draftPayments.find((p) => p.id === btn.dataset.handover);
        if (payment) payment.transferredAt = new Date().toISOString();
        drawPayments();
        await refresh();
        toast('Marked as handed over', 'good');
      } catch (e) {
        btn.disabled = false;
        toast(e.message, 'bad');
      }
    }));
  }

  // Picking a package fills the price in. The owner only has to set the
  // date and the time, and change the figure only if a different one was
  // agreed.
  function fillPrice() {
    const setup = setups.find((p) => p.slug === $('#f-package', body).value);
    const mediaSel = $('#f-media', body);
    const extra = mediaSel ? media.find((p) => p.slug === mediaSel.value) : null;
    const total = (setup ? setup.price : 0) + (extra ? extra.price : 0);
    if (!total) return;

    const list = $('#f-list', body);
    const agreed = $('#f-price', body);
    // The agreed figure follows too, unless somebody has already typed a
    // different one — that is a deal, and a deal is not overwritten.
    const agreedWasList = Number(agreed.value || 0) === Number(list.value || 0) || !Number(agreed.value || 0);
    list.value = total;
    if (agreedWasList) agreed.value = total;
    drawDeal();
  }
  $('#f-package', body).addEventListener('change', fillPrice);
  const mediaPick = $('#f-media', body);
  if (mediaPick) mediaPick.addEventListener('change', fillPrice);
  // A brand-new booking starts with the figure already in.
  if (isNew) fillPrice();

  // The discount, worked out as you type. Two boxes are easy to get wrong,
  // and the gap between them is the number that actually matters.
  function drawDeal() {
    const box = $('#deal-note', body);
    if (!box) return;
    const list = Number($('#f-list', body).value || 0);
    const agreed = Number($('#f-price', body).value || 0);

    if (!list || !agreed || agreed >= list) { box.hidden = true; return; }

    const off = list - agreed;
    const pct = Math.round((off / list) * 100);
    box.hidden = false;
    box.innerHTML =
      `<strong>${tk(off)} off</strong> \u2014 ${pct}% below the list price. ` +
      `The accounts will use ${tk(agreed)}.`;
  }
  ['f-list', 'f-price'].forEach((id) => {
    const field = $('#' + id, body);
    if (field) field.addEventListener('input', drawDeal);
  });
  drawDeal();

  if (!isNew) {
    // The reminder buttons. Loaded from the server so the wording lives in
    // one place rather than being duplicated here.
    api('/admin/api/reminders').then(({ reminders, mailReady }) => {
      const row = $('#remind-row', body);
      if (!row) return;
      row.innerHTML = reminders
        .map((r) => `<button type="button" class="btn btn-sm" data-remind="${esc(r.id)}">${esc(r.label)}</button>`)
        .join('');

      const note = $('#remind-note', body);
      if (!mailReady) note.textContent = 'Email is not switched on yet, so these will not send.';
      else if (!b.email) note.textContent = 'This customer gave no email address, so use WhatsApp instead.';

      $$('[data-remind]', row).forEach((btn) => btn.addEventListener('click', async () => {
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Sending\u2026';
        try {
          const r = await api(`/admin/api/bookings/${encodeURIComponent(b.id)}/remind`, {
            method: 'POST', body: JSON.stringify({ kind: btn.dataset.remind }),
          });
          toast(r.sent ? 'Email sent' : `Not sent \u2014 ${r.reason}`, r.sent ? 'good' : 'bad');
        } catch (e) {
          toast(e.message, 'bad');
        } finally {
          btn.disabled = false;
          btn.textContent = original;
        }
      }));
    }).catch(() => {});

    const approveNow = $('[data-approve-now]');
    if (approveNow) {
      approveNow.addEventListener('click', () => {
        // Carry whatever price is on screen into the approval, so a figure
        // just typed is not lost when the dialog changes.
        const typed = Number($('#f-price', body).value || 0);
        sheet.dialog.close();
        approveBooking(Object.assign({}, b, { price: typed || b.price }));
      });
    }

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
      const ok = await confirmDialog(
        `Remove booking ${b.id} for ${b.name}? It goes to the recycle bin, and can be put back from there.`,
        'Remove');
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

/** What a team member sees instead of the dashboard: their own money and
 *  nothing else. What they spent, what they took, and what they are still
 *  holding \u2014 enough to check their own work without being shown the
 *  business's takings to do it. */
async function renderStaffHome() {
  const el = $('#view-dashboard');
  el.innerHTML = '<div class="empty">Loading\u2026</div>';

  let data;
  try {
    data = await api('/admin/api/my-ledger');
  } catch (e) {
    el.innerHTML = `<div class="empty"><strong>Could not load</strong>${esc(e.message)}</div>`;
    return;
  }
  const t = data.totals;

  el.innerHTML = `
    <div class="card card-pad" style="margin-bottom:16px">
      <h2 class="section-title" style="margin-bottom:4px">Hello${state.name ? ', ' + esc(state.name) : ''}</h2>
      <p class="hint" style="margin:0">Your own record. Nobody else's figures are shown here.</p>
    </div>

    <div class="grid grid-stats" style="margin-bottom:16px">
      <div class="stat ${t.holding ? 'is-warn' : ''}"><div class="stat-label">You are holding</div>
        <div class="stat-value">${tk(t.holding)}</div>
        <div class="stat-note">not handed over yet</div></div>
      <div class="stat is-good"><div class="stat-label">Taken this month</div>
        <div class="stat-value">${tk(t.collectedThisMonth)}</div>
        <div class="stat-note">${tk(t.collected)} in total</div></div>
      <div class="stat"><div class="stat-label">Spent this month</div>
        <div class="stat-value">${tk(t.spentThisMonth)}</div>
        <div class="stat-note">${tk(t.spent)} in total</div></div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      ${may('costs_add') ? '<button class="btn btn-primary" id="sh-pay">+ Payment received</button>' : ''}
      ${may('costs_add') ? '<button class="btn" id="sh-cost">+ Cost</button>' : ''}
      ${may('chat') ? `<button class="btn" data-go="messages">Messages${state.chatUnread ? ' (' + state.chatUnread + ')' : ''}</button>` : ''}
      ${may('bookings_view') ? '<button class="btn" data-go="bookings">Bookings</button>' : ''}
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-pad" style="border-bottom:1px solid var(--line)">
        <h2 class="section-title" style="margin:0">Money you took</h2>
      </div>
      ${data.taken.length ? `<div class="tablewrap"><table class="tbl">
        <thead><tr><th>Date</th><th>From</th><th>Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>${data.taken.map((p) => `
          <tr>
            <td>${esc(humanDate(p.date))}</td>
            <td>${esc(p.customer)}<br><span style="font-size:11.5px;color:var(--muted)">${esc(p.bookingId)} \u00b7 ${esc(p.method)}</span></td>
            <td class="num"><strong>${tk(p.amount)}</strong></td>
            <td>${p.transferredAt
                  ? '<span class="pill pill-completed">Handed over</span>'
                  : '<span class="pill pill-confirmed">With you</span>'}</td>
            <td class="num" style="white-space:nowrap">
              ${p.transferredAt ? '' : `
                <button class="btn btn-sm" data-edit-pay="${esc(p.paymentId)}" data-bk="${esc(p.bookingId)}">Edit</button>
                <button class="btn btn-sm btn-primary" data-cash="${esc(p.bookingId)}" data-pid="${esc(p.paymentId)}">Handed over</button>`}
            </td>
          </tr>`).join('')}
        </tbody></table></div>`
        : '<div class="empty"><strong>Nothing yet</strong>Money you take from a customer shows here.</div>'}
    </div>

    <div class="card">
      <div class="card-pad" style="border-bottom:1px solid var(--line)">
        <h2 class="section-title" style="margin:0">What you spent</h2>
      </div>
      ${data.costs.length ? `<div class="tablewrap"><table class="tbl">
        <thead><tr><th>Date</th><th>What for</th><th>Amount</th><th></th></tr></thead>
        <tbody>${data.costs.map((e) => `
          <tr>
            <td>${esc(humanDate(e.date))}</td>
            <td>${esc(e.category)}${e.note ? `<br><span style="font-size:11.5px;color:var(--muted)">${esc(e.note)}</span>` : ''}
              ${e.editedAt ? `<br><span style="font-size:11px;color:var(--muted)">edited ${esc(relativeTime(e.editedAt))}</span>` : ''}</td>
            <td class="num"><strong>${tk(e.amount)}</strong></td>
            <td class="num"><button class="btn btn-sm" data-edit-cost="${esc(e.id)}">Edit</button></td>
          </tr>`).join('')}
        </tbody></table></div>`
        : '<div class="empty"><strong>Nothing yet</strong>What you spend on the job shows here.</div>'}
    </div>`;

  $$('[data-go]', el).forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  const again = () => { refresh().then(renderStaffHome); };

  const pay = $('#sh-pay', el);
  if (pay) pay.addEventListener('click', () => addPayment(again));
  const cost = $('#sh-cost', el);
  if (cost) cost.addEventListener('click', () => addCost(again));

  $$('[data-edit-cost]', el).forEach((b) => b.addEventListener('click', () => {
    const e = data.costs.find((c) => c.id === b.dataset.editCost);
    if (e) editCost(e, again);
  }));
  $$('[data-edit-pay]', el).forEach((b) => b.addEventListener('click', () => {
    const p = data.taken.find((x) => x.paymentId === b.dataset.editPay);
    if (p) editPayment(p.bookingId, { id: p.paymentId, amount: p.amount, date: p.date, method: p.method, note: p.note }, again);
  }));

  wireCash(again);
  labelTableCells(el);
  $('#topbar-actions').innerHTML = '';
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
    </div>

    ${cashHTML()}`;

  $('#ex-add', el).addEventListener('click', () => addCost(renderStaffCosts));
  wireCash(renderStaffCosts);
  $('#topbar-actions').innerHTML = '';
}

// ================================================================ MESSAGES
//
// A list of conversations on the left, the open one on the right. Everyone
// who works here can answer: a customer asking whether a date is free should
// not have to wait for the owner to be free.

function renderMessages() {
  const el = $('#view-messages');
  const list = state.threads;

  el.innerHTML = `
    <div class="chat-wrap">
      <div class="chat-list">
        ${list.length ? list.map((t) => `
          <button class="chat-row ${state.openThread === t.customerId ? 'is-open' : ''}" data-thread="${esc(t.customerId)}">
            <span class="cr-top">
              <strong>${esc(t.name)}</strong>
              ${t.unread ? `<span class="cr-dot">${t.unread}</span>` : ''}
            </span>
            <span class="cr-preview">${t.lastFrom === 'team' ? 'You: ' : ''}${esc(t.preview)}</span>
            <span class="cr-when">${esc(relativeTime(t.lastAt))}</span>
          </button>`).join('')
          : '<div class="empty"><strong>No messages yet</strong>When a customer writes from the website, it lands here.</div>'}
      </div>
      <div class="chat-panel" id="chat-panel">
        <div class="empty"><strong>Pick a conversation</strong>Choose someone on the left to read and answer.</div>
      </div>
    </div>`;

  $$('[data-thread]', el).forEach((b) => b.addEventListener('click', () => openThread(b.dataset.thread)));
  if (state.openThread && list.some((t) => t.customerId === state.openThread)) openThread(state.openThread);

  $('#topbar-actions').innerHTML = state.mailReady || !isOwner() ? ''
    : '<span class="hint" style="margin:0;align-self:center">Email is off — replies will not be emailed</span>';
}

/** "3 minutes ago" rather than an ISO string: on this screen the only thing
 *  that matters about a time is how long someone has been waiting. */
function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  if (isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  const days = Math.round(hours / 24);
  if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
  return humanDate(iso);
}

async function openThread(customerId) {
  state.openThread = customerId;
  $$('[data-thread]').forEach((b) => b.classList.toggle('is-open', b.dataset.thread === customerId));

  const panel = $('#chat-panel');
  panel.innerHTML = '<div class="empty">Loading…</div>';

  let data;
  try {
    data = await api('/admin/api/chats/' + encodeURIComponent(customerId));
  } catch (e) {
    panel.innerHTML = `<div class="empty"><strong>Could not load</strong>${esc(e.message)}</div>`;
    return;
  }

  const wa = waNumber(data.phone);
  panel.innerHTML = `
    <div class="chat-head">
      <div>
        <strong>${esc(data.name)}</strong>
        <span>${esc(data.phone || data.email || '')}</span>
      </div>
      ${wa ? `<a class="btn btn-sm" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      ${isOwner() ? '<button class="btn btn-sm btn-danger" id="chat-wipe">Delete</button>' : ''}
    </div>
    <div class="chat-log" id="chat-log">
      ${data.messages.map(bubble).join('') ||
        '<div class="empty" style="padding:28px 16px">Nothing said yet.</div>'}
    </div>
    <form class="chat-form" id="chat-form">
      <label class="btn btn-sm" style="align-self:flex-end;margin:0" title="Send a photo">
        \ud83d\udcf7<input type="file" id="chat-photo" accept="image/jpeg,image/png,image/webp" hidden>
      </label>
      <textarea id="chat-text" rows="2" placeholder="Write a reply…"></textarea>
      <button class="btn btn-primary" type="submit" id="chat-send">Send</button>
    </form>
    <p class="hint" id="chat-photo-note" style="padding:0 16px;margin:0"></p>
    <p class="hint" style="padding:0 16px 14px;margin:0">
      ${data.email ? 'They get this on the website and by email.' : 'They gave no email address, so this shows on the website only.'}
    </p>`;

  const log = $('#chat-log');
  log.scrollTop = log.scrollHeight;

  // Deleting a conversation is the owner's alone. A chat is the record of
  // what was promised to a customer, and staff should not be able to make
  // an awkward one disappear.
  const wipe = $('#chat-wipe');
  if (wipe) wipe.addEventListener('click', async () => {
    const ok = await confirmDialog(
      `Delete the whole conversation with ${data.name}? Every message goes, and it cannot be undone.`);
    if (!ok) return;
    try {
      await api('/admin/api/chats/' + encodeURIComponent(customerId), { method: 'DELETE' });
      state.openThread = null;
      await refresh();
      renderMessages();
      toast('Conversation deleted', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  });

  // One message at a time, for the mistyped one.
  const wireDeletes = () => {
    $$('[data-del-msg]').forEach((btn) => btn.addEventListener('click', async () => {
      const ok = await confirmDialog('Delete this message?', 'Delete');
      if (!ok) return;
      try {
        const r = await api(
          `/admin/api/chats/${encodeURIComponent(customerId)}/${encodeURIComponent(btn.dataset.delMsg)}`,
          { method: 'DELETE' });
        $('#chat-log').innerHTML = (r.messages || []).map(bubble).join('');
        wireDeletes();
        await refresh();
      } catch (e) { toast(e.message, 'bad'); }
    }));
  };
  wireDeletes();

  // Reading a thread clears its unread count, so the sidebar has to catch up.
  await refresh();
  $$('[data-thread]').forEach((b) => b.classList.toggle('is-open', b.dataset.thread === customerId));

  let chatPhoto = '';
  $('#chat-photo').addEventListener('change', async (e) => {
    const chosen = e.target.files && e.target.files[0];
    chatPhoto = '';
    const note = $('#chat-photo-note');
    if (!chosen) { note.textContent = ''; return; }
    note.textContent = 'Uploading…';
    try {
      const body = new FormData();
      body.append('receipt', chosen);
      const res = await fetch('/api/chat-photo', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      chatPhoto = data.file;
      note.textContent = 'Photo attached — press Send.';
    } catch (err) {
      note.textContent = err.message;
    } finally {
      e.target.value = '';
    }
  });

  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = $('#chat-text');
    const text = box.value.trim();
    if (!text && !chatPhoto) return;

    const send = $('#chat-send');
    send.disabled = true;
    try {
      const r = await api('/admin/api/chats/' + encodeURIComponent(customerId), {
        method: 'POST', body: JSON.stringify({ text, photo: chatPhoto }),
      });
      box.value = '';
      chatPhoto = '';
      $('#chat-photo-note').textContent = '';
      $('#chat-log').innerHTML = r.messages.map(bubble).join('');
      $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
      await refresh();
      $$('[data-thread]').forEach((b) => b.classList.toggle('is-open', b.dataset.thread === customerId));
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      send.disabled = false;
      box.focus();
    }
  });

  // Enter sends, shift+Enter makes a new line — what everyone expects.
  $('#chat-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#chat-form').requestSubmit();
    }
  });
}

function bubble(m) {
  const mine = m.from === 'team';
  return `<div class="msg ${mine ? 'mine' : 'theirs'}">
    ${isOwner() ? `<button class="msg-del" data-del-msg="${esc(m.id)}" title="Delete this message">\u00d7</button>` : ''}
    ${m.photo ? `<a href="/receipts/${encodeURIComponent(m.photo)}" target="_blank" rel="noopener" class="msg-photo">
      <img src="/receipts/${encodeURIComponent(m.photo)}" alt="Photo"></a>` : ''}
    ${m.text ? `<div class="msg-body">${esc(m.text)}</div>` : ''}
    <div class="msg-meta">${mine ? esc(m.byName) + ' · ' : ''}${esc(relativeTime(m.at))}</div>
  </div>`;
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
          <tr class="row-link" data-customer="${esc(c.id)}">
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

  $$('[data-customer]', el).forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('a,button')) return;
    openCustomer(tr.dataset.customer);
  }));

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

/** Everything about one customer in one place: their bookings, every taka
 *  that has come in from them, and what is still owed. The question this
 *  answers is "what is my history with this person", which is otherwise
 *  three screens and some arithmetic. */
async function openCustomer(id) {
  let data;
  try {
    data = await api('/admin/api/customers/' + encodeURIComponent(id));
  } catch (e) {
    toast(e.message, 'bad');
    return;
  }

  const c = data.customer;
  const t = data.totals;
  const wa = waNumber(c.phone);

  openSheet({
    title: c.name || 'Customer',
    body: `
      <p class="hint" style="margin:-4px 0 16px">
        ${esc(c.phone || 'no number')}${c.email ? ' \u00b7 ' + esc(c.email) : ''}
        ${c.createdAt ? ' \u00b7 since ' + esc(humanDate(c.createdAt)) : ''}
      </p>

      <div class="grid grid-stats" style="margin-bottom:18px">
        <div class="stat"><div class="stat-label">Booked</div><div class="stat-value">${tk(t.booked)}</div></div>
        <div class="stat is-good"><div class="stat-label">Paid</div><div class="stat-value">${tk(t.paid)}</div></div>
        <div class="stat ${t.due ? 'is-warn' : ''}"><div class="stat-label">Still owed</div><div class="stat-value">${tk(t.due)}</div></div>
        <div class="stat"><div class="stat-label">Spent on them</div><div class="stat-value">${tk(t.spent)}</div>
          <div class="stat-note">profit ${tk(t.profit)}</div></div>
      </div>

      <h3 class="section-title">Bookings (${data.bookings.length})</h3>
      ${data.bookings.length ? `<div class="tablewrap"><table class="tbl">
        <tbody>${data.bookings.map((b) => `
          <tr><td><strong>${esc(b.id)}</strong><br>
              <span style="font-size:11.5px;color:var(--muted)">${esc(b.packageName || '\u2014')}</span></td>
            <td>${esc(humanDate(b.eventDate) || '\u2014')}</td>
            <td class="num">${tk(b.price)}</td>
            <td><span class="pill pill-${esc(b.status)}">${esc((STATUSES.find((s) => s.id === b.status) || {}).label || b.status)}</span></td>
          </tr>`).join('')}
        </tbody></table></div>` : '<p class="hint" style="margin:0">No bookings yet.</p>'}

      <h3 class="section-title" style="margin-top:22px">Every movement</h3>
      ${data.ledger.length ? `<div class="tablewrap"><table class="tbl">
        <thead><tr><th>When</th><th>What</th><th class="num">Amount</th></tr></thead>
        <tbody>${data.ledger.map((row) => `
          <tr>
            <td>${esc(humanDate(row.at))}</td>
            <td>${row.kind === 'payment' ? 'Paid us' : 'Booked'} \u00b7 ${esc(row.bookingId)}
              <br><span style="font-size:11.5px;color:var(--muted)">${esc(row.label)}</span></td>
            <td class="num" style="${row.kind === 'payment' ? 'color:var(--good);font-weight:700' : ''}">
              ${row.kind === 'payment' ? '+' : ''}${tk(row.amount)}</td>
          </tr>`).join('')}
        </tbody></table></div>` : '<p class="hint" style="margin:0">Nothing recorded yet.</p>'}

      ${data.costs.length ? `
        <h3 class="section-title" style="margin-top:22px">What we spent on them</h3>
        <div class="tablewrap"><table class="tbl">
          <tbody>${data.costs.map((e) => `
            <tr><td>${esc(humanDate(e.date))}</td>
              <td>${esc(e.category)}${e.note ? ' \u00b7 ' + esc(e.note) : ''}</td>
              <td class="num" style="color:var(--bad)">\u2212${tk(e.amount)}</td></tr>`).join('')}
          </tbody></table></div>` : ''}

      <p class="hint" style="margin:18px 0 0">
        ${data.messages} message${data.messages === 1 ? '' : 's'} in their conversation.
      </p>`,
    extraFoot: `
      ${wa ? `<a class="btn btn-sm" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      <button type="button" class="btn btn-sm" data-open-chat="${esc(c.id)}">Open chat</button>`,
  });

  const chat = $('[data-open-chat]');
  if (chat) chat.addEventListener('click', () => {
    $('#sheet').close();
    go('messages');
    openThread(c.id);
  });
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

// ================================================================ TEAM CHAT
//
// One room for everyone who works here. Separate from the customer threads
// on purpose: this is where somebody says "running twenty minutes late" and
// nobody outside ever sees it.

let teamTimer = null;

function renderTeamChat() {
  const el = $('#view-team-chat');

  el.innerHTML = `
    <div class="card chat-panel" style="max-height:calc(100vh - 150px)">
      <div class="chat-head">
        <div>
          <strong>Team chat</strong>
          <span>Everyone who works here. Customers never see this.</span>
        </div>
      </div>
      <div class="chat-log" id="team-log"><div class="empty">Loading\u2026</div></div>
      <form class="chat-form" id="team-form">
        <label class="btn btn-sm" style="align-self:flex-end;margin:0" title="Send a photo">
          \ud83d\udcf7<input type="file" id="team-photo" accept="image/jpeg,image/png,image/webp" hidden>
        </label>
        <textarea id="team-text" rows="2" placeholder="Write to the team\u2026"></textarea>
        <button class="btn btn-primary" type="submit" id="team-send">Send</button>
      </form>
      <p class="hint" id="team-note" style="padding:0 16px 14px;margin:0"></p>
    </div>`;

  let photo = '';
  const note = $('#team-note', el);

  const draw = (messages) => {
    state.teamChat = messages;
    const log = $('#team-log', el);
    log.innerHTML = messages.length
      ? messages.map(teamBubble).join('')
      : '<div class="empty" style="padding:30px 16px">Nothing said yet. Say hello.</div>';
    log.scrollTop = log.scrollHeight;
  };

  const load = () => api('/admin/api/team-chat').then((d) => draw(d.messages || [])).catch(() => {});
  load();

  // Delegated: the log is redrawn every few seconds, so a handler bound to
  // each button would be lost on the next poll.
  $('#team-log', el).addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del-team]');
    if (!btn) return;
    const ok = await confirmDialog('Delete this message?', 'Delete');
    if (!ok) return;
    try {
      const r = await api('/admin/api/team-chat/' + encodeURIComponent(btn.dataset.delTeam), { method: 'DELETE' });
      draw(r.messages || []);
    } catch (err) { toast(err.message, 'bad'); }
  });

  // The room is only worth having if a message shows up while you are
  // looking at it.
  clearInterval(teamTimer);
  teamTimer = setInterval(() => {
    if (document.hidden || !$('#team-log')) { clearInterval(teamTimer); return; }
    load();
  }, 5000);

  $('#team-photo', el).addEventListener('change', async (e) => {
    const chosen = e.target.files && e.target.files[0];
    photo = '';
    if (!chosen) { note.textContent = ''; return; }
    note.textContent = 'Uploading\u2026';
    try {
      const body = new FormData();
      body.append('receipt', chosen);
      const res = await fetch('/api/chat-photo', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      photo = data.file;
      note.textContent = 'Photo attached \u2014 press Send.';
    } catch (err) {
      note.textContent = err.message;
    } finally {
      e.target.value = '';
    }
  });

  $('#team-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = $('#team-text', el);
    const text = box.value.trim();
    if (!text && !photo) return;

    const send = $('#team-send', el);
    send.disabled = true;
    try {
      const r = await api('/admin/api/team-chat', {
        method: 'POST', body: JSON.stringify({ text, photo }),
      });
      box.value = '';
      photo = '';
      note.textContent = '';
      draw(r.messages || []);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      send.disabled = false;
      box.focus();
    }
  });

  $('#team-text', el).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#team-form').requestSubmit(); }
  });

  $('#topbar-actions').innerHTML = '';
}

function teamBubble(m) {
  const mine = m.byName === state.name || (isOwner() && m.role === 'owner');
  return `<div class="msg ${mine ? 'mine' : 'theirs'}">
    ${isOwner() ? `<button class="msg-del" data-del-team="${esc(m.id)}" title="Delete this message">\u00d7</button>` : ''}
    ${m.photo ? `<a href="/receipts/${encodeURIComponent(m.photo)}" target="_blank" rel="noopener" class="msg-photo">
      <img src="/receipts/${encodeURIComponent(m.photo)}" alt="Photo"></a>` : ''}
    ${m.text ? `<div class="msg-body">${esc(m.text)}</div>` : ''}
    <div class="msg-meta">${esc(m.byName)}${m.role === 'owner' ? ' \u00b7 owner' : ''} \u00b7 ${esc(relativeTime(m.at))}</div>
  </div>`;
}

// ================================================================ APPROVALS
//
// Staff can propose a change to a booking or a cost; nothing moves until
// the owner says yes. The work gets done without anyone being able to
// quietly rewrite a price.

function renderApprovals() {
  const el = $('#view-approvals');
  const pending = state.changes.filter((c) => c.state === 'pending');
  const decided = state.changes.filter((c) => c.state !== 'pending').slice(0, 20);

  el.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="card-pad" style="border-bottom:1px solid var(--line)">
        <h2 class="section-title" style="margin:0">Waiting for you (${pending.length})</h2>
        <p class="hint" style="margin:6px 0 0">
          Changes your team has asked for. Nothing has happened to the booking yet.</p>
      </div>
      ${pending.length ? pending.map(changeRow).join('')
        : '<div class="empty"><strong>Nothing waiting</strong>When someone proposes a change it appears here.</div>'}
    </div>

    ${decided.length ? `
      <div class="card">
        <div class="card-pad" style="border-bottom:1px solid var(--line)">
          <h2 class="section-title" style="margin:0">Already decided</h2>
        </div>
        <div class="tablewrap"><table class="tbl">
          <thead><tr><th>What</th><th>Who</th><th>When</th><th>Outcome</th></tr></thead>
          <tbody>${decided.map((c) => `
            <tr>
              <td>${esc(c.targetId)}<br><span style="font-size:11.5px;color:var(--muted)">${esc(describeFields(c.fields))}</span></td>
              <td>${esc(c.byName)}</td>
              <td>${esc(relativeTime(c.decidedAt || c.at))}</td>
              <td><span class="pill ${c.state === 'approved' ? 'pill-completed' : 'pill-cancelled'}">${esc(c.state)}</span></td>
            </tr>`).join('')}
          </tbody></table></div>
      </div>` : ''}`;

  $$('[data-decide]', el).forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await api(`/admin/api/changes/${encodeURIComponent(btn.dataset.id)}/${btn.dataset.decide}`, { method: 'POST' });
      await refresh();
      renderApprovals();
      toast(btn.dataset.decide === 'approve' ? 'Applied' : 'Rejected', 'good');
    } catch (e) {
      btn.disabled = false;
      toast(e.message, 'bad');
    }
  }));

  $('#topbar-actions').innerHTML = '';
}

function changeRow(c) {
  return `<div class="card-pad" style="border-bottom:1px solid var(--line)">
    <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <strong>${esc(c.byName)}</strong>
        <span style="color:var(--muted)"> wants to change </span>
        <strong>${esc(c.targetId)}</strong>
        <div style="margin-top:8px;font-size:13.5px;line-height:1.7">${fieldsHTML(c.fields)}</div>
        ${c.reason ? `<p class="hint" style="margin:8px 0 0">\u201c${esc(c.reason)}\u201d</p>` : ''}
        <p class="hint" style="margin:6px 0 0">${esc(relativeTime(c.at))}</p>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-primary" data-decide="approve" data-id="${esc(c.id)}">Approve</button>
        <button class="btn btn-sm btn-danger" data-decide="reject" data-id="${esc(c.id)}">Reject</button>
      </div>
    </div>
  </div>`;
}

const FIELD_LABEL = {
  price: 'Price', eventDate: 'Date', eventTime: 'Time', people: 'People',
  occasion: 'Occasion', note: 'Customer note', adminNote: 'Private note',
  status: 'Status', amount: 'Amount', date: 'Date', category: 'What for',
};

function fieldsHTML(fields) {
  return Object.keys(fields).map((k) => {
    const value = fields[k];
    const shown = (k === 'price' || k === 'amount') ? tk(value) : String(value || '\u2014');
    return `<div><span style="color:var(--muted)">${esc(FIELD_LABEL[k] || k)}:</span> <strong>${esc(shown)}</strong></div>`;
  }).join('');
}

const describeFields = (fields) => Object.keys(fields).map((k) => FIELD_LABEL[k] || k).join(', ');

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
            <td><strong>${esc(u.name)}</strong>
              ${u.role === 'super' ? '<span class="role-tag">super admin</span>' : ''}
              ${u.phone ? `<br><span style="font-size:11.5px;color:var(--muted)">${esc(u.phone)}</span>` : ''}</td>
            <td>${esc(u.email)}</td>
            <td>
              <span class="pill ${u.active ? 'pill-completed' : 'pill-cancelled'}">${u.active ? 'Active' : 'Blocked'}</span>
              <div style="margin-top:5px;font-size:11px;color:var(--muted);line-height:1.5">${esc(summarisePerms(u))}</div>
            </td>
            <td class="num">
              <button class="btn btn-sm" data-edit="${esc(u.id)}">Edit</button>
              <button class="btn btn-sm btn-ghost" data-toggle="${esc(u.id)}">${u.active ? 'Block' : 'Unblock'}</button>
              <button class="btn btn-sm btn-danger" data-del="${esc(u.id)}">Remove</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div>`
        : `<div class="empty"><strong>No team members yet</strong>Add someone and they can record costs, answer messages and, if you allow it, see bookings.</div>`}
    </div>

    <div class="card card-pad" style="margin-top:14px">
      <h2 class="section-title">What a team member can do</h2>
      <p style="margin:0;line-height:1.7;font-size:13.5px">
        <strong>Yes:</strong> whatever you tick for them — record what they spend, answer messages,
        see bookings (which package, date and customer), and with a second tick the prices and what is owed.<br>
        <strong>No, ever:</strong> editing the website content (packages, prices, photos, site details) — that is
        the admin's alone — customers, income, profit, and removing a cost once it is saved.
      </p>
      <p class="hint" style="margin:10px 0 0">
        Everyone on the team signs in at <strong>coxsdreammoment.shop/team</strong> with
        their email <em>or</em> their mobile number, and the password you gave them.
        This page, at /admin, takes only your own key.</p>
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

/** A short sentence about what somebody can reach, for the Team list. The
 *  full set is behind Edit; this is only so the owner can glance down the
 *  column and spot the one with too much. */
function summarisePerms(user) {
  const perms = user.permissions || {};
  const on = state.permList.filter((p) => (user.permissions ? perms[p.id] === true : p.fallback));
  if (!on.length) return 'nothing yet';
  if (on.length === state.permList.length) return 'everything a staff account can';
  return on.map((p) => p.label.toLowerCase()).join(', ');
}

function staffForm(user) {
  const isNew = !user;
  openSheet({
    title: isNew ? 'Add a team member' : `Edit ${user.name}`,
    body: `
      <div class="field"><label>Name</label><input id="s-name" value="${esc(isNew ? '' : user.name)}"></div>
      ${isMainAdmin() ? `
        <div class="field"><label>Role</label>
          <select id="s-role">
            <option value="staff" ${!isNew && user.role === 'super' ? '' : 'selected'}>Team member \u2014 only what you tick below</option>
            <option value="super" ${!isNew && user.role === 'super' ? 'selected' : ''}>Super admin \u2014 everything except the recycle bin</option>
          </select>
          <p class="hint" style="margin:6px 0 0">Both sign in at <strong>coxsdreammoment.shop/team</strong>.</p>
        </div>` : ''}
      <div class="field-row">
        <div class="field"><label>Work email</label>
          <input id="s-email" type="email" value="${esc(isNew ? '' : user.email)}" ${isNew ? '' : 'disabled'}>
          ${isNew ? '' : '<p class="hint" style="margin:6px 0 0">The email cannot be changed — it is how they sign in.</p>'}
        </div>
        <div class="field"><label>Mobile</label><input id="s-phone" value="${esc(isNew ? '' : (user.phone || ''))}"
          placeholder="01XXXXXXXXX">
          <p class="hint" style="margin:6px 0 0">They can sign in with this or with the email.</p></div>
      </div>
      <div class="field">
        <label>${isNew ? 'Password' : 'New password'}</label>
        <input id="s-pass" type="text" placeholder="${isNew ? 'At least 8 characters' : 'Leave blank to keep the current one'}">
        <p class="hint" style="margin:6px 0 0">
          Shown as plain text on purpose — you have to read it out to them. Tell them in person or on WhatsApp, not by email.</p>
      </div>

      <h3 class="section-title" style="margin-top:22px">What they can do</h3>
      <p class="hint" style="margin:-6px 0 12px">
        Tick only what this person needs. “Staff” is not one job, and giving everybody
        everything is how nobody knows who changed what.</p>
      <div class="perm-list">
        ${state.permList.map((perm) => {
          const on = isNew ? perm.fallback : (user.permissions ? user.permissions[perm.id] === true : perm.fallback);
          return `<label class="perm-row">
            <input type="checkbox" data-perm-id="${esc(perm.id)}" ${on ? 'checked' : ''}>
            <span>${esc(perm.label)}</span>
          </label>`;
        }).join('')}
      </div>
      <p class="hint" style="margin:10px 0 0">
        A change to a booking or a cost is only ever a <strong>request</strong>. It waits for you
        under Approvals; nothing reaches the customer until you say yes.</p>`,
    saveLabel: isNew ? 'Create account' : 'Save',
    onSave: async (root) => {
      const permissions = {};
      $$('[data-perm-id]', root).forEach((box) => { permissions[box.dataset.permId] = box.checked; });

      const payload = {
        name: $('#s-name', root).value.trim(),
        phone: $('#s-phone', root).value.trim(),
        password: $('#s-pass', root).value,
        permissions,
      };
      const role = $('#s-role', root);
      if (role) payload.role = role.value;
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

/** Money a customer handed over that has not yet reached the business.
 *
 *  It arrives in somebody's pocket, not in an account, and until it is
 *  passed on that person is holding it. Two figures rather than one \u2014 what
 *  has been received, and how much of it is still out with the team \u2014
 *  because treating them as the same number is how a shortfall goes
 *  unnoticed for a month. */
function cashHTML() {
  const cash = state.cash;
  if (!cash || !cash.holders.length) return '';

  return `
    <div class="card" style="margin-bottom:18px">
      <div class="card-pad" style="border-bottom:1px solid var(--line)">
        <h2 class="section-title" style="margin:0">
          ${isOwner() ? 'Cash still with the team' : 'Cash you are holding'} \u2014 ${tk(cash.withTeam)}
        </h2>
        <p class="hint" style="margin:6px 0 0">
          ${isOwner()
            ? 'Received from customers but not yet handed over. Mark it once it reaches you.'
            : 'Money you have taken that has not reached the office yet. Mark it when you hand it over.'}
        </p>
      </div>
      <div class="tablewrap"><table class="tbl">
        <thead><tr><th>Who</th><th>From</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>${cash.holders.map((h) => h.items.map((item, i) => `
          <tr>
            ${i === 0 ? `<td rowspan="${h.items.length}"><strong>${esc(h.name)}</strong><br>
              <span style="font-size:11.5px;color:var(--muted)">${tk(h.amount)} in total</span></td>` : ''}
            <td>${esc(item.customer)}<br>
              <span style="font-size:11.5px;color:var(--muted)">${esc(item.bookingId)} \u00b7 ${esc(item.method)} \u00b7 ${esc(humanDate(item.date))}</span></td>
            <td class="num"><strong>${tk(item.amount)}</strong></td>
            <td class="num"><button class="btn btn-sm btn-primary"
              data-cash="${esc(item.bookingId)}" data-pid="${esc(item.paymentId)}">Handed over</button></td>
          </tr>`).join('')).join('')}
        </tbody></table></div>
    </div>`;
}

function wireCash(after) {
  $$('[data-cash]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await api(`/admin/api/bookings/${encodeURIComponent(btn.dataset.cash)}/payments/${encodeURIComponent(btn.dataset.pid)}/transfer`,
        { method: 'POST' });
      await refresh();
      after();
      toast('Marked as handed over', 'good');
    } catch (e) {
      btn.disabled = false;
      toast(e.message, 'bad');
    }
  }));
}

/** Fixes a cost that was typed wrong. A wrong figure that cannot be
 *  corrected is a wrong figure that stays in the accounts for ever. */
function editCost(e, after) {
  openSheet({
    title: 'Change this cost',
    body: `
      <div class="field-row">
        <div class="field"><label>Amount (\u09f3)</label><input id="ec-amt" type="number" min="1" value="${esc(e.amount)}"></div>
        <div class="field"><label>Date</label><input id="ec-date" type="date" value="${esc(e.date)}"></div>
      </div>
      <div class="field"><label>What for</label>
        <select id="ec-cat">${EXPENSE_CATEGORIES.map((c) =>
          `<option ${e.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Note</label><input id="ec-note" value="${esc(e.note || '')}"></div>
      <p class="hint" style="margin:0">The change is recorded with your name, so nobody wonders later who moved it.</p>`,
    saveLabel: 'Save',
    onSave: async (root) => {
      const amount = Number($('#ec-amt', root).value || 0);
      if (!amount) { toast('Enter an amount.', 'bad'); return false; }
      await api('/admin/api/expenses/' + encodeURIComponent(e.id), {
        method: 'PUT',
        body: JSON.stringify({
          amount,
          date: $('#ec-date', root).value,
          category: $('#ec-cat', root).value,
          note: $('#ec-note', root).value,
        }),
      });
      after();
      toast('Cost updated', 'good');
    },
  });
}

/** Fixes a payment recorded wrong \u2014 the figure, the day, the app. */
function editPayment(bookingId, p, after) {
  openSheet({
    title: 'Change this payment',
    body: `
      <div class="field-row">
        <div class="field"><label>Amount (\u09f3)</label><input id="ep-amt" type="number" min="1" value="${esc(p.amount)}"></div>
        <div class="field"><label>Date</label><input id="ep-date" type="date" value="${esc(p.date)}"></div>
      </div>
      <div class="field"><label>How</label>
        <select id="ep-method">${METHODS.map((m) => `<option ${p.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div class="field"><label>Note</label><input id="ep-note" value="${esc(p.note || '')}"></div>`,
    saveLabel: 'Save',
    onSave: async (root) => {
      const amount = Number($('#ep-amt', root).value || 0);
      if (!amount) { toast('Enter an amount.', 'bad'); return false; }
      await api(`/admin/api/bookings/${encodeURIComponent(bookingId)}/payments/${encodeURIComponent(p.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          amount,
          date: $('#ep-date', root).value,
          method: $('#ep-method', root).value,
          note: $('#ep-note', root).value,
        }),
      });
      after();
      toast('Payment updated', 'good');
    },
  });
}

/** Records money received. It goes onto the booking's own payment list
 *  rather than into a separate ledger: there is one record of what a
 *  customer has paid, and a second place to keep it would be a second place
 *  for it to be wrong. */
function addPayment(after) {
  const open = state.bookings.filter((b) => b.status !== 'cancelled');
  if (!open.length) { toast('No bookings to record a payment against.', 'bad'); return; }

  const owing = open.filter((b) => b.due > 0);
  const list = owing.length ? owing : open;

  openSheet({
    title: 'Record a payment',
    body: `
      <div class="field"><label>Which booking</label>
        <select id="pm-booking">
          ${list.map((b) => `<option value="${esc(b.id)}">
            ${esc(b.id)} \u2014 ${esc(b.name)}${b.due ? ' (' + tk(b.due) + ' due)' : ' (paid up)'}
          </option>`).join('')}
        </select>
        ${owing.length ? '' : '<p class="hint" style="margin:6px 0 0">Nothing is outstanding, so every booking is listed.</p>'}
      </div>
      <div class="field-row">
        <div class="field"><label>Amount (\u09f3)</label><input id="pm-amt" type="number" min="1" step="100"></div>
        <div class="field"><label>Date</label><input id="pm-date" type="date" value="${today()}"></div>
      </div>
      <div class="field"><label>How</label>
        <select id="pm-method">${METHODS.map((m) => `<option>${m}</option>`).join('')}</select></div>
      <div class="field"><label>Note</label><input id="pm-note" placeholder="e.g. advance, balance on the day"></div>
      <p class="hint" style="margin:0">The customer is emailed and notified, the same as any other payment.</p>`,
    saveLabel: 'Record payment',
    onSave: async (root) => {
      const amount = Number($('#pm-amt', root).value || 0);
      if (!amount) { toast('Enter an amount.', 'bad'); return false; }
      const id = $('#pm-booking', root).value;
      await api(`/admin/api/bookings/${encodeURIComponent(id)}/payment`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          date: $('#pm-date', root).value,
          method: $('#pm-method', root).value,
          note: $('#pm-note', root).value,
        }),
      });
      await refresh();
      after();
      toast('Payment recorded', 'good');
    },
  });
}

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
      <div class="field"><label>Note</label><input id="e-note" placeholder="e.g. flowers, van hire"></div>
      ${isOwner() && state.bookings.length ? `
        <div class="field"><label>For which booking <span style="text-transform:none;font-weight:600">(optional)</span></label>
          <select id="e-booking">
            <option value="">Not for one in particular</option>
            ${state.bookings.filter((b) => b.status !== 'cancelled').map((b) =>
              `<option value="${esc(b.id)}">${esc(b.id)} \u2014 ${esc(b.name)}</option>`).join('')}
          </select>
          <p class="hint" style="margin:6px 0 0">Tie it to a booking and it shows in that customer's profit.</p>
        </div>` : ''}`,
    saveLabel: 'Add cost',
    onSave: async (root) => {
      const amount = Number($('#e-amt', root).value || 0);
      if (!amount) { toast('Enter an amount.', 'bad'); return false; }
      const booking = $('#e-booking', root);
      await api('/admin/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          amount,
          date: $('#e-date', root).value,
          category: $('#e-cat', root).value,
          note: $('#e-note', root).value,
          bookingId: booking ? booking.value : '',
        }),
      });
      await refresh();
      after();
      toast('Cost added', 'good');
    },
  });
}

/** Approving is one decision — is this price right? — so it asks that and
 *  nothing else. The figure comes from the packages the customer chose, so
 *  most of the time it is already correct and this is one press. */
function approveBooking(booking) {
  openSheet({
    title: `Approve ${booking.id}`,
    body: `
      <p style="margin:0 0 16px;line-height:1.6">
        <strong>${esc(booking.name)}</strong> \u2014 ${esc(booking.packageName || 'no package chosen')}
        ${booking.eventDate ? '<br>' + esc(humanDate(booking.eventDate)) : ''}
      </p>
      <div class="field">
        <label>Agreed price (\u09f3)</label>
        <input id="ap-price" type="number" min="0" step="100" value="${esc(booking.price || '')}" autofocus>
        <p class="hint" style="margin:6px 0 0">
          ${booking.price
            ? 'Taken from the packages they chose. Change it if you agreed something else.'
            : 'Those packages have no published price, so put in what you agreed.'}
        </p>
      </div>
      <p class="hint" style="margin:0">
        ${booking.email
          ? 'Confirming emails <strong>' + esc(booking.email) + '</strong> straight away.'
          : 'They gave no email address, so tell them on WhatsApp \u2014 it will be waiting for you under Customers.'}
      </p>`,
    saveLabel: 'Approve & notify',
    onSave: async (root) => {
      const price = Number($('#ap-price', root).value || 0);
      if (!price) { toast('Put in the agreed price.', 'bad'); return false; }
      await api('/admin/api/bookings/' + encodeURIComponent(booking.id), {
        method: 'PUT', body: JSON.stringify({ price, status: 'confirmed' }),
      });
      await refresh();
      go(currentView());
      toast(booking.email ? 'Approved \u2014 confirmation emailed' : 'Approved \u2014 now tell them on WhatsApp', 'good');
    },
  });
}

/** A booking's time as HH:MM for a time field.
 *
 *  Old bookings carry words ("Sunset (5:00 PM – 6:00 PM)") from when the
 *  time was a choice of three. Those are read as the first clock time in
 *  them, so an old booking opens with something sensible in the field. */
function timeValue(stored) {
  if (!stored) return '';
  if (/^\d{2}:\d{2}$/.test(stored)) return stored;
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(stored);
  if (!m) return '';
  let h = Number(m[1]);
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + m[2];
}

/** 17:30 reads as 5:30 PM. The field stores the 24-hour form; people read
 *  the other one. */
function prettyTime(stored) {
  const t = timeValue(stored);
  if (!t) return stored || '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** A booking as staff see it: everything they need to do the job, nothing
 *  they could accidentally rewrite. */
function viewBooking(b) {
  const money = may('bookings_money');
  const canPropose = may('bookings_edit');

  const rows = [
    ['Customer', b.name],
    ['Mobile', b.phone],
    ['Package', b.packageName],
    ['Date', humanDate(b.eventDate)],
    ['Time', b.eventTime],
    ['People', b.people],
    ['Occasion', b.occasion],
    ['Status', (STATUSES.find((s) => s.id === b.status) || {}).label || b.status],
  ].filter(([, v]) => v);

  if (money) {
    rows.push(['Price', tk(b.price)], ['Paid', tk(b.paid)], ['Still due', tk(b.due)]);
  }

  const wa = waNumber(b.phone);
  openSheet({
    title: `${b.id} \u2014 ${b.name}`,
    body: `
      <div class="tablewrap"><table class="tbl"><tbody>
        ${rows.map(([k, v]) => `<tr><td style="color:var(--muted);width:110px">${esc(k)}</td>
          <td><strong>${esc(v)}</strong></td></tr>`).join('')}
      </tbody></table></div>
      ${b.note ? `<h3 class="section-title" style="margin-top:18px">What the customer wrote</h3>
        <p style="margin:0;line-height:1.6;white-space:pre-wrap">${esc(b.note)}</p>` : ''}
      ${money ? '' : '<p class="hint" style="margin:16px 0 0">Prices and payments are not shown on your account.</p>'}
      ${canPropose ? `
        <h3 class="section-title" style="margin-top:22px">Ask for a change</h3>
        <p class="hint" style="margin:-6px 0 12px">
          The owner sees this under Approvals. Nothing reaches the customer until they agree.</p>
        <div class="field-row">
          <div class="field"><label>Date</label><input id="rq-date" type="date" value="${esc(b.eventDate || '')}"></div>
          <div class="field"><label>Time</label><input id="rq-time" value="${esc(b.eventTime || '')}"></div>
        </div>
        <div class="field"><label>Why</label>
          <input id="rq-reason" placeholder="e.g. the customer rang and asked to move it"></div>
        <button type="button" class="btn btn-primary btn-sm" id="rq-send">Send the request</button>
        ` : ''}`,
    extraFoot: wa
      ? `<a class="btn btn-sm" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>`
      : '',
  });

  const send = $('#rq-send');
  if (!send) return;
  send.addEventListener('click', async () => {
    const fields = {};
    const date = $('#rq-date').value;
    const time = $('#rq-time').value.trim();
    if (date && date !== b.eventDate) fields.eventDate = date;
    if (time !== (b.eventTime || '')) fields.eventTime = time;
    if (!Object.keys(fields).length) { toast('Nothing changed.', 'bad'); return; }

    send.disabled = true;
    try {
      await api('/admin/api/changes', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'booking', targetId: b.id, fields, reason: $('#rq-reason').value.trim(),
        }),
      });
      $('#sheet').close();
      toast('Sent \u2014 the owner will see it under Approvals', 'good');
    } catch (e) {
      send.disabled = false;
      toast(e.message, 'bad');
    }
  });
}

// ================================================================ RECYCLE BIN
//
// Nothing is really gone on the first press. The person who deletes the
// wrong payment and the person who realises it are the same person, ten
// minutes apart.

const BIN_LABEL = { booking: 'Booking', expense: 'Cost', payment: 'Payment' };

function renderBin() {
  const el = $('#view-bin');
  const items = state.bin;

  el.innerHTML = `
    <div class="card">
      <div class="card-pad" style="display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line)">
        <div>
          <h2 class="section-title" style="margin:0">Deleted things (${items.length})</h2>
          <p class="hint" style="margin:6px 0 0">
            Put anything back, or throw it away for good. Only you can see this.</p>
        </div>
        ${items.length ? '<button class="btn btn-sm btn-danger" style="margin-left:auto" id="bin-empty">Empty the bin</button>' : ''}
      </div>
      ${items.length ? `<div class="tablewrap"><table class="tbl">
        <thead><tr><th>What</th><th>Deleted</th><th></th></tr></thead>
        <tbody>${items.map((i) => `
          <tr>
            <td><span class="pill pill-new">${esc(BIN_LABEL[i.kind] || i.kind)}</span>
              <strong style="margin-left:8px">${esc(i.label || i.payload.id || '')}</strong>
              ${binDetail(i)}</td>
            <td>${esc(relativeTime(i.at))}<br><span style="font-size:11.5px;color:var(--muted)">by ${esc(i.byName)}</span></td>
            <td class="num" style="white-space:nowrap">
              <button class="btn btn-sm btn-primary" data-restore="${esc(i.id)}">Put back</button>
              <button class="btn btn-sm btn-ghost" data-forget="${esc(i.id)}">Delete for good</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div>`
        : '<div class="empty"><strong>The bin is empty</strong>Anything you delete lands here first.</div>'}
    </div>`;

  $$('[data-restore]', el).forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api(`/admin/api/bin/${encodeURIComponent(b.dataset.restore)}/restore`, { method: 'POST' });
      await refresh();
      renderBin();
      toast('Put back', 'good');
    } catch (e) {
      b.disabled = false;
      toast(e.message, 'bad');
    }
  }));

  $$('[data-forget]', el).forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmDialog('Delete this for good? It cannot be brought back.');
    if (!ok) return;
    try {
      await api('/admin/api/bin/' + encodeURIComponent(b.dataset.forget), { method: 'DELETE' });
      await refresh();
      renderBin();
      toast('Gone', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  }));

  const empty = $('#bin-empty', el);
  if (empty) empty.addEventListener('click', async () => {
    const ok = await confirmDialog(`Empty the bin? All ${items.length} will be gone for good.`, 'Empty it');
    if (!ok) return;
    try {
      await api('/admin/api/bin', { method: 'DELETE' });
      await refresh();
      renderBin();
      toast('Bin emptied', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  });

  $('#topbar-actions').innerHTML = '';
}

function binDetail(item) {
  const p = item.payload || {};
  const bits = [];
  if (item.kind === 'booking') {
    if (p.packageName) bits.push(p.packageName);
    if (p.eventDate) bits.push(humanDate(p.eventDate));
    if (p.price) bits.push(tk(p.price));
  } else if (item.kind === 'expense') {
    if (p.note) bits.push(p.note);
    if (p.date) bits.push(humanDate(p.date));
  } else if (item.kind === 'payment') {
    if (p.method) bits.push(p.method);
    if (p.date) bits.push(humanDate(p.date));
    if (p.note) bits.push(p.note);
  }
  return bits.length
    ? `<br><span style="font-size:11.5px;color:var(--muted)">${esc(bits.join(' \u00b7 '))}</span>`
    : '';
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

    ${cashHTML()}

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
        <div class="card-pad" style="display:flex;align-items:center;border-bottom:1px solid var(--line)">
          <h2 class="section-title" style="margin:0">Money in</h2>
          <button class="btn btn-sm btn-primary" style="margin-left:auto" id="pay-add">+ Add payment</button>
        </div>
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
                <td class="num" style="white-space:nowrap">
                  <button class="btn btn-sm" data-edit-cost="${esc(e.id)}">Edit</button>
                  <button class="btn btn-sm btn-ghost" data-ex="${esc(e.id)}">Remove</button></td></tr>`).join('')}
          </tbody></table></div>`
          : `<div class="empty"><strong>No costs recorded</strong>Add what you spend so the profit figure is real.</div>`}
      </div>
    </div>`;

  wireBookingRows(el);
  wireCash(renderAccounts);

  $('#ex-add', el).addEventListener('click', () => addCost(renderAccounts));
  $('#pay-add', el).addEventListener('click', () => addPayment(renderAccounts));

  $$('[data-edit-cost]', el).forEach((b) => b.addEventListener('click', () => {
    const e = state.expenses.find((x) => x.id === b.dataset.editCost);
    if (e) editCost(e, () => refresh().then(renderAccounts));
  }));

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

// ---------------------------------------------------------------- notifications
//
// The reason to put this on a home screen: a booking reaches the owner's
// phone without anybody watching a screen.
//
// Permission is asked only when the button is pressed. A browser asked on
// page load remembers the refusal, and there is no second chance.

async function drawPushToggle() {
  const button = $('#push-toggle');
  if (!button || !window.CDMPush) return;

  const state = await window.CDMPush.state();

  const labels = {
    on: 'Notifications: on',
    off: 'Turn notifications on',
    blocked: 'Notifications blocked',
    unsupported: '',
  };
  button.textContent = labels[state] || '';
  button.hidden = !labels[state];
  button.style.color = state === 'on' ? '#7BD7A8' : '';

  button.onclick = async () => {
    if (state === 'blocked') {
      toast('Your browser is blocking them. Turn them back on in its site settings.', 'bad');
      return;
    }
    button.disabled = true;
    const result = state === 'on' ? await window.CDMPush.disable() : await window.CDMPush.enable();
    button.disabled = false;
    toast(result.message, result.ok ? 'good' : 'bad');
    drawPushToggle();

    // A switch that says "on" and then never rings is worse than no switch,
    // so it proves itself straight away.
    if (result.ok && state !== 'on') {
      try { await api('/admin/api/push-test', { method: 'POST' }); } catch (e) { /* the toast already said it worked */ }
    }
  };
}

/** Copies each table's column names onto its cells as data-label.
 *
 *  On a phone every table becomes a list of blocks, and a value with no
 *  name in front of it is a number floating on its own. Done here rather
 *  than written into every cell by hand, which would be forgotten the first
 *  time a column moved. */
function labelTableCells(root) {
  $$('table.tbl', root || document).forEach((table) => {
    const heads = $$('thead th', table).map((th) => th.textContent.trim());
    if (!heads.length) return;
    $$('tbody tr', table).forEach((tr) => {
      // A cell with rowspan covers rows below it, which throws the count
      // off; those are left unlabelled and shown as a heading instead.
      let column = 0;
      Array.from(tr.children).forEach((td) => {
        if (td.hasAttribute('rowspan')) { column += 1; return; }
        if (heads[column]) td.setAttribute('data-label', heads[column]);
        column += 1;
      });
    });
  });
}

// Every screen redraws by replacing innerHTML, so the labels are reapplied
// after each one rather than at load.
const _go = go;
go = function (name) {
  _go(name);
  labelTableCells();
};

// Exposed so content.js can raise a toast and reuse the dialog.
window.Admin = { toast, api, openSheet, confirmDialog, esc, $, $$, isOwner };

boot();

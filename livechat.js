/* ==========================================================================
   Live chat.

   Sits beside the WhatsApp button for people who would rather not leave the
   site, or who do not use WhatsApp at all.

   Anyone can start a conversation. Somebody with an account is already
   signed in and simply types; somebody new gives an email address (and a
   number if they want to) and an account is made from that. No password
   either way — they have just told us how to reach them, which is the only
   thing an account here is for.

   The conversation is the same one the Control Room shows, so a question
   asked here and a question asked from the bookings page are one thread.
   ========================================================================== */
(function () {
  'use strict';

  // The admin panel has its own chat screen; this would be a second one.
  if (location.pathname.indexOf('/admin') === 0) return;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  // ---------------------------------------------------------------- styles

  const css = `
  .lc-btn{
    position:fixed; right:18px; bottom:92px; z-index:900;
    display:flex; align-items:center; gap:9px;
    padding:12px 18px; border:0; border-radius:999px;
    background:#0D1B2A; color:#fff; font:inherit; font-size:14px; font-weight:700;
    box-shadow:0 8px 26px rgba(13,27,42,.3); cursor:pointer;
  }
  .lc-btn svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.9;
              stroke-linecap:round;stroke-linejoin:round}
  .lc-btn .lc-dot{
    position:absolute; top:-3px; right:-3px; min-width:20px; height:20px;
    border-radius:999px; background:#E2613C; color:#fff;
    font-size:11px; font-weight:700; display:grid; place-items:center; padding:0 5px;
  }
  .lc-btn[hidden]{display:none}

  .lc-panel{
    position:fixed; right:18px; bottom:18px; z-index:960;
    width:min(370px, calc(100vw - 32px));
    max-height:min(560px, calc(100vh - 36px));
    background:#fff; border-radius:18px; overflow:hidden;
    box-shadow:0 24px 60px rgba(13,27,42,.34);
    display:flex; flex-direction:column;
    font-family:'Hind Siliguri',system-ui,-apple-system,'Segoe UI',sans-serif;
    color:#16233A;
  }
  .lc-panel[hidden]{display:none}

  .lc-head{
    background:#0D1B2A; color:#fff; padding:15px 16px;
    display:flex; align-items:center; gap:10px;
  }
  .lc-head strong{font-size:15px;display:block;line-height:1.25}
  .lc-head span{font-size:11.5px;color:#8FA3BF;display:block;margin-top:1px}
  .lc-close{
    margin-left:auto; background:none; border:0; color:#8FA3BF;
    font-size:22px; line-height:1; cursor:pointer; padding:2px 6px;
  }
  .lc-close:hover{color:#fff}

  .lc-body{flex:1; overflow-y:auto; padding:16px; background:#F7F4EF;
           display:flex; flex-direction:column; gap:10px; min-height:190px}
  .lc-intro{
    background:#fff; border:1px solid #EFE7DC; border-radius:14px;
    padding:14px 16px; font-size:13.5px; line-height:1.6; color:#16233A;
  }
  .lc-intro b{display:block;margin-bottom:4px;font-size:14px}

  .lc-msg{max-width:82%; display:flex; flex-direction:column; gap:3px}
  .lc-msg.them{align-self:flex-start}
  .lc-msg.me{align-self:flex-end; align-items:flex-end}
  .lc-bubble{
    padding:9px 13px; border-radius:14px; font-size:13.5px; line-height:1.55;
    white-space:pre-wrap; overflow-wrap:anywhere;
  }
  .lc-msg.them .lc-bubble{background:#fff;border:1px solid #EFE7DC;border-bottom-left-radius:4px}
  .lc-msg.me .lc-bubble{background:#0D1B2A;color:#fff;border-bottom-right-radius:4px}
  .lc-meta{font-size:10.5px;color:#6B7A93;padding:0 3px}

  .lc-foot{padding:12px 14px 14px; border-top:1px solid #EFE7DC; background:#fff}
  .lc-field{margin-bottom:9px}
  .lc-field label{
    display:block; font-size:11px; font-weight:700; letter-spacing:.03em;
    text-transform:uppercase; color:#6B7A93; margin-bottom:4px;
  }
  .lc-field label i{
    font-style:normal; text-transform:none; letter-spacing:0; font-weight:600;
    background:rgba(13,27,42,.05); border-radius:999px; padding:1px 7px; margin-left:5px;
  }
  .lc-field input, .lc-foot textarea{
    width:100%; padding:10px 12px; border:1px solid #EFE7DC;
    border-radius:10px; font:inherit; font-size:14px; background:#fff; box-sizing:border-box;
  }
  .lc-foot textarea{resize:none}
  .lc-send-row{display:flex; gap:8px; align-items:flex-end}
  .lc-send-row textarea{flex:1}
  .lc-send{
    border:0; border-radius:10px; background:#E2613C; color:#fff;
    font:inherit; font-size:14px; font-weight:700; padding:11px 16px; cursor:pointer;
  }
  .lc-send:disabled{opacity:.6;cursor:default}
  .lc-note{margin:8px 0 0;font-size:11.5px;color:#6B7A93;line-height:1.5}
  .lc-err{margin:8px 0 0;font-size:12.5px;color:#CE3B4E;font-weight:600}

  @media (max-width:520px){
    .lc-btn{right:14px; bottom:84px; padding:11px 15px; font-size:13.5px}
    .lc-panel{right:10px; left:10px; bottom:10px; width:auto; max-height:calc(100vh - 20px)}
  }
  @media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---------------------------------------------------------------- markup

  const CHAT_SVG = '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z"/></svg>';

  const button = document.createElement('button');
  button.className = 'lc-btn';
  button.type = 'button';
  button.setAttribute('aria-label', 'Chat with us');
  button.innerHTML = CHAT_SVG + '<span>Live chat</span>';

  const panel = document.createElement('div');
  panel.className = 'lc-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat with Cox’s Dream Moment');
  panel.innerHTML =
    '<div class="lc-head">' +
      '<div><strong>Chat with us</strong><span>We usually answer within 30 minutes</span></div>' +
      '<button class="lc-close" type="button" aria-label="Close">&times;</button>' +
    '</div>' +
    '<div class="lc-body" id="lc-body"></div>' +
    '<div class="lc-foot" id="lc-foot"></div>';

  document.body.appendChild(button);
  document.body.appendChild(panel);

  const body = panel.querySelector('#lc-body');
  const foot = panel.querySelector('#lc-foot');
  panel.querySelector('.lc-close').addEventListener('click', close);

  // ---------------------------------------------------------------- state

  let signedIn = false;
  let messages = [];
  let timer = null;
  let lastSeen = 0;

  function open() {
    panel.hidden = false;
    button.hidden = true;
    load().then(() => {
      const box = panel.querySelector('#lc-text');
      if (box) box.focus();
    });
    clearInterval(timer);
    timer = setInterval(poll, 15000);
  }

  function close() {
    panel.hidden = true;
    button.hidden = false;
    clearInterval(timer);
    timer = setInterval(poll, 60000);
  }

  button.addEventListener('click', open);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) close();
  });

  // ---------------------------------------------------------------- drawing

  function drawBody() {
    if (!messages.length) {
      body.innerHTML =
        '<div class="lc-intro"><b>Hello \u{1F44B}</b>' +
        'Ask us anything — whether a date is free, what a package includes, ' +
        'or how the payment works. A real person answers.</div>';
      return;
    }
    body.innerHTML = messages.map((m) => {
      const mine = m.from === 'customer';
      return '<div class="lc-msg ' + (mine ? 'me' : 'them') + '">' +
        '<div class="lc-bubble">' + esc(m.text) + '</div>' +
        '<div class="lc-meta">' + (mine ? '' : esc(m.byName) + ' · ') + esc(relativeTime(m.at)) + '</div>' +
      '</div>';
    }).join('');
    body.scrollTop = body.scrollHeight;
  }

  function drawFoot() {
    foot.innerHTML = signedIn
      ? '<div class="lc-send-row">' +
          '<textarea id="lc-text" rows="2" placeholder="Write a message…"></textarea>' +
          '<button class="lc-send" type="button" id="lc-send">Send</button>' +
        '</div><p class="lc-note" id="lc-note"></p>'

      // Not signed in: ask for the least we need to answer them. The email
      // is required because it is the only way to reply once they close the
      // tab; the number is offered because most people here prefer it.
      : '<div class="lc-field"><label for="lc-name">Your name</label>' +
          '<input id="lc-name" autocomplete="name" placeholder="e.g. Rayhan"></div>' +
        '<div class="lc-field"><label for="lc-email">Email</label>' +
          '<input id="lc-email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com"></div>' +
        '<div class="lc-field"><label for="lc-phone">Mobile <i>optional</i></label>' +
          '<input id="lc-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX"></div>' +
        '<div class="lc-send-row">' +
          '<textarea id="lc-text" rows="2" placeholder="What would you like to ask?"></textarea>' +
          '<button class="lc-send" type="button" id="lc-send">Send</button>' +
        '</div>' +
        '<p class="lc-note" id="lc-note">We reply here and by email. No password, no spam.</p>';

    const send = panel.querySelector('#lc-send');
    const text = panel.querySelector('#lc-text');
    send.addEventListener('click', submit);
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
  }

  function say(message, bad) {
    const note = panel.querySelector('#lc-note');
    if (!note) return;
    note.className = bad ? 'lc-err' : 'lc-note';
    note.textContent = message;
  }

  // ---------------------------------------------------------------- server

  async function load() {
    try {
      const me = await fetch('/api/me').then((r) => r.json());
      signedIn = !!me.signedIn;
    } catch (e) {
      signedIn = false;
    }
    if (signedIn) {
      try {
        const d = await fetch('/api/chat').then((r) => (r.ok ? r.json() : { messages: [] }));
        messages = d.messages || [];
      } catch (e) { /* leave whatever is there */ }
    }
    lastSeen = messages.length;
    drawBody();
    drawFoot();
  }

  /** Checks for a reply while the page is open. When the panel is shut this
   *  runs rarely and only to put a count on the button — nobody wants a
   *  page that talks to the server every few seconds in the background. */
  async function poll() {
    if (document.hidden || !signedIn) return;
    try {
      const d = await fetch('/api/chat').then((r) => (r.ok ? r.json() : null));
      if (!d) return;
      const next = d.messages || [];
      const grew = next.length > messages.length;
      messages = next;

      if (!panel.hidden) {
        drawBody();
        lastSeen = messages.length;
      } else if (grew) {
        const unread = messages.length - lastSeen;
        const fromThem = messages[messages.length - 1].from !== 'customer';
        if (unread > 0 && fromThem) {
          button.innerHTML = CHAT_SVG + '<span>Live chat</span>' +
            '<span class="lc-dot">' + unread + '</span>';
        }
      }
    } catch (e) { /* offline; try again next time */ }
  }

  async function submit() {
    const text = (panel.querySelector('#lc-text').value || '').trim();
    if (!text) return;

    const send = panel.querySelector('#lc-send');
    send.disabled = true;
    say('');

    try {
      if (!signedIn) {
        const email = (panel.querySelector('#lc-email').value || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          say('Enter a valid email address so we can reply.', true);
          return;
        }
        const res = await fetch('/api/chat-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: (panel.querySelector('#lc-name').value || '').trim(),
            email,
            phone: (panel.querySelector('#lc-phone').value || '').trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not start the chat.');
        signedIn = true;
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send.');

      messages = data.messages || [];
      lastSeen = messages.length;
      drawBody();
      drawFoot();
      panel.querySelector('#lc-text').focus();
    } catch (err) {
      say(err.message, true);
    } finally {
      const button2 = panel.querySelector('#lc-send');
      if (button2) button2.disabled = false;
    }
  }

  // Someone with a conversation already open should see a reply waiting.
  load().then(() => {
    clearInterval(timer);
    timer = setInterval(poll, 60000);
    poll();
  });
})();

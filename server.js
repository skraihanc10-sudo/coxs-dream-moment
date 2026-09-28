// ==========================================================================
// Cox's Dream Moment - static site + self-hosted admin API.
//
// The public pages (shop.html, product.html, ...) are plain static files
// served straight from this repo. The *content* those pages read at
// runtime (content/settings.json, content/packages.json, content/gallery.json)
// plus uploaded images live under DATA_DIR instead, so the admin panel can
// edit them without touching git. On Railway, mount a persistent Volume
// and point DATA_DIR at it (see README-DEPLOY.md) so edits survive
// redeploys; without one, DATA_DIR falls back to this checkout and edits
// only last until the next deploy.
// ==========================================================================

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');

const APP_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : APP_DIR;
const CONTENT_DIR = path.join(DATA_DIR, 'content');
const IMAGES_DIR = path.join(DATA_DIR, 'images');

const SETTINGS_FILE = path.join(CONTENT_DIR, 'settings.json');
const PACKAGES_FILE = path.join(CONTENT_DIR, 'packages.json');
const GALLERY_FILE = path.join(CONTENT_DIR, 'gallery.json');
const INTRODUCED_FILE = path.join(CONTENT_DIR, 'introduced-packages.json');
const MIGRATIONS_FILE = path.join(CONTENT_DIR, 'migrations.json');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-secret-change-me';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------- bootstrap DATA_DIR
// First boot against a fresh (empty) volume: seed it from the checkout's
// own content/ and images/ folders so the site has something to serve.
function ensureDataDir() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  if (DATA_DIR === APP_DIR) return; // nothing to copy, we *are* the source

  const seedContentDir = path.join(APP_DIR, 'content');
  const seedImagesDir = path.join(APP_DIR, 'images');

  for (const name of ['settings.json', 'packages.json', 'gallery.json']) {
    const dest = path.join(CONTENT_DIR, name);
    const src = path.join(seedContentDir, name);
    if (!fs.existsSync(dest) && fs.existsSync(src)) fs.copyFileSync(src, dest);
  }

  // Copy per-file rather than only when the volume is empty: once an admin has
  // uploaded anything the directory is non-empty forever, and new artwork
  // shipped with a release (e.g. the brand logo) would never reach production.
  // An existing file is never overwritten, so admin uploads always win.
  if (fs.existsSync(seedImagesDir)) {
    for (const file of fs.readdirSync(seedImagesDir)) {
      const dest = path.join(IMAGES_DIR, file);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(path.join(seedImagesDir, file), dest);
      }
    }
  }
}
ensureDataDir();

// ---------------------------------------------------------------- package codes
// Packages get a stable display code ("CDM 101", "CDM 102", ...). Because
// live content lives in the mounted volume rather than in this repo, an
// already-deployed packages.json will not have codes - so any package
// missing one is given the next free number on boot. Existing codes are
// never reassigned and no other field is touched, so this is safe to run
// against production data on every deploy.
const CODE_PREFIX = 'CDM';
const CODE_START = 101;

function codeNumber(code) {
  const m = /^\s*CDM\s*(\d+)\s*$/i.exec(String(code || ''));
  return m ? parseInt(m[1], 10) : null;
}

function backfillPackageCodes() {
  const data = readJSON(PACKAGES_FILE, null);
  if (!data || !Array.isArray(data.packages)) return;

  const used = new Set();
  data.packages.forEach(p => {
    const n = codeNumber(p.code);
    if (n !== null && !used.has(n)) used.add(n);
  });

  let next = CODE_START;
  const assigned = [];
  data.packages.forEach(p => {
    const n = codeNumber(p.code);
    if (n !== null && used.has(n) && p.code === `${CODE_PREFIX} ${n}`) return; // already fine
    while (used.has(next)) next++;
    p.code = `${CODE_PREFIX} ${next}`;
    used.add(next);
    assigned.push(`${p.slug} -> ${p.code}`);
  });

  if (assigned.length) {
    writeJSON(PACKAGES_FILE, data);
    console.log(`Assigned package codes: ${assigned.join(', ')}`);
  }
}

// ---------------------------------------------------------------- accounts and sessions
//
// Three kinds of person use this site:
//
//   owner     — holds ADMIN_PASSWORD. Sees the money. There is exactly one.
//   staff     — records what they spend and edits the packages. Deliberately
//               cannot see bookings, income, profit or what anyone owes:
//               payroll peace is worth more than the convenience.
//   customer  — created automatically the first time somebody books, so they
//               can come back and see their own bookings without ever having
//               chosen a password.
//
// Staff and customers live in users.json; the owner does not, because the
// owner is a password in the environment and not a row anyone can delete.

const USERS_FILE = path.join(CONTENT_DIR, 'users.json');

function readUsers() {
  const data = readJSON(USERS_FILE, null);
  if (data && Array.isArray(data.users)) return data;
  return { users: [] };
}

/** scrypt, with a per-user salt. Slow on purpose: a stolen users.json should
 *  not turn into a list of passwords. */
function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), useSalt, 64).toString('hex');
  return { salt: useSalt, hash };
}

function passwordMatches(password, user) {
  if (!user || !user.hash || !user.salt) return false;
  const attempt = Buffer.from(hashPassword(password, user.salt).hash, 'hex');
  const stored = Buffer.from(user.hash, 'hex');
  return attempt.length === stored.length && crypto.timingSafeEqual(attempt, stored);
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** A session is the payload plus an HMAC of it. Nothing is stored server
 *  side, so any number of instances can verify it with the same secret. */
function signToken(payload) {
  const body = b64(payload);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('hex');
  return `${body}.${sig}`;
}

function readToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || !Number.isFinite(payload.exp) || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/** Who is making this request, or null. Reads the cookie every time rather
 *  than trusting anything the client sent in the body. */
function currentUser(req) {
  const payload = readToken(req.cookies && req.cookies.admin_session);
  if (!payload) return null;
  if (payload.role === 'owner') return { id: 'owner', role: 'owner', name: 'Owner' };

  const user = readUsers().users.find((u) => u.id === payload.uid);
  if (!user || user.active === false) return null;
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    phone: user.phone,
    email: user.email,
    // True when they signed in with a phone number alone. See the note above
    // the /api/login-phone route.
    weak: payload.weak === true,
  };
}

function setSession(res, req, payload, maxAge) {
  res.cookie('admin_session', signToken(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge,
  });
}

/** Guards a route. `allow` is the list of roles that may pass. */
function requireRole(...allow) {
  return (req, res, next) => {
    const user = currentUser(req);
    if (!user || !allow.includes(user.role)) {
      return res.status(401).json({ error: 'Login required' });
    }
    req.user = user;
    next();
  };
}

// The name the rest of the file already uses. Owner and staff both reach the
// Control Room; each route below narrows it further where it matters.
const requireAuth = requireRole('owner', 'staff');
const requireOwner = requireRole('owner');
const requireCustomer = requireRole('customer');

// ---------------------------------------------------------------- email
//
// Sent through Gmail, with an App Password rather than the account password
// — Google refuses the real one, and an App Password can be revoked on its
// own if it ever leaks.
//
// Every send is best-effort. A booking must never fail because Gmail is slow
// or a password has been revoked: the booking is the thing that matters, the
// email is a courtesy. Whatever happens is written to the log, and to the
// customer's own record, so the owner can see who was never reached and send
// them a message by hand.

const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const MAIL_FROM = process.env.MAIL_FROM || (GMAIL_USER ? `Cox's Dream Moment <${GMAIL_USER}>` : '');
const SITE_URL = (process.env.SITE_URL || 'https://coxsdreammoment.shop').replace(/\/$/, '');

let transport = null;
function mailer() {
  if (transport) return transport;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    // Gmail throttles hard on a burst. Pooling keeps one connection and
    // spaces sends out rather than opening a socket per email.
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
  });
  return transport;
}

const mailReady = () => !!(GMAIL_USER && GMAIL_APP_PASSWORD);

async function sendMail(to, subject, html) {
  if (!to || !/@/.test(to)) return { skipped: 'no address' };

  const send = mailer();
  if (!send) {
    console.warn(`[mail] Gmail is not configured — would have sent "${subject}" to ${to}`);
    return { skipped: 'not configured' };
  }
  try {
    await send.sendMail({ from: MAIL_FROM, to, subject, html });
    return { ok: true };
  } catch (e) {
    console.warn(`[mail] failed sending "${subject}" to ${to}: ${e.message}`);
    return { error: e.message };
  }
}

/** One frame for every email we send, so they all look like they came from
 *  the same business. */
function mailShell(heading, bodyHtml, buttonText, buttonHref) {
  return `<!doctype html><html><body style="margin:0;background:#FBF7F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0D1B2A">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF7F1;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(13,27,42,.07)">
        <tr><td style="background:#0D1B2A;padding:22px 26px">
          <div style="color:#fff;font-size:17px;font-weight:700;letter-spacing:.02em">Cox&#39;s Dream Moment</div>
          <div style="color:#D9A441;font-size:12px;margin-top:2px">Cox&#39;s Bazar sea beach</div>
        </td></tr>
        <tr><td style="padding:26px">
          <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3">${heading}</h1>
          ${bodyHtml}
          ${buttonHref ? `<p style="margin:24px 0 0">
            <a href="${buttonHref}" style="display:inline-block;background:#E2613C;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">${buttonText}</a>
          </p>` : ''}
        </td></tr>
        <tr><td style="padding:16px 26px 24px;border-top:1px solid #EFE7DC;color:#6B7A93;font-size:12px;line-height:1.6">
          Any question, just reply to this email or message us on WhatsApp.<br>
          <a href="${SITE_URL}" style="color:#E2613C">${SITE_URL.replace(/^https?:\/\//, '')}</a>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

const rowsHtml = (pairs) => `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;line-height:1.7">
  ${pairs.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="color:#6B7A93;padding:3px 12px 3px 0;white-space:nowrap">${k}</td><td style="font-weight:600">${escapeHtml(v)}</td></tr>`).join('')}
</table>`;

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------- json helpers
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// Runs after the JSON helpers exist; safe to re-run on every boot.

// ------------------------------------------------------ new packages from a release
// Packages live in the volume, so one added to the seed file would never reach a
// site that is already deployed. This introduces such a package once - the same
// additive rule ensureDataDir() uses for images: never overwrite, never touch
// what is already there.
//
// "Once" matters. Without a record, deleting an introduced package in the admin
// panel would see it reappear on the next deploy. introduced-packages.json
// remembers every slug this has offered, and the volume's own packages seed that
// record on first run so nothing already present is ever re-added either.
function introduceNewSeedPackages() {
  const seed = readJSON(path.join(APP_DIR, 'content', 'packages.json'), null);
  const live = readJSON(PACKAGES_FILE, null);
  if (!seed || !Array.isArray(seed.packages)) return;
  if (!live || !Array.isArray(live.packages)) return;

  const record = readJSON(INTRODUCED_FILE, null);
  const introduced = new Set(
    record && Array.isArray(record.slugs)
      ? record.slugs
      : live.packages.map(p => p.slug)   // first run: everything present counts as seen
  );

  const present = new Set(live.packages.map(p => p.slug));
  const added = [];

  for (const pkg of seed.packages) {
    if (!pkg.slug || present.has(pkg.slug) || introduced.has(pkg.slug)) continue;
    live.packages.push(JSON.parse(JSON.stringify(pkg)));
    introduced.add(pkg.slug);
    added.push(pkg.slug);
  }

  if (added.length) {
    writeJSON(PACKAGES_FILE, live);
    console.log(`Introduced new packages: ${added.join(', ')}`);
  }
  if (!record || added.length) {
    writeJSON(INTRODUCED_FILE, { slugs: Array.from(introduced) });
  }
}
introduceNewSeedPackages();
backfillPackageCodes();

// ------------------------------------------------------------ one-shot migrations
// Content lives in the volume, so a change the owner wants applied to what is
// already deployed cannot be made by editing the seed. These run once and are
// then recorded, so they never fight an admin who later changes the same field.
function runOnce(id, fn) {
  const record = readJSON(MIGRATIONS_FILE, null) || { applied: [] };
  const applied = Array.isArray(record.applied) ? record.applied : [];
  if (applied.includes(id)) return;
  const changed = fn();
  applied.push(id);
  writeJSON(MIGRATIONS_FILE, { applied });
  if (changed) console.log(`Migration applied: ${id}`);
}

// Owner is replacing every package photo, so clear the current ones and let the
// placeholder show until each is uploaded again. The image files themselves stay
// in the volume - only the references are dropped.
runOnce('clear-package-photos', () => {
  const data = readJSON(PACKAGES_FILE, null);
  if (!data || !Array.isArray(data.packages)) return false;
  let cleared = 0;
  data.packages.forEach(p => {
    if (p.main_image) { p.main_image = ''; cleared++; }
    if (Array.isArray(p.thumbnails) && p.thumbnails.length) { p.thumbnails = []; cleared++; }
  });
  if (!cleared) return false;
  writeJSON(PACKAGES_FILE, data);
  return true;
});

// The catalogue was cut from forty near-identical packages to twenty that
// differ from each other. The live volume still holds the old forty, and
// introduceNewSeedPackages only ever adds slugs - so the list has to be
// replaced outright here, once.
//
// Anything an admin had set per package that the seed cannot know - the
// photographs, and any price that was filled in - is carried across for the
// slugs that survive. Everything else comes from the seed.
runOnce('catalogue-of-twenty', () => {
  const seed = readJSON(path.join(APP_DIR, 'content', 'packages.json'), null);
  const live = readJSON(PACKAGES_FILE, null);
  if (!seed || !Array.isArray(seed.packages)) return false;
  if (!live || !Array.isArray(live.packages)) return false;

  const keepBySlug = new Map(live.packages.map(p => [p.slug, p]));

  // Seventeen of the twenty kept their slug. These three were renamed, and
  // they are the original packages - the ones most likely to have had a
  // photograph uploaded against them, so the old name is consulted too.
  const RENAMED = {
    'sweet-beginnings': 'simple',
    'golden-sunset': 'sunset',
    'royal-luxury': 'royal',
  };

  // Both the new slug and the old one may exist by the time this runs:
  // introduceNewSeedPackages will already have inserted an empty copy under
  // the new name. So take the first non-empty value across both rather than
  // letting the empty newcomer win.
  function carried(pkg, field) {
    const candidates = [keepBySlug.get(pkg.slug), keepBySlug.get(RENAMED[pkg.slug])];
    for (const previous of candidates) {
      const value = previous && previous[field];
      if (Array.isArray(value) ? value.length : value) return value;
    }
    return pkg[field];
  }

  const next = seed.packages.map(pkg => ({
    ...JSON.parse(JSON.stringify(pkg)),
    // Anything an admin did that the seed cannot know is kept: the uploaded
    // photographs, and any price that was filled in.
    main_image: carried(pkg, 'main_image'),
    thumbnails: carried(pkg, 'thumbnails'),
    price: carried(pkg, 'price'),
    old_price: carried(pkg, 'old_price'),
    discount: carried(pkg, 'discount'),
  }));

  writeJSON(PACKAGES_FILE, { packages: next });

  // The retired slugs must not come back through introduceNewSeedPackages,
  // so record every slug the volume has ever seen as already introduced.
  const record = readJSON(INTRODUCED_FILE, null);
  const seen = new Set(record && Array.isArray(record.slugs) ? record.slugs : []);
  live.packages.forEach(p => seen.add(p.slug));
  next.forEach(p => seen.add(p.slug));
  writeJSON(INTRODUCED_FILE, { slugs: Array.from(seen) });

  console.log(`Catalogue replaced: ${live.packages.length} -> ${next.length} packages`);
  return true;
});


// The front end is English now, and the three featured packages publish a
// price. The live volume still holds the Bengali copy, the old phone number
// and no featured flags, so the seed's settings and the seed's catalogue text
// are brought across here, once.
//
// This replaces two earlier migrations - one that cleared every price, one
// that wrote Bengali copy into settings - both of which now describe the
// opposite of what the site is meant to say.
runOnce('english-front-end', () => {
  const seedSettings = readJSON(path.join(APP_DIR, 'content', 'settings.json'), null);
  const settings = readJSON(SETTINGS_FILE, null);

  if (seedSettings && settings) {
    // Text and phone numbers come from the seed. Anything the admin owns and
    // the seed cannot know - the uploaded hero image, the add-on list they
    // have been editing - is left as it is.
    for (const key of [
      'topbar_announcement', 'phone_display', 'whatsapp_number',
      'helpline_number', 'helpline_display', 'helpline_note',
      'service_area', 'address', 'hours_note', 'footer_desc', 'hours',
    ]) {
      if (seedSettings[key] !== undefined) settings[key] = seedSettings[key];
    }

    settings.hero = Object.assign({}, settings.hero, {
      eyebrow: seedSettings.hero.eyebrow,
      heading: seedSettings.hero.heading,
      subheading: seedSettings.hero.subheading,
      cta_text: seedSettings.hero.cta_text,
    });

    writeJSON(SETTINGS_FILE, settings);
  }

  const gallery = readJSON(GALLERY_FILE, null);
  if (gallery && gallery.note && /[ঀ-৿]/.test(gallery.note)) {
    gallery.note = '* Sample gallery for now — photographs from real events are being added.';
    writeJSON(GALLERY_FILE, gallery);
  }

  return true;
});


// Booking extras became a list so more than one can be offered, and the second
// one - Special Dinner - is quoted on request rather than at a set fee.
// Packages no longer belong to a time of day. The badge used to read Sunset
// or Night, which ruled out half the bookings each package could have taken -
// the customer picks the time when they book instead. The deployed volume
// still carries the old badges, categories and time-specific copy, so the
// seed's catalogue text is brought across.
//
// Photographs, prices and the featured flags are the admin's, and are kept.
runOnce('packages-any-time', () => {
  const seed = readJSON(path.join(APP_DIR, 'content', 'packages.json'), null);
  const live = readJSON(PACKAGES_FILE, null);
  if (!seed || !Array.isArray(seed.packages)) return false;
  if (!live || !Array.isArray(live.packages)) return false;

  const liveBySlug = new Map(live.packages.map(p => [p.slug, p]));

  const next = seed.packages.map(pkg => {
    const previous = liveBySlug.get(pkg.slug);
    const carried = previous || {};

    return {
      ...JSON.parse(JSON.stringify(pkg)),
      main_image: carried.main_image || pkg.main_image,
      thumbnails: Array.isArray(carried.thumbnails) && carried.thumbnails.length
        ? carried.thumbnails
        : pkg.thumbnails,
      // A price the admin set is theirs. The seed only supplies one for the
      // three featured packages, and only when nothing is there already.
      price: carried.price || pkg.price,
      old_price: carried.old_price || pkg.old_price,
      discount: carried.discount || pkg.discount,
      featured: typeof carried.featured === 'boolean' ? carried.featured : pkg.featured,
    };
  });

  writeJSON(PACKAGES_FILE, { packages: next });

  // Retired slugs must not return through introduceNewSeedPackages.
  const record = readJSON(INTRODUCED_FILE, null);
  const seen = new Set(record && Array.isArray(record.slugs) ? record.slugs : []);
  live.packages.forEach(p => seen.add(p.slug));
  next.forEach(p => seen.add(p.slug));
  writeJSON(INTRODUCED_FILE, { slugs: Array.from(seen) });

  console.log(`Packages freed from a time of day: ${next.length} rewritten`);
  return true;
});

// Prices come off the site until the owner sets them. The deployed volume
// still carries numbers from an earlier catalogue - including discount labels
// like "30% OFF" against packages that no longer have a price for the discount
// to apply to - and a stale number reaching a customer is worse than no number
// at all.
//
// Four packages are featured; those are the ones a price is meant to go on,
// and they are set in the admin panel.
runOnce('clear-prices-four-featured', () => {
  const seed = readJSON(path.join(APP_DIR, 'content', 'packages.json'), null);
  const data = readJSON(PACKAGES_FILE, null);
  if (!seed || !Array.isArray(seed.packages)) return false;
  if (!data || !Array.isArray(data.packages)) return false;

  const featuredSlugs = new Set(seed.packages.filter(p => p.featured).map(p => p.slug));

  data.packages.forEach(p => {
    p.price = '';
    p.old_price = '';
    p.discount = '';
    p.featured = featuredSlugs.has(p.slug);
  });

  writeJSON(PACKAGES_FILE, data);
  console.log(`Prices cleared; featured set on ${featuredSlugs.size} packages`);
  return true;
});

// The gallery shipped with ten stock photographs so the page had something to
// show. They are not this business's work, so they come off; the owner uploads
// their own through the admin panel.
runOnce('empty-demo-gallery', () => {
  const gallery = readJSON(GALLERY_FILE, null);
  if (!gallery || !Array.isArray(gallery.items) || gallery.items.length === 0) return false;

  // Only the images that shipped with the template. Anything uploaded since
  // lives under a different name and is the owner's, so it stays.
  const SHIPPED = /^images\/(full-setup|neon-sign|petal-walkway|setup-arch|candle-jars|fairy-lights|dinner-table|seating-area|flower-bouquet|sunset-sea)\.(jpg|png)$/i;

  const before = gallery.items.length;
  gallery.items = gallery.items.filter(item => !SHIPPED.test(String(item.image || '')));

  if (gallery.items.length === before) return false;

  gallery.note = 'Photographs from our events are being added here.';
  writeJSON(GALLERY_FILE, gallery);
  console.log(`Demo gallery cleared: ${before - gallery.items.length} stock photos removed`);
  return true;
});

// The homepage gained an About section and a row of numbers. Neither exists in
// a settings file written before them, so the seed's copy is brought across -
// but only where nothing is there already, so this cannot overwrite text the
// owner has since rewritten.
runOnce('about-and-stats', () => {
  const seedSettings = readJSON(path.join(APP_DIR, 'content', 'settings.json'), null);
  const settings = readJSON(SETTINGS_FILE, null);
  if (!seedSettings || !settings) return false;

  let changed = false;

  if (!settings.about && seedSettings.about) {
    settings.about = seedSettings.about;
    changed = true;
  }
  if ((!Array.isArray(settings.stats) || settings.stats.length === 0) && Array.isArray(seedSettings.stats)) {
    settings.stats = seedSettings.stats;
    changed = true;
  }

  if (!changed) return false;
  writeJSON(SETTINGS_FILE, settings);
  console.log('About section and stats added to settings');
  return true;
});

// Every package includes the same five things. The deployed volume still
// carries the tiered lists - up to twenty items on the largest - which promise
// photography, a drone shot, dinner and a dedicated host that are not part of
// the package. A list on the website is a promise, so it is brought back to
// what is actually included, and the descriptions with it.
//
// Photographs, prices and featured flags stay with the admin.
runOnce('one-inclusion-list', () => {
  const seed = readJSON(path.join(APP_DIR, 'content', 'packages.json'), null);
  const live = readJSON(PACKAGES_FILE, null);
  if (!seed || !Array.isArray(seed.packages)) return false;
  if (!live || !Array.isArray(live.packages)) return false;

  const liveBySlug = new Map(live.packages.map(p => [p.slug, p]));

  const next = seed.packages.map(pkg => {
    const previous = liveBySlug.get(pkg.slug) || {};
    return {
      ...JSON.parse(JSON.stringify(pkg)),
      main_image: previous.main_image || pkg.main_image,
      thumbnails: Array.isArray(previous.thumbnails) && previous.thumbnails.length
        ? previous.thumbnails
        : pkg.thumbnails,
      price: previous.price || pkg.price,
      old_price: previous.old_price || pkg.old_price,
      discount: previous.discount || pkg.discount,
      featured: typeof previous.featured === 'boolean' ? previous.featured : pkg.featured,
    };
  });

  writeJSON(PACKAGES_FILE, { packages: next });

  const record = readJSON(INTRODUCED_FILE, null);
  const seen = new Set(record && Array.isArray(record.slugs) ? record.slugs : []);
  live.packages.forEach(p => seen.add(p.slug));
  next.forEach(p => seen.add(p.slug));
  writeJSON(INTRODUCED_FILE, { slugs: Array.from(seen) });

  console.log(`Inclusions levelled: every package now lists ${next[0].inclusions.length} items`);
  return true;
});

runOnce('booking-extras-list', () => {
  const settings = readJSON(SETTINGS_FILE, null);
  if (!settings) return false;
  if (Array.isArray(settings.addons) && settings.addons.length) return false;
  settings.addons = [{"label": "Drone Shot (Cinematic Special Drone Video)", "fee": "2000"}, {"label": "Special Dinner", "fee": ""}];
  delete settings.drone_addon;
  writeJSON(SETTINGS_FILE, settings);
  return true;
});






// ------------------------------------------------------ five packages, plus media
//
// The catalogue was twenty variations on one setup, which made choosing hard
// and made every package look like the same thing under a different name.
// This keeps five, as a ladder from the simplest to the largest, and adds two
// media services that are sold alongside a setup rather than instead of one.
//
// Nothing is deleted from disk: the photographs of the retired packages stay
// in the images folder, so any of them can be put back from the admin panel.
const KEEP = ['sweet-beginnings', 'ocean-breeze', 'golden-sunset', 'horizon-glow', 'royal-luxury'];

const MEDIA_PACKAGES = [
  {
    slug: 'drone-video',
    code: 'CDM 201',
    name: 'Drone Video',
    kind: 'media',
    badge: 'Add to any package',
    trust_extra: 'Shot on the day, edited and sent to you',
    featured: false,
    price: '', price_amount: 0, discount_percent: 0, old_price: '', discount: '',
    categories: [], main_image: '', thumbnails: [],
    inclusions: [
      'Cinematic drone footage of your setup and the beach',
      'Around 60 to 90 seconds, edited',
      'Music of your choice',
      'Sent to you within 48 hours',
      'Full resolution file, yours to keep',
    ],
    description:
      'A drone shot from above the setup, with the sea behind you. Flown while the light is '
      + 'good and cut to a short film you can actually send to people, rather than an hour of '
      + 'raw footage nobody watches.',
    booking_policy:
      'Added to any package when you book. Drone flying depends on the weather — if it is '
      + 'unsafe to fly on the day, this is refunded in full.',
    faq:
      'The drone is flown by our own operator, who is there for the whole setup. It is quiet '
      + 'enough not to spoil the moment, and it keeps its distance during the proposal itself.',
  },
  {
    slug: 'full-media-coverage',
    code: 'CDM 202',
    name: 'Drone, Photo & Video',
    kind: 'media',
    badge: 'Complete coverage',
    trust_extra: 'Everything filmed, everything photographed',
    featured: true,
    price: '', price_amount: 0, discount_percent: 0, old_price: '', discount: '',
    categories: [], main_image: '', thumbnails: [],
    inclusions: [
      'Drone footage from above',
      'A photographer for the whole setup',
      'Video from the ground, focus-pulled',
      'Edited highlight film, 2 to 3 minutes',
      'Every edited photograph, full resolution',
    ],
    description:
      'The full crew: a drone above, a camera on the ground and a photographer with you the '
      + 'whole time. You get the short film to share and every photograph to keep.',
    booking_policy:
      'Added to any package when you book. Please tell us at least two days ahead so the crew '
      + 'is free on your date.',
    faq:
      'The edited film arrives within three to five days and the photographs within a week. '
      + 'Nothing is published anywhere without asking you first.',
  },
];

runOnce('five-packages-and-media', () => fivePackagesAndMedia());

// Prices used to be two free-text boxes: "15000" in one and "30000" struck
// through in the other, with a separate "50% Discount" label typed by hand.
// Three places to keep in step, and they drifted. The site now takes one
// full price and one percentage, so this reads the old boxes and works out
// what they meant rather than asking anyone to type it all again.
runOnce('numeric-prices', () => {
  const data = readJSON(PACKAGES_FILE, null);
  if (!data || !Array.isArray(data.packages)) return false;

  // "\u09f315,000" and "15000 tk" both mean fifteen thousand.
  const amount = (value) => {
    const digits = String(value === undefined || value === null ? '' : value).replace(/[^0-9]/g, '');
    return digits ? parseInt(digits, 10) : 0;
  };

  let moved = 0;
  for (const pkg of data.packages) {
    if (Number(pkg.price_amount) > 0) continue;   // already on the new fields

    const now = amount(pkg.price);
    const was = amount(pkg.old_price);
    if (!now && !was) {
      pkg.price_amount = 0;
      pkg.discount_percent = 0;
      continue;
    }

    // old_price is the full price and price is what they pay, so the
    // percentage is whatever gets from one to the other.
    if (was > now && now > 0) {
      pkg.price_amount = was;
      pkg.discount_percent = Math.round(((was - now) / was) * 100);
    } else {
      pkg.price_amount = now || was;
      pkg.discount_percent = 0;
    }

    // The old boxes are cleared, or the site would keep preferring them.
    pkg.price = '';
    pkg.old_price = '';
    pkg.discount = '';
    moved += 1;
  }

  if (!moved) return false;
  writeJSON(PACKAGES_FILE, data);
  console.log(`Prices moved to full-price + discount on ${moved} packages`);
  return true;
});

function fivePackagesAndMedia() {
  const data = readJSON(PACKAGES_FILE, null);
  if (!data || !Array.isArray(data.packages)) return false;

  const kept = data.packages.filter((p) => KEEP.indexOf(p.slug) !== -1);
  // Only run if the catalogue is still the old one; a later hand edit in the
  // admin panel must not be undone by a redeploy.
  if (!kept.length) return false;

  const have = new Set(kept.map((p) => p.slug));
  for (const media of MEDIA_PACKAGES) {
    if (!have.has(media.slug)) kept.push(Object.assign({}, media));
  }

  // The five setups are ordered simplest first; the media services follow.
  const order = KEEP.concat(MEDIA_PACKAGES.map((m) => m.slug));
  kept.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));

  data.packages = kept;
  writeJSON(PACKAGES_FILE, data);
  console.log(`Catalogue trimmed: ${kept.length} packages (${MEDIA_PACKAGES.length} media)`);
  return true;
}

// ---------------------------------------------------------------- app
const app = express();
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

// content + images come from DATA_DIR (writable) and take priority over
// the checkout's own copies of the same folders
app.use('/content', express.static(CONTENT_DIR, { maxAge: 0 }));
app.use('/images', express.static(IMAGES_DIR, { maxAge: '7d' }));

// ---------------------------------------------------------------- sign in
//
// One form, three outcomes. With no email it is the owner signing in with
// ADMIN_PASSWORD; with an email it is a member of staff; a customer never
// sees this screen at all and arrives through a link instead.

app.post('/admin/api/login', (req, res) => {
  const { password, email } = req.body || {};

  if (!email) {
    if (!ADMIN_PASSWORD) {
      return res.status(500).json({ error: 'ADMIN_PASSWORD is not set on the server.' });
    }
    const given = Buffer.from(String(password || ''));
    const expected = Buffer.from(ADMIN_PASSWORD);
    const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
    if (!ok) return res.status(401).json({ error: 'Wrong password' });
    setSession(res, req, { role: 'owner', exp: Date.now() + SESSION_MAX_AGE_MS }, SESSION_MAX_AGE_MS);
    return res.json({ ok: true, role: 'owner' });
  }

  const user = readUsers().users.find(
    (u) => u.role === 'staff' && String(u.email || '').toLowerCase() === String(email).trim().toLowerCase());

  // The same message whether the address is unknown or the password is
  // wrong, so this cannot be used to find out who works here.
  if (!user || user.active === false || !passwordMatches(password, user)) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  setSession(res, req, { role: 'staff', uid: user.id, exp: Date.now() + SESSION_MAX_AGE_MS }, SESSION_MAX_AGE_MS);
  res.json({ ok: true, role: 'staff' });
});

app.post('/admin/api/logout', (req, res) => {
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

app.get('/admin/api/session', (req, res) => {
  const user = currentUser(req);
  res.json({
    authenticated: !!user && user.role !== 'customer',
    role: user ? user.role : null,
    name: user ? user.name : null,
  });
});

// ---------------------------------------------------------------- staff accounts

const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone,
  role: u.role, active: u.active !== false, createdAt: u.createdAt,
});

app.get('/admin/api/staff', requireOwner, (req, res) => {
  res.json({ staff: readUsers().users.filter((u) => u.role === 'staff').map(publicUser) });
});

app.post('/admin/api/staff', requireOwner, (req, res) => {
  const body = req.body || {};
  const name = text(body.name, 80);
  const email = text(body.email, 120).toLowerCase();
  const password = String(body.password || '');

  if (!name || !email) return res.status(400).json({ error: 'Name and email are both needed.' });
  if (password.length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });

  const store = readUsers();
  if (store.users.some((u) => String(u.email || '').toLowerCase() === email)) {
    return res.status(400).json({ error: 'Someone already uses that email.' });
  }

  const { salt, hash } = hashPassword(password);
  const user = {
    id: 'u' + crypto.randomBytes(8).toString('hex'),
    role: 'staff',
    name,
    email,
    phone: tidyPhone(body.phone),
    salt,
    hash,
    active: true,
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  writeJSON(USERS_FILE, store);

  sendMail(email, "You can now sign in — Cox's Dream Moment", mailShell(
    `Welcome, ${escapeHtml(name)}`,
    `<p style="margin:0 0 14px;line-height:1.6">An account has been made for you on the Cox&#39;s Dream Moment staff panel.
     You can record what you spend and keep the packages up to date.</p>
     ${rowsHtml([['Sign in with', email]])}
     <p style="margin:14px 0 0;line-height:1.6;color:#6B7A93;font-size:13px">
       Your password was given to you separately. Please do not share this account.</p>`,
    'Open the staff panel', `${SITE_URL}/admin/`));

  res.json({ ok: true, user: publicUser(user) });
});

app.put('/admin/api/staff/:id', requireOwner, (req, res) => {
  const body = req.body || {};
  const store = readUsers();
  const user = store.users.find((u) => u.id === req.params.id && u.role === 'staff');
  if (!user) return res.status(404).json({ error: 'Not found.' });

  if (body.name !== undefined) user.name = text(body.name, 80);
  if (body.phone !== undefined) user.phone = tidyPhone(body.phone);
  if (body.active !== undefined) user.active = !!body.active;
  if (body.password) {
    if (String(body.password).length < 8) {
      return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
    }
    const { salt, hash } = hashPassword(body.password);
    user.salt = salt;
    user.hash = hash;
  }
  writeJSON(USERS_FILE, store);
  res.json({ ok: true, user: publicUser(user) });
});

app.delete('/admin/api/staff/:id', requireOwner, (req, res) => {
  const store = readUsers();
  const before = store.users.length;
  store.users = store.users.filter((u) => !(u.id === req.params.id && u.role === 'staff'));
  if (store.users.length === before) return res.status(404).json({ error: 'Not found.' });
  writeJSON(USERS_FILE, store);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- customer accounts
//
// A customer account is a side effect of booking, never a form somebody has
// to fill in first. Asking a stranger to choose a password before they can
// ask about a beach setup loses the booking.

function findCustomer(store, phone, email) {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  const mail = String(email || '').trim().toLowerCase();
  return store.users.find((u) => {
    if (u.role !== 'customer') return false;
    if (digits && String(u.phone || '').replace(/\D/g, '').slice(-10) === digits) return true;
    return !!mail && String(u.email || '').toLowerCase() === mail;
  });
}

function upsertCustomer({ name, phone, email }) {
  const store = readUsers();
  let user = findCustomer(store, phone, email);
  if (user) {
    // Keep the newest details, but never blank out something we already had.
    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
  } else {
    user = {
      id: 'c' + crypto.randomBytes(8).toString('hex'),
      role: 'customer',
      name: name || '',
      phone: phone || '',
      email: email || '',
      active: true,
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
  }
  writeJSON(USERS_FILE, store);
  return user;
}

const CUSTOMER_SESSION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  if (!user || user.role !== 'customer') return res.json({ signedIn: false });
  res.json({ signedIn: true, name: user.name, phone: user.phone, email: user.email });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

/** The customer's own bookings. Matched on the account id recorded when the
 *  booking was made, so one customer can never read another's. */
app.get('/api/my-bookings', requireCustomer, (req, res) => {
  const mine = readBookings().bookings
    .filter((b) => b.customerId === req.user.id)
    .map((b) => {
      const full = withTotals(b);
      // Internal notes are exactly that.
      delete full.adminNote;
      delete full.notified;
      // A phone-only session does not get to see bank screenshots.
      if (req.user.weak) full.receipts = [];
      full.daysAway = daysUntil(b.eventDate);
      return full;
    });

  // Soonest first, and anything without a date last: the next event is the
  // one the customer opened this page to check.
  mine.sort((a, b) => {
    const A = a.daysAway === null ? Infinity : (a.daysAway < 0 ? Infinity - 1 : a.daysAway);
    const B = b.daysAway === null ? Infinity : (b.daysAway < 0 ? Infinity - 1 : b.daysAway);
    return A - B;
  });

  res.json({ bookings: mine, name: req.user.name, weak: !!req.user.weak });
});

// ---------------------------------------------------------------- sign in with a number
//
// No password. Type the number you booked with and you are in.
//
// This is a deliberate trade, and it is worth writing down: anyone who knows
// a customer's mobile number can open their bookings. That is the price of a
// sign-in an ordinary customer will actually complete, and the owner chose
// it knowingly.
//
// Two things keep the damage small. A session opened this way is marked
// `weak`, and a weak session is not shown the payment screenshots — those
// are somebody's bank records and are not worth a guessed phone number.
// Signing in through Google, or through the link in an email, gives a full
// session that sees everything.
//
// Rate limited by IP so the phone-number space cannot simply be walked.

const WEAK_SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

app.post('/api/login-phone', (req, res) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (tooManyFrom('phone-login:' + ip)) {
    return res.status(429).json({ error: 'Too many tries. Please wait a few minutes.' });
  }

  const phone = tidyPhone((req.body || {}).phone);
  if (phone.replace(/\D/g, '').length < 10) {
    return res.status(400).json({ error: 'Enter the mobile number you booked with.' });
  }

  const user = findCustomer(readUsers(), phone, '');
  if (!user || user.active === false) {
    return res.status(404).json({
      error: 'We have no booking against that number. If you have just booked, use the same number you gave us.',
    });
  }

  setSession(res, req, {
    role: 'customer',
    uid: user.id,
    weak: true,
    exp: Date.now() + WEAK_SESSION_MS,
  }, WEAK_SESSION_MS);

  res.json({ ok: true, name: user.name });
});

// ---------------------------------------------------------------- magic link
//
// Signing in from a second device. The link is single use — it is stored as
// a hash on the account and cleared the moment it is spent — and lasts 15
// minutes, so a forwarded email is not a spare key.

const MAGIC_TTL_MS = 15 * 60 * 1000;

app.post('/api/login-link', async (req, res) => {
  const store = readUsers();
  const user = findCustomer(store, req.body && req.body.phone, req.body && req.body.email);

  // Answered the same way whether or not the account exists: a stranger must
  // not be able to use this to find out who has booked with us.
  const reply = { ok: true, message: 'If we have an account for that, a sign-in link is on its way by email.' };
  if (!user || !user.email) return res.json(reply);

  const raw = crypto.randomBytes(32).toString('hex');
  user.loginTokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  user.loginTokenExp = Date.now() + MAGIC_TTL_MS;
  writeJSON(USERS_FILE, store);

  const link = `${SITE_URL}/api/login-link/${raw}`;
  await sendMail(user.email, "Your sign-in link — Cox's Dream Moment", mailShell(
    'Sign in to see your bookings',
    `<p style="margin:0 0 14px;line-height:1.6">Press the button below and you are in. No password needed.</p>
     <p style="margin:0;line-height:1.6;color:#6B7A93;font-size:13px">
       The link works once and stops working after 15 minutes.
       If you did not ask for it, you can ignore this email.</p>`,
    'Sign me in', link));

  res.json(reply);
});

app.get('/api/login-link/:token', (req, res) => {
  const hash = crypto.createHash('sha256').update(String(req.params.token || '')).digest('hex');
  const store = readUsers();
  const user = store.users.find((u) => u.loginTokenHash && u.loginTokenHash === hash);

  if (!user || !user.loginTokenExp || Date.now() > user.loginTokenExp) {
    return res.redirect('/my-bookings.html?expired=1');
  }
  // Spent. Clearing it here is what makes the link single use.
  delete user.loginTokenHash;
  delete user.loginTokenExp;
  writeJSON(USERS_FILE, store);

  setSession(res, req, { role: 'customer', uid: user.id, exp: Date.now() + CUSTOMER_SESSION_MS }, CUSTOMER_SESSION_MS);
  res.redirect('/my-bookings.html');
});

// ---------------------------------------------------------------- continue with Google
//
// The browser gets a signed token from Google and hands it here. We check it
// with Google rather than trusting it: anyone can POST a made-up token, and
// the only thing that makes this safe is asking Google whether the token is
// real and whether it was issued for *our* site.
//
// No OAuth library. One HTTPS call to Google's tokeninfo endpoint does the
// signature check, the expiry check and the audience check in one go.

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

/** What the booking page needs to know about how people can sign in. */
app.get('/api/auth-config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

app.post('/api/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google sign-in is not set up on this site yet.' });
  }
  const credential = String((req.body || {}).credential || '');
  if (!credential || credential.length > 4096) {
    return res.status(400).json({ error: 'Sign-in failed. Please try again.' });
  }

  let info;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!r.ok) throw new Error('rejected by Google');
    info = await r.json();
  } catch (e) {
    console.warn('[google] token check failed:', e.message);
    return res.status(401).json({ error: 'Sign-in failed. Please try again.' });
  }

  // The audience check is the important one. Without it, a token issued for
  // any other Google app would sign somebody in here.
  if (info.aud !== GOOGLE_CLIENT_ID) {
    return res.status(401).json({ error: 'Sign-in failed. Please try again.' });
  }
  if (info.email_verified !== 'true' && info.email_verified !== true) {
    return res.status(401).json({ error: 'Please verify your Google email address first.' });
  }

  const email = String(info.email || '').toLowerCase();
  if (!email) return res.status(401).json({ error: 'Sign-in failed. Please try again.' });

  // Matches an account made by an earlier booking, by email. Somebody who
  // booked by phone alone and later signs in with Google gets a second
  // account — which is correct, because nothing links the two.
  const store = readUsers();
  let user = findCustomer(store, '', email);
  if (user) {
    if (!user.name && info.name) user.name = String(info.name).slice(0, 80);
    user.googleId = info.sub;
    writeJSON(USERS_FILE, store);
  } else {
    user = upsertCustomer({ name: String(info.name || '').slice(0, 80), phone: '', email });
    const fresh = readUsers();
    const row = fresh.users.find((u) => u.id === user.id);
    if (row) {
      row.googleId = info.sub;
      writeJSON(USERS_FILE, fresh);
    }
  }

  setSession(res, req, { role: 'customer', uid: user.id, exp: Date.now() + CUSTOMER_SESSION_MS }, CUSTOMER_SESSION_MS);
  res.json({ ok: true, name: user.name });
});

// ---------------------------------------------------------------- customers (owner)
//
// Who has booked with us, and — the point of this screen — who we have no
// email address for. Those are the people the owner has to message by hand,
// and the WhatsApp text is written out here so it is one tap rather than
// something to compose at eleven at night.

const NOTICE_LABEL = {
  received: 'Booking received',
  confirmed: 'Booking confirmed',
  completed: 'Booking completed',
  cancelled: 'Booking cancelled',
  payment: 'Payment recorded',
  price: 'Price updated',
};

/** The message the owner sends on WhatsApp when email could not do it.
 *  Plain text, no markup: WhatsApp is not a browser. */
function whatsappText(booking, kind) {
  const money = (n) => '৳' + Number(n || 0).toLocaleString('en-IN');
  const paid = (booking.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const due = Math.max(Number(booking.price || 0) - paid, 0);

  const lines = [`Hello ${booking.name || ''},`.trim(), ''];

  if (kind === 'confirmed') {
    lines.push(`Your booking ${booking.id} with Cox's Dream Moment is confirmed.`);
  } else if (kind === 'completed') {
    lines.push(`Thank you for choosing Cox's Dream Moment. We hope your evening was everything you wanted.`);
  } else if (kind === 'cancelled') {
    lines.push(`Your booking ${booking.id} has been cancelled. If that is not what you expected, please let us know.`);
  } else if (kind === 'payment') {
    lines.push(`We have received your payment for booking ${booking.id}. Thank you.`);
  } else {
    lines.push(`We have your booking ${booking.id}. We are checking the date and will confirm shortly.`);
  }

  lines.push('');
  if (booking.packageName) lines.push(`Package: ${booking.packageName}`);
  if (booking.eventDate) lines.push(`Date: ${booking.eventDate}`);
  if (booking.eventTime) lines.push(`Time: ${booking.eventTime}`);

  if (booking.price) {
    lines.push('');
    lines.push(`Total: ${money(booking.price)}`);
    lines.push(`Paid: ${money(paid)}`);
    lines.push(due ? `Still to pay: ${money(due)}` : 'Fully paid — thank you.');
  }

  lines.push('');
  lines.push("Cox's Dream Moment");
  return lines.join('\n');
}

app.get('/admin/api/customers', requireOwner, (req, res) => {
  const bookings = readBookings().bookings;
  const users = readUsers().users.filter((u) => u.role === 'customer');

  const rows = users.map((u) => {
    const mine = bookings.filter((b) => b.customerId === u.id);
    const live = mine.filter((b) => b.status !== 'cancelled');
    const spent = mine.reduce(
      (sum, b) => sum + (b.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0), 0);
    const due = live.reduce((sum, b) => {
      const paid = (b.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
      return sum + Math.max(Number(b.price || 0) - paid, 0);
    }, 0);

    // Anything we meant to tell them that email could not deliver.
    const waiting = [];
    for (const b of mine) {
      for (const n of b.notified || []) {
        if (n.state === 'pending') {
          waiting.push({
            bookingId: b.id,
            kind: n.kind,
            label: NOTICE_LABEL[n.kind] || n.kind,
            at: n.at,
            why: n.why,
            text: whatsappText(b, n.kind),
          });
        }
      }
    }

    return {
      id: u.id,
      name: u.name,
      phone: u.phone || '',
      email: u.email || '',
      hasGoogle: !!u.googleId,
      createdAt: u.createdAt,
      bookings: mine.length,
      spent,
      due,
      lastBooking: mine.length ? mine[0].id : '',
      // Newest first: the thing most likely still to need sending.
      waiting: waiting.reverse(),
    };
  });

  rows.sort((a, b) => (b.waiting.length - a.waiting.length) || (b.bookings - a.bookings));
  res.json({ customers: rows, mailReady: mailReady() });
});

/** Marks a pending notice as handled, once the owner has sent it by hand.
 *  Without this the same reminder would sit there for ever. */
app.post('/admin/api/customers/:id/sent', requireOwner, (req, res) => {
  const { bookingId, kind } = req.body || {};
  const store = readBookings();
  const booking = store.bookings.find((b) => b.id === bookingId && b.customerId === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  let marked = 0;
  for (const n of booking.notified || []) {
    if (n.state === 'pending' && (!kind || n.kind === kind)) {
      n.state = 'sent';
      n.why = 'sent on WhatsApp by hand';
      marked += 1;
    }
  }
  writeJSON(BOOKINGS_FILE, store);
  res.json({ ok: true, marked });
});

// ---------------------------------------------------------------- payment receipts
//
// A screenshot of a bKash or bank transfer is somebody's financial record.
// It is kept outside the public images folder and served only to the owner,
// to staff, and to the customer whose booking it belongs to.

const RECEIPTS_DIR = path.join(DATA_DIR, 'receipts');
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, RECEIPTS_DIR),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname).toLowerCase().match(/^\.(jpe?g|png|webp)$/) || ['.jpg'])[0];
      cb(null, `r-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});

app.post('/api/receipt', receiptUpload.single('receipt'), (req, res) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (tooManyFrom('receipt:' + ip)) {
    return res.status(429).json({ error: 'Too many uploads. Please try again in a few minutes.' });
  }
  if (!req.file) return res.status(400).json({ error: 'Attach a screenshot (jpg, png or webp, up to 6MB).' });
  res.json({ ok: true, file: req.file.filename });
});

app.get('/receipts/:file', (req, res) => {
  const name = path.basename(String(req.params.file || ''));
  const full = path.join(RECEIPTS_DIR, name);
  if (!full.startsWith(RECEIPTS_DIR) || !fs.existsSync(full)) return res.status(404).end();

  const user = currentUser(req);
  if (!user) return res.status(401).end();
  if (user.role === 'customer') {
    const owns = readBookings().bookings.some(
      (b) => b.customerId === user.id && (b.receipts || []).some((r) => r.file === name));
    if (!owns) return res.status(403).end();
  }
  res.sendFile(full);
});

// What the booking page needs in order to show how to pay. Public on
// purpose — these are the numbers we want customers to send money to —
// but assembled field by field so nothing else in settings.json can leak
// out of this endpoint by accident.
app.get('/api/payment-info', (req, res) => {
  const pay = readJSON(SETTINGS_FILE, {}).payment || {};
  res.json({
    intro: pay.intro || '',
    advance_note: pay.advance_note || '',
    qr_image: pay.qr_image || '',
    methods: (Array.isArray(pay.methods) ? pay.methods : []).map((m) => ({
      label: m.label || '',
      number: m.number || '',
      type: m.type || '',
      note: m.note || '',
    })),
    whatsapp_number: readJSON(SETTINGS_FILE, {}).whatsapp_number || '',
  });
});

app.get('/admin/api/data', requireAuth, (req, res) => {
  res.json({
    settings: readJSON(SETTINGS_FILE, {}),
    packages: readJSON(PACKAGES_FILE, { packages: [] }),
    gallery: readJSON(GALLERY_FILE, { items: [] }),
  });
});

app.put('/admin/api/settings', requireOwner, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid data' });
  writeJSON(SETTINGS_FILE, body);
  res.json({ ok: true });
});

app.put('/admin/api/packages', requireAuth, (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.packages)) return res.status(400).json({ error: 'Invalid data' });

  const slugs = new Set();
  const codes = new Set();
  for (const pkg of body.packages) {
    if (!pkg.slug || typeof pkg.slug !== 'string' || !/^[a-z0-9-]+$/.test(pkg.slug)) {
      return res.status(400).json({ error: `Invalid slug: "${pkg.slug}" — use lowercase letters, numbers and hyphens only` });
    }
    if (slugs.has(pkg.slug)) {
      return res.status(400).json({ error: `Slug "${pkg.slug}" is used more than once — every package needs a unique slug` });
    }
    slugs.add(pkg.slug);

    // Package code: normalise "cdm101" / "CDM  101" to "CDM 101", and keep
    // codes unique. A blank code is filled in from the next free number so
    // a newly added package never has to be numbered by hand.
    const typed = String(pkg.code || '').trim();
    if (typed) {
      const n = codeNumber(typed);
      if (n === null) {
        return res.status(400).json({ error: `Invalid package code: "${typed}" — the format is "CDM 101"` });
      }
      pkg.code = `${CODE_PREFIX} ${n}`;
      if (codes.has(pkg.code)) {
        return res.status(400).json({ error: `Package Code "${pkg.code}" is used more than once — every code must be unique` });
      }
      codes.add(pkg.code);
    }

    if (!Array.isArray(pkg.categories)) pkg.categories = [];
    if (!Array.isArray(pkg.thumbnails)) pkg.thumbnails = [];
    if (!Array.isArray(pkg.inclusions)) pkg.inclusions = [];
    // Stored as a real boolean so the shop can filter on it without having to
    // guess what "false", 0 or "" were meant to mean.
    pkg.featured = pkg.featured === true;

    // A discount and a struck-through old price only mean something next to a
    // price. Dropped here as well as in the shop, so the data does not carry a
    // "30% OFF" that nothing will ever draw.
    if (!String(pkg.price || '').trim()) {
      pkg.price = '';
      pkg.old_price = '';
      pkg.discount = '';
    }
  }

  // The featured row is the first thing on the shop page. More than a handful
  // and it stops being a recommendation.
  const featuredCount = body.packages.filter(p => p.featured).length;
  if (featuredCount > 5) {
    return res.status(400).json({
      error: `${featuredCount} packages are marked Featured. Keep it to five or fewer — the top row is a recommendation, not a second catalogue.`,
    });
  }

  // Fill in any package saved without a code, reusing the same numbering
  // rule as the boot-time backfill.
  let next = CODE_START;
  for (const pkg of body.packages) {
    if (pkg.code) continue;
    while (codes.has(`${CODE_PREFIX} ${next}`)) next++;
    pkg.code = `${CODE_PREFIX} ${next}`;
    codes.add(pkg.code);
  }

  writeJSON(PACKAGES_FILE, body);
  res.json({ ok: true });
});

app.put('/admin/api/gallery', requireOwner, (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.items)) return res.status(400).json({ error: 'Invalid data' });
  writeJSON(GALLERY_FILE, body);
  res.json({ ok: true });
});


// ================================================================
// Bookings + accounts
//
// Everything the owner needs to run the business lives in two files in
// DATA_DIR, next to the site content: bookings.json and expenses.json.
// No database — the volume is already the durable thing here, and one
// business doing a handful of bookings a week does not need more.
//
// A booking arrives one of two ways: a customer fills the form on the
// site (POST /api/bookings, public), or the owner enters one they took
// over the phone. Both land in the same list.
// ================================================================

const BOOKINGS_FILE = path.join(CONTENT_DIR, 'bookings.json');
const EXPENSES_FILE = path.join(CONTENT_DIR, 'expenses.json');

const BOOKING_STATUSES = ['new', 'confirmed', 'completed', 'cancelled'];
const PAYMENT_METHODS = ['Cash', 'bKash', 'Nagad', 'Rocket', 'Bank', 'Other'];

function readBookings() {
  const data = readJSON(BOOKINGS_FILE, null);
  if (data && Array.isArray(data.bookings)) return data;
  return { bookings: [], nextNumber: 1001 };
}

function readExpenses() {
  const data = readJSON(EXPENSES_FILE, null);
  if (data && Array.isArray(data.expenses)) return data;
  return { expenses: [] };
}

/// Trims and caps a free-text field. Length limits are the only real
/// defence a public endpoint has against someone pasting a novel into it.
function text(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max || 200);
}

function money(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/// A Bangladeshi number typed as 01712…, +88017… or 88017… is the same
/// person. Stored in one shape so two bookings from one customer can be
/// recognised as such.
function tidyPhone(value) {
  const raw = text(value, 24);
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('880')) return '+' + digits;
  if (digits.startsWith('0')) return '+88' + digits;
  if (digits.length === 10) return '+880' + digits;
  return raw;
}

/// What a booking looks like after the server has had its say. Callers
/// may send anything; only these fields survive, and each is clamped.
function normaliseBooking(input, existing) {
  const base = existing || {};
  const paymentsIn = Array.isArray(input.payments) ? input.payments : base.payments || [];

  const payments = paymentsIn.slice(0, 50).map((p, i) => ({
    id: text(p.id, 40) || `p${Date.now()}${i}`,
    date: text(p.date, 20) || new Date().toISOString().slice(0, 10),
    amount: money(p.amount),
    method: PAYMENT_METHODS.includes(p.method) ? p.method : 'Cash',
    note: text(p.note, 200),
  }));

  // A field the caller did not send keeps what the booking already had.
  // Anything else turns a partial update — "just set the price" — into a
  // silent erase of the package, the date and everything the customer wrote.
  const keep = (key, max) =>
    input[key] !== undefined ? text(input[key], max) : (base[key] || '');

  return {
    id: base.id,
    createdAt: base.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: base.source || (input.source === 'manual' ? 'manual' : 'website'),

    name: text(input.name, 80) || base.name || '',
    phone: input.phone !== undefined ? tidyPhone(input.phone) : base.phone || '',
    email: keep('email', 120),

    packageSlug: keep('packageSlug', 80),
    packageName: keep('packageName', 120),

    eventDate: keep('eventDate', 20),
    eventTime: keep('eventTime', 60),
    people: input.people !== undefined
      ? Math.min(Math.max(parseInt(input.people, 10) || 0, 0), 500)
      : (base.people || 0),
    occasion: keep('occasion', 60),
    note: keep('note', 1200),

    status: BOOKING_STATUSES.includes(input.status) ? input.status : base.status || 'new',
    // The agreed price. Deliberately separate from the package's listed
    // price: what a customer actually pays is negotiated, and the listing
    // is only where the conversation starts.
    price: input.price !== undefined ? money(input.price) : money(base.price),
    cost: input.cost !== undefined ? money(input.cost) : money(base.cost),
    payments,
    adminNote: keep('adminNote', 1200),

    // What we have told this customer, and how. An email that could not be
    // sent is not a silent failure: it shows up in the admin panel as
    // something still to say on WhatsApp.
    notified: Array.isArray(base.notified) ? base.notified : [],

    // The account this booking belongs to, so the customer can come back
    // and see it. Set once, on creation, and never taken from the request.
    customerId: base.customerId || '',

    // Screenshots of bKash / bank transfers the customer sent in.
    receipts: Array.isArray(base.receipts) ? base.receipts : [],
  };
}

/** Whole days from today to [date], in Bangladesh time. Negative once the
 *  day has passed, null when there is no date yet. Computed from the date
 *  alone, never the clock time, so "tomorrow" does not become "0 days" at
 *  one minute past midnight. */
function daysUntil(date) {
  if (!date) return null;
  const target = new Date(String(date).slice(0, 10) + 'T00:00:00+06:00');
  if (isNaN(target)) return null;
  const now = new Date();
  const todayDhaka = new Date(
    new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dhaka' })).toDateString() + ' 00:00:00 GMT+0600');
  return Math.round((target - todayDhaka) / 86400000);
}

const bookingPaid = (b) => (b.payments || []).reduce((sum, p) => sum + money(p.amount), 0);
const bookingDue = (b) => Math.max(money(b.price) - bookingPaid(b), 0);

/// Adds the figures the UI would otherwise have to recompute on every
/// render, so the arithmetic exists in exactly one place.
function withTotals(b) {
  const paid = bookingPaid(b);
  return { ...b, paid, due: Math.max(money(b.price) - paid, 0) };
}

// ---------------------------------------------------------------- public booking
//
// The only public write endpoint on the site. A booking here is a request,
// not a commitment: it arrives as 'new' and carries no price, because
// nothing a stranger can POST should be able to set what someone owes.

const recentPosts = new Map(); // ip -> [timestamps]

function tooManyFrom(ip) {
  const now = Date.now();
  const window = 10 * 60 * 1000;
  const hits = (recentPosts.get(ip) || []).filter((t) => now - t < window);
  hits.push(now);
  recentPosts.set(ip, hits);
  // Keep the map from growing without bound on a long-running process.
  if (recentPosts.size > 500) {
    for (const [key, times] of recentPosts) {
      if (!times.some((t) => now - t < window)) recentPosts.delete(key);
    }
  }
  return hits.length > 6;
}

app.post('/api/bookings', (req, res) => {
  const body = req.body || {};

  // A hidden field no human fills in. Answered with a cheerful 200 so a bot
  // gets no signal that it was caught.
  if (text(body.website, 100)) return res.json({ ok: true });

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (tooManyFrom(String(ip).split(',')[0].trim())) {
    return res.status(429).json({ error: 'Too many requests. Please try again in a few minutes.' });
  }

  const name = text(body.name, 80);
  const phone = tidyPhone(body.phone);
  const email = text(body.email, 120).toLowerCase();
  if (!name || phone.replace(/\D/g, '').length < 10) {
    return res.status(400).json({ error: 'Please enter your name and a valid mobile number.' });
  }
  // The email is optional. Plenty of customers here do not use one, and
  // demanding it would lose the booking. What it costs them is convenience:
  // no confirmation email, and no way to sign in from a second device. The
  // owner sees who has no address and messages them on WhatsApp instead.
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'That email address does not look right.' });
  }

  // An account, so this customer can come back and see the booking. Created
  // here rather than asked for up front: nobody chooses a password before
  // they have even asked a question.
  const customer = upsertCustomer({ name, phone, email });

  const store = readBookings();
  const booking = normaliseBooking(
    { ...body, name, phone, email, status: 'new', price: 0, cost: 0, payments: [], adminNote: '' },
    { source: 'website', customerId: customer.id },
  );
  booking.id = `CDM-${store.nextNumber}`;

  // A payment screenshot, if they paid before submitting. Only the filename
  // is taken: the file itself was already checked and stored by /api/receipt.
  const receiptFile = path.basename(text(body.receipt, 120));
  if (receiptFile && fs.existsSync(path.join(RECEIPTS_DIR, receiptFile))) {
    booking.receipts = [{
      file: receiptFile,
      method: text(body.paymentMethod, 40),
      amount: money(body.paidAmount),
      at: new Date().toISOString(),
    }];
  }

  store.nextNumber += 1;
  store.bookings.unshift(booking);
  writeJSON(BOOKINGS_FILE, store);

  // Signed in on this device straight away. They just proved who they are by
  // booking from it, so making them prove it again would be theatre.
  setSession(res, req, { role: 'customer', uid: customer.id, exp: Date.now() + CUSTOMER_SESSION_MS }, CUSTOMER_SESSION_MS);

  res.json({ ok: true, id: booking.id });

  // After the reply, so a slow mail provider never keeps the customer
  // waiting on a spinner.
  mailBookingReceived(booking).catch(() => {});
});

// ---------------------------------------------------------------- booking emails

const PRETTY_STATUS = {
  new: 'Received',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** The details block that appears in every booking email, so a customer
 *  always sees the same shape and can spot a wrong date at a glance. */
function bookingRows(booking) {
  return rowsHtml([
    ['Booking number', booking.id],
    ['Package', booking.packageName],
    ['Date', booking.eventDate],
    ['Time', booking.eventTime],
    ['People', booking.people || ''],
    ['Occasion', booking.occasion],
  ]);
}

/** Writes down that we tried to tell this customer something. Read back by
 *  the admin panel to show who is still waiting to hear from us. */
function recordNotice(bookingId, kind, result) {
  const store = readBookings();
  const booking = store.bookings.find((b) => b.id === bookingId);
  if (!booking) return;
  booking.notified = booking.notified || [];
  booking.notified.push({
    kind,
    at: new Date().toISOString(),
    // 'sent' when Gmail took it; 'pending' when there was nobody to send to
    // or the send failed, which is what the WhatsApp button is for.
    state: result && result.ok ? 'sent' : 'pending',
    why: result && (result.error || result.skipped) ? String(result.error || result.skipped) : '',
  });
  // Keep the trail short; the last handful is all anyone reads.
  if (booking.notified.length > 12) booking.notified = booking.notified.slice(-12);
  writeJSON(BOOKINGS_FILE, store);
}

async function mailBookingReceived(booking) {
  if (!booking.email) {
    recordNotice(booking.id, 'received', { skipped: 'no email address' });
    return;
  }
  const result = await sendMail(booking.email, `We have your booking — ${booking.id}`, mailShell(
    `Thank you, ${escapeHtml(booking.name)}`,
    `<p style="margin:0 0 16px;line-height:1.6">Your booking has reached us. We will check the date and
     come back to you shortly — usually within half an hour.</p>
     ${bookingRows(booking)}
     ${(booking.receipts || []).length
       ? '<p style="margin:16px 0 0;line-height:1.6">We can see your payment screenshot. It will be checked and added to your booking.</p>'
       : ''}
     <p style="margin:16px 0 0;line-height:1.6;color:#6B7A93;font-size:13px">
       Nothing is confirmed until we reply — please do not make travel plans around this date yet.</p>`,
    'See your booking', `${SITE_URL}/my-bookings.html`));
  recordNotice(booking.id, 'received', result);
}

async function mailBookingUpdated(booking, previous) {
  const statusChanged = previous.status !== booking.status;
  const paidBefore = (previous.payments || []).reduce((sum, p) => sum + money(p.amount), 0);
  const paidNow = (booking.payments || []).reduce((sum, p) => sum + money(p.amount), 0);
  const paymentAdded = paidNow > paidBefore;
  const priceChanged = money(previous.price) !== money(booking.price);

  // Only write when something the customer would care about actually moved.
  // An email for every keystroke in the admin panel teaches people to ignore
  // our emails, which is worse than sending none.
  if (!statusChanged && !paymentAdded && !priceChanged) return;

  const kind = statusChanged ? booking.status : (paymentAdded ? 'payment' : 'price');
  if (!booking.email) {
    recordNotice(booking.id, kind, { skipped: 'no email address' });
    return;
  }

  const due = Math.max(money(booking.price) - paidNow, 0);
  const headings = {
    confirmed: 'Your booking is confirmed',
    completed: 'Thank you for choosing us',
    cancelled: 'Your booking has been cancelled',
  };
  const heading = statusChanged
    ? (headings[booking.status] || `Your booking is now ${PRETTY_STATUS[booking.status] || booking.status}`)
    : (paymentAdded ? 'We have received your payment' : 'Your booking has been updated');

  let intro;
  if (booking.status === 'cancelled') {
    intro = 'This booking has been cancelled. If that is not what you expected, please message us — it may be a mistake at our end.';
  } else if (booking.status === 'completed') {
    intro = 'We hope the evening was everything you wanted. If you have a moment, we would love to hear how it went.';
  } else if (paymentAdded) {
    intro = `We have recorded ${escapeHtml('\u09f3' + (paidNow - paidBefore).toLocaleString('en-IN'))} against your booking.`;
  } else if (statusChanged && booking.status === 'confirmed') {
    intro = 'Your date is held. Our team will be on the beach two hours before your time to set everything up.';
  } else {
    intro = 'Here is where your booking stands now.';
  }

  const result = await sendMail(booking.email, `${heading} — ${booking.id}`, mailShell(
    heading,
    `<p style="margin:0 0 16px;line-height:1.6">${intro}</p>
     ${bookingRows(booking)}
     ${booking.price ? `<div style="margin-top:16px;padding:14px 16px;background:#FBF7F1;border-radius:10px">
       ${rowsHtml([
         ['Total', '\u09f3' + money(booking.price).toLocaleString('en-IN')],
         ['Paid', '\u09f3' + paidNow.toLocaleString('en-IN')],
         ['Still to pay', due ? '\u09f3' + due.toLocaleString('en-IN') : 'Nothing — fully paid'],
       ])}
     </div>` : ''}`,
    'See your booking', `${SITE_URL}/my-bookings.html`));
  recordNotice(booking.id, kind, result);
}

// ------------------------------------------------------------ reminders
//
// Messages the owner sends because they want to, not because a field
// changed: the nudge the day before, the "we are ready" on the morning.
// Kept here rather than typed each time, so every customer gets the same
// wording and nobody has to compose one at eleven at night.

const REMINDERS = {
  tomorrow: {
    label: 'Tomorrow \u2014 gentle reminder',
    heading: 'We see you tomorrow',
    subject: (b) => `See you tomorrow \u2014 ${b.id}`,
    body: (b) =>
      `<p style="margin:0 0 16px;line-height:1.6">Just a quick note that your setup is tomorrow. `
      + `Our team will be on the beach two hours before your time, so everything is finished `
      + `before you arrive.</p>`,
  },
  ready: {
    label: 'Today \u2014 we are ready and waiting',
    heading: 'Everything is ready',
    subject: (b) => `We are ready for you \u2014 ${b.id}`,
    body: () =>
      `<p style="margin:0 0 16px;line-height:1.6">Your setup is ready and we are waiting for you. `
      + `Take your time \u2014 we are here until you arrive.</p>`,
  },
  balance: {
    label: 'Payment still due',
    heading: 'A note about your booking',
    subject: (b) => `Your booking \u2014 ${b.id}`,
    body: (b, paid, due) =>
      `<p style="margin:0 0 16px;line-height:1.6">A gentle reminder about the balance on your `
      + `booking. You can pay it on the day, or send it ahead if that is easier \u2014 whichever `
      + `suits you.</p>`,
  },
  thanks: {
    label: 'After the event \u2014 thank you',
    heading: 'Thank you',
    subject: (b) => `Thank you from Cox's Dream Moment \u2014 ${b.id}`,
    body: () =>
      `<p style="margin:0 0 16px;line-height:1.6">We hope your evening was everything you wanted. `
      + `It was a pleasure to set it up for you. If you have a moment, we would love to hear how `
      + `it went \u2014 and if you would share a photograph, even better.</p>`,
  },
};

app.get('/admin/api/reminders', requireOwner, (req, res) => {
  res.json({
    reminders: Object.keys(REMINDERS).map((id) => ({ id, label: REMINDERS[id].label })),
    mailReady: mailReady(),
  });
});

app.post('/admin/api/bookings/:id/remind', requireOwner, async (req, res) => {
  const kind = String((req.body || {}).kind || '');
  const template = REMINDERS[kind];
  if (!template) return res.status(400).json({ error: 'Unknown reminder.' });

  const booking = readBookings().bookings.find((b) => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const paid = bookingPaid(booking);
  const due = Math.max(money(booking.price) - paid, 0);

  if (!booking.email) {
    recordNotice(booking.id, kind, { skipped: 'no email address' });
    return res.json({ ok: true, sent: false, reason: 'no email address' });
  }

  const result = await sendMail(booking.email, template.subject(booking), mailShell(
    template.heading,
    `<p style="margin:0 0 16px;line-height:1.6">Hello ${escapeHtml(booking.name)},</p>`
    + template.body(booking, paid, due)
    + bookingRows(booking)
    + (booking.price ? `<div style="margin-top:16px;padding:14px 16px;background:#FBF7F1;border-radius:10px">
        ${rowsHtml([
          ['Total', '\u09f3' + money(booking.price).toLocaleString('en-IN')],
          ['Paid', '\u09f3' + paid.toLocaleString('en-IN')],
          ['Still to pay', due ? '\u09f3' + due.toLocaleString('en-IN') : 'Nothing \u2014 fully paid'],
        ])}
      </div>` : ''),
    'See your booking', `${SITE_URL}/my-bookings`));

  recordNotice(booking.id, kind, result);
  res.json({ ok: true, sent: !!result.ok, reason: result.error || result.skipped || '' });
});

// ---------------------------------------------------------------- admin bookings

app.get('/admin/api/bookings', requireOwner, (req, res) => {
  const store = readBookings();
  res.json({ bookings: store.bookings.map(withTotals) });
});

app.post('/admin/api/bookings', requireOwner, (req, res) => {
  const store = readBookings();
  const booking = normaliseBooking(req.body || {}, { source: 'manual' });
  if (!booking.name) return res.status(400).json({ error: 'A name is required.' });
  booking.id = `CDM-${store.nextNumber}`;
  store.nextNumber += 1;
  store.bookings.unshift(booking);
  writeJSON(BOOKINGS_FILE, store);
  res.json({ ok: true, booking: withTotals(booking) });
});

app.put('/admin/api/bookings/:id', requireOwner, (req, res) => {
  const store = readBookings();
  const index = store.bookings.findIndex((b) => b.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Booking not found.' });
  const previous = store.bookings[index];
  const updated = normaliseBooking(req.body || {}, previous);
  updated.id = previous.id;
  store.bookings[index] = updated;
  writeJSON(BOOKINGS_FILE, store);
  res.json({ ok: true, booking: withTotals(updated) });

  mailBookingUpdated(updated, previous).catch(() => {});
});

app.delete('/admin/api/bookings/:id', requireOwner, (req, res) => {
  const store = readBookings();
  const before = store.bookings.length;
  store.bookings = store.bookings.filter((b) => b.id !== req.params.id);
  if (store.bookings.length === before) return res.status(404).json({ error: 'Booking not found.' });
  writeJSON(BOOKINGS_FILE, store);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- expenses

app.get('/admin/api/expenses', requireAuth, (req, res) => {
  res.json(readExpenses());
});

app.post('/admin/api/expenses', requireAuth, (req, res) => {
  const body = req.body || {};
  const store = readExpenses();
  const expense = {
    id: `e${Date.now()}`,
    date: text(body.date, 20) || new Date().toISOString().slice(0, 10),
    amount: money(body.amount),
    category: text(body.category, 60) || 'Other',
    note: text(body.note, 200),
    bookingId: text(body.bookingId, 40),
    // Who recorded it. Taken from the session, never from the request, so a
    // cost cannot be entered under someone else's name.
    byId: req.user ? req.user.id : '',
    byName: req.user ? (req.user.name || 'Owner') : '',
  };
  if (!expense.amount) return res.status(400).json({ error: 'Enter an amount.' });
  store.expenses.unshift(expense);
  writeJSON(EXPENSES_FILE, store);
  res.json({ ok: true, expense });
});

app.delete('/admin/api/expenses/:id', requireOwner, (req, res) => {
  const store = readExpenses();
  const before = store.expenses.length;
  store.expenses = store.expenses.filter((e) => e.id !== req.params.id);
  if (store.expenses.length === before) return res.status(404).json({ error: 'Not found.' });
  writeJSON(EXPENSES_FILE, store);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- summary
//
// The dashboard's numbers, computed server-side so every screen showing
// "this month's income" is showing the same figure.

app.get('/admin/api/summary', requireOwner, (req, res) => {
  const bookings = readBookings().bookings;
  const expenses = readExpenses().expenses;

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const inMonth = (iso) => typeof iso === 'string' && iso.slice(0, 7) === monthKey;

  let received = 0;
  let receivedThisMonth = 0;
  let due = 0;
  let booked = 0;

  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    booked += money(b.price);
    due += bookingDue(b);
    for (const p of b.payments || []) {
      received += money(p.amount);
      if (inMonth(p.date)) receivedThisMonth += money(p.amount);
    }
  }

  const spent = expenses.reduce((sum, e) => sum + money(e.amount), 0);
  const spentThisMonth = expenses
    .filter((e) => inMonth(e.date))
    .reduce((sum, e) => sum + money(e.amount), 0);

  const byStatus = {};
  for (const s of BOOKING_STATUSES) byStatus[s] = bookings.filter((b) => b.status === s).length;

  // Which packages actually sell. Cancelled bookings are left out — they
  // would otherwise make an unpopular package look busy.
  const packageCounts = {};
  for (const b of bookings) {
    if (b.status === 'cancelled' || !b.packageName) continue;
    const entry = packageCounts[b.packageName] || { name: b.packageName, count: 0, value: 0 };
    entry.count += 1;
    entry.value += money(b.price);
    packageCounts[b.packageName] = entry;
  }
  const topPackages = Object.values(packageCounts).sort((a, b) => b.count - a.count).slice(0, 6);

  // Six months of income and spending, oldest first, for the chart.
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let income = 0;
    for (const b of bookings) {
      for (const p of b.payments || []) if ((p.date || '').slice(0, 7) === key) income += money(p.amount);
    }
    const outgoing = expenses
      .filter((e) => (e.date || '').slice(0, 7) === key)
      .reduce((sum, e) => sum + money(e.amount), 0);
    months.push({ key, label: d.toLocaleString('en', { month: 'short' }), income, spent: outgoing });
  }

  res.json({
    totals: {
      bookings: bookings.length,
      booked,
      received,
      due,
      spent,
      profit: received - spent,
      receivedThisMonth,
      spentThisMonth,
      profitThisMonth: receivedThisMonth - spentThisMonth,
    },
    byStatus,
    topPackages,
    months,
    recent: bookings.slice(0, 8).map(withTotals),
  });
});

// ---------------------------------------------------------------- staff summary
//
// Deliberately thin. A staff member sees what they have spent and how many
// packages are live, and nothing about bookings or income.

app.get('/admin/api/staff-summary', requireAuth, (req, res) => {
  const expenses = readExpenses().expenses;
  const packages = readJSON(PACKAGES_FILE, { packages: [] }).packages || [];

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const mine = expenses.filter((e) => e.byId === req.user.id);

  res.json({
    packages: packages.length,
    featured: packages.filter((p) => p.featured).length,
    myCostsThisMonth: mine.filter((e) => (e.date || '').slice(0, 7) === monthKey)
      .reduce((sum, e) => sum + money(e.amount), 0),
    myCostsTotal: mine.reduce((sum, e) => sum + money(e.amount), 0),
    myCostCount: mine.length,
  });
});

// ---------------------------------------------------------------- chat
//
// One conversation per customer, kept in a single file. Not a chat product:
// a laundry-list of messages between a customer and whoever is working, with
// an email on each side so nobody has to sit watching the page.
//
// Both sides are emailed, but not on every message. A conversation is a
// burst of four or five lines, and five emails for one exchange teaches
// people to ignore our emails. One goes out, then nothing for MAIL_GAP_MS
// unless the other side has spoken since.

const CHAT_FILE = path.join(CONTENT_DIR, 'chats.json');
const MAIL_GAP_MS = 10 * 60 * 1000;
const MAX_MESSAGE = 2000;

function readChats() {
  const data = readJSON(CHAT_FILE, null);
  if (data && Array.isArray(data.threads)) return data;
  return { threads: [] };
}

function threadFor(store, customerId, create) {
  let thread = store.threads.find((t) => t.customerId === customerId);
  if (!thread && create) {
    thread = {
      customerId,
      messages: [],
      // When each side last had an email about this thread, so a burst of
      // replies does not become a burst of emails.
      lastMailedTeam: 0,
      lastMailedCustomer: 0,
    };
    store.threads.push(thread);
  }
  return thread;
}

/** Everyone who should hear about a customer message: the owner, and every
 *  member of staff who is still active. */
function teamAddresses() {
  const settings = readJSON(SETTINGS_FILE, {});
  const list = [];
  if (GMAIL_USER) list.push(GMAIL_USER);
  if (settings.email && settings.email !== GMAIL_USER) list.push(settings.email);
  for (const u of readUsers().users) {
    if (u.role === 'staff' && u.active !== false && u.email) list.push(u.email);
  }
  return Array.from(new Set(list));
}

const unreadFor = (thread, side) =>
  (thread.messages || []).filter((m) => m.from !== side && !m.readBy[side]).length;

function markRead(thread, side) {
  for (const m of thread.messages || []) {
    if (m.from !== side) m.readBy[side] = true;
  }
}

/** What the other side sees. `readBy` is bookkeeping, not content. */
const publicMessage = (m) => ({
  id: m.id,
  from: m.from,
  byName: m.byName,
  text: m.text,
  at: m.at,
});

/** An account from a chat, for somebody who has not booked anything.
 *
 *  Email is required because it is the only way to answer once they close
 *  the tab. The number is optional here and required for a booking: we can
 *  answer a question by email, but we cannot reach someone on a beach.
 */
app.post('/api/chat-signup', (req, res) => {
  const body = req.body || {};

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (tooManyFrom('chat-signup:' + ip)) {
    return res.status(429).json({ error: 'Too many tries. Please wait a few minutes.' });
  }

  const email = text(body.email, 120).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address so we can reply.' });
  }

  const user = upsertCustomer({
    name: text(body.name, 80),
    phone: tidyPhone(body.phone),
    email,
  });

  setSession(res, req, {
    role: 'customer',
    uid: user.id,
    // Started from a chat box, so it sees the conversation and its own
    // bookings, but not payment screenshots. Same rule as a phone sign-in.
    weak: true,
    exp: Date.now() + CUSTOMER_SESSION_MS,
  }, CUSTOMER_SESSION_MS);

  res.json({ ok: true, name: user.name });
});

// ---------------------------------------------------------------- customer side

app.get('/api/chat', requireCustomer, (req, res) => {
  const store = readChats();
  const thread = threadFor(store, req.user.id, false);
  if (!thread) return res.json({ messages: [] });

  markRead(thread, 'customer');
  writeJSON(CHAT_FILE, store);
  res.json({ messages: thread.messages.map(publicMessage) });
});

app.post('/api/chat', requireCustomer, async (req, res) => {
  const text = String((req.body || {}).text || '').trim().slice(0, MAX_MESSAGE);
  if (!text) return res.status(400).json({ error: 'Write something first.' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (tooManyFrom('chat:' + ip)) {
    return res.status(429).json({ error: 'Too many messages. Please wait a moment.' });
  }

  const store = readChats();
  const thread = threadFor(store, req.user.id, true);
  thread.messages.push({
    id: 'm' + Date.now() + crypto.randomBytes(3).toString('hex'),
    from: 'customer',
    byName: req.user.name || 'Customer',
    text,
    at: new Date().toISOString(),
    readBy: { customer: true, team: false },
  });

  const shouldMail = Date.now() - (thread.lastMailedTeam || 0) > MAIL_GAP_MS;
  if (shouldMail) thread.lastMailedTeam = Date.now();
  writeJSON(CHAT_FILE, store);

  res.json({ ok: true, messages: thread.messages.map(publicMessage) });

  if (!shouldMail) return;

  // After the reply: the customer should never wait on our mail provider.
  const who = req.user.name || 'A customer';
  const phone = req.user.phone || '';
  for (const address of teamAddresses()) {
    sendMail(address, `New message from ${who}`, mailShell(
      'A customer has written to you',
      `${rowsHtml([['From', who], ['Mobile', phone], ['Email', req.user.email || '']])}
       <div style="margin-top:16px;padding:14px 16px;background:#FBF7F1;border-radius:10px;
                   font-size:14px;line-height:1.65;white-space:pre-wrap">${escapeHtml(text)}</div>
       <p style="margin:16px 0 0;font-size:13px;color:#6B7A93;line-height:1.6">
         Reply in the Control Room and it reaches them on the website and by email.</p>`,
      'Open the Control Room', `${SITE_URL}/admin/`)).catch(() => {});
  }
});

// ---------------------------------------------------------------- team side
//
// Staff can read and answer. They still cannot see a booking, a price or
// what anyone owes — answering a question is the job; the money is not.

app.get('/admin/api/chats', requireAuth, (req, res) => {
  const store = readChats();
  const users = readUsers().users;

  const threads = store.threads.map((t) => {
    const user = users.find((u) => u.id === t.customerId);
    const last = t.messages[t.messages.length - 1];
    return {
      customerId: t.customerId,
      name: (user && user.name) || 'Customer',
      phone: (user && user.phone) || '',
      email: (user && user.email) || '',
      unread: unreadFor(t, 'team'),
      total: t.messages.length,
      lastAt: last ? last.at : '',
      lastFrom: last ? last.from : '',
      preview: last ? last.text.slice(0, 90) : '',
    };
  });

  // Unanswered first, then most recent: the list is a queue, not an archive.
  threads.sort((a, b) =>
    (b.unread - a.unread) || String(b.lastAt).localeCompare(String(a.lastAt)));

  res.json({ threads, unread: threads.reduce((n, t) => n + t.unread, 0) });
});

app.get('/admin/api/chats/:customerId', requireAuth, (req, res) => {
  const store = readChats();
  const thread = threadFor(store, req.params.customerId, false);
  if (!thread) return res.json({ messages: [] });

  markRead(thread, 'team');
  writeJSON(CHAT_FILE, store);

  const user = readUsers().users.find((u) => u.id === req.params.customerId);
  res.json({
    messages: thread.messages.map(publicMessage),
    name: (user && user.name) || 'Customer',
    phone: (user && user.phone) || '',
    email: (user && user.email) || '',
  });
});

app.post('/admin/api/chats/:customerId', requireAuth, async (req, res) => {
  const text = String((req.body || {}).text || '').trim().slice(0, MAX_MESSAGE);
  if (!text) return res.status(400).json({ error: 'Write something first.' });

  const user = readUsers().users.find((u) => u.id === req.params.customerId && u.role === 'customer');
  if (!user) return res.status(404).json({ error: 'Customer not found.' });

  const store = readChats();
  const thread = threadFor(store, req.params.customerId, true);
  thread.messages.push({
    id: 'm' + Date.now() + crypto.randomBytes(3).toString('hex'),
    from: 'team',
    // Signed, so the customer is talking to a person and the owner can see
    // who answered.
    byName: req.user.name || 'Cox’s Dream Moment',
    text,
    at: new Date().toISOString(),
    readBy: { customer: false, team: true },
  });

  const shouldMail = Date.now() - (thread.lastMailedCustomer || 0) > MAIL_GAP_MS;
  if (shouldMail) thread.lastMailedCustomer = Date.now();
  writeJSON(CHAT_FILE, store);

  res.json({ ok: true, messages: thread.messages.map(publicMessage) });

  if (!shouldMail || !user.email) return;

  sendMail(user.email, 'We have replied to your message', mailShell(
    'We have replied',
    `<p style="margin:0 0 16px;line-height:1.6">Hello ${escapeHtml(user.name || '')},</p>
     <div style="padding:14px 16px;background:#FBF7F1;border-radius:10px;
                 font-size:14px;line-height:1.65;white-space:pre-wrap">${escapeHtml(text)}</div>
     <p style="margin:16px 0 0;line-height:1.6;font-size:13px;color:#6B7A93">
       You can answer on the website — the whole conversation is there.</p>`,
    'Open the conversation', `${SITE_URL}/my-bookings`)).catch(() => {});
});

// ---------------------------------------------------------------- image upload
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMAGES_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.jpg';
      const base = path
        .basename(file.originalname, path.extname(file.originalname))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'image';
      cb(null, `${base}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype));
  },
});

app.post('/admin/api/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image upload failed (jpg/png/webp/gif, up to 8MB)' });
  res.json({ path: `images/${req.file.filename}` });
});

// ---------------------------------------------------------------- static site + admin UI
//
// URLs without .html. /shop is the address; /shop.html redirects to it
// permanently, so links already shared, bookmarked or indexed keep working
// and search engines learn the new address rather than seeing two pages
// with the same content.

// shop.html is the home page — index.html has only ever been a redirect to
// it — so it is served at / and its own two addresses point back here. One
// page, one address.
const HOME_ALIASES = new Set(['index', 'shop']);

app.get(/^\/(.+)\.html$/, (req, res) => {
  const name = req.params[0];
  const target = HOME_ALIASES.has(name) ? '/' : '/' + name;
  const query = req.originalUrl.slice(req.path.length);
  res.redirect(301, target + query);
});

app.get('/shop', (req, res) => res.redirect(301, '/' + req.originalUrl.slice(req.path.length)));

app.get('/', (req, res) => res.sendFile(path.join(APP_DIR, 'shop.html')));

app.use('/admin', express.static(path.join(APP_DIR, 'admin')));

// `extensions` is what makes /shop find shop.html. index:false stops
// express serving /some-folder/index.html for a bare directory.
app.use(express.static(APP_DIR, { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`Cox's Dream Moment running on port ${PORT}`);
  console.log(`DATA_DIR = ${DATA_DIR}`);
  if (!ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD is not set - /admin login will refuse everyone.');
});

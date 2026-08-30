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

// ---------------------------------------------------------------- tiny signed-cookie session
// No session store needed: the cookie itself carries an expiry and an
// HMAC signature, so a single Railway instance (or many, since they'd
// share SESSION_SECRET) can verify it statelessly.
function signSession(expiresAt) {
  const payload = `admin.${expiresAt}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifySession(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [role, expiresAtStr, sig] = parts;
  const payload = `${role}.${expiresAtStr}`;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  const expiresAt = Number(expiresAtStr);
  return role === 'admin' && Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

function requireAuth(req, res, next) {
  if (verifySession(req.cookies && req.cookies.admin_session)) return next();
  res.status(401).json({ error: 'Login required' });
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

// Every package advertises the same facilities. The four that predate that
// decision still carry their old lists in the volume, so bring them into line.
// Written out here rather than read from the seed so a later seed edit cannot
// silently change what this one-shot migration meant when it ran.
runOnce('shared-inclusions', () => {
  const shared = [
    'Customized cake',
    'Mineral water',
    'Welcome drinks',
    'Free music system',
    'Pickup & drop service',
    'Professional photography',
    'Professional cinematography & cinematic video shoot',
    'Premium luxury decoration setup',
    'And many more attractive facilities!',
  ];

  const data = readJSON(PACKAGES_FILE, null);
  if (!data || !Array.isArray(data.packages)) return false;

  let updated = 0;
  data.packages.forEach(p => {
    const current = Array.isArray(p.inclusions) ? p.inclusions : [];
    const same = current.length === shared.length
      && current.every((v, i) => v === shared[i]);
    if (same) return;
    p.inclusions = shared.slice();
    updated++;
  });

  if (!updated) return false;
  writeJSON(PACKAGES_FILE, data);
  console.log(`Applied the shared inclusions list to ${updated} package(s)`);
  return true;
});

// Owner is re-pricing the whole catalogue from the admin panel, so clear the
// prices that are already deployed and let each be set fresh. A package with no
// price simply hides its price line and total until one is entered.
runOnce('clear-package-prices', () => {
  const data = readJSON(PACKAGES_FILE, null);
  if (!data || !Array.isArray(data.packages)) return false;
  let cleared = 0;
  data.packages.forEach(p => {
    for (const key of ['price', 'old_price', 'discount']) {
      if (p[key]) { p[key] = ''; cleared++; }
    }
  });
  if (!cleared) return false;
  writeJSON(PACKAGES_FILE, data);
  return true;
});

// Half the catalogue is a sunset setting and half is after dark, and the
// descriptive copy moved to Bangla while names, codes, inclusions and prices
// stay in English. Both are content, so the deployed volume needs them applied
// directly rather than through the seed.
runOnce('sunset-night-bangla', () => {
  const sunset = ["simple", "sunset", "luxury", "sunset-serenade", "ocean-breeze"];
  const night = ["royal", "moonlight-romance", "starlight-dinner", "grand-celebration", "signature-elite"];
  const copy = {
    sunset: { trust_extra: "সূর্যাস্তের সময়", description: "সূর্যাস্তের সোনালি আলোয় কক্সবাজার সৈকতে সাজানো একটি সম্পূর্ণ প্রিমিয়াম সেটআপ। কাস্টমাইজড কেক, ওয়েলকাম ড্রিংকস, মিউজিক সিস্টেম, পিকআপ ও ড্রপ সার্ভিস এবং প্রফেশনাল ফটোগ্রাফি ও সিনেমাটোগ্রাফি — সবকিছু মিলিয়ে আপনার বিশেষ মুহূর্তটি হয়ে উঠবে স্মরণীয়।" },
    night: { trust_extra: "রাতের আয়োজন", description: "রাতের আকাশের নিচে আলো-ঝলমলে একটি সম্পূর্ণ প্রিমিয়াম সেটআপ, কক্সবাজার সৈকতে। কাস্টমাইজড কেক, ওয়েলকাম ড্রিংকস, মিউজিক সিস্টেম, পিকআপ ও ড্রপ সার্ভিস এবং প্রফেশনাল ফটোগ্রাফি ও সিনেমাটোগ্রাফি — সবকিছু মিলিয়ে আপনার বিশেষ মুহূর্তটি হয়ে উঠবে স্মরণীয়।" },
  };
  const policy = "বুকিং নিশ্চিত করতে ৩০% অগ্রিম প্রয়োজন। ইভেন্টের ৪৮ ঘণ্টা আগে তারিখ পরিবর্তন করা যাবে বিনামূল্যে। ২৪ ঘণ্টার মধ্যে বাতিল করলে অগ্রিম ফেরতযোগ্য নয়।";
  const faq = "সেটআপে সাধারণত ৪৫–৬০ মিনিট সময় লাগে। বৃষ্টি হলে বিনামূল্যে তারিখ পরিবর্তনের সুযোগ থাকবে।";

  const data = readJSON(PACKAGES_FILE, null);
  if (data && Array.isArray(data.packages)) {
    data.packages.forEach(p => {
      const group = sunset.includes(p.slug) ? 'sunset'
                  : night.includes(p.slug) ? 'night'
                  : null;
      if (!group) return;   // something the owner added since - leave it alone
      p.badge = group === 'sunset' ? 'Sunset' : 'Night';
      p.categories = [group];
      p.trust_extra = copy[group].trust_extra;
      p.description = copy[group].description;
      p.booking_policy = policy;
      p.faq = faq;
    });
    writeJSON(PACKAGES_FILE, data);
  }

  const settings = readJSON(SETTINGS_FILE, null);
  if (settings) {
    Object.assign(settings, {"topbar_announcement": "কক্সবাজার জুড়ে সার্ভিস প্রদান করি 🌊", "service_area": "কক্সবাজার সমুদ্র সৈকত ও আশেপাশের এলাকা", "address": "কক্সবাজার, বাংলাদেশ", "hours_note": "ইভেন্টের দিন আমাদের টিম সেটআপের ২ ঘণ্টা আগে থেকেই সৈকতে উপস্থিত থাকে।", "footer_desc": "কক্সবাজার সমুদ্র সৈকতে স্বপ্নের প্রপোজাল ও ডেকোরেশন সার্ভিস। আপনার বিশেষ মুহূর্তকে করে তুলি স্মরণীয়।"});
    settings.hours = [{"days": "শনি – বৃহস্পতি", "time": "সকাল ৯টা – রাত ৯টা"}, {"days": "শুক্রবার", "time": "দুপুর ২টা – রাত ৯টা"}];
    settings.hero = Object.assign({}, settings.hero, {"eyebrow": "কক্সবাজারের সমুদ্র সৈকতে সেরা মুহূর্ত", "heading": "আপনার স্বপ্নের প্রপোজাল মুহূর্ত<br>আমরা সাজিয়ে দিই", "subheading": "সূর্যাস্তের আলোয়, ফুলের সাজে — কক্সবাজার সৈকতে বুক করুন আপনার বিশেষ সন্ধ্যা।", "cta_text": "প্যাকেজ দেখুন"});
    writeJSON(SETTINGS_FILE, settings);
  }

  const gallery = readJSON(GALLERY_FILE, null);
  if (gallery) {
    gallery.note = "* বর্তমানে ডেমো গ্যালারি — শীঘ্রই আরও বাস্তব ইভেন্টের ছবি যুক্ত হবে।";
    writeJSON(GALLERY_FILE, gallery);
  }

  return true;
});

// Booking extras became a list so more than one can be offered, and the second
// one - Special Dinner - is quoted on request rather than at a set fee.
runOnce('booking-extras-list', () => {
  const settings = readJSON(SETTINGS_FILE, null);
  if (!settings) return false;
  if (Array.isArray(settings.addons) && settings.addons.length) return false;
  settings.addons = [{"label": "Drone Shot (Cinematic Special Drone Video)", "fee": "2000"}, {"label": "Special Dinner", "fee": ""}];
  delete settings.drone_addon;
  writeJSON(SETTINGS_FILE, settings);
  return true;
});






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

// ---------------------------------------------------------------- admin auth
app.post('/admin/api/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD is not set on the server. Add it under Railway Variables.' });
  }
  const { password } = req.body || {};
  const given = Buffer.from(String(password || ''));
  const expected = Buffer.from(ADMIN_PASSWORD);
  const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
  if (!ok) return res.status(401).json({ error: 'Wrong password' });

  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  res.cookie('admin_session', signSession(expiresAt), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: SESSION_MAX_AGE_MS,
  });
  res.json({ ok: true });
});

app.post('/admin/api/logout', (req, res) => {
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

app.get('/admin/api/session', (req, res) => {
  res.json({ authenticated: verifySession(req.cookies && req.cookies.admin_session) });
});

// ---------------------------------------------------------------- admin content API
app.get('/admin/api/data', requireAuth, (req, res) => {
  res.json({
    settings: readJSON(SETTINGS_FILE, {}),
    packages: readJSON(PACKAGES_FILE, { packages: [] }),
    gallery: readJSON(GALLERY_FILE, { items: [] }),
  });
});

app.put('/admin/api/settings', requireAuth, (req, res) => {
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

app.put('/admin/api/gallery', requireAuth, (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.items)) return res.status(400).json({ error: 'Invalid data' });
  writeJSON(GALLERY_FILE, body);
  res.json({ ok: true });
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
app.use('/admin', express.static(path.join(APP_DIR, 'admin')));
app.use(express.static(APP_DIR));

app.listen(PORT, () => {
  console.log(`Cox's Dream Moment running on port ${PORT}`);
  console.log(`DATA_DIR = ${DATA_DIR}`);
  if (!ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD is not set - /admin login will refuse everyone.');
});

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

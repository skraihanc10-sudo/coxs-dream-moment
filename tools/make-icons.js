/* ==========================================================================
   Builds the square app icons a phone needs to install the site.
   Run with: node tools/make-icons.js

   The logo is a wide wordmark (680x436) and every icon slot is square, so
   it is scaled to fit and centred on the brand's sand colour rather than
   stretched. A stretched logo is the first thing anyone notices on a home
   screen.

   Two shapes are produced for each size:

     icon-<n>.png          the logo filling most of the square
     icon-<n>-maskable.png the same logo, smaller, with room around it

   Android crops a maskable icon into whatever shape the launcher uses — a
   circle, a squircle, a rounded square. Anything within about 20% of the
   edge can be cut off, so the maskable version keeps well clear.

   pngjs is a devDependency: this runs once, on a laptop, and the icons are
   committed. Nothing here ships to the server.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'images', 'logo.png');
const OUT_DIR = path.join(ROOT, 'images');

// The site's own sand, so the icon does not sit on a white square that
// glows against a dark wallpaper.
const BACKGROUND = [0xFB, 0xF7, 0xF1, 255];

/** Bilinear sampling. Nearest-neighbour leaves the wordmark's thin strokes
 *  ragged at these sizes, which is exactly where it would be noticed. */
function sample(src, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, src.width - 1);
  const y1 = Math.min(y0 + 1, src.height - 1);
  const fx = x - x0;
  const fy = y - y0;

  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const p00 = src.data[(y0 * src.width + x0) * 4 + c];
    const p10 = src.data[(y0 * src.width + x1) * 4 + c];
    const p01 = src.data[(y1 * src.width + x0) * 4 + c];
    const p11 = src.data[(y1 * src.width + x1) * 4 + c];
    const top = p00 + (p10 - p00) * fx;
    const bottom = p01 + (p11 - p01) * fx;
    out[c] = top + (bottom - top) * fy;
  }
  return out;
}

function makeIcon(src, size, inset) {
  const png = new PNG({ width: size, height: size });

  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = BACKGROUND[0];
    png.data[i + 1] = BACKGROUND[1];
    png.data[i + 2] = BACKGROUND[2];
    png.data[i + 3] = BACKGROUND[3];
  }

  // Fit the whole logo inside the safe box, keeping its proportions.
  const box = size * (1 - inset * 2);
  const scale = Math.min(box / src.width, box / src.height);
  const drawW = Math.round(src.width * scale);
  const drawH = Math.round(src.height * scale);
  const offX = Math.round((size - drawW) / 2);
  const offY = Math.round((size - drawH) / 2);

  for (let y = 0; y < drawH; y++) {
    for (let x = 0; x < drawW; x++) {
      const [r, g, b, a] = sample(src, (x / drawW) * (src.width - 1), (y / drawH) * (src.height - 1));
      const alpha = a / 255;
      const target = ((offY + y) * size + (offX + x)) * 4;
      // Composite over the background: the logo has transparent corners and
      // leaving them transparent would show the launcher's own colour
      // through, which looks like a mistake.
      png.data[target] = Math.round(r * alpha + BACKGROUND[0] * (1 - alpha));
      png.data[target + 1] = Math.round(g * alpha + BACKGROUND[1] * (1 - alpha));
      png.data[target + 2] = Math.round(b * alpha + BACKGROUND[2] * (1 - alpha));
      png.data[target + 3] = 255;
    }
  }
  return png;
}

const source = PNG.sync.read(fs.readFileSync(SOURCE));
console.log(`source: ${source.width}x${source.height}`);

const jobs = [
  ['icon-192.png', 192, 0.08],
  ['icon-512.png', 512, 0.08],
  // Well inside the 20% a launcher may crop.
  ['icon-192-maskable.png', 192, 0.22],
  ['icon-512-maskable.png', 512, 0.22],
  // Apple has no maskable concept and puts its own rounded corners on.
  ['apple-touch-icon.png', 180, 0.10],
];

for (const [name, size, inset] of jobs) {
  const png = makeIcon(source, size, inset);
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, PNG.sync.write(png));
  console.log(`  ${name.padEnd(26)} ${size}x${size}  ${(fs.statSync(file).size / 1024).toFixed(0)}KB`);
}

console.log('done');

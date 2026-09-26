// ==========================================================================
// Rebuilds content/packages.json.
//
// Every package includes the same five things:
//
//   Premium beach decoration setup
//   Mineral water
//   Welcome drinks
//   Free music system
//   Customized cake
//
// That is the whole package. Nothing is added on top of it here, because a
// list printed on the website is a promise, and the only safe promise is the
// one the owner actually made. Anything beyond these five - photography, a
// drone shot, dinner - is a paid extra offered at booking, which is where it
// can be priced and agreed rather than assumed.
//
// What differs between the twenty is the setting: where on the beach, how it
// is dressed, who it suits. So the descriptions describe the look, and none of
// them mentions a service that is not in the list above.
//
// There is no tier either. Simple, Premium and Grand meant something when the
// inclusion lists differed; with one list they would only claim a difference
// that is not there.
//
// Four packages are marked `featured`. They sit in their own row at the top of
// the shop and are the only ones meant to carry a price, which is set in the
// admin panel - never here, where an invented number could reach a customer.
//
// Run with: node build-packages.js
// ==========================================================================

const fs = require('node:fs');

// The package. One list, shared by all twenty, so there is exactly one place
// to change what is included.
const INCLUSIONS = [
  'Premium beach decoration setup',
  'Mineral water',
  'Welcome drinks',
  'Free music system',
  'Customized cake',
];

const POLICY =
  'A 30% advance confirms the booking. The date can be changed free of charge ' +
  'up to 48 hours before the event. Cancellations within 24 hours are not refundable.';

const FAQ =
  'The setup takes about 45 to 60 minutes, so our team reaches the beach at least ' +
  'two hours before your time. Every setup can be arranged at sunset or after dark - ' +
  'tell us which you want when you book. Photography, a drone shot and dinner can be ' +
  'added as extras. If it rains, the date can be moved at no cost.';

// Twenty settings for the same five things. Each description says what the
// setup looks like and who it suits - never what else comes with it.
const CATALOGUE = [
  {
    slug: 'sweet-beginnings', name: 'Sweet Beginnings', featured: true,
    desc: 'A decorated corner on the open sand, kept simple and clean. The one most ' +
      'people choose the first time, and the easiest to shoot on your own phone.',
  },
  {
    slug: 'ocean-breeze', name: 'Ocean Breeze',
    desc: 'Set close to the water with room for a few friends to stand around. Good for ' +
      'a birthday surprise where the group matters as much as the couple.',
  },
  {
    slug: 'candlelit-shore', name: 'Candlelit Shore',
    desc: 'Ringed with candles and lanterns, low to the ground. Quiet and private, and ' +
      'it looks far warmer in real life than it sounds on a page.',
  },
  {
    slug: 'moonlight-romance', name: 'Moonlight Romance',
    desc: 'A dressed table for two facing the water, with nothing behind it but the sea. ' +
      'As much as a quiet evening needs, and nothing you will not use.',
  },
  {
    slug: 'golden-sunset', name: 'Golden Sunset', featured: true,
    desc: 'Placed to face the sun as it goes down, so the light falls across the setup ' +
      'rather than behind it. Timed to the sunset for your date.',
  },
  {
    slug: 'seashell-promise', name: 'Seashell Promise',
    desc: 'A heart laid out on the sand in shells and flowers, with the two of you in ' +
      'the middle of it. Simple, and one of the most asked for.',
  },
  {
    slug: 'lantern-nights', name: 'Lantern Nights',
    desc: 'Hanging lanterns over a dressed seating area, lit so the whole setup glows ' +
      'evenly instead of throwing hard shadows.',
  },
  {
    slug: 'starlight-dinner', name: 'Starlight Dinner',
    desc: 'A table set under an open sky with a dressed walkway leading to it. The meal ' +
      'itself can be arranged as an extra - tell us when you book.',
  },
  {
    slug: 'horizon-glow', name: 'Horizon Glow', featured: true,
    desc: 'A wide, open setting facing the horizon, dressed in warm tones. The easiest ' +
      'of our layouts to fit a group into without crowding the middle.',
  },
  {
    slug: 'marine-drive-magic', name: 'Marine Drive Magic',
    desc: 'Set along the longest beach road in the world, on a quieter stretch away from ' +
      'the crowd. The right choice if you would rather not have an audience.',
  },
  {
    slug: 'velvet-night', name: 'Velvet Night',
    desc: 'Deep colour and heavy draping, lit low. The most dramatic setting we do, and ' +
      'the one that reads best after dark.',
  },
  {
    slug: 'nocturne-elegance', name: 'Nocturne Elegance',
    desc: 'White flowers, pale draping and soft light. Restrained rather than bright - ' +
      'our own favourite for an anniversary.',
  },
  {
    slug: 'sunlit-vows', name: 'Sunlit Vows',
    desc: 'An open frame as the centrepiece, facing the water. Built for the moment ' +
      'someone kneels, with a clear line of sight from every side.',
  },
  {
    slug: 'amber-tide', name: 'Amber Tide',
    desc: 'Warm amber tones across the whole setup, with space around it for family or ' +
      'friends to gather without standing in the way.',
  },
  {
    slug: 'midnight-serenade', name: 'Midnight Serenade',
    desc: 'A late setting, dressed darker, with the lighting doing most of the work. ' +
      'For couples who would rather do this once the beach has emptied.',
  },
  {
    slug: 'aurora-night', name: 'Aurora Night',
    desc: 'Colour worked through the lighting and the draping together rather than left ' +
      'to one or the other. The brightest of the evening settings.',
  },
  {
    slug: 'royal-luxury', name: 'Royal Luxury', featured: true,
    desc: 'Our largest layout, dressed end to end. Built for a group, wide enough that ' +
      'everyone has somewhere to stand and can still see.',
  },
  {
    slug: 'coral-horizon', name: 'Coral Horizon',
    desc: 'Coral and gold throughout, facing the water. Warm in daylight and warmer ' +
      'still once the lights come on.',
  },
  {
    slug: 'golden-hour-bliss', name: 'Golden Hour Bliss',
    desc: 'Positioned and timed for the twenty minutes of good light before sunset. ' +
      'The setup is dressed to catch it rather than block it.',
  },
  {
    slug: 'celestial-bliss', name: 'Celestial Bliss',
    desc: 'Open to the sky, with the lighting kept low so the stars still read above it. ' +
      'The quietest of our large settings.',
  },
];

const packages = CATALOGUE.map((entry, index) => ({
  slug: entry.slug,
  code: `CDM ${101 + index}`,
  name: `${entry.name} Package`,
  // No tier. With one inclusion list there is nothing for a tier to describe.
  badge: '',
  // The line under the title on the package page. The location is appended to
  // it by the renderer, so this says the thing the customer still has to
  // decide rather than repeating where we are.
  trust_extra: 'Sunset or after dark - you choose',
  featured: entry.featured === true,
  price: '',
  old_price: '',
  discount: '',
  categories: [],
  main_image: '',
  // Four photographs per package: the main one and three more.
  thumbnails: [],
  inclusions: INCLUSIONS.slice(),
  description: entry.desc,
  booking_policy: POLICY,
  faq: FAQ,
}));

fs.writeFileSync(
  'content/packages.json',
  JSON.stringify({ packages }, null, 2) + '\n',
  'utf8',
);

const lists = new Set(packages.map((p) => p.inclusions.join('|')));

console.log(`Wrote ${packages.length} packages`);
console.log('  inclusions per package:', packages[0].inclusions.length);
console.log('  distinct inclusion lists:', lists.size, lists.size === 1 ? '(all identical)' : '(MISMATCH)');
console.log('  featured:', packages.filter((p) => p.featured).map((p) => p.name).join(', '));
console.log('  carrying a price:', packages.filter((p) => p.price).length);

// A description that names something not in the list is a promise the package
// does not keep. Checked here rather than left for a customer to find.
const PROMISES =
  /photograph|photography|cinemat|video|drone|album|neon sign|dedicated host|pickup|bouquet|rose petal|cold fire|sparkler/i;

const offenders = packages.filter((p) => PROMISES.test(p.description));
console.log('  descriptions promising extras:',
  offenders.length ? offenders.map((p) => p.slug).join(', ') : 'none');

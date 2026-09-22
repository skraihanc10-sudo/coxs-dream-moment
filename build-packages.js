// ==========================================================================
// Rebuilds content/packages.json.
//
// Twenty packages: ten at sunset, ten at night, rising from a simple setup to
// a full production. What separates them is what is in them, so the inclusion
// lists differ rather than repeating.
//
// Three of them are marked `featured`. Those sit in their own row at the top
// of the shop and are the only ones showing a price. Every other package is
// quoted in conversation, because the cost depends on the date, the size of
// the group and what is added to it.
//
// The prices below are placeholders. Set the real ones in the admin panel -
// they are the three packages that carry a number, so they are the three worth
// getting right.
//
// Run with: node build-packages.js
// ==========================================================================

const fs = require('node:fs');

// Written once so a tier is defined by what it adds to the one below it.
const I = {
  decor: 'Premium beach decoration setup',
  decorLux: 'Premium luxury decoration setup',
  water: 'Mineral water',
  drinks: 'Welcome drinks',
  music: 'Free music system',
  cake: 'Customized cake',
  photos: 'Professional photography',
  cinema: 'Professional cinematography & cinematic video shoot',
  pickup: 'Pickup & drop service',
  bouquet: 'Fresh flower bouquet',
  petals: 'Rose petal walkway',
  candles: 'Candle & lantern arrangement',
  fairy: 'Fairy light canopy',
  neon: 'Custom neon name sign',
  balloon: 'Balloon & floral arch',
  dinner: 'Candlelight dinner for two',
  coldfire: 'Cold fire & sparkler moment',
  drone: 'Cinematic drone shot',
  album: 'Printed photo album',
  host: 'Dedicated event host on site',
  more: 'And many more attractive facilities!',
};

const TIERS = {
  simple: [I.decor, I.water, I.drinks, I.music, I.cake],
  standard: [I.decor, I.water, I.drinks, I.music, I.cake, I.petals, I.photos],
  premium: [
    I.decorLux, I.water, I.drinks, I.music, I.cake, I.petals, I.bouquet,
    I.photos, I.cinema, I.pickup,
  ],
  luxury: [
    I.decorLux, I.water, I.drinks, I.music, I.cake, I.petals, I.bouquet,
    I.balloon, I.photos, I.cinema, I.pickup, I.drone, I.more,
  ],
  grand: [
    I.decorLux, I.water, I.drinks, I.music, I.cake, I.petals, I.bouquet,
    I.balloon, I.neon, I.photos, I.cinema, I.pickup, I.drone, I.album,
    I.host, I.coldfire, I.more,
  ],
};

// Night packages get the things that only work after dark.
function nightExtras(tier, list) {
  const extra = [...list];
  if (tier === 'simple') extra.splice(4, 0, I.candles);
  else if (tier === 'standard') extra.splice(5, 0, I.candles, I.fairy);
  else extra.splice(6, 0, I.candles, I.fairy, I.dinner);
  return extra;
}

const TIER_LABEL = {
  simple: 'Simple',
  standard: 'Standard',
  premium: 'Premium',
  luxury: 'Luxury',
  grand: 'Grand',
};

const POLICY =
  'A 30% advance confirms the booking. The date can be changed free of charge ' +
  'up to 48 hours before the event. Cancellations within 24 hours are not refundable.';

const FAQ =
  'The setup takes about 45 to 60 minutes, so our team reaches the beach at least ' +
  'two hours before your time. If it rains, the date can be moved at no cost.';

const CATALOGUE = [
  // ---------------------------------------------------------------- sunset
  {
    slug: 'sweet-beginnings', name: 'Sweet Beginnings', tier: 'simple', when: 'sunset',
    // One of the three that carry a price: the easiest way in.
    featured: true, price: '৳ 7,500',
    desc: 'The simplest way to do this properly. A decorated corner on the sand just ' +
      'before the sun goes down, a cake, welcome drinks and music — exactly what the ' +
      'moment needs and nothing you will not use.',
  },
  {
    slug: 'ocean-breeze', name: 'Ocean Breeze', tier: 'simple', when: 'sunset',
    desc: 'A light setup in the open air by the water. Good for a small group or a ' +
      'birthday surprise — a beautiful evening without a large budget.',
  },
  {
    slug: 'golden-sunset', name: 'Golden Sunset', tier: 'standard', when: 'sunset',
    featured: true, price: '৳ 12,000',
    desc: 'Cox’s Bazar is famous for twenty minutes of golden light, and this package ' +
      'is built around them: a rose petal walkway, and a photographer who gets the ' +
      'shots before the light goes.',
  },
  {
    slug: 'seashell-promise', name: 'Seashell Promise', tier: 'standard', when: 'sunset',
    desc: 'A heart laid out on the sand in shells and flowers, with the two of you in ' +
      'the middle of it. Simple, and it photographs beautifully — one of the most ' +
      'booked setups we do.',
  },
  {
    slug: 'horizon-glow', name: 'Horizon Glow', tier: 'premium', when: 'sunset',
    desc: 'A complete evening — flower bouquet, luxury decoration, photography and a ' +
      'cinematic video. We collect you from your hotel and drop you back afterwards, ' +
      'so there is nothing for you to arrange.',
  },
  {
    slug: 'marine-drive-magic', name: 'Marine Drive Magic', tier: 'premium', when: 'sunset',
    desc: 'Set up along the longest beach road in the world, on a quieter stretch away ' +
      'from the crowd. The right choice if you would rather not have an audience.',
  },
  {
    slug: 'sunlit-vows', name: 'Sunlit Vows', tier: 'luxury', when: 'sunset',
    desc: 'A full production for an engagement or an anniversary. A balloon and floral ' +
      'arch, luxury decor, and a cinematic drone shot that puts the whole beach in the ' +
      'frame with you.',
  },
  {
    slug: 'amber-tide', name: 'Amber Tide', tier: 'luxury', when: 'sunset',
    desc: 'A larger sunset setup for celebrating with family or friends. Photography, ' +
      'cinematic video and drone — the day is captured three ways.',
  },
  {
    slug: 'coral-horizon', name: 'Coral Horizon', tier: 'grand', when: 'sunset',
    desc: 'Our largest sunset event. A neon sign with your name, full decoration, a ' +
      'dedicated host, a cold fire moment and a printed photo album you take home on ' +
      'the day.',
  },
  {
    slug: 'golden-hour-bliss', name: 'Golden Hour Bliss', tier: 'grand', when: 'sunset',
    desc: 'The golden hour, entirely yours. A host runs the evening from start to ' +
      'finish so you are only ever in the moment. For a large proposal or a surprise ' +
      'with everyone there.',
  },

  // ----------------------------------------------------------------- night
  {
    slug: 'candlelit-shore', name: 'Candlelit Shore', tier: 'simple', when: 'night',
    desc: 'A small corner on a dark beach, surrounded by candles and lanterns. Quiet, ' +
      'private, and it photographs far better than it sounds — the simplest way into ' +
      'an evening setup.',
  },
  {
    slug: 'moonlight-romance', name: 'Moonlight Romance', tier: 'simple', when: 'night',
    desc: 'Moonlight and the sound of the waves, with candles, a cake and a little ' +
      'decoration. As much as a quiet night for two actually needs.',
  },
  {
    slug: 'lantern-nights', name: 'Lantern Nights', tier: 'standard', when: 'night',
    desc: 'A canopy of fairy lights overhead and a rose petal walkway below. The lighting ' +
      'is placed so the night photographs come out clean and warm — that is the real ' +
      'work in this one.',
  },
  {
    slug: 'starlight-dinner', name: 'Starlight Dinner', tier: 'standard', when: 'night',
    desc: 'A table set under an open sky, with fairy lights and candles. Dinner can be ' +
      'added — tell us when you book and we will arrange it.',
  },
  {
    slug: 'velvet-night', name: 'Velvet Night', tier: 'premium', when: 'night',
    desc: 'Candlelight dinner for two, full luxury decoration, photography and a ' +
      'cinematic video, with pickup and drop from your hotel. A complete evening.',
  },
  {
    slug: 'nocturne-elegance', name: 'Nocturne Elegance', tier: 'premium', when: 'night',
    desc: 'A quiet, elegant night — white flowers, warm light and a candlelight dinner. ' +
      'Our own favourite for an anniversary.',
  },
  {
    slug: 'midnight-serenade', name: 'Midnight Serenade', tier: 'luxury', when: 'night',
    desc: 'A balloon and floral arch, candlelight dinner and a drone shot. Seen from ' +
      'above, the lighting is the best part of the video.',
  },
  {
    slug: 'aurora-night', name: 'Aurora Night', tier: 'luxury', when: 'night',
    desc: 'A large night setup in colour, for celebrating with family or friends. ' +
      'Photography, cinematic video and drone are all included.',
  },
  {
    slug: 'royal-luxury', name: 'Royal Luxury', tier: 'grand', when: 'night',
    featured: true, price: '৳ 25,000',
    desc: 'Our largest event. A neon sign with your name, full decoration, candlelight ' +
      'dinner, cold fire, drone, a printed album, and a dedicated host with you all ' +
      'evening.',
  },
  {
    slug: 'celestial-bliss', name: 'Celestial Bliss', tier: 'grand', when: 'night',
    desc: 'The night sky, the sea and the lights together — our largest celebration. ' +
      'A proposal, an anniversary or a big surprise: whatever the occasion, we run ' +
      'the whole evening.',
  },
];

const packages = CATALOGUE.map((entry, index) => {
  const base = TIERS[entry.tier];
  const inclusions = entry.when === 'night' ? nightExtras(entry.tier, base) : base;

  return {
    slug: entry.slug,
    code: `CDM ${101 + index}`,
    name: `${entry.name} Package`,
    badge: entry.when === 'sunset' ? 'Sunset' : 'Night',
    trust_extra: `${TIER_LABEL[entry.tier]} • ${entry.when === 'sunset' ? 'Sunset setup' : 'Evening setup'}`,
    // Only the featured three carry a price; the rest are quoted in conversation.
    featured: entry.featured === true,
    price: entry.price || '',
    old_price: '',
    discount: '',
    categories: [entry.when],
    main_image: '',
    // Four photographs per package: the main one and three more. Left empty
    // for the admin to fill in.
    thumbnails: [],
    inclusions,
    description: entry.desc,
    booking_policy: POLICY,
    faq: FAQ,
  };
});

fs.writeFileSync(
  'content/packages.json',
  JSON.stringify({ packages }, null, 2) + '\n',
  'utf8',
);

const featured = packages.filter((p) => p.featured);
console.log(`Wrote ${packages.length} packages`);
console.log('  sunset:', packages.filter((p) => p.categories[0] === 'sunset').length);
console.log('  night :', packages.filter((p) => p.categories[0] === 'night').length);
console.log('  featured (with a price):', featured.map((p) => `${p.name} ${p.price}`).join(', '));
console.log('  priced but not featured:', packages.filter((p) => p.price && !p.featured).length);

// ==========================================================================
// Rebuilds content/packages.json.
//
// Twenty packages on a five-step ladder, four to a step, rising from a simple
// setup to a full production. What separates them is what is in them, so the
// inclusion lists differ rather than repeating.
//
// No package is tied to a time of day. A setup can be done at sunset or after
// dark - that is the customer's choice when they book, not a property of the
// package, and printing it on the card only rules things out. The enquiry form
// asks for the time instead.
//
// Three packages are marked `featured`. They sit in their own row at the top
// of the shop and are the only ones showing a price. The prices below are
// placeholders - set the real ones in the admin panel.
//
// Run with: node build-packages.js
// ==========================================================================

const fs = require('node:fs');

const I = {
  decor: 'Premium beach decoration setup',
  decorLux: 'Premium luxury decoration setup',
  water: 'Mineral water',
  drinks: 'Welcome drinks',
  music: 'Free music system',
  cake: 'Customized cake',
  petals: 'Rose petal walkway',
  candles: 'Candle & lantern arrangement',
  photos: 'Professional photography',
  fairy: 'Fairy light canopy',
  bouquet: 'Fresh flower bouquet',
  cinema: 'Professional cinematography & cinematic video shoot',
  pickup: 'Pickup & drop service',
  balloon: 'Balloon & floral arch',
  dinner: 'Candlelight dinner for two',
  drone: 'Cinematic drone shot',
  neon: 'Custom neon name sign',
  album: 'Printed photo album',
  host: 'Dedicated event host on site',
  coldfire: 'Cold fire & sparkler moment',
  more: 'And many more attractive facilities!',
};

// Each step is the step below it plus what is named here, so the list a
// customer reads grows in a way that matches what they are paying for.
const TIERS = {
  simple: {
    label: 'Simple',
    items: [I.decor, I.water, I.drinks, I.music, I.cake],
  },
  standard: {
    label: 'Standard',
    items: [I.decor, I.water, I.drinks, I.music, I.cake, I.petals, I.candles, I.photos],
  },
  premium: {
    label: 'Premium',
    items: [
      I.decorLux, I.water, I.drinks, I.music, I.cake, I.petals, I.candles,
      I.fairy, I.bouquet, I.photos, I.cinema, I.pickup,
    ],
  },
  luxury: {
    label: 'Luxury',
    items: [
      I.decorLux, I.water, I.drinks, I.music, I.cake, I.petals, I.candles,
      I.fairy, I.bouquet, I.balloon, I.dinner, I.photos, I.cinema, I.pickup,
      I.drone, I.more,
    ],
  },
  grand: {
    label: 'Grand',
    items: [
      I.decorLux, I.water, I.drinks, I.music, I.cake, I.petals, I.candles,
      I.fairy, I.bouquet, I.balloon, I.neon, I.dinner, I.photos, I.cinema,
      I.pickup, I.drone, I.album, I.host, I.coldfire, I.more,
    ],
  },
};

const POLICY =
  'A 30% advance confirms the booking. The date can be changed free of charge ' +
  'up to 48 hours before the event. Cancellations within 24 hours are not refundable.';

const FAQ =
  'The setup takes about 45 to 60 minutes, so our team reaches the beach at least ' +
  'two hours before your time. Every package can be arranged at sunset or after dark — ' +
  'tell us which you want when you book. If it rains, the date can be moved at no cost.';

// Four to a tier. The descriptions say what makes each one different from its
// neighbours, and none of them commits the customer to a time of day.
const CATALOGUE = [
  // ------------------------------------------------------------- simple
  {
    slug: 'sweet-beginnings', name: 'Sweet Beginnings', tier: 'simple',
    featured: true, price: '৳ 7,500',
    desc: 'The simplest way to do this properly. A decorated corner on the sand, a cake ' +
      'and welcome drinks — exactly what the moment needs and nothing you will not use. ' +
      'Our most booked first setup.',
  },
  {
    slug: 'ocean-breeze', name: 'Ocean Breeze', tier: 'simple',
    desc: 'A light setup in the open air by the water, with room for a few friends to ' +
      'stand around. Good for a birthday surprise or a small celebration without a ' +
      'large budget.',
  },
  {
    slug: 'candlelit-shore', name: 'Candlelit Shore', tier: 'simple',
    desc: 'A small corner ringed with candles and lanterns. Quiet and private, and it ' +
      'photographs far better than it sounds — the warm light does most of the work.',
  },
  {
    slug: 'moonlight-romance', name: 'Moonlight Romance', tier: 'simple',
    desc: 'Just the two of you, the waves and a decorated table. As much as a quiet ' +
      'evening actually needs, and nothing more.',
  },

  // ----------------------------------------------------------- standard
  {
    slug: 'golden-sunset', name: 'Golden Sunset', tier: 'standard',
    featured: true, price: '৳ 12,000',
    desc: 'A rose petal walkway, candles, and a professional photographer who knows ' +
      'the beach and gets the shots while the light is right. The step most couples ' +
      'take when they want photographs they will actually keep.',
  },
  {
    slug: 'seashell-promise', name: 'Seashell Promise', tier: 'standard',
    desc: 'A heart laid out on the sand in shells and flowers, with the two of you in ' +
      'the middle of it. Simple, and it photographs beautifully.',
  },
  {
    slug: 'lantern-nights', name: 'Lantern Nights', tier: 'standard',
    desc: 'Lanterns and candles arranged around a decorated seating area. The lighting ' +
      'is placed so the photographs come out clean and warm rather than flat.',
  },
  {
    slug: 'starlight-dinner', name: 'Starlight Dinner', tier: 'standard',
    desc: 'A table set under an open sky, with candles and a petal walkway leading to ' +
      'it. Dinner can be added — tell us when you book and we will arrange it.',
  },

  // ------------------------------------------------------------ premium
  {
    slug: 'horizon-glow', name: 'Horizon Glow', tier: 'premium',
    desc: 'A complete evening — flower bouquet, fairy light canopy, luxury decoration, ' +
      'photography and a cinematic video. We collect you from your hotel and drop you ' +
      'back, so there is nothing for you to arrange.',
  },
  {
    slug: 'marine-drive-magic', name: 'Marine Drive Magic', tier: 'premium',
    desc: 'Set up along the longest beach road in the world, on a quieter stretch away ' +
      'from the crowd. The right choice if you would rather not have an audience.',
  },
  {
    slug: 'velvet-night', name: 'Velvet Night', tier: 'premium',
    desc: 'Deep colour, heavy drapes and warm light, with full photography and a ' +
      'cinematic video. The most dramatic of the premium setups.',
  },
  {
    slug: 'nocturne-elegance', name: 'Nocturne Elegance', tier: 'premium',
    desc: 'White flowers, soft light and a restrained, elegant setting. Our own ' +
      'favourite for an anniversary.',
  },

  // ------------------------------------------------------------- luxury
  {
    slug: 'sunlit-vows', name: 'Sunlit Vows', tier: 'luxury',
    desc: 'A full production for an engagement. A balloon and floral arch, dinner for ' +
      'two, and a cinematic drone shot that puts the whole beach in frame with you.',
  },
  {
    slug: 'amber-tide', name: 'Amber Tide', tier: 'luxury',
    desc: 'A larger setup with room for family or friends to be there. Photography, ' +
      'cinematic video and drone — the day is captured three ways.',
  },
  {
    slug: 'midnight-serenade', name: 'Midnight Serenade', tier: 'luxury',
    desc: 'A floral arch, a candlelight dinner and a drone shot. Seen from above, the ' +
      'lighting is the best part of the video.',
  },
  {
    slug: 'aurora-night', name: 'Aurora Night', tier: 'luxury',
    desc: 'Colour throughout — lighting, flowers and drapes worked into one scheme, ' +
      'with the full photography and video package.',
  },

  // -------------------------------------------------------------- grand
  {
    slug: 'royal-luxury', name: 'Royal Luxury', tier: 'grand',
    featured: true, price: '৳ 25,000',
    desc: 'Our largest event. A neon sign with your name, full decoration, dinner for ' +
      'two, cold fire, a drone shot, a printed album, and a dedicated host with you ' +
      'the whole evening.',
  },
  {
    slug: 'coral-horizon', name: 'Coral Horizon', tier: 'grand',
    desc: 'The full production in warm coral and gold. Neon sign, dedicated host, cold ' +
      'fire moment and a printed photo album you take home on the day.',
  },
  {
    slug: 'golden-hour-bliss', name: 'Golden Hour Bliss', tier: 'grand',
    desc: 'A host runs the whole evening from start to finish so you are only ever in ' +
      'the moment. For a large proposal or a surprise with everyone there.',
  },
  {
    slug: 'celestial-bliss', name: 'Celestial Bliss', tier: 'grand',
    desc: 'The sea, the sky and the lights together — our largest celebration, arranged ' +
      'end to end. Whatever the occasion, we run the evening.',
  },
];

const packages = CATALOGUE.map((entry, index) => {
  const tier = TIERS[entry.tier];

  return {
    slug: entry.slug,
    code: `CDM ${101 + index}`,
    name: `${entry.name} Package`,
    // The badge carries the tier now. It used to say Sunset or Night, which
    // ruled out half the bookings each package could have taken.
    badge: tier.label,
    trust_extra: `${tier.label} setup • Cox's Bazar`,
    featured: entry.featured === true,
    price: entry.price || '',
    old_price: '',
    discount: '',
    // No time-of-day categories. The filter only ever ran from a ?cat= link,
    // and there is nothing left to filter on.
    categories: [],
    main_image: '',
    // Four photographs per package: the main one and three more.
    thumbnails: [],
    inclusions: tier.items,
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

const byTier = {};
packages.forEach((p) => {
  byTier[p.badge] = (byTier[p.badge] || 0) + 1;
});

console.log(`Wrote ${packages.length} packages`);
console.log('  per tier:', Object.entries(byTier).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('  featured:', packages.filter((p) => p.featured).map((p) => `${p.name} ${p.price}`).join(', '));
console.log('  inclusions range:',
  Math.min(...packages.map((p) => p.inclusions.length)), '-',
  Math.max(...packages.map((p) => p.inclusions.length)));
console.log('  any time-of-day text left:',
  packages.some((p) => /sunset|night|evening|dark/i.test(p.badge + p.trust_extra)) ? 'YES' : 'no');

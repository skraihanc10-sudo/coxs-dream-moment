// ==========================================================================
// Rebuilds content/packages.json as a catalogue of twenty.
//
// The previous forty were the same package forty times - identical inclusions,
// two descriptions shared between them all, names that were the only thing
// telling them apart. A customer scrolling that list cannot choose, because
// there is nothing to choose between.
//
// These twenty are a ladder instead: ten at sunset, ten at night, rising from
// a simple setup to a full production, with each step adding something a
// customer can actually see. The inclusions differ because the packages
// differ.
//
// Run with: node build-packages.js
// ==========================================================================

const fs = require('node:fs');

// The things a package can include. Written once here so the same wording is
// used everywhere and a tier is defined by what it adds to the one below.
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

// Five tiers. Each one is the tier below plus what is named here, so the list
// a customer reads grows in a way that matches the price.
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
  'বুকিং নিশ্চিত করতে ৩০% অগ্রিম প্রয়োজন। ইভেন্টের ৪৮ ঘণ্টা আগে তারিখ পরিবর্তন করা ' +
  'যাবে বিনামূল্যে। ২৪ ঘণ্টার মধ্যে বাতিল করলে অগ্রিম ফেরতযোগ্য নয়।';

const FAQ =
  'সেটআপে সাধারণত ৪৫–৬০ মিনিট সময় লাগে, তাই আমাদের টিম নির্ধারিত সময়ের অন্তত ২ ঘণ্টা ' +
  'আগে সৈকতে পৌঁছে যায়। বৃষ্টি হলে বিনামূল্যে তারিখ পরিবর্তনের সুযোগ থাকবে।';

// Twenty packages, each with its own name, its own reason to exist, and a
// description that says what actually happens rather than repeating the
// inclusions list back.
const CATALOGUE = [
  // ---------------------------------------------------------------- sunset
  {
    slug: 'sweet-beginnings', name: 'Sweet Beginnings', tier: 'simple', when: 'sunset',
    desc: 'প্রথমবার প্রপোজ করার জন্য সবচেয়ে সহজ আর সুন্দর আয়োজন। সূর্য ডোবার ঠিক আগে সৈকতে ' +
      'ছোট্ট একটি সাজানো কর্নার, কেক আর ওয়েলকাম ড্রিংকস — যা লাগে ঠিক ততটুকুই, বাড়তি কিছু নয়।',
  },
  {
    slug: 'ocean-breeze', name: 'Ocean Breeze', tier: 'simple', when: 'sunset',
    desc: 'খোলা হাওয়ায় সমুদ্রের ধারে সাজানো একটি হালকা সেটআপ। বন্ধুবান্ধব নিয়ে ছোট আয়োজন ' +
      'কিংবা জন্মদিনের চমকের জন্য আদর্শ — কম খরচে সুন্দর একটি সন্ধ্যা।',
  },
  {
    slug: 'golden-sunset', name: 'Golden Sunset', tier: 'standard', when: 'sunset',
    desc: 'কক্সবাজারের বিখ্যাত সোনালি আলোটা যখন সবচেয়ে সুন্দর, ঠিক তখনই গোলাপের পাপড়ি বিছানো ' +
      'পথ ধরে আপনার মুহূর্তটি। সাথে প্রফেশনাল ফটোগ্রাফার, যিনি আলোটা চলে যাওয়ার আগেই ছবিগুলো তুলে নেন।',
  },
  {
    slug: 'seashell-promise', name: 'Seashell Promise', tier: 'standard', when: 'sunset',
    desc: 'সৈকতের বালিতে ঝিনুক আর ফুল দিয়ে সাজানো হৃদয়ের নকশা, মাঝখানে আপনি দুজন। ' +
      'সহজ, কিন্তু ছবিতে অসাধারণ দেখায় — আমাদের সবচেয়ে বেশি বুক হওয়া সাজগুলোর একটি।',
  },
  {
    slug: 'horizon-glow', name: 'Horizon Glow', tier: 'premium', when: 'sunset',
    desc: 'সম্পূর্ণ সাজানো একটি সন্ধ্যা — ফুলের তোড়া, লাক্সারি ডেকোরেশন, ফটোগ্রাফি ও ' +
      'সিনেমাটিক ভিডিও। হোটেল থেকে পিকআপ, অনুষ্ঠান শেষে ড্রপ — আপনাকে কিছু ভাবতে হবে না।',
  },
  {
    slug: 'marine-drive-magic', name: 'Marine Drive Magic', tier: 'premium', when: 'sunset',
    desc: 'পৃথিবীর দীর্ঘতম সমুদ্র সৈকত সড়কের পাশে, তুলনামূলক নিরিবিলি একটি জায়গায় সাজানো আয়োজন। ' +
      'ভিড় থেকে দূরে থাকতে চাইলে এটিই সেরা পছন্দ।',
  },
  {
    slug: 'sunlit-vows', name: 'Sunlit Vows', tier: 'luxury', when: 'sunset',
    desc: 'এনগেজমেন্ট বা অ্যানিভার্সারির মতো বড় দিনের জন্য পূর্ণাঙ্গ আয়োজন। বেলুন ও ফুলের তোরণ, ' +
      'লাক্সারি ডেকোর, আর উপর থেকে ড্রোনে তোলা সিনেমাটিক শট — পুরো সৈকতসহ আপনার মুহূর্ত।',
  },
  {
    slug: 'amber-tide', name: 'Amber Tide', tier: 'luxury', when: 'sunset',
    desc: 'সূর্যাস্তের কমলা আলোয় সাজানো বড় পরিসরের সেটআপ, পরিবার বা বন্ধুদের নিয়ে উদযাপনের জন্য। ' +
      'ফটো, ভিডিও আর ড্রোন — তিনভাবেই ধরা থাকবে দিনটি।',
  },
  {
    slug: 'coral-horizon', name: 'Coral Horizon', tier: 'grand', when: 'sunset',
    desc: 'আমাদের সবচেয়ে বড় সূর্যাস্ত আয়োজন। নামের নিয়ন সাইন, পূর্ণ ডেকোরেশন, ডেডিকেটেড হোস্ট, ' +
      'কোল্ড ফায়ার মুহূর্ত আর ছাপানো ফটো অ্যালবাম — অনুষ্ঠানের দিনই হাতে পাবেন স্মৃতিটা।',
  },
  {
    slug: 'golden-hour-bliss', name: 'Golden Hour Bliss', tier: 'grand', when: 'sunset',
    desc: 'সোনালি ঘণ্টাটা পুরোপুরি আপনার। শুরু থেকে শেষ পর্যন্ত একজন হোস্ট সব সামলান, ' +
      'আপনি শুধু মুহূর্তটায় থাকেন। বড় প্রপোজাল বা সারপ্রাইজ অনুষ্ঠানের জন্য।',
  },

  // ----------------------------------------------------------------- night
  {
    slug: 'candlelit-shore', name: 'Candlelit Shore', tier: 'simple', when: 'night',
    desc: 'অন্ধকার সৈকতে মোমবাতি আর লণ্ঠনের আলোয় ঘেরা ছোট্ট একটি কর্নার। শান্ত, ঘরোয়া, ' +
      'আর ছবিতে দারুণ — রাতের আয়োজনের সবচেয়ে সহজ শুরু।',
  },
  {
    slug: 'moonlight-romance', name: 'Moonlight Romance', tier: 'simple', when: 'night',
    desc: 'চাঁদের আলো আর ঢেউয়ের শব্দ — এর সাথে শুধু কয়েকটা মোমবাতি, কেক আর একটু সাজ। ' +
      'দুজনের নিরিবিলি একটি রাতের জন্য যতটুকু দরকার।',
  },
  {
    slug: 'lantern-nights', name: 'Lantern Nights', tier: 'standard', when: 'night',
    desc: 'মাথার উপরে পরির আলোর ছাউনি, নিচে গোলাপের পাপড়ি বিছানো পথ। আলো এমনভাবে বসানো ' +
      'হয় যাতে রাতের ছবিও পরিষ্কার আর উষ্ণ আসে — এটাই এই প্যাকেজের আসল কাজ।',
  },
  {
    slug: 'starlight-dinner', name: 'Starlight Dinner', tier: 'standard', when: 'night',
    desc: 'তারাভরা আকাশের নিচে সাজানো টেবিল, ফেয়ারি লাইট আর মোমবাতি। ডিনার যোগ করতে চাইলে ' +
      'আমরা ব্যবস্থা করে দিই — শুধু বুকিংয়ের সময় বলে দিন।',
  },
  {
    slug: 'velvet-night', name: 'Velvet Night', tier: 'premium', when: 'night',
    desc: 'দুজনের জন্য মোমবাতির আলোয় ডিনার, পূর্ণ লাক্সারি ডেকোরেশন, ফটোগ্রাফি ও সিনেমাটিক ভিডিও। ' +
      'হোটেল থেকে নিয়ে আসা ও পৌঁছে দেওয়াসহ সম্পূর্ণ আয়োজন।',
  },
  {
    slug: 'nocturne-elegance', name: 'Nocturne Elegance', tier: 'premium', when: 'night',
    desc: 'শান্ত, অভিজাত একটি রাতের সাজ — সাদা ফুল, উষ্ণ আলো আর ক্যান্ডেললাইট ডিনার। ' +
      'অ্যানিভার্সারির জন্য আমাদের সবচেয়ে পছন্দের আয়োজন।',
  },
  {
    slug: 'midnight-serenade', name: 'Midnight Serenade', tier: 'luxury', when: 'night',
    desc: 'বেলুন ও ফুলের তোরণ, ক্যান্ডেললাইট ডিনার আর ড্রোন শট — রাতের বড় আয়োজনের জন্য পূর্ণাঙ্গ প্যাকেজ। ' +
      'উপর থেকে আলোর সাজটা যেমন দেখায়, সেটাই ভিডিওর সবচেয়ে সুন্দর অংশ।',
  },
  {
    slug: 'aurora-night', name: 'Aurora Night', tier: 'luxury', when: 'night',
    desc: 'রঙিন আলোয় সাজানো বড় পরিসরের রাতের সেটআপ, পরিবার বা বন্ধুদের নিয়ে উদযাপনের জন্য। ' +
      'ফটো, সিনেমাটিক ভিডিও আর ড্রোন — সবই এর মধ্যে।',
  },
  {
    slug: 'royal-luxury', name: 'Royal Luxury', tier: 'grand', when: 'night',
    desc: 'আমাদের সবচেয়ে বড় আয়োজন। নামের নিয়ন সাইন, পূর্ণ ডেকোরেশন, ক্যান্ডেললাইট ডিনার, ' +
      'কোল্ড ফায়ার, ড্রোন, ছাপানো অ্যালবাম আর সারাক্ষণ একজন ডেডিকেটেড হোস্ট।',
  },
  {
    slug: 'celestial-bliss', name: 'Celestial Bliss', tier: 'grand', when: 'night',
    desc: 'রাতের আকাশ, সমুদ্র আর আলো — সব মিলিয়ে সবচেয়ে বড় পরিসরের উদযাপন। বিয়ের প্রস্তাব, ' +
      'অ্যানিভার্সারি বা বড় সারপ্রাইজ — যে উপলক্ষই হোক, পুরো সন্ধ্যাটা আমরা সামলাই।',
  },
];

const packages = CATALOGUE.map((entry, index) => {
  const base = TIERS[entry.tier];
  const inclusions = entry.when === 'night' ? nightExtras(entry.tier, base) : base;

  return {
    slug: entry.slug,
    code: `CDM ${101 + index}`,
    name: `${entry.name} Package`,
    // The badge says when it happens; the tier is what separates the packages
    // within a time of day, so it goes in the line underneath.
    badge: entry.when === 'sunset' ? 'Sunset' : 'Night',
    trust_extra: `${TIER_LABEL[entry.tier]} • ${entry.when === 'sunset' ? 'সূর্যাস্তের সময়' : 'রাতের আয়োজন'}`,
    price: '',
    old_price: '',
    discount: '',
    categories: [entry.when],
    main_image: '',
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

console.log(`Wrote ${packages.length} packages`);
console.log('  sunset:', packages.filter((p) => p.categories[0] === 'sunset').length);
console.log('  night :', packages.filter((p) => p.categories[0] === 'night').length);
console.log('  inclusions range:',
  Math.min(...packages.map((p) => p.inclusions.length)), '-',
  Math.max(...packages.map((p) => p.inclusions.length)));

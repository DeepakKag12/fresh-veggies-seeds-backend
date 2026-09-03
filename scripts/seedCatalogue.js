/**
 * Replace the catalogue with a realistic demo dataset.
 *
 * Generates 100 products spread across the existing categories, plus combo
 * packs built from real product references. Images come from a keyword-matched
 * service with a fixed `lock` seed, so every product gets a stable, relevant
 * photo instead of the dead Unsplash links the old seed carried.
 *
 * Scope: catalogue only. Users and orders are deliberately left alone — use the
 * admin "Production preparation" tool if you want those gone too.
 *
 *   node scripts/seedCatalogue.js            # replace catalogue
 *   node scripts/seedCatalogue.js --keep     # add without deleting
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Combo = require('../models/Combo');

const KEEP = process.argv.includes('--keep');

// Verified, subject-matched photographs.
//
// Every URL below was fetched and visually checked on a contact sheet: the
// previous keyword-service links either 403'd on multi-word names or served an
// unrelated stock photo for every product. These are permanent Unsplash CDN
// URLs grouped by what they actually show.
const IMAGE_POOL = {
  'vegetable-seeds': [
    'https://images.unsplash.com/photo-1445282768818-728615cc910a',
    'https://images.unsplash.com/photo-1449300079323-02e209d9d3a6',
    'https://images.unsplash.com/photo-1464226184884-fa280b87c399',
    'https://images.unsplash.com/photo-1576045057995-568f588f82fb',
    'https://images.unsplash.com/photo-1590779033100-9f60a05a013d',
    'https://images.unsplash.com/photo-1592924357228-91a4daadcfea',
    'https://images.unsplash.com/photo-1597362925123-77861d3fbac7',
    'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37',
    'https://images.unsplash.com/photo-1604977042946-1eecc30f269e',
    'https://images.unsplash.com/photo-1464965911861-746a04b4bca6',
    'https://images.unsplash.com/photo-1543158181-e6f9f6712055',
  ],
  'flower-seeds': [
    'https://images.unsplash.com/photo-1490750967868-88aa4486c946',
    'https://images.unsplash.com/photo-1496062031456-07b8f162a322',
    'https://images.unsplash.com/photo-1592729645009-b96d1e63d14b',
    'https://images.unsplash.com/photo-1565011523534-747a8601f10a',
  ],
  'grow-bags': [
    'https://images.unsplash.com/photo-1523348837708-15d4a09cfac2',
    'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735',
    'https://images.unsplash.com/photo-1625246333195-78d9c38ad449',
    'https://images.unsplash.com/photo-1558904541-efa843a96f01',
  ],
  'soil-fertilizers': [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b',
    'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735',
    'https://images.unsplash.com/photo-1625246333195-78d9c38ad449',
    'https://images.unsplash.com/photo-1558904541-efa843a96f01',
  ],
  'tools': [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b',
    'https://images.unsplash.com/photo-1617576683096-00fc8eecb3af',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64',
  ],
  'plants': [
    'https://images.unsplash.com/photo-1565011523534-747a8601f10a',
    'https://images.unsplash.com/photo-1592729645009-b96d1e63d14b',
    'https://images.unsplash.com/photo-1617576683096-00fc8eecb3af',
    'https://images.unsplash.com/photo-1523348837708-15d4a09cfac2',
  ],
  'fertilizers': [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b',
    'https://images.unsplash.com/photo-1625246333195-78d9c38ad449',
    'https://images.unsplash.com/photo-1558904541-efa843a96f01',
    'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735',
  ],
  'watering-solutions': [
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64',
    'https://images.unsplash.com/photo-1558904541-efa843a96f01',
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b',
  ],
  'pest-control': [
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64',
    'https://images.unsplash.com/photo-1617576683096-00fc8eecb3af',
    'https://images.unsplash.com/photo-1592729645009-b96d1e63d14b',
  ],
};

// Deterministic pick so a product keeps the same photo across re-seeds.
const img = (slug, n, w = 600) => {
  const list = IMAGE_POOL[slug] || IMAGE_POOL['plants'];
  return `${list[n % list.length]}?w=${w}&h=${w}&fit=crop`;
};

const CATEGORIES = [
  { name: 'Vegetable Seeds',    slug: 'vegetable-seeds',    icon: '🥬', keywords: 'vegetable,seeds' },
  { name: 'Flower Seeds',       slug: 'flower-seeds',       icon: '🌸', keywords: 'flower,seeds' },
  { name: 'Grow Bags',          slug: 'grow-bags',          icon: '🎒', keywords: 'grow,bag,garden' },
  { name: 'Soil & Fertilizers', slug: 'soil-fertilizers',   icon: '🌱', keywords: 'soil,compost' },
  { name: 'Tools',              slug: 'tools',              icon: '🛠️', keywords: 'garden,tools' },
  { name: 'Plants',             slug: 'plants',             icon: '🪴', keywords: 'houseplant,pot' },
  { name: 'Fertilizers',        slug: 'fertilizers',        icon: '🌾', keywords: 'fertilizer,garden' },
  { name: 'Watering Solutions', slug: 'watering-solutions', icon: '💧', keywords: 'watering,can' },
  { name: 'Pest Control',       slug: 'pest-control',       icon: '🐛', keywords: 'garden,spray' },
];

// Product names per category. Real-sounding SKUs rather than "Product 47".
const CATALOGUE = {
  'vegetable-seeds': ['Tomato', 'Brinjal', 'Okra', 'Spinach', 'Carrot', 'Radish', 'Cucumber', 'Chilli', 'Cabbage',
                      'Cauliflower', 'Beetroot', 'Bottle Gourd', 'Bitter Gourd', 'Pumpkin', 'Onion'],
  'flower-seeds':    ['Marigold', 'Rose', 'Sunflower', 'Petunia', 'Zinnia', 'Cosmos', 'Dahlia', 'Balsam',
                      'Portulaca', 'Aster', 'Nasturtium', 'Salvia'],
  'grow-bags':       ['HDPE Grow Bag 12x12', 'HDPE Grow Bag 15x15', 'HDPE Grow Bag 18x18', 'Fabric Grow Bag 5 Gallon',
                      'Fabric Grow Bag 10 Gallon', 'Vertical Grow Bag', 'Rectangular Grow Bag', 'Terrace Grow Bag',
                      'Round Grow Bag Set', 'Balcony Grow Bag Set'],
  'soil-fertilizers':['Organic Potting Mix 5kg', 'Organic Potting Mix 10kg', 'Cocopeat Block 5kg', 'Red Soil 10kg',
                      'Perlite 1kg', 'Vermiculite 1kg', 'Garden Compost 5kg', 'Leaf Mould 3kg',
                      'Coco Chips 2kg', 'Seed Starting Mix 2kg'],
  'tools':           ['Hand Trowel', 'Pruning Shears', 'Garden Fork', 'Weeding Hoe', 'Transplanter',
                      'Garden Gloves', 'Cultivator', 'Grafting Knife', 'Kneeling Pad', 'Tool Set (8 Piece)',
                      'Bypass Lopper', 'Soil Scoop'],
  'plants':          ['Money Plant', 'Snake Plant', 'Peace Lily', 'Jade Plant', 'Areca Palm', 'ZZ Plant',
                      'Spider Plant', 'Aglaonema', 'Syngonium', 'Rubber Plant', 'Monstera', 'Philodendron'],
  'fertilizers':     ['Vermicompost 5kg', 'Bone Meal 1kg', 'Neem Cake 2kg', 'NPK 19:19:19', 'Mustard Cake 1kg',
                      'Seaweed Extract 500ml', 'Epsom Salt 900g', 'Organic Plant Food 1kg', 'Rock Phosphate 1kg'],
  'watering-solutions':['Watering Can 5L', 'Watering Can 10L', 'Garden Hose 15m', 'Drip Irrigation Kit',
                      'Spray Bottle 1L', 'Spray Bottle 2L', 'Sprinkler Head', 'Self-Watering Spikes',
                      'Hose Nozzle', 'Watering Wand'],
  'pest-control':    ['Neem Oil 500ml', 'Sticky Traps (10 Pack)', 'Organic Pest Spray 1L', 'Fungicide Powder 500g',
                      'Insect Netting 3m', 'Snail Barrier Tape', 'Aphid Control Spray', 'Mite Control Concentrate',
                      'Copper Fungicide 250g', 'Diatomaceous Earth 1kg'],
};

const SEASONS = ['Summer', 'Winter', 'Monsoon', 'Spring'];
const pick = (arr, i) => arr[i % arr.length];

// Deterministic pseudo-random so repeated runs produce the same catalogue.
const rand = (seed) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('✖  MONGODB_URI is not set in .env');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected');

  if (!KEEP) {
    console.log(`🗑️  Removing ${await Product.countDocuments()} products and ${await Combo.countDocuments()} combos`);
    await Product.deleteMany({});
    await Combo.deleteMany({});
  }

  // Categories: upsert so existing ids (and anything referencing them) survive.
  const categoryIds = {};
  for (const c of CATEGORIES) {
    const doc = await Category.findOneAndUpdate(
      { slug: c.slug },
      { $set: { name: c.name, slug: c.slug, icon: c.icon, description: `${c.name} for home gardeners`, isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    categoryIds[c.slug] = doc._id;
  }
  console.log(`✅ ${Object.keys(categoryIds).length} categories ready`);

  // ── Products ────────────────────────────────────────────────────────────────
  const products = [];
  let lock = 100;

  for (const cat of CATEGORIES) {
    const names = CATALOGUE[cat.slug] || [];
    names.forEach((base, i) => {
      lock += 1;
      const seed = lock;
      const isSeed = cat.slug.includes('seeds');
      const name = isSeed ? `${base} Seeds` : base;

      const price = Math.round((99 + rand(seed) * 900) / 10) * 10 + 9;
      const originalPrice = Math.round(price * (1.2 + rand(seed + 1) * 0.6));
      const stock = Math.floor(5 + rand(seed + 2) * 200);
      const rating = Math.round((3.6 + rand(seed + 3) * 1.4) * 100) / 100;

      const product = {
        __slug: cat.slug,
        name,
        categoryId: categoryIds[cat.slug],
        price,
        originalPrice,
        discount: Math.round(((originalPrice - price) / originalPrice) * 100),
        // Product.weight is an enum; only values it accepts.
        weight: isSeed
          ? ['10g', '20g', '50g', '100g', '250g'][i % 5]
          : ['500g', '1kg', '2kg', '5kg', '10kg'][i % 5],
        stock,
        description: `${name} — quality ${cat.name.toLowerCase()} suited to Indian home gardens, balconies and terraces.`,
        images: [img(cat.slug, i), img(cat.slug, i + 1)],
        features: ['Quality checked', 'Suitable for Indian climate', 'Beginner friendly', 'Ships pan-India'],
        howToGrow: isSeed
          ? 'Sow 1cm deep in moist, well-drained soil. Keep in bright indirect light and water lightly each day until germination.'
          : 'Store in a cool, dry place away from direct sunlight. Follow the usage guidance on the pack.',
        season: pick(SEASONS, i),
        isCombo: false,
        isActive: true,
        rating,
        numReviews: Math.floor(rand(seed + 4) * 180),
        featured: rand(seed + 5) > 0.72,
        trending: rand(seed + 6) > 0.85,
      };

      // Seed products get real pack-size variants, which the pricing service
      // and the product page both understand.
      if (isSeed) {
        product.packages = [
          { quantity: '50 Seeds',  price,                        stock },
          { quantity: '100 Seeds', price: Math.round(price * 1.8), stock: Math.max(0, stock - 10) },
          { quantity: '250 Seeds', price: Math.round(price * 4),   stock: Math.max(0, stock - 25) },
        ];
      }
      products.push(product);
    });
  }

  // Top up to exactly 100 with extra pack sizes of existing lines.
  let extra = 0;
  while (products.length < 100) {
    const base = products[extra % products.length];
    lock += 1;
    products.push({
      ...base,
      name: `${base.name} (Value Pack)`,
      price: Math.round(base.price * 1.7),
      originalPrice: Math.round(base.originalPrice * 1.7),
      stock: Math.floor(5 + rand(lock) * 120),
      images: [img(base.__slug || 'plants', extra), img(base.__slug || 'plants', extra + 1)],
      featured: false,
      packages: undefined,
    });
    extra += 1;
  }
  const clean = products.slice(0, 100).map(({ __slug, ...rest }) => rest);
  const created = await Product.insertMany(clean);
  console.log(`✅ ${created.length} products created`);

  // ── Combos ──────────────────────────────────────────────────────────────────
  const byCat = (slug) => created.filter((p) => String(p.categoryId) === String(categoryIds[slug]));

  const COMBOS = [
    { name: 'Kitchen Garden Starter Kit', type: 'Kitchen Garden',
      from: ['vegetable-seeds', 'soil-fertilizers', 'grow-bags'], blurb: 'Everything a first-time grower needs to plant their first vegetables.' },
    { name: 'Balcony Gardener Bundle', type: 'Small',
      from: ['plants', 'grow-bags', 'watering-solutions'], blurb: 'Compact picks that thrive in small balconies and window ledges.' },
    { name: 'Terrace Garden Pack', type: 'Terrace Garden',
      from: ['vegetable-seeds', 'fertilizers', 'tools'], blurb: 'A bigger kit for terrace growers ready to scale up.' },
    { name: 'Flower Lover Combo', type: 'Custom',
      from: ['flower-seeds', 'soil-fertilizers'], blurb: 'Bright, easy-to-grow blooms with the soil to match.' },
    { name: 'Plant Care Essentials', type: 'Custom',
      from: ['fertilizers', 'pest-control', 'watering-solutions'], blurb: 'Keep what you have already grown healthy all season.' },
    { name: 'Complete Growing Kit', type: 'Growing Kit',
      from: ['vegetable-seeds', 'flower-seeds', 'tools', 'soil-fertilizers'], blurb: 'Seeds, soil and tools in one box — our most complete bundle.' },
  ];

  const combos = COMBOS.map((c, i) => {
    const includedProducts = c.from
      .map((slug) => byCat(slug)[i % Math.max(1, byCat(slug).length)])
      .filter(Boolean)
      .map((p) => ({ productId: p._id, quantity: 1 }));

    // Price the bundle off its real members, then discount it.
    const memberTotal = c.from
      .map((slug) => byCat(slug)[i % Math.max(1, byCat(slug).length)])
      .filter(Boolean)
      .reduce((sum, p) => sum + p.price, 0);
    const price = Math.round(memberTotal * 0.75);

    return {
      name: c.name,
      description: c.blurb,
      price,
      originalPrice: memberTotal,
      discount: Math.round(((memberTotal - price) / memberTotal) * 100),
      comboType: c.type,
      stock: 25 + i * 5,
      includedProducts,
      images: [img(c.from[0], i)],
      isActive: true,
    };
  });

  const createdCombos = await Combo.insertMany(combos);
  console.log(`✅ ${createdCombos.length} combos created`);

  console.log('\n📊 Summary');
  console.log('   categories:', await Category.countDocuments());
  console.log('   products  :', await Product.countDocuments());
  console.log('   combos    :', await Combo.countDocuments());
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('✖  Seeding failed:', err.message);
  process.exit(1);
});

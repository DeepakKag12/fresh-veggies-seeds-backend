const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Category = require('./models/Category');
const Product = require('./models/Product');
const User = require('./models/User');

dotenv.config();

// Sample Categories
const categories = [
  {
    name: 'Vegetable Seeds',
    slug: 'vegetable-seeds',
    description: 'High-quality organic vegetable seeds for your garden',
    image: 'https://images.unsplash.com/photo-1585664811087-47f65abbad64?w=400',
    icon: '🥬'
  },
  {
    name: 'Flower Seeds',
    slug: 'flower-seeds',
    description: 'Beautiful flower seeds to brighten your garden',
    image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400',
    icon: '🌸'
  },
  {
    name: 'Grow Bags',
    slug: 'grow-bags',
    description: 'Durable grow bags for container gardening',
    image: 'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?w=400',
    icon: '🎒'
  },
  {
    name: 'Soil & Fertilizers',
    slug: 'soil-fertilizers',
    description: 'Premium soil and organic fertilizers',
    image: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400',
    icon: '🌱'
  },
  {
    name: 'Tools',
    slug: 'tools',
    description: 'Essential gardening tools and equipment',
    image: 'https://images.unsplash.com/photo-1617576683096-00fc8eecb3af?w=400',
    icon: '🛠️'
  }
];

// Sample Products (will be created after categories)
const getProducts = (categoryIds) => [
  // Vegetable Seeds
  {
    name: 'All Time Vegetable Seeds Kit',
    categoryId: categoryIds['vegetable-seeds'],
    price: 199,
    originalPrice: 450,
    discount: 55,
    weight: '100g',
    stock: 150,
    description: 'Complete kit with 10 varieties of seasonal vegetable seeds. Perfect for year-round gardening. Includes Tomato, Cucumber, Carrot, Radish, Spinach, Brinjal, Chilli, Beans, Peas, and Coriander.',
    images: [
      'https://images.unsplash.com/photo-1592419044706-39796d40f98c?w=600',
      'https://images.unsplash.com/photo-1585664811087-47f65abbad64?w=600'
    ],
    features: [
      'High germination rate (85%+)',
      'Organic and non-GMO seeds',
      '10 different varieties included',
      'Suitable for all seasons',
      'Complete growing instructions'
    ],
    howToGrow: 'Sow seeds 1/4 to 1/2 inch deep in seed trays or directly in soil. Keep soil moist. Transplant after 4-6 weeks. Needs full sunlight and regular watering.',
    season: 'All Season',
    rating: 4.53,
    numReviews: 102,
    isActive: true,
    featured: true,
    trending: true
  },
  {
    name: 'Winter Season Vegetables Seeds',
    categoryId: categoryIds['vegetable-seeds'],
    price: 349,
    originalPrice: 999,
    discount: 65,
    weight: '150g',
    stock: 89,
    description: 'Special winter vegetable collection with premium quality seeds. Includes Cabbage, Cauliflower, Peas, Beans, Lettuce, Winter Spinach, Broccoli, and Brussels Sprouts. Perfect for cold season gardening.',
    images: [
      'https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=600',
      'https://images.unsplash.com/photo-1590779033100-9f60a05a013d?w=600'
    ],
    features: [
      'Cold-tolerant varieties',
      'Premium quality seeds',
      '8 winter vegetable varieties',
      'High yield production',
      'Organic and certified'
    ],
    howToGrow: 'Sow in early autumn for winter harvest. Plant in full sun with well-draining soil. Water moderately. Harvest when fully mature.',
    season: 'Winter',
    rating: 4.49,
    numReviews: 71,
    isActive: true,
    featured: true
  },
  {
    name: 'Summer Vegetable Seeds Pack',
    categoryId: categoryIds['vegetable-seeds'],
    price: 249,
    originalPrice: 599,
    discount: 40,
    weight: '120g',
    stock: 120,
    description: '12 varieties of heat-resistant vegetable seeds for summer growing. Includes Tomato, Chilli, Brinjal, Okra, Bottle Gourd, Ridge Gourd, Bitter Gourd, Cucumber, and more.',
    images: [
      'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=600',
      'https://images.unsplash.com/photo-1597362925123-77861d3fbac7?w=600'
    ],
    features: [
      'Heat-resistant varieties',
      '12 different vegetables',
      'Fast-growing seeds',
      'High germination rate',
      'Perfect for summer planting'
    ],
    howToGrow: 'Plant after last frost. Needs 6-8 hours of direct sunlight. Water deeply 2-3 times per week. Mulch to retain moisture.',
    season: 'Summer',
    rating: 4.67,
    numReviews: 89,
    isActive: true,
    featured: true
  },
  {
    name: 'Organic Tomato Seeds',
    categoryId: categoryIds['vegetable-seeds'],
    price: 79,
    originalPrice: 150,
    discount: 47,
    weight: '10g',
    stock: 200,
    description: 'Premium hybrid tomato seeds with high yield. Disease resistant variety perfect for home gardens. Produces large, juicy tomatoes.',
    images: [
      'https://images.unsplash.com/photo-1546470427-e26264be0b0d?w=600',
      'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600'
    ],
    features: [
      'High germination rate',
      'Disease resistant',
      'Large fruit size',
      'All-season variety'
    ],
    howToGrow: 'Sow 1/4 inch deep. Transplant after 4-6 weeks. Needs full sun and support stakes.',
    season: 'All Season',
    rating: 4.71,
    numReviews: 156,
    isActive: true,
    trending: true
  },
  {
    name: 'Cucumber Seeds',
    categoryId: categoryIds['vegetable-seeds'],
    price: 49,
    originalPrice: 99,
    discount: 50,
    weight: '8g',
    stock: 180,
    description: 'Fresh cucumber seeds for crisp, juicy cucumbers. Suitable for salads and pickling. Fast-growing variety.',
    images: [
      'https://images.unsplash.com/photo-1568584711271-81bd9c6ed8f7?w=600',
      'https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=600'
    ],
    features: [
      'Fast growing (50-60 days)',
      'Crisp and juicy',
      'Good for salads',
      'High yield'
    ],
    howToGrow: 'Plant in warm soil. Provide trellis for climbing. Water regularly. Harvest when 6-8 inches.',
    season: 'Summer',
    rating: 4.45,
    numReviews: 67,
    isActive: true
  },

  // Flower Seeds
  {
    name: 'Mixed Flower Seeds Kit',
    categoryId: categoryIds['flower-seeds'],
    price: 299,
    originalPrice: 799,
    discount: 50,
    weight: '50g',
    stock: 95,
    description: '15 varieties of colorful annual flowers. Perfect for creating a vibrant garden. Includes Marigold, Zinnia, Cosmos, Sunflower, Petunia, and more.',
    images: [
      'https://images.unsplash.com/photo-1563241789-3b8e84b9c88c?w=600',
      'https://images.unsplash.com/photo-1563089145-599997674d42?w=600'
    ],
    features: [
      '15 flower varieties',
      'Attracts butterflies',
      'Easy to grow',
      'Blooms all season',
      'Organic seeds'
    ],
    howToGrow: 'Sow in spring after frost. Needs full sun. Water regularly. Deadhead spent flowers.',
    season: 'Spring',
    rating: 4.82,
    numReviews: 143,
    isActive: true,
    featured: true
  },
  {
    name: 'Marigold Seeds Pack',
    categoryId: categoryIds['flower-seeds'],
    price: 59,
    originalPrice: 120,
    discount: 50,
    weight: '10g',
    stock: 250,
    description: 'Bright orange and yellow marigold seeds. Easy to grow and perfect for borders and pots. Natural pest repellent.',
    images: [
      'https://images.unsplash.com/photo-1568618090102-0c0e9991c4e1?w=600',
      'https://images.unsplash.com/photo-1595259691735-75360ffe0cb0?w=600'
    ],
    features: [
      'Bright colors',
      'Easy to grow',
      'Natural pest control',
      'Long blooming'
    ],
    howToGrow: 'Sow directly or in trays. Needs full sun. Space 8-10 inches apart. Water moderately.',
    season: 'All Season',
    rating: 4.55,
    numReviews: 92,
    isActive: true,
    trending: true
  },
  {
    name: 'Rose Seeds Collection',
    categoryId: categoryIds['flower-seeds'],
    price: 149,
    originalPrice: 350,
    discount: 57,
    weight: '5g',
    stock: 75,
    description: 'Beautiful hybrid tea rose seeds in assorted colors. Bloom all season long. Perfect for garden beds.',
    images: [
      'https://images.unsplash.com/photo-1496062031456-07b8f162a322?w=600',
      'https://images.unsplash.com/photo-1518709594023-6eab9bab7b23?w=600'
    ],
    features: [
      'Multiple colors',
      'Long blooming',
      'Fragrant flowers',
      'Garden beauty'
    ],
    howToGrow: 'Soak seeds overnight. Plant in rich soil. Needs 6 hours sun. Prune regularly.',
    season: 'Spring',
    rating: 4.38,
    numReviews: 54,
    isActive: true
  },
  {
    name: 'Sunflower Seeds',
    categoryId: categoryIds['flower-seeds'],
    price: 89,
    originalPrice: 180,
    discount: 50,
    weight: '20g',
    stock: 160,
    description: 'Giant sunflower seeds that grow up to 8 feet tall. Perfect for garden borders and bird feeding.',
    images: [
      'https://images.unsplash.com/photo-1597848212624-e2931f53c969?w=600',
      'https://images.unsplash.com/photo-1500462918059-b1a0cb512f1d?w=600'
    ],
    features: [
      'Giant flowers',
      'Grows up to 8 feet',
      'Attracts birds',
      'Easy care'
    ],
    howToGrow: 'Plant in full sun. Needs deep soil. Water regularly. Stake tall varieties.',
    season: 'Summer',
    rating: 4.76,
    numReviews: 128,
    isActive: true,
    featured: true
  },

  // Grow Bags
  {
    name: 'Premium Grow Bags Set (5 Pack)',
    categoryId: categoryIds['grow-bags'],
    price: 399,
    originalPrice: 899,
    discount: 55,
    weight: '1kg',
    stock: 110,
    description: 'Heavy-duty fabric grow bags with handles. Sizes: 5, 7, 10, 15, 20 gallon. Perfect for vegetables and flowers.',
    images: [
      'https://images.unsplash.com/photo-1610450949065-1f2841536c88?w=600',
      'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600'
    ],
    features: [
      'Breathable fabric',
      'Strong handles',
      '5 different sizes',
      'Drainage holes',
      'Reusable'
    ],
    howToGrow: 'Fill with quality potting mix. Excellent drainage prevents root rot. Move easily with handles.',
    season: 'All Season',
    rating: 4.64,
    numReviews: 87,
    isActive: true,
    featured: true,
    trending: true
  },
  {
    name: 'HDPE Grow Bag 12x12 inch',
    categoryId: categoryIds['grow-bags'],
    price: 199,
    originalPrice: 450,
    discount: 55,
    weight: '800g',
    stock: 200,
    description: 'UV stabilized HDPE grow bags ideal for terrace gardening. Pack of 10 bags. Durable and weather resistant.',
    images: [
      'https://images.unsplash.com/photo-1585664811087-47f65abbad64?w=600',
      'https://images.unsplash.com/photo-1558904541-efa843a96f01?w=600'
    ],
    features: [
      'UV stabilized',
      'Weather resistant',
      'Pack of 10',
      'Perfect size'
    ],
    howToGrow: 'Ideal for terrace gardens. Good for small to medium plants. Fill and plant.',
    season: 'All Season',
    rating: 4.41,
    numReviews: 73,
    isActive: true
  },
  {
    name: 'Vertical Garden Grow Bags',
    categoryId: categoryIds['grow-bags'],
    price: 299,
    originalPrice: 699,
    discount: 57,
    weight: '600g',
    stock: 65,
    description: 'Multi-pocket vertical planter bags. Save space and grow more. 7 pockets per bag. Perfect for herbs and flowers.',
    images: [
      'https://images.unsplash.com/photo-1558904541-efa843a96f01?w=600',
      'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?w=600'
    ],
    features: [
      '7 pockets',
      'Space saving',
      'Wall hanging',
      'Easy access'
    ],
    howToGrow: 'Hang on wall or fence. Fill pockets with soil. Plant herbs or flowers in each pocket.',
    season: 'All Season',
    rating: 4.58,
    numReviews: 45,
    isActive: true
  },

  // Soil & Fertilizers
  {
    name: 'Organic Potting Mix - 10kg',
    categoryId: categoryIds['soil-fertilizers'],
    price: 249,
    originalPrice: 499,
    discount: 50,
    weight: '10kg',
    stock: 140,
    description: 'Premium blend of coco peat, vermicompost, perlite, and neem cake. Perfect for all plants. Rich in nutrients.',
    images: [
      'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=600',
      'https://images.unsplash.com/photo-1617634667039-8e4cb6ea1faa?w=600'
    ],
    features: [
      'Organic ingredients',
      'Perfect pH balance',
      'Good drainage',
      'Rich in nutrients',
      'All-purpose mix'
    ],
    howToGrow: 'Use for all potted plants. Mix with existing soil or use directly. Water after planting.',
    season: 'All Season',
    rating: 4.79,
    numReviews: 234,
    isActive: true,
    featured: true,
    trending: true
  },
  {
    name: 'Vermicompost - 5kg',
    categoryId: categoryIds['soil-fertilizers'],
    price: 149,
    originalPrice: 299,
    discount: 50,
    weight: '5kg',
    stock: 175,
    description: '100% organic vermicompost rich in nutrients. Improves soil health and plant growth. Earthworm castings.',
    images: [
      'https://images.unsplash.com/photo-1617634667039-8e4cb6ea1faa?w=600',
      'https://images.unsplash.com/photo-1628267942134-0068c201f96a?w=600'
    ],
    features: [
      '100% organic',
      'Rich in nutrients',
      'Improves soil',
      'Natural fertilizer'
    ],
    howToGrow: 'Mix with soil at 1:4 ratio. Apply monthly for best results. Water after application.',
    season: 'All Season',
    rating: 4.68,
    numReviews: 156,
    isActive: true
  },
  {
    name: 'NPK Fertilizer 19:19:19',
    categoryId: categoryIds['soil-fertilizers'],
    price: 179,
    originalPrice: 350,
    discount: 48,
    weight: '1kg',
    stock: 190,
    description: 'Balanced NPK fertilizer for all-purpose gardening. Water soluble and fast acting. Complete plant nutrition.',
    images: [
      'https://images.unsplash.com/photo-1592419044706-39796d40f98c?w=600',
      'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=600'
    ],
    features: [
      'Balanced NPK',
      'Water soluble',
      'Fast acting',
      'All-purpose'
    ],
    howToGrow: 'Dissolve 5g per liter. Apply every 15 days. Avoid over-fertilizing.',
    season: 'All Season',
    rating: 4.52,
    numReviews: 98,
    isActive: true
  },
  {
    name: 'Neem Cake Powder - 2kg',
    categoryId: categoryIds['soil-fertilizers'],
    price: 129,
    originalPrice: 250,
    discount: 48,
    weight: '2kg',
    stock: 145,
    description: 'Organic pest control and fertilizer. Rich in nitrogen and acts as natural pesticide. Safe for all plants.',
    images: [
      'https://images.unsplash.com/photo-1628267942134-0068c201f96a?w=600',
      'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=600'
    ],
    features: [
      'Organic pest control',
      'Natural fertilizer',
      'Rich in nitrogen',
      'Safe for plants'
    ],
    howToGrow: 'Mix with soil before planting. Apply monthly as top dressing. Water well.',
    season: 'All Season',
    rating: 4.61,
    numReviews: 82,
    isActive: true
  },

  // Tools
  {
    name: 'Gardening Tools Set (8 Pieces)',
    categoryId: categoryIds['tools'],
    price: 599,
    originalPrice: 1299,
    discount: 53,
    weight: '2kg',
    stock: 85,
    description: 'Complete gardening tool kit with spade, rake, trowel, pruner, sprayer, gloves, and storage bag. Professional quality.',
    images: [
      'https://images.unsplash.com/photo-1617576683096-00fc8eecb3af?w=600',
      'https://images.unsplash.com/photo-1565011523534-747a8601f10a?w=600'
    ],
    features: [
      '8 essential tools',
      'Ergonomic design',
      'Durable materials',
      'Storage bag included',
      'Professional quality'
    ],
    howToGrow: 'Complete toolkit for all garden tasks. Keep tools clean and dry after use.',
    season: 'All Season',
    rating: 4.73,
    numReviews: 167,
    isActive: true,
    featured: true,
    trending: true
  },
  {
    name: 'Hand Pruning Shears',
    categoryId: categoryIds['tools'],
    price: 249,
    originalPrice: 499,
    discount: 50,
    weight: '300g',
    stock: 120,
    description: 'Professional grade pruning shears with ergonomic grip. Perfect for trimming plants and flowers. Sharp blades.',
    images: [
      'https://images.unsplash.com/photo-1565011523534-747a8601f10a?w=600',
      'https://images.unsplash.com/photo-1617576683096-00fc8eecb3af?w=600'
    ],
    features: [
      'Sharp blades',
      'Ergonomic grip',
      'Professional grade',
      'Easy to use'
    ],
    howToGrow: 'Perfect for pruning roses, shrubs, and small branches. Clean after each use.',
    season: 'All Season',
    rating: 4.66,
    numReviews: 94,
    isActive: true
  },
  {
    name: 'Garden Spray Bottle 2L',
    categoryId: categoryIds['tools'],
    price: 199,
    originalPrice: 399,
    discount: 50,
    weight: '500g',
    stock: 155,
    description: 'Pressure sprayer for watering and pesticide application. Adjustable nozzle with pump action. Easy to use.',
    images: [
      'https://images.unsplash.com/photo-1563089145-599997674d42?w=600',
      'https://images.unsplash.com/photo-1617576683096-00fc8eecb3af?w=600'
    ],
    features: [
      '2L capacity',
      'Adjustable nozzle',
      'Pump action',
      'Easy grip'
    ],
    howToGrow: 'Fill with water or liquid fertilizer. Pump to build pressure. Spray evenly.',
    season: 'All Season',
    rating: 4.44,
    numReviews: 76,
    isActive: true
  },
  {
    name: 'Watering Can 10L',
    categoryId: categoryIds['tools'],
    price: 299,
    originalPrice: 599,
    discount: 50,
    weight: '1.2kg',
    stock: 95,
    description: 'Large capacity watering can with long spout and rose head. Durable plastic construction. Easy pouring.',
    images: [
      'https://images.unsplash.com/photo-1563659222-90928e9898db?w=600',
      'https://images.unsplash.com/photo-1617576683096-00fc8eecb3af?w=600'
    ],
    features: [
      '10L capacity',
      'Long spout',
      'Rose head',
      'Durable'
    ],
    howToGrow: 'Perfect for watering large gardens. Rose head for gentle watering of seedlings.',
    season: 'All Season',
    rating: 4.57,
    numReviews: 68,
    isActive: true
  },

  // Old products for backward compatibility
  {
    name: 'Spinach Seeds Premium',
    categoryId: categoryIds.vegetables,
    price: 35,
    weight: '20g',
    stock: 200,
    description: 'Fresh organic spinach seeds for healthy greens. Rich in iron and vitamins. Perfect for winter gardening. Fast growing variety.',
    images: [
      'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=600',
      'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=600'
    ],
    features: [
      'Fast growing (30-40 days)',
      'High in iron and vitamins',
      'Organic certified seeds',
      'Cold tolerant variety'
    ],
    howToGrow: 'Sow directly in well-drained soil. Keep 2 inches apart. Water regularly. Harvest outer leaves first.',
    season: 'Winter',
    rating: 4.7,
    numReviews: 45,
    isActive: true
  },
  {
    name: 'Carrot Seeds Hybrid',
    categoryId: categoryIds.vegetables,
    price: 55,
    weight: '10g',
    stock: 120,
    description: 'Bright orange carrots with sweet taste. Hybrid variety for better yield. Rich in beta-carotene and vitamin A.',
    images: [
      'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=600',
      'https://images.unsplash.com/photo-1445282768818-728615cc910a?w=600'
    ],
    features: [
      'Sweet and crunchy',
      'High beta-carotene content',
      'Uniform size and shape',
      '90-100 days to harvest'
    ],
    howToGrow: 'Sow in loose, sandy soil. Thin seedlings to 3 inches apart. Keep soil moist but not waterlogged.',
    season: 'Winter',
    rating: 4.3,
    numReviews: 32,
    isActive: true
  },
  {
    name: 'Cucumber Seeds',
    categoryId: categoryIds.vegetables,
    price: 45,
    weight: '10g',
    stock: 180,
    description: 'Crispy, refreshing cucumber seeds. High yielding variety. Perfect for salads and pickles. Disease resistant.',
    images: [
      'https://images.unsplash.com/photo-1604977042946-1eecc30f269e?w=600',
      'https://images.unsplash.com/photo-1566840815470-74c1e0e6a8eb?w=600'
    ],
    features: [
      'High yielding variety',
      'Crispy and refreshing',
      'Disease resistant',
      'Suitable for salads and pickles'
    ],
    howToGrow: 'Sow after last frost. Needs support/trellis. Water regularly. Harvest when 6-8 inches long.',
    season: 'Summer',
    rating: 4.6,
    numReviews: 38,
    isActive: true
  },
  {
    name: 'Strawberry Plants',
    categoryId: categoryIds.fruits,
    price: 120,
    weight: '50g',
    stock: 80,
    description: 'Sweet and juicy strawberry plants. Produces fruit within 3-4 months. Perfect for home gardens and containers.',
    images: [
      'https://images.unsplash.com/photo-1543158181-e6f9f6712055?w=600',
      'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=600'
    ],
    features: [
      'Quick fruit production',
      'Sweet and aromatic',
      'Suitable for containers',
      'Perennial plant'
    ],
    howToGrow: 'Plant in well-draining soil with full sun. Water regularly. Mulch around plants. Fertilize monthly.',
    season: 'Winter',
    rating: 4.8,
    numReviews: 52,
    isActive: true
  },
  {
    name: 'Basil Seeds (Tulsi)',
    categoryId: categoryIds.herbs,
    price: 30,
    weight: '10g',
    stock: 250,
    description: 'Holy basil (Tulsi) seeds with medicinal properties. Aromatic and sacred plant. Easy to grow in pots or ground.',
    images: [
      'https://images.unsplash.com/photo-1618375569909-3c8616cf7e55?w=600',
      'https://images.unsplash.com/photo-1627843563920-020ed6d2916d?w=600'
    ],
    features: [
      'Medicinal properties',
      'Aromatic leaves',
      'Easy to grow',
      'Pest repellent'
    ],
    howToGrow: 'Sow in pots or ground. Needs partial to full sunlight. Water when soil feels dry. Pinch growing tips for bushier growth.',
    season: 'All Season',
    rating: 4.9,
    numReviews: 67,
    isActive: true
  },
  {
    name: 'Coriander Seeds',
    categoryId: categoryIds.herbs,
    price: 25,
    weight: '20g',
    stock: 300,
    description: 'Fresh coriander (cilantro) seeds for flavorful leaves. Fast growing herb. Essential for Indian cooking.',
    images: [
      'https://images.unsplash.com/photo-1620207222638-f61b39f4e0c4?w=600',
      'https://images.unsplash.com/photo-1581950004874-29d2e8d09f43?w=600'
    ],
    features: [
      'Fast growing (30 days)',
      'Rich flavor and aroma',
      'Cut and grow again',
      'Rich in vitamins'
    ],
    howToGrow: 'Sow directly in garden or pots. Needs partial shade. Water regularly. Harvest outer leaves.',
    season: 'Winter',
    rating: 4.4,
    numReviews: 41,
    isActive: true
  },
  {
    name: 'Marigold Flower Seeds',
    categoryId: categoryIds.flowers,
    price: 40,
    weight: '10g',
    stock: 150,
    description: 'Bright orange and yellow marigold seeds. Natural pest repellent. Perfect for garden borders and pots.',
    images: [
      'https://images.unsplash.com/photo-1592729645009-b96d1e63d14b?w=600',
      'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=600'
    ],
    features: [
      'Vibrant colors',
      'Natural pest control',
      'Easy to grow',
      'Long blooming season'
    ],
    howToGrow: 'Sow after last frost. Full sun required. Deadhead spent flowers. Water at base of plant.',
    season: 'All Season',
    rating: 4.5,
    numReviews: 35,
    isActive: true
  }
];

// Create Admin User
const adminUser = {
  name: 'Admin User',
  email: 'admin@freshveggies.com',
  phone: '9999999999',
  password: 'admin123',
  role: 'admin',
  isActive: true
};

// Sample Customer
const customerUser = {
  name: 'Test Customer',
  email: 'customer@test.com',
  phone: '8888888888',
  password: 'customer123',
  role: 'customer',
  isActive: true
};

// Connect to Database
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  });

// Seed Database
const seedDatabase = async () => {
  try {
    console.log('🌱 Starting database seeding...');

    // Clear existing data
    await Category.deleteMany({});
    await Product.deleteMany({});
    await User.deleteMany({});
    console.log('🗑️  Cleared existing data');

    // Create Categories
    const createdCategories = await Category.insertMany(categories);
    console.log(`✅ Created ${createdCategories.length} categories`);

    // Create category ID mapping
    const categoryIds = {
      'vegetable-seeds': createdCategories.find(c => c.slug === 'vegetable-seeds')?._id,
      'flower-seeds': createdCategories.find(c => c.slug === 'flower-seeds')?._id,
      'grow-bags': createdCategories.find(c => c.slug === 'grow-bags')?._id,
      'soil-fertilizers': createdCategories.find(c => c.slug === 'soil-fertilizers')?._id,
      'tools': createdCategories.find(c => c.slug === 'tools')?._id,
      vegetables: createdCategories.find(c => c.slug === 'vegetables')?._id,
      fruits: createdCategories.find(c => c.slug === 'fruits')?._id,
      herbs: createdCategories.find(c => c.slug === 'herbs')?._id,
      flowers: createdCategories.find(c => c.slug === 'flowers')?._id,
    };

    // Create Products
    const products = getProducts(categoryIds);
    // Filter out products with undefined categoryId
    const validProducts = products.filter(p => p.categoryId);
    const createdProducts = await Product.insertMany(validProducts);
    console.log(`✅ Created ${createdProducts.length} products`);

    // Create Users
    const admin = await User.create(adminUser);
    const customer = await User.create(customerUser);
    console.log('✅ Created admin and customer users');

    console.log('\n📊 Seeding Summary:');
    console.log(`   Categories: ${createdCategories.length}`);
    console.log(`   Products: ${createdProducts.length}`);
    console.log(`   Users: 2 (1 admin, 1 customer)`);
    console.log('\n👤 Login Credentials:');
    console.log('   Admin:');
    console.log('   Email: admin@freshveggies.com');
    console.log('   Password: admin123');
    console.log('\n   Customer:');
    console.log('   Email: customer@test.com');
    console.log('   Password: customer123');
    
    console.log('\n✅ Database seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

// Run seeding
seedDatabase();

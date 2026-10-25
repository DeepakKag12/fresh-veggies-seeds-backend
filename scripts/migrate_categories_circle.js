require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../src/models/category.model');
const cacheService = require('../src/utils/cache.util');

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const categories = await Category.find({});
  console.log(`Found ${categories.length} categories.`);

  for (const cat of categories) {
    const s = (cat.name || '').toLowerCase();
    // Disable fertilising, tools, watering, soils, pest control per user instruction
    if (
      s.includes('fertil') ||
      s.includes('tool') ||
      s.includes('water') ||
      s.includes('soil') ||
      s.includes('pest')
    ) {
      cat.showInCircle = false;
      console.log(`Disabled circle for: ${cat.name}`);
    } else {
      cat.showInCircle = true;
      console.log(`Enabled circle for: ${cat.name}`);
    }
    await cat.save();
  }

  cacheService.invalidate('categories:');
  console.log('Categories cache invalidated.');
  await mongoose.disconnect();
  console.log('Migration complete!');
}

migrate().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});

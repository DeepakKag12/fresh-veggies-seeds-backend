const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const cacheService = require('../src/utils/cache.util');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/vinodjiju');
    console.log('✅ Connected to MongoDB for image consistency audit & normalization');

    const Banner = mongoose.model('Banner', new mongoose.Schema({}, { strict: false }));
    const Category = mongoose.model('Category', new mongoose.Schema({}, { strict: false }));
    const Product = mongoose.model('Product', new mongoose.Schema({}, { strict: false }));
    const Combo = mongoose.model('Combo', new mongoose.Schema({}, { strict: false }));

    // 1. Audit and Fix Banners
    const banners = await Banner.find({});
    for (const b of banners) {
      const titleLower = (b.title || '').toLowerCase();
      let updatedImageUrl = b.imageUrl;
      let updatedMobileUrl = b.mobileImageUrl;

      if (!b.imageUrl || b.imageUrl.includes('fresh-veggies/image/upload') || b.imageUrl.includes('placeholder')) {
        if (titleLower.includes('monsoon') || titleLower.includes('rain')) {
          updatedImageUrl = '/sandbox-assets/banners/monsoon_gardening.jpg';
          updatedMobileUrl = '/sandbox-assets/banners/monsoon_gardening.jpg';
        } else if (titleLower.includes('diwali') || titleLower.includes('harvest') || titleLower.includes('spring')) {
          updatedImageUrl = '/sandbox-assets/hero/slide_3.webp';
          updatedMobileUrl = '/sandbox-assets/hero/slide_3.webp';
        } else if (titleLower.includes('fertilizer') || titleLower.includes('feed')) {
          updatedImageUrl = '/sandbox-assets/banners/organic_fertilizer_promo.webp';
          updatedMobileUrl = '/sandbox-assets/banners/organic_fertilizer_promo.webp';
        } else {
          updatedImageUrl = '/sandbox-assets/hero/slide_1.webp';
          updatedMobileUrl = '/sandbox-assets/hero/slide_1.webp';
        }

        await Banner.updateOne(
          { _id: b._id },
          { $set: { imageUrl: updatedImageUrl, mobileImageUrl: updatedMobileUrl } }
        );
        console.log(`✓ Updated banner "${b.title}" -> ${updatedImageUrl}`);
      }
    }

    // 2. Audit and Fix Categories
    const categories = await Category.find({});
    for (const c of categories) {
      if (!c.image || c.image.includes('placeholder')) {
        const nameLower = (c.name || '').toLowerCase();
        let fallbackIcon = '/sandbox-assets/icons/seeds.webp';
        if (nameLower.includes('flower')) fallbackIcon = '/sandbox-assets/icons/flowers.webp';
        else if (nameLower.includes('fertilizer')) fallbackIcon = '/sandbox-assets/icons/fertilisers.webp';
        else if (nameLower.includes('soil')) fallbackIcon = '/sandbox-assets/icons/soils.webp';
        else if (nameLower.includes('tool')) fallbackIcon = '/sandbox-assets/icons/tools.webp';
        else if (nameLower.includes('herb') || nameLower.includes('basil') || nameLower.includes('plant')) fallbackIcon = '/sandbox-assets/icons/plants.webp';

        await Category.updateOne(
          { _id: c._id },
          { $set: { image: fallbackIcon } }
        );
        console.log(`✓ Updated category "${c.name}" icon -> ${fallbackIcon}`);
      }
    }

    // 3. Audit and Fix Combos
    const combos = await Combo.find({});
    for (const combo of combos) {
      if (!combo.image || !combo.images || combo.images.length === 0) {
        const comboImg = '/sandbox-assets/hero/slide_3.webp';
        await Combo.updateOne(
          { _id: combo._id },
          { $set: { image: comboImg, images: [comboImg] } }
        );
        console.log(`✓ Updated combo "${combo.name}" image -> ${comboImg}`);
      }
    }

    // 4. Audit and Fix Products with missing images
    const products = await Product.find({ isDeleted: { $ne: true } });
    for (const p of products) {
      if (!p.images || p.images.length === 0 || !p.images[0]) {
        const nameLower = (p.name || '').toLowerCase();
        let defaultProductImg = '/sandbox-assets/spotlight/spotlight_kitchen_garden.webp';
        if (nameLower.includes('fertilizer') || nameLower.includes('soil') || nameLower.includes('compost')) {
          defaultProductImg = '/sandbox-assets/spotlight/spotlight_soil_care.webp';
        } else if (nameLower.includes('kit') || nameLower.includes('pack')) {
          defaultProductImg = '/sandbox-assets/farm/farm_1.webp';
        }

        await Product.updateOne(
          { _id: p._id },
          { $set: { images: [defaultProductImg] } }
        );
        console.log(`✓ Updated product "${p.name}" images -> [${defaultProductImg}]`);
      }
    }

    // Clear all in-memory caches
    cacheService.invalidate();
    console.log('✅ Cleared cacheService in-memory store');

    console.log('🎉 Image normalization completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during image fix:', err);
    process.exit(1);
  }
})();

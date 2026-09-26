const express = require('express');
const path = require('path');

const authRoutes = require('../src/routes/auth.routes');
const categoryRoutes = require('../src/routes/category.routes');
const productRoutes = require('../src/routes/product.routes');
const comboRoutes = require('../src/routes/combo.routes');
const orderRoutes = require('../src/routes/order.routes');
const paymentRoutes = require('../src/routes/payment.routes');
const adminRoutes = require('../src/routes/admin.routes');
const uploadRoutes = require('../src/routes/upload.routes');
const couponRoutes = require('../src/routes/coupon.routes');
const reviewRoutes = require('../src/routes/review.routes');
const bannerRoutes = require('../src/routes/banner.routes');
const settingsRoutes = require('../src/routes/settings.routes');

const mounted = [
  { prefix: '/api/auth', router: authRoutes },
  { prefix: '/api/categories', router: categoryRoutes },
  { prefix: '/api/products', router: productRoutes },
  { prefix: '/api/combos', router: comboRoutes },
  { prefix: '/api/orders', router: orderRoutes },
  { prefix: '/api/payments', router: paymentRoutes },
  { prefix: '/api/admin', router: adminRoutes },
  { prefix: '/api/upload', router: uploadRoutes },
  { prefix: '/api/coupons', router: couponRoutes },
  { prefix: '/api/reviews', router: reviewRoutes },
  { prefix: '/api/banners', router: bannerRoutes },
  { prefix: '/api/settings', router: settingsRoutes },
];

const registeredRoutes = [];

mounted.forEach(({ prefix, router }) => {
  if (!router || !router.stack) return;
  router.stack.forEach(layer => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
      const fullPath = (prefix + layer.route.path).replace(/\/+/g, '/').replace(/\/$/, '');
      methods.forEach(method => {
        registeredRoutes.push({ method, path: fullPath });
      });
    }
  });
});

console.log(`Backend has ${registeredRoutes.length} route endpoints registered.`);

registeredRoutes.sort((a,b) => (a.path + a.method).localeCompare(b.path + b.method)).forEach(r => {
  console.log(`${r.method.padEnd(6)} ${r.path}`);
});

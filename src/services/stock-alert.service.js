const StockAlert = require('../models/stock-alert.model');
const emailService = require('./email.service');

exports.notifyProductBackInStock = async (product) => {
  if (!product?._id) return;

  const alerts = await StockAlert.find({
    productId: product._id,
    status: 'pending'
  }).lean();

  for (const alert of alerts) {
    try {
      if (alert.packageId) {
        const packageEntry = product.packages?.id?.(alert.packageId) ||
          product.packages?.find((entry) => String(entry._id) === String(alert.packageId));
        if (!packageEntry || Number(packageEntry.stock) <= 0) continue;
      }
      if (alert.email) {
        await emailService.sendStockAlertEmail(alert.email, product.name);
      } else {
        console.warn(`No SMS provider configured for stock alert ${alert._id}; leaving it pending`);
        continue;
      }
      await StockAlert.updateOne(
        { _id: alert._id, status: 'pending' },
        { $set: { status: 'notified', notifiedAt: new Date() } }
      );
    } catch (error) {
      console.error(`Stock alert delivery failed for ${product._id}:`, error.message);
    }
  }
};

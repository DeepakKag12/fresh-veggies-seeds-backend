const Order = require('../models/order.model');
const User = require('../models/user.model');
const notify = require('./order-notification.service');

const deliver = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order || order.paymentStatus !== 'Paid') return;

  const customer = await User.findById(order.userId).select('name email phone');
  const now = new Date();
  await Order.updateOne({ _id: order._id }, { $set: { 'notificationDelivery.lastAttemptAt': now } });

  if (!['Sent', 'Sending'].includes(order.notificationDelivery?.customerStatus)) {
    const claimed = await Order.updateOne(
      { _id: order._id, 'notificationDelivery.customerStatus': { $nin: ['Sent', 'Sending'] } },
      { $set: { 'notificationDelivery.customerStatus': 'Sending' } }
    );
    if (claimed.modifiedCount === 1) {
      try {
        await notify.sendOrderConfirmation(order, customer);
        await Order.updateOne({ _id: order._id }, { $set: { 'notificationDelivery.customerStatus': 'Sent' } });
      } catch (error) {
        await Order.updateOne({ _id: order._id }, {
          $set: { 'notificationDelivery.customerStatus': 'Failed', 'notificationDelivery.lastError': error.message }
        });
      }
    }
  }

  if (!['Sent', 'Sending'].includes(order.notificationDelivery?.adminStatus)) {
    const claimed = await Order.updateOne(
      { _id: order._id, 'notificationDelivery.adminStatus': { $nin: ['Sent', 'Sending'] } },
      { $set: { 'notificationDelivery.adminStatus': 'Sending' } }
    );
    if (claimed.modifiedCount === 1) {
      try {
        await notify.notifyAdminNewOrder(order, customer);
        await Order.updateOne({ _id: order._id }, { $set: { 'notificationDelivery.adminStatus': 'Sent' } });
      } catch (error) {
        await Order.updateOne({ _id: order._id }, {
          $set: { 'notificationDelivery.adminStatus': 'Failed', 'notificationDelivery.lastError': error.message }
        });
      }
    }
  }
};

exports.deliver = deliver;
exports.retryPending = async () => {
  const orders = await Order.find({
    paymentStatus: 'Paid',
    $or: [
      { 'notificationDelivery.customerStatus': { $nin: ['Sent', 'Sending'] } },
      { 'notificationDelivery.adminStatus': { $nin: ['Sent', 'Sending'] } }
    ]
  }).select('_id').limit(100);
  for (const order of orders) await deliver(order._id);
};

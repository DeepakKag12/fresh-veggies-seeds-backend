const User = require('../models/user.model');

exports.saveAddressToUser = async (userId, shippingAddress) => {
  if (!userId || !shippingAddress?.street) return;

  const user = await User.findById(userId);
  if (!user) return;

  if (!user.addresses) user.addresses = [];
  const exists = user.addresses.some((address) =>
    (address.street || '').trim().toLowerCase() === shippingAddress.street.trim().toLowerCase() &&
    (address.pincode || '').trim() === (shippingAddress.pincode || '').trim()
  );
  const isFirst = user.addresses.length === 0;

  if (!exists) {
    user.addresses.push({
      name: shippingAddress.name || user.name,
      phone: shippingAddress.phone || user.phone,
      street: shippingAddress.street,
      city: shippingAddress.city,
      state: shippingAddress.state,
      pincode: shippingAddress.pincode,
      country: shippingAddress.country || 'India',
      isDefault: isFirst,
      createdAt: new Date()
    });
  }

  if (!user.address?.street || isFirst) {
    user.address = {
      street: shippingAddress.street,
      city: shippingAddress.city,
      state: shippingAddress.state,
      pincode: shippingAddress.pincode,
      country: shippingAddress.country || 'India'
    };
  }

  if (shippingAddress.name && (!user.name || /^customer(\s*\d+)?$/i.test(user.name.trim()))) {
    user.name = shippingAddress.name.trim();
  }

  if (shippingAddress.email && !user.email) {
    const email = shippingAddress.email.trim().toLowerCase();
    const existing = await User.findOne({ email, _id: { $ne: user._id } });
    if (!existing) user.email = email;
  }

  await user.save({ validateBeforeSave: false });
};

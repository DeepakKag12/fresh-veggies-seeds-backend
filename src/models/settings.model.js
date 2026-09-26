const mongoose = require('mongoose');

const DEFAULT_SETTINGS = {
  store: {
    name: 'Fresh Veggies',
    logo: '/logo.png',
    phone: '9876543210',
    email: 'contact@freshveggies.me',
    whatsappNumber: '9876543210',
    address: '123 Garden Street, Indore, Madhya Pradesh 452001',
    businessHours: '9:00 AM – 8:00 PM',
    trustPillars: {
      pillar1Title: '100% Non-GMO',
      pillar1Subtitle: 'Heirloom certified seeds',
      pillar2Title: 'Free Delivery',
      pillar2Subtitle: 'On all orders above ₹{threshold}',
      pillar3Title: 'High Germination',
      pillar3Subtitle: 'Tested & fresh batch',
      pillar4Title: 'Expert Support',
      pillar4Subtitle: 'Gardener help via WhatsApp',
    },
  },
  delivery: {
    freeDeliveryThreshold: 499,
    deliveryCharge: 50,
    minOrderAmount: 100,
    codAvailable: true,
    codMaxOrder: 5000,
    deliveryTime: '3–5 Days',
  },
  orders: {
    allowCustomerCancellation: true,
    cancellationAllowedUntil: 'Before Shipped', // 'Before Packed' or 'Before Shipped'
    autoConfirmOrders: false,
    autoCancelUnpaidOrders: true,
    unpaidOrderTimeoutMinutes: 30,
  },
  inventory: {
    lowStockThreshold: 10,
    showOnlyXLeft: true,
    allowBackorders: false,
    autoHideOutOfStock: false,
  },
  payments: {
    onlinePaymentEnabled: true,
    codEnabled: true,
    codMinOrder: 100,
    codMaxOrder: 5000,
    codExtraCharge: 0,
    onlineDiscountType: 'percentage', // 'percentage' or 'flat'
    onlineDiscountValue: 0,
    onlineDiscountMaxLimit: 100,
  },
  notifications: {
    admin: {
      newOrder: { email: true, whatsapp: true },
      cancellationRequest: { email: true, whatsapp: false },
      lowStock: { email: true, whatsapp: false },
      paymentFailed: { email: true, whatsapp: false },
      courierFailed: { email: true, whatsapp: false },
    },
    customer: {
      orderConfirmation: { email: true, whatsapp: true },
      orderShipped: { email: true, whatsapp: true },
      orderDelivered: { email: true, whatsapp: true },
      orderCancelled: { email: true, whatsapp: true },
    },
  },
};

const settingsSchema = new mongoose.Schema(
  {
    store: {
      name: { type: String, default: DEFAULT_SETTINGS.store.name },
      logo: { type: String, default: DEFAULT_SETTINGS.store.logo },
      phone: { type: String, default: DEFAULT_SETTINGS.store.phone },
      email: { type: String, default: DEFAULT_SETTINGS.store.email },
      whatsappNumber: { type: String, default: DEFAULT_SETTINGS.store.whatsappNumber },
      address: { type: String, default: DEFAULT_SETTINGS.store.address },
      businessHours: { type: String, default: DEFAULT_SETTINGS.store.businessHours },
      trustPillars: {
        pillar1Title: { type: String, default: DEFAULT_SETTINGS.store.trustPillars.pillar1Title },
        pillar1Subtitle: { type: String, default: DEFAULT_SETTINGS.store.trustPillars.pillar1Subtitle },
        pillar2Title: { type: String, default: DEFAULT_SETTINGS.store.trustPillars.pillar2Title },
        pillar2Subtitle: { type: String, default: DEFAULT_SETTINGS.store.trustPillars.pillar2Subtitle },
        pillar3Title: { type: String, default: DEFAULT_SETTINGS.store.trustPillars.pillar3Title },
        pillar3Subtitle: { type: String, default: DEFAULT_SETTINGS.store.trustPillars.pillar3Subtitle },
        pillar4Title: { type: String, default: DEFAULT_SETTINGS.store.trustPillars.pillar4Title },
        pillar4Subtitle: { type: String, default: DEFAULT_SETTINGS.store.trustPillars.pillar4Subtitle },
      },
    },
    delivery: {
      freeDeliveryThreshold: { type: Number, default: DEFAULT_SETTINGS.delivery.freeDeliveryThreshold, min: 0 },
      deliveryCharge: { type: Number, default: DEFAULT_SETTINGS.delivery.deliveryCharge, min: 0 },
      minOrderAmount: { type: Number, default: DEFAULT_SETTINGS.delivery.minOrderAmount, min: 0 },
      codAvailable: { type: Boolean, default: DEFAULT_SETTINGS.delivery.codAvailable },
      codMaxOrder: { type: Number, default: DEFAULT_SETTINGS.delivery.codMaxOrder, min: 0 },
      deliveryTime: { type: String, default: DEFAULT_SETTINGS.delivery.deliveryTime },
    },
    orders: {
      allowCustomerCancellation: { type: Boolean, default: DEFAULT_SETTINGS.orders.allowCustomerCancellation },
      cancellationAllowedUntil: {
        type: String,
        enum: ['Before Packed', 'Before Shipped'],
        default: DEFAULT_SETTINGS.orders.cancellationAllowedUntil,
      },
      autoConfirmOrders: { type: Boolean, default: DEFAULT_SETTINGS.orders.autoConfirmOrders },
      autoCancelUnpaidOrders: { type: Boolean, default: DEFAULT_SETTINGS.orders.autoCancelUnpaidOrders },
      unpaidOrderTimeoutMinutes: { type: Number, default: DEFAULT_SETTINGS.orders.unpaidOrderTimeoutMinutes, min: 5 },
    },
    inventory: {
      lowStockThreshold: { type: Number, default: DEFAULT_SETTINGS.inventory.lowStockThreshold, min: 1 },
      showOnlyXLeft: { type: Boolean, default: DEFAULT_SETTINGS.inventory.showOnlyXLeft },
      allowBackorders: { type: Boolean, default: DEFAULT_SETTINGS.inventory.allowBackorders },
      autoHideOutOfStock: { type: Boolean, default: DEFAULT_SETTINGS.inventory.autoHideOutOfStock },
    },
    payments: {
      onlinePaymentEnabled: { type: Boolean, default: DEFAULT_SETTINGS.payments.onlinePaymentEnabled },
      codEnabled: { type: Boolean, default: DEFAULT_SETTINGS.payments.codEnabled },
      codMinOrder: { type: Number, default: DEFAULT_SETTINGS.payments.codMinOrder, min: 0 },
      codMaxOrder: { type: Number, default: DEFAULT_SETTINGS.payments.codMaxOrder, min: 0 },
      codExtraCharge: { type: Number, default: 0, min: 0 },
      onlineDiscountType: { type: String, enum: ['flat', 'percentage'], default: 'percentage' },
      onlineDiscountValue: { type: Number, default: 0, min: 0 },
      onlineDiscountMaxLimit: { type: Number, default: 100, min: 0 },
    },
    notifications: {
      admin: {
        newOrder: { email: { type: Boolean, default: true }, whatsapp: { type: Boolean, default: true } },
        cancellationRequest: { email: { type: Boolean, default: true }, whatsapp: { type: Boolean, default: false } },
        lowStock: { email: { type: Boolean, default: true }, whatsapp: { type: Boolean, default: false } },
        paymentFailed: { email: { type: Boolean, default: true }, whatsapp: { type: Boolean, default: false } },
        courierFailed: { email: { type: Boolean, default: true }, whatsapp: { type: Boolean, default: false } },
      },
      customer: {
        orderConfirmation: { email: { type: Boolean, default: true }, whatsapp: { type: Boolean, default: true } },
        orderShipped: { email: { type: Boolean, default: true }, whatsapp: { type: Boolean, default: true } },
        orderDelivered: { email: { type: Boolean, default: true }, whatsapp: { type: Boolean, default: true } },
        orderCancelled: { email: { type: Boolean, default: true }, whatsapp: { type: Boolean, default: true } },
      },
    },
  },
  { timestamps: true }
);

/**
 * In-memory fast cache of settings to avoid DB lookups on every single cart/order tick.
 */
let cachedSettings = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute in-process cache

// Deep merge helper to ensure all schema defaults are present on lean documents
const deepMergeDefaults = (defaults, source) => {
  const result = { ...defaults };
  for (const key of Object.keys(source || {})) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key]) && defaults[key]) {
      result[key] = deepMergeDefaults(defaults[key], source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
};

settingsSchema.statics.getSingleton = async function (forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedSettings && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedSettings;
  }

  let doc = await this.findOne().lean();
  if (!doc) {
    const created = await this.create(DEFAULT_SETTINGS);
    doc = created.toObject();
  }

  // Deep-merge defaults and deeply freeze to prevent accidental in-memory mutation
  const merged = deepMergeDefaults(DEFAULT_SETTINGS, doc);
  cachedSettings = Object.freeze(merged);
  lastFetchTime = now;
  return cachedSettings;
};

settingsSchema.statics.invalidateCache = function () {
  cachedSettings = null;
  lastFetchTime = 0;
  try {
    const cacheService = require('../utils/cache.util');
    cacheService.invalidate('settings:');
  } catch (_) {}
};

settingsSchema.statics.getDefaults = function () {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
};

module.exports = mongoose.model('Settings', settingsSchema);

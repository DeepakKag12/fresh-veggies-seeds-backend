const auditService = require('../services/audit.service');

/**
 * Audit Logger Middleware
 * Intercepts all state-mutating (non-GET) admin operations across the platform
 * and records an immutable audit log entry including actor, action, entity, IP, and timestamp.
 */
const auditMiddleware = (req, res, next) => {
  // Only intercept state-mutating requests
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const originalJson = res.json;
  res.json = function (body) {
    res.json = originalJson;
    const statusCode = res.statusCode;

    // Log when successful (2xx or 3xx) and user is an administrator
    if (statusCode >= 200 && statusCode < 400 && req.user && req.user.role === 'admin') {
      const urlPath = req.originalUrl || req.url;
      const method = req.method;

      let action = `${method}_OPERATION`;
      let entityType = 'System';

      if (urlPath.includes('/products')) {
        entityType = 'Product';
        action = method === 'POST' ? 'CREATE_PRODUCT' : method === 'DELETE' ? 'DELETE_PRODUCT' : 'UPDATE_PRODUCT';
      } else if (urlPath.includes('/categories')) {
        entityType = 'Category';
        action = method === 'POST' ? 'CREATE_CATEGORY' : method === 'DELETE' ? 'DELETE_CATEGORY' : 'UPDATE_CATEGORY';
      } else if (urlPath.includes('/combos')) {
        entityType = 'Combo';
        action = method === 'POST' ? 'CREATE_COMBO' : method === 'DELETE' ? 'DELETE_COMBO' : 'UPDATE_COMBO';
      } else if (urlPath.includes('/orders')) {
        entityType = 'Order';
        action = urlPath.includes('/status') ? 'ORDER_STATUS_CHANGED' : `${method}_ORDER`;
      } else if (urlPath.includes('/settings')) {
        entityType = 'Settings';
        action = 'SETTINGS_UPDATED';
      } else if (urlPath.includes('/users')) {
        entityType = 'User';
        action = urlPath.includes('/status') ? 'USER_STATUS_CHANGED' : `${method}_USER`;
      } else if (urlPath.includes('/coupons')) {
        entityType = 'Coupon';
        action = method === 'POST' ? 'CREATE_COUPON' : method === 'DELETE' ? 'DELETE_COUPON' : 'UPDATE_COUPON';
      } else if (urlPath.includes('/banners')) {
        entityType = 'Banner';
        action = method === 'POST' ? 'CREATE_BANNER' : method === 'DELETE' ? 'DELETE_BANNER' : 'UPDATE_BANNER';
      } else if (urlPath.includes('/purge')) {
        entityType = 'DataPurge';
        action = 'PERMANENT_PURGE';
      } else if (urlPath.includes('/trash') || urlPath.includes('/delete-history')) {
        entityType = 'Trash';
        action = urlPath.includes('/restore') ? 'RESTORE_RECORD' : 'PERMANENT_PURGE';
      }

      const entityId = req.params?.id || body?.data?._id || '';
      const entityName = body?.data?.name || body?.data?.title || body?.data?.code || body?.data?.store?.name || '';

      const sanitizeDetails = (obj) => {
        if (!obj || typeof obj !== 'object') return {};
        const clean = { ...obj };
        delete clean.password;
        delete clean.token;
        delete clean.secret;
        return clean;
      };

      setImmediate(async () => {
        try {
          await auditService.logAction({
            req,
            actor: {
              userId: req.user._id,
              name: req.user.name || 'Administrator',
              email: req.user.email || '',
              role: req.user.role || 'admin',
            },
            action,
            entityType,
            entityId: String(entityId),
            entityName: String(entityName),
            details: {
              method,
              url: urlPath,
              statusCode,
              payload: sanitizeDetails(req.body),
            },
          });
        } catch (err) {
          console.error('⚠️  Audit logging middleware error:', err.message);
        }
      });
    }

    return originalJson.call(this, body);
  };

  next();
};

module.exports = auditMiddleware;

const fs = require('fs');
const path = require('path');

// 1. Get backend routes
const registered = [
  { method: 'GET', path: '/admin/analytics' },
  { method: 'GET', path: '/admin/lowstock' },
  { method: 'GET', path: '/admin/purge-data/preview' },
  { method: 'POST', path: '/admin/purge-data' },
  { method: 'GET', path: '/admin/revenue' },
  { method: 'GET', path: '/admin/stats' },
  { method: 'PUT', path: '/admin/users/:id/role' },
  { method: 'DELETE', path: '/admin/users/:id' },
  { method: 'GET', path: '/admin/users' },
  { method: 'PUT', path: '/auth/addresses/:addressId/default' },
  { method: 'DELETE', path: '/auth/addresses/:addressId' },
  { method: 'PUT', path: '/auth/addresses/:addressId' },
  { method: 'POST', path: '/auth/addresses' },
  { method: 'GET', path: '/auth/cart' },
  { method: 'PUT', path: '/auth/cart' },
  { method: 'PUT', path: '/auth/change-email' },
  { method: 'PUT', path: '/auth/change-password' },
  { method: 'POST', path: '/auth/forgot-password' },
  { method: 'POST', path: '/auth/login' },
  { method: 'POST', path: '/auth/logout' },
  { method: 'GET', path: '/auth/me' },
  { method: 'POST', path: '/auth/msg91-verify' },
  { method: 'POST', path: '/auth/msg91/resend-otp' },
  { method: 'POST', path: '/auth/msg91/send-otp' },
  { method: 'POST', path: '/auth/msg91/verify-otp' },
  { method: 'POST', path: '/auth/msg91/verify-token' },
  { method: 'PUT', path: '/auth/profile' },
  { method: 'POST', path: '/auth/register' },
  { method: 'POST', path: '/auth/reset-password/:resetToken' },
  { method: 'POST', path: '/auth/send-otp' },
  { method: 'GET', path: '/auth/verify-email/:token' },
  { method: 'POST', path: '/auth/verify-otp' },
  { method: 'POST', path: '/banners/:id/click' },
  { method: 'DELETE', path: '/banners/:id' },
  { method: 'PUT', path: '/banners/:id' },
  { method: 'GET', path: '/banners/active' },
  { method: 'GET', path: '/banners/admin' },
  { method: 'POST', path: '/banners' },
  { method: 'DELETE', path: '/categories/:id' },
  { method: 'GET', path: '/categories/:id' },
  { method: 'PUT', path: '/categories/:id' },
  { method: 'GET', path: '/categories' },
  { method: 'POST', path: '/categories' },
  { method: 'DELETE', path: '/combos/:id' },
  { method: 'GET', path: '/combos/:id' },
  { method: 'PUT', path: '/combos/:id' },
  { method: 'GET', path: '/combos' },
  { method: 'POST', path: '/combos' },
  { method: 'DELETE', path: '/coupons/:id' },
  { method: 'PUT', path: '/coupons/:id' },
  { method: 'GET', path: '/coupons/active' },
  { method: 'POST', path: '/coupons/validate' },
  { method: 'GET', path: '/coupons' },
  { method: 'POST', path: '/coupons' },
  { method: 'PUT', path: '/orders/:id/approve-cancel' },
  { method: 'PUT', path: '/orders/:id/cancel' },
  { method: 'DELETE', path: '/orders/:id/history/:historyId' },
  { method: 'POST', path: '/orders/:id/history/bulk-delete' },
  { method: 'PUT', path: '/orders/:id/reject-cancel' },
  { method: 'POST', path: '/orders/:id/ship' },
  { method: 'PUT', path: '/orders/:id/status' },
  { method: 'GET', path: '/orders/:id/track' },
  { method: 'DELETE', path: '/orders/:id/tracking/:trackingId' },
  { method: 'GET', path: '/orders/:id' },
  { method: 'GET', path: '/orders/check-pincode/:pincode' },
  { method: 'GET', path: '/orders/myorders' },
  { method: 'GET', path: '/orders' },
  { method: 'POST', path: '/orders' },
  { method: 'POST', path: '/payments/create-order' },
  { method: 'POST', path: '/payments/payment-failure' },
  { method: 'POST', path: '/payments/refund' },
  { method: 'POST', path: '/payments/verify-payment' },
  { method: 'POST', path: '/payments/webhook' },
  { method: 'DELETE', path: '/products/:id' },
  { method: 'GET', path: '/products/:id' },
  { method: 'PUT', path: '/products/:id' },
  { method: 'GET', path: '/products/featured' },
  { method: 'GET', path: '/products' },
  { method: 'POST', path: '/products' },
  { method: 'PUT', path: '/reviews/:id/approve' },
  { method: 'DELETE', path: '/reviews/:id' },
  { method: 'PUT', path: '/reviews/:id' },
  { method: 'GET', path: '/reviews/admin' },
  { method: 'GET', path: '/reviews/eligibility/:productId' },
  { method: 'GET', path: '/reviews/product/:productId' },
  { method: 'POST', path: '/reviews' },
  { method: 'PUT', path: '/settings/admin/:section' },
  { method: 'POST', path: '/settings/admin/reset/:section' },
  { method: 'GET', path: '/settings/admin' },
  { method: 'GET', path: '/settings' },
  { method: 'DELETE', path: '/upload/:publicId' },
  { method: 'POST', path: '/upload' },
];

function routeToRegex(routePath) {
  // Replace :param with ([^/]+)
  const pattern = '^' + routePath.replace(/:[a-zA-Z0-9_]+/g, '([^/]+)') + '$';
  return new RegExp(pattern);
}

const compiled = registered.map(r => ({
  ...r,
  regex: routeToRegex(r.path)
}));

function getFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        results = results.concat(getFiles(full));
      }
    } else {
      if (file.endsWith('.js') || file.endsWith('.jsx')) results.push(full);
    }
  });
  return results;
}

const frontendFiles = getFiles('../frontend/src');
const apiCallRegex = /(?:api\.(get|post|put|delete|patch)|cachedGet|fetchAllPages)\s*\(\s*([`'"][^`'"]+[`'"])/g;

let mismatches = [];
let matched = 0;

frontendFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = apiCallRegex.exec(content)) !== null) {
    const method = (match[1] || 'get').toUpperCase();
    let rawUrl = match[2].slice(1, -1);
    
    // Normalize template strings like ${id} to a dummy value for matching
    let testUrl = rawUrl.replace(/\$\{[^}]+\}/g, 'dummyValue');
    // Remove query string
    testUrl = testUrl.split('?')[0];

    const found = compiled.find(r => r.method === method && r.regex.test(testUrl));
    if (!found) {
      mismatches.push({
        file: path.relative('../frontend/src', file),
        method,
        rawUrl,
        testUrl
      });
    } else {
      matched++;
    }
  }
});

console.log(`Matched: ${matched}`);
console.log(`Mismatches: ${mismatches.length}`);
if (mismatches.length > 0) {
  console.log('Mismatches details:');
  mismatches.forEach(m => console.log(`  ${m.method} ${m.rawUrl} in ${m.file} (testUrl: ${m.testUrl})`));
}

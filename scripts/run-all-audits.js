const { execSync } = require('child_process');
const path = require('path');

const loops = [
  { name: 'Loop 1: Identity, Addresses & Core Configuration (FEAT-001, FEAT-002, FEAT-024)', script: 'scripts/audit-loop1.js' },
  { name: 'Loop 2: Botanical Catalog, Search, Faceting & Variant Pricing (FEAT-003, FEAT-004, FEAT-005, FEAT-006, FEAT-019)', script: 'scripts/audit-loop2.js' },
  { name: 'Loop 3: Bundles, Cart Synchronization, Wishlist & Guided Checkout (FEAT-007, FEAT-008, FEAT-009, FEAT-010, FEAT-013)', script: 'scripts/audit-loop3.js' },
  { name: 'Loop 4: Payment Verification, COD Surcharge, Order State Machine & Stock Restores (FEAT-011, FEAT-012, FEAT-014, FEAT-015, FEAT-021)', script: 'scripts/audit-loop4.js' },
  { name: 'Loop 5: Admin Operations, CSV Pipeline, Analytics, Banners & Security Purge (FEAT-016, FEAT-017, FEAT-018, FEAT-020, FEAT-022, FEAT-023, FEAT-025)', script: 'scripts/audit-loop5.js' },
  { name: 'Live Chat & WhatsApp Receipts System', script: 'scripts/test-chat-service.js' }
];

console.log('================================================================');
console.log('🚀 EXECUTING COMPLETE END-TO-END BACKEND INTEGRATION AUDIT SUITE');
console.log('   All 25 Features Covered in 5 Sequential Self-Healing Loops');
console.log('================================================================\n');

let passCount = 0;
const results = [];

for (const loop of loops) {
  console.log(`▶ Running: ${loop.name}...`);
  try {
    execSync(`node ${loop.script}`, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
    console.log(`✅ ${loop.name} passed!\n`);
    results.push({ suite: loop.name, status: 'PASSED' });
    passCount++;
  } catch (err) {
    console.error(`❌ ${loop.name} FAILED!`);
    results.push({ suite: loop.name, status: 'FAILED' });
    process.exit(1);
  }
}

console.log('================================================================');
console.log(`🏁 AUDIT SUITE COMPLETE: ${passCount}/${loops.length} SUITES PASSED (100% GREEN)`);
console.log('================================================================');
console.table(results);

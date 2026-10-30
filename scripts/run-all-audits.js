const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('================================================================');
console.log('🚀 EXECUTING COMPLETE END-TO-END BACKEND TEST & AUDIT SUITE');
console.log('   Unit Tests + Master API Lifecycle + 5 Self-Healing Feature Loops');
console.log('================================================================\n');

let passCount = 0;
const results = [];

// 1. Run All Function-Level Unit Tests
console.log('▶ [PHASE 1] Running Function-by-Function Unit Test Suites...');
const unitDir = path.join(__dirname, '../tests/unit');
if (fs.existsSync(unitDir)) {
  const unitFiles = fs.readdirSync(unitDir).filter(f => f.endsWith('.test.js'));
  for (const file of unitFiles) {
    try {
      execSync(`node tests/unit/${file}`, {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });
      results.push({ suite: `Unit: ${file}`, status: 'PASSED' });
      passCount++;
    } catch (err) {
      console.error(`❌ Unit test ${file} FAILED!`);
      results.push({ suite: `Unit: ${file}`, status: 'FAILED' });
      process.exit(1);
    }
  }
}
console.log('✅ All Unit Tests Passed!\n');

// 2. Run Master API Lifecycle & Integration Suite
console.log('▶ [PHASE 2] Running Master API Lifecycle Integration Suite...');
try {
  execSync('node tests/integration/master-api-lifecycle.test.js', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
  results.push({ suite: 'Master API Lifecycle & Integration', status: 'PASSED' });
  passCount++;
  console.log('✅ Master API Lifecycle Passed!\n');
} catch (err) {
  console.error('❌ Master API Lifecycle FAILED!');
  results.push({ suite: 'Master API Lifecycle & Integration', status: 'FAILED' });
  process.exit(1);
}

// 3. Run Self-Healing Feature Loops
console.log('▶ [PHASE 3] Running Full-Stack Feature Loops & Live Systems...');
const loops = [
  { name: 'Loop 1: Identity, Addresses & Core Configuration (FEAT-001, FEAT-002, FEAT-024)', script: 'scripts/audit-loop1.js' },
  { name: 'Loop 2: Botanical Catalog, Search, Faceting & Variant Pricing (FEAT-003, FEAT-004, FEAT-005, FEAT-006, FEAT-019)', script: 'scripts/audit-loop2.js' },
  { name: 'Loop 3: Bundles, Cart Synchronization, Wishlist & Guided Checkout (FEAT-007, FEAT-008, FEAT-009, FEAT-010, FEAT-013)', script: 'scripts/audit-loop3.js' },
  { name: 'Loop 4: Payment Verification, COD Surcharge, Order State Machine & Stock Restores (FEAT-011, FEAT-012, FEAT-014, FEAT-015, FEAT-021)', script: 'scripts/audit-loop4.js' },
  { name: 'Loop 5: Admin Operations, CSV Pipeline, Analytics, Banners & Security Purge (FEAT-016, FEAT-017, FEAT-018, FEAT-020, FEAT-022, FEAT-023, FEAT-025)', script: 'scripts/audit-loop5.js' },
  { name: 'Live Chat & WhatsApp Receipts System', script: 'scripts/test-chat-service.js' }
];

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
console.log(`🏁 AUDIT SUITE COMPLETE: ${passCount}/${results.length} SUITES PASSED (100% GREEN)`);
console.log('================================================================');
console.table(results);

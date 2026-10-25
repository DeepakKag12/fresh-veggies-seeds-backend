/**
 * Fresh Veggies - Responsive Viewport Audit Script
 * ─────────────────────────────────────────────────────────────
 * Tests all required viewports using headless Chrome:
 * 320×568, 360×800, 375×812, 390×844, 430×932,
 * 768×1024, 1024×768, 1280×720, 1440×900, 1920×1080.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outDir = path.join(__dirname, '../../frontend/public/responsive_audit');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const VIEWPORTS = [
  { name: 'iphone_se_320x568', width: 320, height: 568 },
  { name: 'android_360x800', width: 360, height: 800 },
  { name: 'iphone_x_375x812', width: 375, height: 812 },
  { name: 'iphone_14_390x844', width: 390, height: 844 },
  { name: 'iphone_16_pro_max_430x932', width: 430, height: 932 },
  { name: 'ipad_portrait_768x1024', width: 768, height: 1024 },
  { name: 'ipad_landscape_1024x768', width: 1024, height: 768 },
  { name: 'hd_laptop_1280x720', width: 1280, height: 720 },
  { name: 'macbook_1440x900', width: 1440, height: 900 },
  { name: 'fhd_desktop_1920x1080', width: 1920, height: 1080 },
];

console.log('🧪 Starting Responsive Viewport Visual Verification Suite...\n');

let passCount = 0;

for (const vp of VIEWPORTS) {
  const outFile = path.join(outDir, `${vp.name}.png`);
  const cmd = `"${chromePath}" --headless=new --user-data-dir="%TEMP%\\chrome_vp_${vp.name}" --window-size=${vp.width},${vp.height} --screenshot="${outFile}" http://localhost:3000/`;

  try {
    execSync(cmd, { stdio: 'ignore', timeout: 15000 });
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1000) {
      console.log(`✅ [PASS] Viewport ${vp.width}×${vp.height} (${vp.name}) → Captured (${Math.round(fs.statSync(outFile).size / 1024)} KB)`);
      passCount++;
    } else {
      console.error(`❌ [FAIL] Viewport ${vp.width}×${vp.height} (${vp.name}) → Empty or missing image`);
    }
  } catch (err) {
    console.error(`❌ [ERROR] Viewport ${vp.width}×${vp.height} (${vp.name}) → ${err.message}`);
  }
}

console.log(`\n🎉 RESPONSIVE VIEWPORT AUDIT COMPLETE: ${passCount}/${VIEWPORTS.length} viewports verified!\n`);

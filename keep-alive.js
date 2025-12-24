// Keep-alive script to prevent free-tier hosting from sleeping
// Run this on a separate service like cron-job.org or UptimeRobot

const https = require('https');
const http = require('http');

const BACKEND_URL = process.env.BACKEND_URL || 'https://your-backend-url.com';
const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes (before 15-min timeout)

function pingServer() {
  const protocol = BACKEND_URL.startsWith('https') ? https : http;
  const url = `${BACKEND_URL}/health`;

  protocol.get(url, (res) => {
    console.log(`[${new Date().toISOString()}] Ping Status: ${res.statusCode}`);
  }).on('error', (err) => {
    console.error(`[${new Date().toISOString()}] Ping Error:`, err.message);
  });
}

// Initial ping
pingServer();

// Ping every 14 minutes
setInterval(pingServer, PING_INTERVAL);

console.log(`Keep-alive service started. Pinging ${BACKEND_URL} every 14 minutes.`);

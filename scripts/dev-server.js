/**
 * Local development server with a throwaway in-memory MongoDB.
 *
 * Use this when you have no MONGODB_URI configured and just want the app
 * running: it starts a real MongoDB in a temp directory, seeds it with the
 * project's own seedData.js, and boots the normal server against it.
 *
 * Data lives only for the life of the process. NEVER use this in production —
 * set MONGODB_URI in .env and run `npm start` instead.
 */
const path = require('path');
const { execFileSync } = require('child_process');
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  if (process.env.NODE_ENV === 'production') {
    console.error('✖  dev-server is not for production. Set MONGODB_URI and run `npm start`.');
    process.exit(1);
  }

  console.log('⏳ Starting in-memory MongoDB…');
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  const env = {
    ...process.env,
    MONGODB_URI: uri,
    JWT_SECRET: process.env.JWT_SECRET || 'dev-only-secret-'.padEnd(48, 'x'),
    JWT_EXPIRE: process.env.JWT_EXPIRE || '7d',
    PORT: process.env.PORT || '5000',
  };

  console.log('🌱 Seeding…');
  try {
    execFileSync('node', [path.join(__dirname, '..', 'seedData.js')], {
      env, cwd: path.join(__dirname, '..'), stdio: 'inherit',
    });
  } catch {
    // seedData.js ends with process.exit(0); that is a normal finish.
  }

  Object.assign(process.env, env);
  require(path.join(__dirname, '..', 'server.js'));

  const shutdown = async () => { await mongod.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((err) => {
  console.error('✖  dev-server failed:', err.message);
  process.exit(1);
});

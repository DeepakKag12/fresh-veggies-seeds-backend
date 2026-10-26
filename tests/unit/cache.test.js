const test = require('node:test');
const assert = require('node:assert');
const cache = require('../../src/utils/cache.util');

test('Cache Utility - Basic Operations', async (t) => {
  await t.test('sets and gets cached values', () => {
    cache.set('test:key1', { fruit: 'Mango' }, 5000, false);
    const hit = cache.get('test:key1');
    assert.deepStrictEqual(hit, { fruit: 'Mango' });
    assert.strictEqual(cache.isValid('test:key1'), true);
  });

  await t.test('returns null for nonexistent keys', () => {
    assert.strictEqual(cache.get('test:nonexistent'), null);
    assert.strictEqual(cache.isValid('test:nonexistent'), false);
  });

  await t.test('invalidates by prefix', () => {
    cache.set('prod:1', 'Product 1', 10000, false);
    cache.set('prod:2', 'Product 2', 10000, false);
    cache.set('order:1', 'Order 1', 10000, false);

    cache.invalidate('prod:');
    assert.strictEqual(cache.get('prod:1'), null);
    assert.strictEqual(cache.get('prod:2'), null);
    assert.strictEqual(cache.get('order:1'), 'Order 1');
  });

  await t.test('remember executes producer on miss and uses cache on hit', async () => {
    let callCount = 0;
    const producer = async () => {
      callCount++;
      return `result_${callCount}`;
    };

    const first = await cache.remember('test:remember_key', 5000, producer, false);
    assert.strictEqual(first, 'result_1');
    assert.strictEqual(callCount, 1);

    // Second call should hit cache without calling producer
    const second = await cache.remember('test:remember_key', 5000, producer, false);
    assert.strictEqual(second, 'result_1');
    assert.strictEqual(callCount, 1);
  });

  await t.test('singleFlight coalesces concurrent calls into a single execution', async () => {
    let execCount = 0;
    const slowProducer = async () => {
      execCount++;
      await new Promise((r) => setTimeout(r, 50));
      return 'shared_result';
    };

    const [res1, res2, res3] = await Promise.all([
      cache.singleFlight('test:flight', slowProducer),
      cache.singleFlight('test:flight', slowProducer),
      cache.singleFlight('test:flight', slowProducer)
    ]);

    assert.strictEqual(res1, 'shared_result');
    assert.strictEqual(res2, 'shared_result');
    assert.strictEqual(res3, 'shared_result');
    assert.strictEqual(execCount, 1, 'Producer should only execute once');
  });

  await t.test('withJitter applies reasonable spread', () => {
    const base = 60000;
    const jittered = cache.withJitter(base, 0.18);
    assert.ok(jittered >= base * 0.82, 'Must not be less than min factor');
    assert.ok(jittered <= base * 1.18, 'Must not be greater than max factor');
  });
});

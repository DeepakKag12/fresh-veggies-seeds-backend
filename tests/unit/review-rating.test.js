const test = require('node:test');
const assert = require('node:assert');

test('Review & Ratings Logic - Rating Calculations & Bounds', async (t) => {

  await t.test('1. Validates numerical rating bounds (1 to 5 inclusive)', () => {
    const isValidRating = (r) => {
      const num = Number(r);
      return Number.isInteger(num) && num >= 1 && num <= 5;
    };

    assert.strictEqual(isValidRating(1), true);
    assert.strictEqual(isValidRating(5), true);
    assert.strictEqual(isValidRating(3), true);
    assert.strictEqual(isValidRating(0), false);
    assert.strictEqual(isValidRating(6), false);
    assert.strictEqual(isValidRating(4.5), false);
    assert.strictEqual(isValidRating('5'), true);
    assert.strictEqual(isValidRating('invalid'), false);
    assert.strictEqual(isValidRating(null), false);
  });

  await t.test('2. Aggregates average rating rounded to 1 decimal place', () => {
    const calculateAggregatedRating = (ratings) => {
      if (!Array.isArray(ratings) || ratings.length === 0) {
        return { rating: 0, numReviews: 0 };
      }
      const sum = ratings.reduce((acc, r) => acc + r, 0);
      const avg = sum / ratings.length;
      return {
        rating: Math.round(avg * 10) / 10,
        numReviews: ratings.length
      };
    };

    // 5 + 4 + 4 = 13 / 3 = 4.333... -> 4.3
    const res1 = calculateAggregatedRating([5, 4, 4]);
    assert.strictEqual(res1.rating, 4.3);
    assert.strictEqual(res1.numReviews, 3);

    // 5 + 5 + 5 = 15 / 3 = 5.0
    const res2 = calculateAggregatedRating([5, 5, 5]);
    assert.strictEqual(res2.rating, 5);
    assert.strictEqual(res2.numReviews, 3);

    // Empty ratings
    const res3 = calculateAggregatedRating([]);
    assert.strictEqual(res3.rating, 0);
    assert.strictEqual(res3.numReviews, 0);
  });

  await t.test('3. Generates correct star distribution counts', () => {
    const computeDistribution = (ratings) => {
      const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const r of ratings) {
        if (dist[r] !== undefined) dist[r]++;
      }
      return dist;
    };

    const dist = computeDistribution([5, 5, 4, 3, 5, 2, 1]);
    assert.strictEqual(dist[5], 3);
    assert.strictEqual(dist[4], 1);
    assert.strictEqual(dist[3], 1);
    assert.strictEqual(dist[2], 1);
    assert.strictEqual(dist[1], 1);
  });

  await t.test('4. Sanitizes review images up to max limit of 5 valid URLs', () => {
    const sanitizeReviewImages = (images) => {
      if (!Array.isArray(images)) return [];
      return images
        .filter(img => typeof img === 'string' && img.trim().length > 0)
        .slice(0, 5);
    };

    const input = [
      'https://example.com/photo1.jpg',
      '',
      'https://example.com/photo2.jpg',
      null,
      'https://example.com/photo3.jpg',
      'https://example.com/photo4.jpg',
      'https://example.com/photo5.jpg',
      'https://example.com/photo6.jpg' // Should be truncated at 5
    ];

    const sanitized = sanitizeReviewImages(input);
    assert.strictEqual(sanitized.length, 5);
    assert.strictEqual(sanitized[0], 'https://example.com/photo1.jpg');
    assert.strictEqual(sanitized[4], 'https://example.com/photo5.jpg');
  });
});

const mongoose = require('mongoose');

/**
 * Atomic sequence counter.
 *
 * Used to hand out order numbers. Deriving the next number from a
 * countDocuments() would let two concurrent orders read the same count and
 * generate the same number — the second then dies on the unique index, failing
 * a checkout that had already taken the customer's money.
 *
 * findOneAndUpdate with $inc is atomic in MongoDB, so every caller gets a
 * distinct value even under concurrency.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },   // e.g. "order-20260903"
  seq: { type: Number, default: 0 }
});

/**
 * Claim the next value in a sequence, creating it on first use.
 * @param {string} key
 * @returns {Promise<number>} the next sequence value, starting at 1
 */
counterSchema.statics.next = async function (key) {
  const doc = await this.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc.seq;
};

module.exports = mongoose.model('Counter', counterSchema);

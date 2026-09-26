/**
 * Uniform 500 response.
 *
 * Controllers used to answer `res.status(500).json({ message: error.message })`,
 * which forwards raw Mongoose and MongoDB text — index names, connection
 * details, internal field paths — straight to the client. This logs the real
 * error server-side and returns something a customer can actually read.
 *
 * @param {import('express').Response} res
 * @param {Error}  error    the caught error (logged, never sent)
 * @param {string} context  where it happened, for the log line
 * @param {string} [publicMessage] customer-facing text
 */
const serverError = (res, error, context, publicMessage = 'Something went wrong. Please try again.') => {
  console.error(`❌ ${context}:`, error?.message, error?.stack ? `\n${error.stack}` : '');
  return res.status(500).json({ success: false, message: publicMessage });
};

module.exports = { serverError };

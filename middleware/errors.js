import { scrubPath } from './requestLog.js';

// A route that failed for a reason of ours, not the visitor's: the error goes to the log with the
// request id, and the visitor gets a plain sentence. Never err.message, which can hold SQL, table
// names or a provider's answer.
export function serverError(req, res, err) {
  console.error(req.id, req.method, scrubPath(req.originalUrl.split('?')[0]), err);
  res.status(500).json({ error: 'Something went wrong' });
}

// The JSON error handler for /api. A request the parser refused says what was wrong; anything
// else that got past a route's own catch is a server error.
// eslint-disable-next-line no-unused-vars
export function apiErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'That request was not valid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large' });
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status < 500) return res.status(status).json({ error: 'Bad request' });
  serverError(req, res, err);
}

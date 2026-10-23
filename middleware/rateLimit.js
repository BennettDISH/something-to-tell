// Tiny in-memory rate limiter, counted per address (req.ip: the last X-Forwarded-For hop,
// with trust proxy 1 in server.js). One process serves the site, so memory is enough.
// Mirrors crux/server/rateLimit.js.

export function rateLimit({ windowMs, max, message }) {
  const hits = new Map(); // address -> recent request times

  // Now and then drop stale addresses so the map can't grow without bound.
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, times] of hits) {
      const fresh = times.filter((t) => t > cutoff);
      if (fresh.length) hits.set(k, fresh);
      else hits.delete(k);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const k = req.ip || req.socket?.remoteAddress || 'unknown';
    const times = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (times.length >= max) {
      hits.set(k, times);
      res.set('Retry-After', String(Math.ceil((times[0] + windowMs - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    times.push(now);
    hits.set(k, times);
    next();
  };
}

import { encryptionEnabled } from '../config/crypto.js';

// With no ENCRYPTION_KEY, encrypt() hands back plaintext. Fine for local development, but
// in production it would mean secrets, API keys and the AI text that quotes secrets quietly
// stored in the clear if the variable ever dropped off the deploy. There, the routes that
// store them refuse instead. Reads keep working.
export function requireEncryption(req, res, next) {
  if (!encryptionEnabled && process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'Saving is switched off: the server has no encryption key set' });
  }
  next();
}

// At-rest encryption for user content: secrets, users' AI API keys, and the AI
// text that quotes secrets (reasoning/summaries/decoy arrays). AES-256-GCM with
// a key derived from ENCRYPTION_KEY (sha256). Stored values carry an 'enc:v1:'
// prefix so legacy plaintext rows stay readable and the boot-time backfill in
// db.js is idempotent. No key rotation: changing ENCRYPTION_KEY makes existing
// rows unreadable (they surface as a '[encrypted — …]' marker, never a crash).
import crypto from 'crypto';

const PREFIX = 'enc:v1:';
const RAW_KEY = process.env.ENCRYPTION_KEY || '';
const KEY = RAW_KEY ? crypto.createHash('sha256').update(RAW_KEY).digest() : null;

// iv(12) + authTag(16) + at least one byte of ciphertext
const MIN_PAYLOAD_BYTES = 29;

export const encryptionEnabled = !!KEY;

// Does this stored value actually look like one of our ciphertexts? The prefix
// alone is not enough — it is user-typeable, so a secret whose text merely
// STARTS with 'enc:v1:' must not be mistaken for ciphertext. Requiring a
// well-formed base64 payload of plausible length makes that collision vanishing.
export function isEncrypted(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return false;
  const body = value.slice(PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return false;
  return Buffer.from(body, 'base64').length >= MIN_PAYLOAD_BYTES;
}

// Always encrypts. It deliberately does NOT skip prefix-carrying input: that
// check used to live here, which let a user store plaintext by typing 'enc:v1:'
// at the start of a secret (and made the value unreadable forever after).
// Backfill idempotency is the CALLER's job now — see isEncrypted() in db.js.
export function encrypt(value) {
  if (!KEY || value == null) return value;
  const s = String(value);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

// Markers shown in place of content we cannot recover. They are DISPLAY values —
// never feed one to the AI or treat it as a secret (see isDecryptionMarker).
export const NO_KEY_MARKER = '[encrypted — ENCRYPTION_KEY not set]';
export const BAD_KEY_MARKER = '[encrypted — cannot decrypt (wrong ENCRYPTION_KEY?)]';

export const isDecryptionMarker = (v) => v === NO_KEY_MARKER || v === BAD_KEY_MARKER;

export function decrypt(value) {
  if (!isEncrypted(value)) return value;
  if (!KEY) return NO_KEY_MARKER;
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return BAD_KEY_MARKER;
  }
}

export const encryptArray = (arr) => (Array.isArray(arr) ? arr.map(encrypt) : arr);

// Shallow-copy a DB row with the named fields decrypted (arrays handled).
export function decryptFields(row, fields) {
  if (!row) return row;
  const out = { ...row };
  for (const f of fields) {
    if (!(f in out)) continue;
    out[f] = Array.isArray(out[f]) ? out[f].map(decrypt) : decrypt(out[f]);
  }
  return out;
}

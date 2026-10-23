import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { centralRegister, centralLogin, exchangeCode } from '../config/sso.js';
import { authenticate } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Waypoint caps its proxy and token endpoints per calling address, and every visitor here reaches
// it from this server's one address: 30 password tries or code exchanges per 15 minutes for the
// whole site. Counting each visitor first keeps one of them from using those up for everyone
// else. Login and register share one count; the code exchange has its own.
const signInLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many sign-in attempts. Try again in a few minutes.',
});
const callbackLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many sign-in attempts. Try again in a few minutes.',
});

// Guests are refused: this app matches secrets between people, reveals them later and keeps the
// user's own AI key, and a guest who loses the browser can never come back to a match. Waypoint's
// sign-in page offers "Continue as guest" whatever an app wants, so the refusal is here, before a
// profile or a token is made.
const GUEST_REFUSED = 'Guest accounts can’t be used here. Sign in with your own account.';

async function findOrCreateProfile(centralUser) {
  const userId = centralUser.central_user_id;
  const { rows: existing } = await pool.query(
    'SELECT * FROM profiles WHERE central_user_id = $1',
    [userId]
  );
  if (existing[0]) {
    await pool.query(
      `UPDATE profiles SET username=$1, email=$2, first_name=$3, last_name=$4, updated_at=NOW()
       WHERE central_user_id=$5`,
      [centralUser.username, centralUser.email || null, centralUser.first_name, centralUser.last_name, userId]
    );
    return { ...existing[0], username: centralUser.username, email: centralUser.email || null };
  }
  // Central accounts may have no email — store NULL, never '', so nothing can match on a
  // blank email later.
  const { rows } = await pool.query(
    `INSERT INTO profiles (central_user_id, username, email, first_name, last_name)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, centralUser.username, centralUser.email || null, centralUser.first_name || '', centralUser.last_name || '']
  );
  return rows[0];
}

function issueToken(profile) {
  return jwt.sign(
    { central_user_id: profile.central_user_id, username: profile.username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// The three ways in all end here: sign in, or answer 403 for a guest before anything is stored.
async function signIn(res, centralUser) {
  if (centralUser.is_guest) return res.status(403).json({ error: GUEST_REFUSED });
  const profile = await findOrCreateProfile(centralUser);
  res.json({ token: issueToken(profile), user: profile });
}

router.post('/register', signInLimit, async (req, res) => {
  try {
    await signIn(res, await centralRegister(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', signInLimit, async (req, res) => {
  try {
    await signIn(res, await centralLogin(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/sso-callback', callbackLimit, async (req, res) => {
  try {
    await signIn(res, await exchangeCode(req.body.code));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/profile', authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;

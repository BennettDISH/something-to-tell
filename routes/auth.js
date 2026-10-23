import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { centralRegister, centralLogin, centralGuest, exchangeCode } from '../config/sso.js';
import { authenticate } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Waypoint caps its proxy endpoints per calling address, and every visitor here reaches it
// from this server's one address: 30 password tries per 15 minutes and 500 new guests an
// hour for the whole site. Counting each visitor first keeps one of them from using those
// up for everyone else.
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many sign-in attempts. Try again in a few minutes.',
});
// Waypoint's own guest button allows 15 an hour per address; the same here.
const guestLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: 'Too many guest accounts from this address. Try again later.',
});

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

router.post('/register', async (req, res) => {
  try {
    const data = await centralRegister(req.body);
    const profile = await findOrCreateProfile(data);
    res.json({ token: issueToken(profile), user: profile });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', loginLimit, async (req, res) => {
  try {
    const data = await centralLogin(req.body);
    const profile = await findOrCreateProfile(data);
    res.json({ token: issueToken(profile), user: profile });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/sso-callback', async (req, res) => {
  try {
    const data = await exchangeCode(req.body.code);
    const profile = await findOrCreateProfile(data);
    res.json({ token: issueToken(profile), user: profile });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// One-click guest: mint a central guest account and sign in as it — no redirect, no form.
router.post('/guest', guestLimit, async (req, res) => {
  try {
    const profile = await findOrCreateProfile(await centralGuest());
    res.json({ token: issueToken(profile), user: profile });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/profile', authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;

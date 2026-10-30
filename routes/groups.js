import { Router } from 'express';
import crypto from 'crypto';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { serverError } from '../middleware/errors.js';

const router = Router();

// 16 hex characters (64 bits). Rooms made before this have 8-character codes, which keep
// working: a join looks the code up exactly as stored.
function generateJoinCode() {
  return crypto.randomBytes(8).toString('hex');
}

// A join code is all that keeps a stranger out of a room, and Waypoint accounts cost nothing
// to make (guests are refused here, but anyone can register), so wrong codes are limited per
// client IP rather than per account. Once a client is over the
// limit even a right code is refused, or the limit would still tell a guesser when it hit.
// In-process only, like the one-run-per-room guard in secrets.js: fine while the app runs
// as one instance.
const MAX_FAILED_JOINS = 10;
const FAILED_JOIN_WINDOW_MS = 15 * 60 * 1000;
const failedJoins = new Map(); // ip -> { count, resetAt }

function joinsBlocked(ip, now = Date.now()) {
  const entry = failedJoins.get(ip);
  return !!entry && entry.resetAt > now && entry.count >= MAX_FAILED_JOINS;
}

function recordFailedJoin(ip, now = Date.now()) {
  if (failedJoins.size > 10000) {
    for (const [key, entry] of failedJoins) if (entry.resetAt <= now) failedJoins.delete(key);
  }
  const entry = failedJoins.get(ip);
  if (!entry || entry.resetAt <= now) failedJoins.set(ip, { count: 1, resetAt: now + FAILED_JOIN_WINDOW_MS });
  else entry.count++;
}

// List groups the user belongs to
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.*, gm.role,
        (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
        (SELECT COUNT(*) FROM secrets WHERE group_id = g.id AND central_user_id = $1) as my_secrets
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.central_user_id = $1
       ORDER BY g.created_at DESC`,
      [req.user.central_user_id]
    );
    res.json({ groups: rows });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Get single group with members
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows: membership } = await pool.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND central_user_id = $2',
      [req.params.id, req.user.central_user_id]
    );
    if (!membership[0]) return res.status(403).json({ error: 'Not a member of this group' });

    const { rows: [group] } = await pool.query('SELECT * FROM groups WHERE id = $1', [req.params.id]);
    const { rows: members } = await pool.query(
      `SELECT p.central_user_id, p.username, p.first_name, p.last_name, gm.role, gm.joined_at
       FROM group_members gm
       JOIN profiles p ON gm.central_user_id = p.central_user_id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at`,
      [req.params.id]
    );
    res.json({ group: { ...group, members } });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Create group
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, description } = req.body;
    const joinCode = generateJoinCode();
    const { rows: [group] } = await pool.query(
      'INSERT INTO groups (name, description, join_code, created_by) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, description || '', joinCode, req.user.central_user_id]
    );
    await pool.query(
      'INSERT INTO group_members (group_id, central_user_id, role) VALUES ($1,$2,$3)',
      [group.id, req.user.central_user_id, 'admin']
    );
    res.status(201).json({ group });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Join group by code
router.post('/join', authenticate, async (req, res) => {
  try {
    if (joinsBlocked(req.ip)) {
      return res.status(429).json({ error: 'Too many wrong join codes. Try again in a few minutes.' });
    }
    const { code } = req.body;
    const { rows: [group] } = await pool.query('SELECT * FROM groups WHERE join_code = $1', [code]);
    if (!group) {
      recordFailedJoin(req.ip);
      return res.status(404).json({ error: 'Invalid join code' });
    }

    const { rows: existing } = await pool.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND central_user_id = $2',
      [group.id, req.user.central_user_id]
    );
    if (existing[0]) return res.json({ group, message: 'Already a member' });

    await pool.query(
      'INSERT INTO group_members (group_id, central_user_id) VALUES ($1,$2)',
      [group.id, req.user.central_user_id]
    );
    res.status(201).json({ group });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Update group settings (admin only)
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { rows: membership } = await pool.query(
      "SELECT * FROM group_members WHERE group_id = $1 AND central_user_id = $2 AND role = 'admin'",
      [req.params.id, req.user.central_user_id]
    );
    if (!membership[0]) return res.status(403).json({ error: 'Only the group admin can update settings' });

    const { name, description, ai_prompt, room_config } = req.body;
    const { rows: [group] } = await pool.query(
      `UPDATE groups SET name = COALESCE($1, name), description = COALESCE($2, description), ai_prompt = COALESCE($3, ai_prompt), room_config = COALESCE($4, room_config)
       WHERE id = $5 RETURNING *`,
      [name, description, ai_prompt, room_config ? JSON.stringify(room_config) : null, req.params.id]
    );
    res.json({ group });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Leave group
router.delete('/:id/leave', authenticate, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM group_members WHERE group_id = $1 AND central_user_id = $2',
      [req.params.id, req.user.central_user_id]
    );
    res.json({ message: 'Left group' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Delete group (admin only)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rows: membership } = await pool.query(
      "SELECT * FROM group_members WHERE group_id = $1 AND central_user_id = $2 AND role = 'admin'",
      [req.params.id, req.user.central_user_id]
    );
    if (!membership[0]) return res.status(403).json({ error: 'Only the group admin can delete the group' });

    await pool.query('DELETE FROM groups WHERE id = $1', [req.params.id]);
    res.json({ message: 'Group deleted successfully' });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;

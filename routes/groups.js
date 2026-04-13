import { Router } from 'express';
import crypto from 'crypto';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

function generateJoinCode() {
  return crypto.randomBytes(4).toString('hex');
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// Join group by code
router.post('/join', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    const { rows: [group] } = await pool.query('SELECT * FROM groups WHERE join_code = $1', [code]);
    if (!group) return res.status(404).json({ error: 'Invalid join code' });

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
    res.status(500).json({ error: err.message });
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

    const { name, description, ai_prompt } = req.body;
    const { rows: [group] } = await pool.query(
      `UPDATE groups SET name = COALESCE($1, name), description = COALESCE($2, description), ai_prompt = COALESCE($3, ai_prompt)
       WHERE id = $4 RETURNING *`,
      [name, description, ai_prompt, req.params.id]
    );
    res.json({ group });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

export default router;

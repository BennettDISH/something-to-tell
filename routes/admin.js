import { Router } from 'express';
import pool from '../config/db.js';
import { authenticateAdmin } from '../middleware/auth.js';

const router = Router();

// All groups with member + secret counts
router.get('/groups', authenticateAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.*,
        p.username as created_by_name,
        (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count,
        (SELECT COUNT(*) FROM secrets WHERE group_id = g.id) as secret_count,
        (SELECT COUNT(*) FROM vault_matches WHERE group_id = g.id) as match_count
       FROM groups g
       JOIN profiles p ON g.created_by = p.central_user_id
       ORDER BY g.created_at DESC`
    );
    res.json({ groups: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All secrets + matches in a group (full content visible to admin)
router.get('/groups/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: [group] } = await pool.query('SELECT * FROM groups WHERE id = $1', [id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const { rows: members } = await pool.query(
      `SELECT p.central_user_id, p.username, p.first_name, p.last_name, gm.role, gm.joined_at
       FROM group_members gm
       JOIN profiles p ON gm.central_user_id = p.central_user_id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at`,
      [id]
    );

    const { rows: secrets } = await pool.query(
      `SELECT s.*, p.username
       FROM secrets s
       JOIN profiles p ON s.central_user_id = p.central_user_id
       WHERE s.group_id = $1
       ORDER BY s.created_at DESC`,
      [id]
    );

    const { rows: matches } = await pool.query(
      `SELECT vm.*,
        sa.content as secret_a_content, pa.username as user_a_name,
        sb.content as secret_b_content, pb.username as user_b_name
       FROM vault_matches vm
       JOIN secrets sa ON vm.secret_a_id = sa.id
       JOIN secrets sb ON vm.secret_b_id = sb.id
       JOIN profiles pa ON sa.central_user_id = pa.central_user_id
       JOIN profiles pb ON sb.central_user_id = pb.central_user_id
       WHERE vm.group_id = $1
       ORDER BY vm.created_at DESC`,
      [id]
    );

    const { rows: comparisons } = await pool.query(
      `SELECT c.*,
        sa.content as secret_a_content, pa.username as user_a_name,
        sb.content as secret_b_content, pb.username as user_b_name
       FROM comparisons c
       JOIN secrets sa ON c.secret_a_id = sa.id
       JOIN secrets sb ON c.secret_b_id = sb.id
       JOIN profiles pa ON sa.central_user_id = pa.central_user_id
       JOIN profiles pb ON sb.central_user_id = pb.central_user_id
       WHERE c.group_id = $1
       ORDER BY c.created_at DESC`,
      [id]
    );

    res.json({ group: { ...group, members }, secrets, matches, comparisons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

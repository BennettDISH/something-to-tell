import { Router } from 'express';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { getUserAiConfig, compareSecrets, generateObfuscation, shuffleWithSecret } from '../services/aiService.js';

const router = Router();

// Get my secrets in a group + any vault matches
router.get('/group/:groupId', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;

    // Verify membership
    const { rows: membership } = await pool.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND central_user_id = $2',
      [groupId, req.user.central_user_id]
    );
    if (!membership[0]) return res.status(403).json({ error: 'Not a member' });

    // My secrets
    const { rows: mySecrets } = await pool.query(
      'SELECT * FROM secrets WHERE group_id = $1 AND central_user_id = $2 ORDER BY created_at DESC',
      [groupId, req.user.central_user_id]
    );

    // Vault matches involving my secrets
    const { rows: matches } = await pool.query(
      `SELECT vm.*,
        sa.content as secret_a_content, sa.central_user_id as user_a_id, sa.obfuscation_level as obf_a,
        sb.content as secret_b_content, sb.central_user_id as user_b_id, sb.obfuscation_level as obf_b,
        pa.username as user_a_name, pb.username as user_b_name
       FROM vault_matches vm
       JOIN secrets sa ON vm.secret_a_id = sa.id
       JOIN secrets sb ON vm.secret_b_id = sb.id
       JOIN profiles pa ON sa.central_user_id = pa.central_user_id
       JOIN profiles pb ON sb.central_user_id = pb.central_user_id
       WHERE vm.group_id = $1
         AND (sa.central_user_id = $2 OR sb.central_user_id = $2)
       ORDER BY vm.created_at DESC`,
      [groupId, req.user.central_user_id]
    );

    // Other members' sealed secret count (not content)
    const { rows: otherCounts } = await pool.query(
      `SELECT p.username, COUNT(s.id) as secret_count
       FROM secrets s
       JOIN profiles p ON s.central_user_id = p.central_user_id
       WHERE s.group_id = $1 AND s.central_user_id != $2
       GROUP BY p.username`,
      [groupId, req.user.central_user_id]
    );

    res.json({ secrets: mySecrets, matches, otherMembers: otherCounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit a secret and run AI comparison
router.post('/group/:groupId', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { content, obfuscation_level = 3 } = req.body;

    // Verify membership
    const { rows: membership } = await pool.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND central_user_id = $2',
      [groupId, req.user.central_user_id]
    );
    if (!membership[0]) return res.status(403).json({ error: 'Not a member' });

    // Check AI config
    const aiConfig = await getUserAiConfig(req.user.central_user_id);
    if (!aiConfig) return res.status(400).json({ error: 'Set up your AI provider in settings before submitting secrets' });

    // Insert secret
    const { rows: [newSecret] } = await pool.query(
      'INSERT INTO secrets (group_id, central_user_id, content, obfuscation_level) VALUES ($1,$2,$3,$4) RETURNING *',
      [groupId, req.user.central_user_id, content, obfuscation_level]
    );

    // Get all other secrets in this group (not by this user)
    const { rows: otherSecrets } = await pool.query(
      'SELECT * FROM secrets WHERE group_id = $1 AND central_user_id != $2',
      [groupId, req.user.central_user_id]
    );

    // Compare against each using AI
    const newMatches = [];
    for (const other of otherSecrets) {
      // Check if already matched
      const { rows: existingMatch } = await pool.query(
        `SELECT id FROM vault_matches
         WHERE (secret_a_id = $1 AND secret_b_id = $2) OR (secret_a_id = $2 AND secret_b_id = $1)`,
        [newSecret.id, other.id]
      );
      if (existingMatch[0]) continue;

      try {
        const result = await compareSecrets(aiConfig, content, other.content);
        if (result.match && result.confidence >= 0.6) {
          // Generate obfuscation for both secrets
          let obfuscatedA = [content];
          let obfuscatedB = [other.content];

          if (newSecret.obfuscation_level > 0) {
            const fakesA = await generateObfuscation(aiConfig, content, newSecret.obfuscation_level);
            obfuscatedA = shuffleWithSecret(fakesA, content);
          }
          if (other.obfuscation_level > 0) {
            const fakesB = await generateObfuscation(aiConfig, other.content, other.obfuscation_level);
            obfuscatedB = shuffleWithSecret(fakesB, other.content);
          }

          const { rows: [match] } = await pool.query(
            `INSERT INTO vault_matches (group_id, secret_a_id, secret_b_id, ai_reasoning, obfuscated_a, obfuscated_b)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [groupId, newSecret.id, other.id, result.reasoning, obfuscatedA, obfuscatedB]
          );

          // Update secret statuses
          await pool.query("UPDATE secrets SET status = 'matched' WHERE id IN ($1, $2)", [newSecret.id, other.id]);

          newMatches.push({ match, reasoning: result.reasoning, confidence: result.confidence });
        }
      } catch (aiErr) {
        console.error('AI comparison failed:', aiErr.message);
      }
    }

    res.status(201).json({ secret: newSecret, matches: newMatches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a secret (only your own, and only if not matched)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rows: [secret] } = await pool.query(
      'SELECT * FROM secrets WHERE id = $1 AND central_user_id = $2',
      [req.params.id, req.user.central_user_id]
    );
    if (!secret) return res.status(404).json({ error: 'Secret not found' });
    if (secret.status === 'matched') return res.status(400).json({ error: 'Cannot delete a matched secret' });

    await pool.query('DELETE FROM secrets WHERE id = $1', [req.params.id]);
    res.json({ message: 'Secret deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

import { Router } from 'express';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { getUserAiConfig, compareSecrets, generateObfuscation, shuffleWithSecret } from '../services/aiService.js';

const router = Router();

// Get my secrets in a group + matches + submission counts
router.get('/group/:groupId', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;

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

    // How many submitted secrets each other member has (not content)
    const { rows: otherCounts } = await pool.query(
      `SELECT p.username,
        COUNT(s.id) FILTER (WHERE s.status = 'submitted') as submitted_count,
        COUNT(s.id) as total_count
       FROM secrets s
       JOIN profiles p ON s.central_user_id = p.central_user_id
       WHERE s.group_id = $1 AND s.central_user_id != $2
       GROUP BY p.username`,
      [groupId, req.user.central_user_id]
    );

    // Total submitted count for the group (for admin to know if ready)
    const { rows: [submittedStats] } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'submitted') as submitted_count,
              COUNT(DISTINCT central_user_id) FILTER (WHERE status = 'submitted') as submitters
       FROM secrets WHERE group_id = $1`,
      [groupId]
    );

    // Comparison results involving my secrets (user_summary only, no full reasoning)
    const { rows: myComparisons } = await pool.query(
      `SELECT c.id, c.matched, c.confidence, c.user_summary, c.created_at,
        CASE WHEN c.secret_a_id IN (SELECT id FROM secrets WHERE central_user_id = $2) THEN c.secret_a_id ELSE c.secret_b_id END as my_secret_id
       FROM comparisons c
       WHERE c.group_id = $1
         AND (c.secret_a_id IN (SELECT id FROM secrets WHERE central_user_id = $2)
           OR c.secret_b_id IN (SELECT id FROM secrets WHERE central_user_id = $2))
       ORDER BY c.created_at DESC`,
      [groupId, req.user.central_user_id]
    );

    res.json({
      secrets: mySecrets,
      matches,
      otherMembers: otherCounts,
      submittedStats: submittedStats,
      comparisons: myComparisons,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a secret (sealed — no AI call)
router.post('/group/:groupId', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { content, obfuscation_level = 3 } = req.body;

    const { rows: membership } = await pool.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND central_user_id = $2',
      [groupId, req.user.central_user_id]
    );
    if (!membership[0]) return res.status(403).json({ error: 'Not a member' });

    const { rows: [newSecret] } = await pool.query(
      'INSERT INTO secrets (group_id, central_user_id, content, obfuscation_level) VALUES ($1,$2,$3,$4) RETURNING *',
      [groupId, req.user.central_user_id, content, obfuscation_level]
    );

    res.status(201).json({ secret: newSecret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit a secret (mark as ready for AI comparison)
router.patch('/:id/submit', authenticate, async (req, res) => {
  try {
    const { rows: [secret] } = await pool.query(
      'SELECT * FROM secrets WHERE id = $1 AND central_user_id = $2',
      [req.params.id, req.user.central_user_id]
    );
    if (!secret) return res.status(404).json({ error: 'Secret not found' });
    if (secret.status !== 'sealed') return res.status(400).json({ error: 'Secret is already ' + secret.status });

    const { rows: [updated] } = await pool.query(
      "UPDATE secrets SET status = 'submitted' WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    res.json({ secret: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unsubmit a secret (back to sealed)
router.patch('/:id/unsubmit', authenticate, async (req, res) => {
  try {
    const { rows: [secret] } = await pool.query(
      'SELECT * FROM secrets WHERE id = $1 AND central_user_id = $2',
      [req.params.id, req.user.central_user_id]
    );
    if (!secret) return res.status(404).json({ error: 'Secret not found' });
    if (secret.status !== 'submitted') return res.status(400).json({ error: 'Secret is not submitted' });

    const { rows: [updated] } = await pool.query(
      "UPDATE secrets SET status = 'sealed' WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    res.json({ secret: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: trigger AI comparison on all submitted secrets in a group
router.post('/group/:groupId/compare', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;

    // Verify user is group admin
    const { rows: membership } = await pool.query(
      "SELECT * FROM group_members WHERE group_id = $1 AND central_user_id = $2 AND role = 'admin'",
      [groupId, req.user.central_user_id]
    );
    if (!membership[0]) return res.status(403).json({ error: 'Only the group admin can trigger comparison' });

    // Get group (for ai_prompt)
    const { rows: [group] } = await pool.query('SELECT * FROM groups WHERE id = $1', [groupId]);

    // Get group creator's AI config
    const aiConfig = await getUserAiConfig(group.created_by);
    if (!aiConfig) return res.status(400).json({ error: 'Set up your AI provider in settings first' });

    // Get all submitted secrets
    const { rows: submitted } = await pool.query(
      "SELECT * FROM secrets WHERE group_id = $1 AND status = 'submitted'",
      [groupId]
    );

    if (submitted.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 submitted secrets to compare' });
    }

    // Clear previous non-match comparisons for this group (re-runs replace old results)
    await pool.query(
      `DELETE FROM comparisons WHERE group_id = $1
       AND NOT EXISTS (SELECT 1 FROM vault_matches vm WHERE vm.secret_a_id = comparisons.secret_a_id AND vm.secret_b_id = comparisons.secret_b_id)`,
      [groupId]
    );

    // Compare all pairs
    const newMatches = [];
    const allResults = [];
    for (let i = 0; i < submitted.length; i++) {
      for (let j = i + 1; j < submitted.length; j++) {
        const a = submitted[i];
        const b = submitted[j];

        // Skip if same user
        if (a.central_user_id === b.central_user_id) continue;

        // Skip if already matched
        const { rows: existingMatch } = await pool.query(
          `SELECT id FROM vault_matches
           WHERE (secret_a_id = $1 AND secret_b_id = $2) OR (secret_a_id = $2 AND secret_b_id = $1)`,
          [a.id, b.id]
        );
        if (existingMatch[0]) continue;

        try {
          const result = await compareSecrets(aiConfig, a.content, b.content, group.ai_prompt);

          // Log every comparison
          await pool.query(
            `INSERT INTO comparisons (group_id, secret_a_id, secret_b_id, matched, confidence, ai_reasoning, user_summary)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [groupId, a.id, b.id, result.match && result.confidence >= 0.6, result.confidence, result.reasoning, result.user_summary || '']
          );

          allResults.push({ matched: result.match && result.confidence >= 0.6, confidence: result.confidence, user_summary: result.user_summary });

          if (result.match && result.confidence >= 0.6) {
            let obfuscatedA = [a.content];
            let obfuscatedB = [b.content];

            if (a.obfuscation_level > 0) {
              const fakesA = await generateObfuscation(aiConfig, a.content, a.obfuscation_level);
              obfuscatedA = shuffleWithSecret(fakesA, a.content);
            }
            if (b.obfuscation_level > 0) {
              const fakesB = await generateObfuscation(aiConfig, b.content, b.obfuscation_level);
              obfuscatedB = shuffleWithSecret(fakesB, b.content);
            }

            const { rows: [match] } = await pool.query(
              `INSERT INTO vault_matches (group_id, secret_a_id, secret_b_id, ai_reasoning, obfuscated_a, obfuscated_b)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
              [groupId, a.id, b.id, result.reasoning, obfuscatedA, obfuscatedB]
            );

            await pool.query("UPDATE secrets SET status = 'matched' WHERE id IN ($1, $2)", [a.id, b.id]);

            newMatches.push({ match, reasoning: result.reasoning, confidence: result.confidence });
          }
        } catch (aiErr) {
          console.error('AI comparison failed:', aiErr.message);
        }
      }
    }

    res.json({ matches: newMatches, results: allResults, compared: submitted.length });
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

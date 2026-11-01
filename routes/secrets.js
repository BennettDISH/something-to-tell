import { Router } from 'express';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireEncryption } from '../middleware/encryption.js';
import { getUserAiConfig, compareSecrets, generateObfuscation, shuffleWithSecret, describeAiError } from '../services/aiService.js';
import { comparisonSummary, safeSummary, FAILED_SUMMARY, QUOTA_SUMMARY } from '../services/summaries.js';
import { encrypt, encryptArray, decrypt, decryptFields, tryDecrypt } from '../config/crypto.js';
import { serverError } from '../middleware/errors.js';

const router = Router();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

    // Vault matches involving my secrets. Each side is shown only through
    // obfuscated_a/_b, where the real secret sits among the room's decoys; the raw
    // contents stay server-side, or anyone with devtools could pick the real one out.
    const { rows: matches } = await pool.query(
      `SELECT vm.*,
        sa.central_user_id as user_a_id,
        sb.central_user_id as user_b_id,
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

    // The AI's reasoning quotes both real secrets ("for the admin", per its prompt). In a
    // vault with decoys that points straight past them, so those vaults show the pair's
    // fixed summary instead (plain text, which the decryptFields below passes through).
    // Without decoys both secrets are shown anyway.
    if (matches.length) {
      const { rows: summaries } = await pool.query(
        `SELECT secret_a_id, secret_b_id, user_summary FROM comparisons
         WHERE group_id = $1 AND matched ORDER BY id`,
        [groupId]
      );
      for (const m of matches) {
        const hasDecoys = [m.obfuscated_a, m.obfuscated_b].some((list) => Array.isArray(list) && list.length > 1);
        if (!hasDecoys) continue;
        const pair = summaries.filter((s) => s.secret_a_id === m.secret_a_id && s.secret_b_id === m.secret_b_id).pop();
        m.ai_reasoning = pair ? safeSummary(decrypt(pair.user_summary), true) : null;
      }
    }

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

    // Total submitted count for the group (for admin to know if ready). Counts current
    // members only, the same pool a comparison run draws from.
    const { rows: [submittedStats] } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'submitted') as submitted_count,
              COUNT(DISTINCT central_user_id) FILTER (WHERE status = 'submitted') as submitters
       FROM secrets WHERE group_id = $1
         AND central_user_id IN (SELECT central_user_id FROM group_members WHERE group_id = $1)`,
      [groupId]
    );

    // Comparison results (fixed summaries; the AI's confidence number stays server-side,
    // since room rules can steer it too)
    // ROOM ADMIN sees everything in the group. Regular members only see comparisons involving their own secrets.
    const isAdminOfGroup = membership[0].role === 'admin';
    const { rows: myComparisons } = await pool.query(
      `SELECT c.id, c.matched, c.user_summary, c.created_at,
        CASE WHEN c.secret_a_id IN (SELECT id FROM secrets WHERE central_user_id = $2) THEN c.secret_a_id ELSE c.secret_b_id END as my_secret_id
       FROM comparisons c
       WHERE c.group_id = $1
         AND (
           $3 = TRUE 
           OR c.secret_a_id IN (SELECT id FROM secrets WHERE central_user_id = $2)
           OR c.secret_b_id IN (SELECT id FROM secrets WHERE central_user_id = $2)
         )
       ORDER BY c.created_at DESC`,
      [groupId, req.user.central_user_id, isAdminOfGroup]
    );

    res.json({
      secrets: mySecrets.map((r) => decryptFields(r, ['content'])),
      matches: matches.map((r) => decryptFields(r, ['ai_reasoning', 'obfuscated_a', 'obfuscated_b'])),
      otherMembers: otherCounts,
      submittedStats: submittedStats,
      comparisons: myComparisons.map((r) => ({ ...r, user_summary: safeSummary(decrypt(r.user_summary), r.matched) })),
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Every submitted secret goes to the AI once per other member's submitted secret, on the
// room admin's own API key. These keep one member from running up that bill.
const MAX_SECRET_LENGTH = 2000;
const MAX_SUBMITTED_PER_MEMBER = 10;

// Add a secret (sealed — no AI call)
router.post('/group/:groupId', authenticate, requireEncryption, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { content } = req.body;
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Write a secret first' });
    }
    if (content.length > MAX_SECRET_LENGTH) {
      return res.status(400).json({ error: `Keep it under ${MAX_SECRET_LENGTH} characters` });
    }

    const { rows: membership } = await pool.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND central_user_id = $2',
      [groupId, req.user.central_user_id]
    );
    if (!membership[0]) return res.status(403).json({ error: 'Not a member' });

    const { rows: [newSecret] } = await pool.query(
      'INSERT INTO secrets (group_id, central_user_id, content) VALUES ($1,$2,$3) RETURNING *',
      [groupId, req.user.central_user_id, encrypt(content)]
    );

    res.status(201).json({ secret: { ...newSecret, content } });
  } catch (err) {
    serverError(req, res, err);
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

    const { rows: [{ n }] } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM secrets WHERE group_id = $1 AND central_user_id = $2 AND status = 'submitted'",
      [secret.group_id, req.user.central_user_id]
    );
    if (n >= MAX_SUBMITTED_PER_MEMBER) {
      return res.status(400).json({ error: `You can have at most ${MAX_SUBMITTED_PER_MEMBER} secrets submitted in a room at once` });
    }

    // Only from sealed: a comparison run or another tab may have changed it since the read.
    const { rows: [updated] } = await pool.query(
      "UPDATE secrets SET status = 'submitted' WHERE id = $1 AND status = 'sealed' RETURNING *",
      [req.params.id]
    );
    if (!updated) return res.status(409).json({ error: 'That secret just changed. Reload and try again.' });
    res.json({ secret: decryptFields(updated, ['content']) });
  } catch (err) {
    serverError(req, res, err);
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

    // Only from submitted: a run that matched it meanwhile has already opened its vault.
    const { rows: [updated] } = await pool.query(
      "UPDATE secrets SET status = 'sealed' WHERE id = $1 AND status = 'submitted' RETURNING *",
      [req.params.id]
    );
    if (!updated) return res.status(409).json({ error: 'That secret just changed. Reload and try again.' });
    res.json({ secret: decryptFields(updated, ['content']) });
  } catch (err) {
    serverError(req, res, err);
  }
});

// One comparison run per room at a time. A second click or tab used to start a parallel
// run that repeated every AI call on the room admin's key and, when both found the same
// match, logged a permanent "analysis failed" entry next to it. In-process only: fine
// while the app runs as one instance.
const roomsComparing = new Set();
function oneRunPerRoom(handler) {
  return async (req, res) => {
    const room = String(req.params.groupId);
    if (roomsComparing.has(room)) {
      return res.status(409).json({ error: 'A comparison is already running in this room' });
    }
    roomsComparing.add(room);
    try {
      await handler(req, res);
    } finally {
      roomsComparing.delete(room);
    }
  };
}

// Both secrets of a pair ($1, $2) are still in the run: submitted (or matched earlier in this
// same run, which goes on comparing them with the rest), and their owners still in room $3.
// A run reads the submitted secrets once, then spends seconds per AI call, and meanwhile a
// member can unsubmit, delete or leave.
const STILL_IN_RUN = `id IN ($1, $2) AND status IN ('submitted', 'matched')
  AND central_user_id IN (SELECT central_user_id FROM group_members WHERE group_id = $3)`;

async function stillInRun(groupId, a, b) {
  const { rows: [{ n }] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM secrets WHERE ${STILL_IN_RUN}`, [a.id, b.id, groupId]);
  return n === 2;
}

// Write one pair's outcome, or nothing if either secret was withdrawn while the AI was
// answering. Both rows are locked before anything is written, so a withdrawal can't land
// halfway; a match moves both to 'matched' in the same transaction as its vault, so a vault
// never opens on a secret its member took back (and a deleted one can't break the run).
// Returns null for a skipped pair, else { vaultId } (undefined without a vault).
async function recordPair(groupId, a, b, outcome) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      outcome.vault
        ? `UPDATE secrets SET status = 'matched' WHERE ${STILL_IN_RUN}`
        : `SELECT id FROM secrets WHERE ${STILL_IN_RUN} FOR SHARE`,
      [a.id, b.id, groupId]
    );
    if (rowCount !== 2) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `INSERT INTO comparisons (group_id, secret_a_id, secret_b_id, matched, confidence, ai_reasoning, user_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [groupId, a.id, b.id, outcome.matched, outcome.confidence, encrypt(outcome.reasoning), encrypt(outcome.summary)]
    );
    let vaultId;
    if (outcome.vault) {
      ({ rows: [{ id: vaultId }] } = await client.query(
        `INSERT INTO vault_matches (group_id, secret_a_id, secret_b_id, ai_reasoning, obfuscated_a, obfuscated_b)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [groupId, a.id, b.id, encrypt(outcome.reasoning), encryptArray(outcome.vault.a), encryptArray(outcome.vault.b)]
      ));
    }
    await client.query('COMMIT');
    return { vaultId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Only the room's admin runs a comparison. Asked before the one-run guard, so that nobody else
// can take a room's turn from its admin for a moment, or learn from a 409 that a run is going.
async function requireRoomAdmin(req, res, next) {
  try {
    const { rows: membership } = await pool.query(
      "SELECT * FROM group_members WHERE group_id = $1 AND central_user_id = $2 AND role = 'admin'",
      [req.params.groupId, req.user.central_user_id]
    );
    if (!membership[0]) return res.status(403).json({ error: 'Only the group admin can trigger comparison' });
    next();
  } catch (err) {
    serverError(req, res, err);
  }
}

// Admin: trigger AI comparison on all submitted secrets in a group
router.post('/group/:groupId/compare', authenticate, requireEncryption, requireRoomAdmin, oneRunPerRoom(async (req, res) => {
  try {
    const { groupId } = req.params;

    // Get current room admin AI config
    const aiConfig = await getUserAiConfig(req.user.central_user_id);
    if (!aiConfig) return res.status(400).json({ error: 'Set up your AI provider in settings first' });

    // Get group info (prompt/mode)
    const { rows: [group] } = await pool.query('SELECT * FROM groups WHERE id = $1', [groupId]);

    // Get all submitted secrets (decrypted here once — the AI compares plaintext). Only
    // current members': a secret left behind by someone who left the room stays out, or
    // a later run could still open a vault that shows it to whoever it matches.
    const { rows: submittedRows } = await pool.query(
      `SELECT * FROM secrets WHERE group_id = $1 AND status = 'submitted'
         AND central_user_id IN (SELECT central_user_id FROM group_members WHERE group_id = $1)`,
      [groupId]
    );
    // Drop anything we could not decrypt. Every unreadable secret decrypts to the
    // SAME marker string, so comparing them would look like a perfect match and
    // mint a permanent, irreversible vault match over garbage. The ok flag is
    // out-of-band, so a member who types a marker's text keeps a real secret.
    const decrypted = submittedRows.map((r) => ({ row: r, res: tryDecrypt(r.content) }));
    const submitted = decrypted.filter((d) => d.res.ok).map((d) => ({ ...d.row, content: d.res.value }));
    const unreadable = decrypted.length - submitted.length;
    if (unreadable) console.warn(`[compare] skipped ${unreadable} undecryptable secret(s) in group ${groupId}`);

    if (submitted.length < 2) {
      return res.status(400).json({
        error: unreadable
          ? `Need at least 2 readable submitted secrets — ${unreadable} could not be decrypted (ENCRYPTION_KEY changed?)`
          : 'Need at least 2 submitted secrets to compare',
      });
    }

    // Clear previous non-match comparisons for this group
    await pool.query(
      `DELETE FROM comparisons WHERE group_id = $1
       AND NOT EXISTS (SELECT 1 FROM vault_matches vm WHERE vm.secret_a_id = comparisons.secret_a_id AND vm.secret_b_id = comparisons.secret_b_id)`,
      [groupId]
    );

    // One set of decoys per secret for the whole run. A secret can match several others in a run
    // (a matched secret leaves later runs, not this one), and a new set in each vault would let a
    // member lay the lists side by side, with two secrets of their own: what they share is the real one.
    const decoysOf = new Map();
    const coverFor = async (secret, deniability) => {
      if (!decoysOf.has(secret.id)) decoysOf.set(secret.id, await generateObfuscation(aiConfig, secret.content, deniability));
      return shuffleWithSecret(decoysOf.get(secret.id), secret.content);
    };

    // Compare all pairs
    const newMatches = [];
    const allResults = [];
    let errors = 0;
    for (let i = 0; i < submitted.length; i++) {
      for (let j = i + 1; j < submitted.length; j++) {
        const a = submitted[i];
        const b = submitted[j];

        if (a.central_user_id === b.central_user_id) continue;

        const { rows: existingMatch } = await pool.query(
          `SELECT id FROM vault_matches
           WHERE (secret_a_id = $1 AND secret_b_id = $2) OR (secret_a_id = $2 AND secret_b_id = $1)`,
          [a.id, b.id]
        );
        if (existingMatch[0]) continue;
        // Withdrawn since the read above: not sent to the AI.
        if (!(await stillInRun(groupId, a, b))) continue;

        let outcome;
        try {
          // Add a small delay between calls to help with rate limits
          if (allResults.length > 0 || errors > 0) await sleep(500);

          const result = await compareSecrets(aiConfig, a.content, b.content, group.ai_prompt, group.room_config);

          const isMatch = result.match && result.confidence >= 0.6;
          outcome = { matched: isMatch, confidence: result.confidence, reasoning: result.reasoning, summary: comparisonSummary(isMatch, group.room_config) };

          // Decoys before anything is written: if none come back, the pair is logged as
          // failed below and retried next run, not logged as a match with no vault.
          if (isMatch) {
            const deniability = group.room_config?.deniability || 0;
            let obfuscatedA = [a.content];
            let obfuscatedB = [b.content];

            if (deniability > 0) {
              obfuscatedA = await coverFor(a, deniability);
              obfuscatedB = await coverFor(b, deniability);
            }
            outcome.vault = { a: obfuscatedA, b: obfuscatedB };
          }
        } catch (aiErr) {
          console.error('AI comparison failed:', describeAiError(aiErr));
          errors++;

          let userMsg = FAILED_SUMMARY;
          if (aiErr.message.includes('429') || aiErr.message.toLowerCase().includes('quota')) {
            userMsg = QUOTA_SUMMARY;
          }

          // A failure record so we know it was attempted
          outcome = { matched: false, confidence: 0, reasoning: aiErr.message, summary: userMsg, failed: true };
        }

        const saved = await recordPair(groupId, a, b, outcome);
        if (!saved || outcome.failed) continue;
        allResults.push({ matched: outcome.matched, user_summary: outcome.summary });
        // The room admin who runs this is usually not one of the pair: send no
        // content, reasoning or decoy lists. The two members read their vault from
        // GET /group/:groupId.
        if (saved.vaultId) newMatches.push({ id: saved.vaultId });
      }
    }

    res.json({ 
      matches: newMatches, 
      results: allResults, 
      compared: submitted.length,
      errors: errors > 0 ? errors : undefined
    });
  } catch (err) {
    serverError(req, res, err);
  }
}));

// Delete a secret (only your own, and only if not matched)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rows: [secret] } = await pool.query(
      'SELECT * FROM secrets WHERE id = $1 AND central_user_id = $2',
      [req.params.id, req.user.central_user_id]
    );
    if (!secret) return res.status(404).json({ error: 'Secret not found' });
    if (secret.status === 'matched') return res.status(400).json({ error: 'Cannot delete a matched secret' });

    const { rowCount } = await pool.query("DELETE FROM secrets WHERE id = $1 AND status <> 'matched'", [req.params.id]);
    if (!rowCount) return res.status(409).json({ error: 'That secret just changed. Reload and try again.' });
    res.json({ message: 'Secret deleted' });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;

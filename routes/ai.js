import { Router } from 'express';
import pool from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireEncryption } from '../middleware/encryption.js';
import { getUserAiConfig, testConnection } from '../services/aiService.js';
import { encrypt } from '../config/crypto.js';
import { serverError } from '../middleware/errors.js';

const router = Router();

// Get user's AI config
router.get('/config', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, provider, model, created_at, updated_at FROM ai_configs WHERE central_user_id = $1',
      [req.user.central_user_id]
    );
    res.json({ config: rows[0] || null });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Save/update AI config
router.put('/config', authenticate, requireEncryption, async (req, res) => {
  try {
    const { provider, api_key, model } = req.body;
    if (!provider || !api_key) {
      return res.status(400).json({ error: 'Provider and API key are required' });
    }

    const { rows: existing } = await pool.query(
      'SELECT id FROM ai_configs WHERE central_user_id = $1',
      [req.user.central_user_id]
    );

    if (existing[0]) {
      await pool.query(
        `UPDATE ai_configs SET provider=$1, api_key=$2, model=$3, updated_at=NOW()
         WHERE central_user_id=$4`,
        [provider, encrypt(api_key), model || null, req.user.central_user_id]
      );
    } else {
      await pool.query(
        'INSERT INTO ai_configs (central_user_id, provider, api_key, model) VALUES ($1,$2,$3,$4)',
        [req.user.central_user_id, provider, encrypt(api_key), model || null]
      );
    }

    res.json({ message: 'AI config saved' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Delete AI config
router.delete('/config', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM ai_configs WHERE central_user_id = $1', [req.user.central_user_id]);
    res.json({ message: 'AI config deleted' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Test AI connection
router.post('/test', authenticate, async (req, res) => {
  try {
    const config = await getUserAiConfig(req.user.central_user_id);
    if (!config) return res.status(400).json({ error: 'No AI config found. Save one first.' });

    const result = await testConnection(config);
    res.json(result);
  } catch (err) {
    // Our own sentence about the stored key, or the provider's status code when it turned the
    // call down; never the provider's own text, which can quote part of the key.
    if (err.expose) return res.status(400).json({ error: err.message });
    if (err.status >= 400 && err.status < 500) {
      return res.status(400).json({ error: `The AI provider turned the test down (${err.status}). Check the key and the model.` });
    }
    serverError(req, res, err);
  }
});

export default router;

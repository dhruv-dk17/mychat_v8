const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { pool } = require('../db/database');

const limiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
const getZodErrorMessage = error => error.issues?.[0]?.message || 'Invalid request';

async function verifyUserSession(username, token) {
  if (!username || !token) return false;
  const u = await pool.query('SELECT username FROM users WHERE username = $1 AND session_token = $2', [username.toLowerCase(), token]);
  return u.rows.length > 0;
}

const dropSchema = z.object({
  receiverUsername: z.string(),
  encryptedPayload: z.string(),
  senderPublicKey: z.string()
});

router.post('/', limiter, async (req, res) => {
  const { username, token } = req.headers;
  
  if (!(await verifyUserSession(username, token))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { receiverUsername, encryptedPayload, senderPublicKey } = dropSchema.parse(req.body);
    
    // Check if receiver exists
    const rec = await pool.query('SELECT username FROM users WHERE username = $1', [receiverUsername.toLowerCase()]);
    if (!rec.rows.length) return res.status(404).json({ error: 'Receiver not found' });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await pool.query(
      'INSERT INTO dead_drops (receiver_username, encrypted_payload, sender_public_key, expires_at) VALUES ($1, $2, $3, $4)',
      [receiverUsername.toLowerCase(), encryptedPayload, senderPublicKey, expiresAt]
    );

    res.json({ success: true });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getZodErrorMessage(e) });
    console.error('Dead drop store error:', e.message);
    res.status(500).json({ error: 'Failed to store dead drop' });
  }
});

router.get('/', limiter, async (req, res) => {
  const { username, token } = req.headers;
  if (!(await verifyUserSession(username, token))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await pool.query(
      'SELECT id, encrypted_payload, sender_public_key, created_at FROM dead_drops WHERE receiver_username = $1 AND delivered = FALSE',
      [username.toLowerCase()]
    );
    res.json({ drops: result.rows });
  } catch (e) {
    console.error('Fetch dead drop error:', e.message);
    res.status(500).json({ error: 'Failed to fetch dead drops' });
  }
});

router.post('/:id/confirm', limiter, async (req, res) => {
  const { username, token } = req.headers;
  if (!(await verifyUserSession(username, token))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    await pool.query(
      'DELETE FROM dead_drops WHERE id = $1 AND receiver_username = $2',
      [id, username.toLowerCase()]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Confirmation failed' });
  }
});

module.exports = router;

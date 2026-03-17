const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { pool } = require('../db/database');
const { validateSlug, validateHash } = require('../middleware/validate');

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many registration attempts. Try again in an hour.' }
});

// GET /api/rooms/check/:slug — availability check
router.get('/check/:slug', async (req, res) => {
  const slug = req.params.slug?.toLowerCase();
  if (!validateSlug(slug)) return res.status(400).json({ error: 'Invalid room ID. Use 3-8 lowercase alphanumeric characters.' });
  try {
    const result = await pool.query('SELECT slug FROM rooms WHERE slug = $1', [slug]);
    res.json({ available: result.rows.length === 0 });
  } catch (e) {
    console.error('Check error:', e.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/rooms/register
router.post('/register', registerLimiter, async (req, res) => {
  const { slug, passwordHash, ownerTokenHash } = req.body;
  if (!validateSlug(slug))           return res.status(400).json({ error: 'Invalid room ID' });
  if (!validateHash(passwordHash))   return res.status(400).json({ error: 'Invalid password hash' });
  if (!validateHash(ownerTokenHash)) return res.status(400).json({ error: 'Invalid owner token hash' });
  try {
    await pool.query(
      'INSERT INTO rooms (slug, password_hash, owner_token_hash, created_at) VALUES ($1, $2, $3, $4)',
      [slug.toLowerCase(), passwordHash, ownerTokenHash, Date.now()]
    );
    res.json({ success: true, slug: slug.toLowerCase() });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Room ID already taken' });
    console.error('Register error:', e.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/rooms/verify-password
router.post('/verify-password', async (req, res) => {
  const { slug, passwordHash } = req.body;
  if (!validateSlug(slug))         return res.status(400).json({ error: 'Invalid slug' });
  if (!validateHash(passwordHash)) return res.status(400).json({ error: 'Invalid hash' });
  try {
    const r = await pool.query('SELECT password_hash FROM rooms WHERE slug = $1', [slug.toLowerCase()]);
    if (!r.rows.length) return res.status(404).json({ error: 'Room not found' });
    res.json({ valid: timingSafeEqual(r.rows[0].password_hash, passwordHash) });
  } catch (e) {
    console.error('Verify-password error:', e.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /api/rooms/verify-owner
router.post('/verify-owner', async (req, res) => {
  const { slug, ownerTokenHash } = req.body;
  if (!validateSlug(slug))           return res.status(400).json({ error: 'Invalid slug' });
  if (!validateHash(ownerTokenHash)) return res.status(400).json({ error: 'Invalid token hash' });
  try {
    const r = await pool.query('SELECT owner_token_hash FROM rooms WHERE slug = $1', [slug.toLowerCase()]);
    if (!r.rows.length) return res.status(404).json({ error: 'Room not found' });
    res.json({ valid: timingSafeEqual(r.rows[0].owner_token_hash, ownerTokenHash) });
  } catch (e) {
    console.error('Verify-owner error:', e.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

module.exports = router;

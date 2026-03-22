const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { pool } = require('../db/database');

const SALT_ROUNDS = 12;
const getZodErrorMessage = error => error.issues?.[0]?.message || 'Invalid request';

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20
});

const registerSchema = z.object({
  slug: z.string().min(3).max(8).regex(/^[a-z0-9]+$/),
  password: z.string().min(1),
  username: z.string().min(3).max(32),
  token: z.string()
});

const authRoomSchema = z.object({
  slug: z.string(),
  password: z.string()
});

async function verifyUserSession(username, token) {
  if (!username || !token) return false;
  const u = await pool.query('SELECT username FROM users WHERE username = $1 AND session_token = $2', [username.toLowerCase(), token]);
  return u.rows.length > 0;
}

router.get('/check/:slug', async (req, res) => {
  const slug = req.params.slug?.toLowerCase();
  if (!slug || !/^[a-z0-9]{3,8}$/.test(slug)) return res.status(400).json({ error: 'Invalid room ID' });
  try {
    const result = await pool.query('SELECT room_name FROM rooms WHERE room_name = $1', [slug]);
    res.json({ available: result.rows.length === 0 });
  } catch (e) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/register', limiter, async (req, res) => {
  try {
    const { slug, password, username, token } = registerSchema.parse(req.body);
    
    if (!(await verifyUserSession(username, token))) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    await pool.query(
      'INSERT INTO rooms (room_name, password_hash, owner_username) VALUES ($1, $2, $3)',
      [slug.toLowerCase(), passwordHash, username.toLowerCase()]
    );
    res.json({ success: true, slug: slug.toLowerCase() });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getZodErrorMessage(e) });
    if (e.code === '23505') return res.status(409).json({ error: 'Room ID already taken' });
    console.error('Register error:', e.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/verify-password', async (req, res) => {
  try {
    const { slug, password } = authRoomSchema.parse(req.body);
    const r = await pool.query('SELECT password_hash FROM rooms WHERE room_name = $1', [slug.toLowerCase()]);
    if (!r.rows.length) return res.status(404).json({ error: 'Room not found' });
    
    const valid = await bcrypt.compare(password, r.rows[0].password_hash);
    res.json({ valid });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getZodErrorMessage(e) });
    console.error('Verify pw error:', e.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.get('/user', async (req, res) => {
  const { username, token } = req.query;
  if (!(await verifyUserSession(username, token))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const r = await pool.query('SELECT room_name as slug, created_at FROM rooms WHERE owner_username = $1 ORDER BY created_at DESC', [username.toLowerCase()]);
    res.json({ rooms: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

router.delete('/:slug', async (req, res) => {
  const slug = req.params.slug?.toLowerCase();
  const { username, token } = req.query;
  if (!(await verifyUserSession(username, token))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const del = await pool.query('DELETE FROM rooms WHERE room_name = $1 AND owner_username = $2 RETURNING room_name', [slug, username.toLowerCase()]);
    if (!del.rows.length) return res.status(404).json({ error: 'Room not found or unauthorized' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Deletion failed' });
  }
});

// Remove old message store routes temporarily if they depended on old room_slug schemas. 
// Standard P2P doesn't send persistent messages to server, but dead drop does. 
// V7 had room_messages, but V8 replaces persistent room offline messaging with Dead Drop messaging.
// As instructed: "The server stores only an encrypted blob it cannot read." for dead drop. 
// Room_messages from V7 should be removed.

module.exports = router;

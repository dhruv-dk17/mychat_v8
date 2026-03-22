const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { pool } = require('../db/database');

const SALT_ROUNDS = 12;
const getZodErrorMessage = error => error.issues?.[0]?.message || 'Invalid request';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10,
  message: { error: 'Too many auth attempts. Try again later.' }
});

const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
  publicIdentityKey: z.string().optional()
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
  publicIdentityKey: z.string().optional()
});

const recoverySchema = z.object({
  username: z.string(),
  recoveryKey: z.string(),
  newPassword: z.string().min(8).max(128)
});

// Simple dictionary for recovery keys
const WORDS = ['cactus','lake','rocket','stone','winter','lotus','planet','forest','ocean','cloud',
'fire','mountain','star','river','valley','moon','sun','leaf','tree','bird','eagle','tiger','lion','bear'];

function generateRecoveryKey() {
  return Array.from({ length: 8 }, () => WORDS[Math.floor(Math.random() * WORDS.length)]).join('-');
}

router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, password, publicIdentityKey } = registerSchema.parse(req.body);
    
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    
    const recoveryKey = generateRecoveryKey();
    const recoveryKeyHash = await bcrypt.hash(recoveryKey, SALT_ROUNDS);

    const token = crypto.randomBytes(48).toString('hex');

    await pool.query(
      'INSERT INTO users (username, password_hash, recovery_key_hash, public_identity_key, session_token) VALUES ($1, $2, $3, $4, $5)',
      [username.toLowerCase(), passwordHash, recoveryKeyHash, publicIdentityKey || null, token]
    );

    await pool.query('UPDATE users SET last_active = NOW() WHERE username = $1', [username.toLowerCase()]);

    res.json({ success: true, username: username.toLowerCase(), recoveryKey, token });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getZodErrorMessage(e) });
    if (e.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    console.error('Register error:', e.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password, publicIdentityKey } = loginSchema.parse(req.body);

    const r = await pool.query('SELECT password_hash FROM users WHERE username = $1', [username.toLowerCase()]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    
    const match = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = crypto.randomBytes(48).toString('hex');

    if (publicIdentityKey) {
       await pool.query('UPDATE users SET public_identity_key = $1, session_token = $2, last_active = NOW() WHERE username = $3', [publicIdentityKey, token, username.toLowerCase()]);
    } else {
       await pool.query('UPDATE users SET session_token = $1, last_active = NOW() WHERE username = $2', [token, username.toLowerCase()]);
    }

    res.json({ success: true, username: username.toLowerCase(), token });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getZodErrorMessage(e) });
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/recover', authLimiter, async (req, res) => {
  try {
    const { username, recoveryKey, newPassword } = recoverySchema.parse(req.body);

    const r = await pool.query('SELECT recovery_key_hash FROM users WHERE username = $1', [username.toLowerCase()]);
    if (!r.rows.length) return res.status(400).json({ error: 'Invalid username or recovery key' });
    
    const match = await bcrypt.compare(recoveryKey, r.rows[0].recovery_key_hash);
    if (!match) return res.status(400).json({ error: 'Invalid username or recovery key' });
    
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [newPasswordHash, username.toLowerCase()]);

    res.json({ success: true });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getZodErrorMessage(e) });
    console.error('Recovery error:', e.message);
    res.status(500).json({ error: 'Recovery failed' });
  }
});

router.delete('/account', authLimiter, async (req, res) => {
  // We need password confirmation to delete
  try {
    const checkSchema = z.object({
      username: z.string(),
      password: z.string()
    });
    const { username, password } = checkSchema.parse(req.body);

    const r = await pool.query('SELECT password_hash FROM users WHERE username = $1', [username.toLowerCase()]);
    if (!r.rows.length) return res.status(401).json({ error: 'Unauthorized' });
    
    const match = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Unauthorized' });

    await pool.query('DELETE FROM users WHERE username = $1', [username.toLowerCase()]);
    res.json({ success: true, message: 'Account deleted' });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getZodErrorMessage(e) });
    console.error('Delete account error:', e.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

router.get('/contacts', async (req, res) => {
  const { username, token } = req.query;
  if (!username || !token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const u = await pool.query('SELECT contacts FROM users WHERE username = $1 AND session_token = $2', [username.toLowerCase(), token]);
    if (!u.rows.length) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ contacts: u.rows[0].contacts || [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

router.post('/contacts', async (req, res) => {
  const { username, token } = req.query;
  const { contactUsername } = req.body;
  if (!username || !token) return res.status(401).json({ error: 'Unauthorized' });
  if (!contactUsername || contactUsername.toLowerCase() === username.toLowerCase()) return res.status(400).json({ error: 'Invalid contact' });
  try {
    const u = await pool.query('SELECT contacts FROM users WHERE username = $1 AND session_token = $2', [username.toLowerCase(), token]);
    if (!u.rows.length) return res.status(401).json({ error: 'Unauthorized' });
    
    const contactCheck = await pool.query('SELECT username FROM users WHERE username = $1', [contactUsername.toLowerCase()]);
    if (!contactCheck.rows.length) return res.status(404).json({ error: 'User does not exist' });

    let contacts = u.rows[0].contacts || [];
    if (!contacts.includes(contactUsername.toLowerCase())) {
        contacts.push(contactUsername.toLowerCase());
        await pool.query('UPDATE users SET contacts = $1 WHERE username = $2', [JSON.stringify(contacts), username.toLowerCase()]);
    }
    res.json({ success: true, contacts });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

module.exports = router;

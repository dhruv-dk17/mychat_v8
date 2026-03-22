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

const contactUsernameSchema = z.object({
  contactUsername: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/)
});

const contactRespondSchema = z.object({
  fromUsername: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  action: z.enum(['accept', 'reject'])
});

// Simple dictionary for recovery keys
const WORDS = ['cactus','lake','rocket','stone','winter','lotus','planet','forest','ocean','cloud',
'fire','mountain','star','river','valley','moon','sun','leaf','tree','bird','eagle','tiger','lion','bear'];

function generateRecoveryKey() {
  return Array.from({ length: 8 }, () => WORDS[Math.floor(Math.random() * WORDS.length)]).join('-');
}

function normalizeUsernameList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map(item => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
}

function toJsonbParam(value) {
  return JSON.stringify(normalizeUsernameList(value));
}

async function loadUserSession(username, token) {
  return pool.query(
    'SELECT username, contacts, contact_requests, outgoing_contact_requests FROM users WHERE username = $1 AND session_token = $2',
    [username.toLowerCase(), token]
  );
}

async function updateUserContactState(client, username, contacts, incoming, outgoing) {
  await client.query(
    `UPDATE users
     SET contacts = $1::jsonb,
         contact_requests = $2::jsonb,
         outgoing_contact_requests = $3::jsonb
     WHERE username = $4`,
    [toJsonbParam(contacts), toJsonbParam(incoming), toJsonbParam(outgoing), username.toLowerCase()]
  );
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
    const u = await loadUserSession(username, token);
    if (!u.rows.length) return res.status(401).json({ error: 'Unauthorized' });
    const row = u.rows[0];
    res.json({
      contacts: normalizeUsernameList(row.contacts),
      incomingRequests: normalizeUsernameList(row.contact_requests),
      outgoingRequests: normalizeUsernameList(row.outgoing_contact_requests)
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

async function sendContactRequest(req, res) {
  const { username, token } = req.query;
  if (!username || !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let parsed;
  try {
    parsed = contactUsernameSchema.parse(req.body);
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getZodErrorMessage(e) });
    return res.status(400).json({ error: 'Invalid contact username' });
  }

  const me = username.toLowerCase();
  const target = parsed.contactUsername.toLowerCase();
  if (target === me) return res.status(400).json({ error: 'You cannot add yourself' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const meResult = await client.query(
      'SELECT contacts, contact_requests, outgoing_contact_requests FROM users WHERE username = $1 AND session_token = $2 FOR UPDATE',
      [me, token]
    );
    if (!meResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const targetResult = await client.query(
      'SELECT contacts, contact_requests, outgoing_contact_requests FROM users WHERE username = $1 FOR UPDATE',
      [target]
    );
    if (!targetResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User does not exist' });
    }

    let meContacts = normalizeUsernameList(meResult.rows[0].contacts);
    let meIncoming = normalizeUsernameList(meResult.rows[0].contact_requests);
    let meOutgoing = normalizeUsernameList(meResult.rows[0].outgoing_contact_requests);

    let targetContacts = normalizeUsernameList(targetResult.rows[0].contacts);
    let targetIncoming = normalizeUsernameList(targetResult.rows[0].contact_requests);
    let targetOutgoing = normalizeUsernameList(targetResult.rows[0].outgoing_contact_requests);

    let status = 'pending';

    if (meContacts.includes(target)) {
      status = 'already_contact';
    } else if (meIncoming.includes(target) || targetOutgoing.includes(me)) {
      // Incoming request exists, so accept immediately.
      meIncoming = meIncoming.filter(name => name !== target);
      targetOutgoing = targetOutgoing.filter(name => name !== me);

      meOutgoing = meOutgoing.filter(name => name !== target);
      targetIncoming = targetIncoming.filter(name => name !== me);

      meContacts = normalizeUsernameList([...meContacts, target]);
      targetContacts = normalizeUsernameList([...targetContacts, me]);
      status = 'accepted';
    } else if (!meOutgoing.includes(target) && !targetIncoming.includes(me)) {
      meOutgoing = normalizeUsernameList([...meOutgoing, target]);
      targetIncoming = normalizeUsernameList([...targetIncoming, me]);
      status = 'pending';
    }

    await updateUserContactState(client, me, meContacts, meIncoming, meOutgoing);
    await updateUserContactState(client, target, targetContacts, targetIncoming, targetOutgoing);

    await client.query('COMMIT');
    res.json({
      success: true,
      status,
      contacts: meContacts,
      incomingRequests: meIncoming,
      outgoingRequests: meOutgoing
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Contact request error:', e.message);
    res.status(500).json({ error: 'Failed to send contact request' });
  } finally {
    client.release();
  }
}

router.post('/contacts', sendContactRequest);
router.post('/contacts/request', sendContactRequest);

router.post('/contacts/respond', async (req, res) => {
  const { username, token } = req.query;
  if (!username || !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let parsed;
  try {
    parsed = contactRespondSchema.parse(req.body);
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: getZodErrorMessage(e) });
    return res.status(400).json({ error: 'Invalid contact response' });
  }

  const me = username.toLowerCase();
  const from = parsed.fromUsername.toLowerCase();
  const action = parsed.action;
  if (from === me) return res.status(400).json({ error: 'Invalid request sender' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const meResult = await client.query(
      'SELECT contacts, contact_requests, outgoing_contact_requests FROM users WHERE username = $1 AND session_token = $2 FOR UPDATE',
      [me, token]
    );
    if (!meResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const fromResult = await client.query(
      'SELECT contacts, contact_requests, outgoing_contact_requests FROM users WHERE username = $1 FOR UPDATE',
      [from]
    );
    if (!fromResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request sender no longer exists' });
    }

    let meContacts = normalizeUsernameList(meResult.rows[0].contacts);
    let meIncoming = normalizeUsernameList(meResult.rows[0].contact_requests);
    let meOutgoing = normalizeUsernameList(meResult.rows[0].outgoing_contact_requests);

    let fromContacts = normalizeUsernameList(fromResult.rows[0].contacts);
    let fromIncoming = normalizeUsernameList(fromResult.rows[0].contact_requests);
    let fromOutgoing = normalizeUsernameList(fromResult.rows[0].outgoing_contact_requests);

    if (!meIncoming.includes(from) && !fromOutgoing.includes(me)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No pending request found' });
    }

    meIncoming = meIncoming.filter(name => name !== from);
    fromOutgoing = fromOutgoing.filter(name => name !== me);

    if (action === 'accept') {
      meContacts = normalizeUsernameList([...meContacts, from]);
      fromContacts = normalizeUsernameList([...fromContacts, me]);
      meOutgoing = meOutgoing.filter(name => name !== from);
      fromIncoming = fromIncoming.filter(name => name !== me);
    }

    await updateUserContactState(client, me, meContacts, meIncoming, meOutgoing);
    await updateUserContactState(client, from, fromContacts, fromIncoming, fromOutgoing);

    await client.query('COMMIT');
    res.json({
      success: true,
      status: action === 'accept' ? 'accepted' : 'rejected',
      contacts: meContacts,
      incomingRequests: meIncoming,
      outgoingRequests: meOutgoing
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Contact response error:', e.message);
    res.status(500).json({ error: 'Failed to respond to contact request' });
  } finally {
    client.release();
  }
});

module.exports = router;

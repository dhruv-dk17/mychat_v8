'use strict';

// ── User Auth API ───────────────────────────────────────────────────
async function registerUser(username, password) {
  const passwordHash = await sha256(password);
  const res = await fetch(`${CONFIG.API_BASE}/users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, passwordHash })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Registration failed');
  return data;
}

async function loginUser(username, password) {
  const passwordHash = await sha256(password);
  const res = await fetch(`${CONFIG.API_BASE}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, passwordHash })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Login failed');
  return data;
}

// ── Room availability check ───────────────────────────────────────
async function checkRoomAvailability(slug) {
  const res  = await fetch(`${CONFIG.API_BASE}/rooms/check/${encodeURIComponent(slug)}`);
  const data = await res.json();
  return data.available === true;
}

// ── Register permanent room ───────────────────────────────────────
async function registerPermanentRoom(slug, password) {
  const passwordHash   = await sha256(password);
  const ownerToken     = randomToken(32);
  const ownerTokenHash = await sha256(ownerToken);

  const payload = { slug, passwordHash, ownerTokenHash };
  const u = getUserSession();
  if (u) {
    payload.username = u.username;
    payload.token    = u.token;
  }

  const res = await fetch(`${CONFIG.API_BASE}/rooms/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Registration failed');

  // Store raw owner token in sessionStorage only — cleared on tab close
  sessionStorage.setItem('ownerToken_' + slug, ownerToken);
  return { slug, ownerToken };
}

// ── Verify room password ──────────────────────────────────────────
async function verifyRoomPassword(slug, password) {
  const passwordHash = await sha256(password);
  const res  = await fetch(`${CONFIG.API_BASE}/rooms/verify-password`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ slug, passwordHash })
  });
  const data = await res.json();
  return data.valid === true;
}

// ── Verify owner token ────────────────────────────────────────────
async function verifyOwnerToken(slug, ownerToken) {
  const ownerTokenHash = await sha256(ownerToken);
  const res  = await fetch(`${CONFIG.API_BASE}/rooms/verify-owner`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ slug, ownerTokenHash })
  });
  const data = await res.json();
  return data.valid === true;
}

// ── PeerJS ID helpers ─────────────────────────────────────────────
function hostPeerId(roomId, isPermanent) {
  return isPermanent
    ? `mchat-perm-${roomId}-host`
    : `mchat-${roomId}-host`;
}

function guestPeerId(roomId, isPermanent) {
  const rand = randomToken(2);
  return isPermanent
    ? `mchat-perm-${roomId}-${rand}`
    : `mchat-${roomId}-${rand}`;
}

// ── Create temporary room ─────────────────────────────────────────
function createTempRoom(type) {
  return { id: randomRoomId(CONFIG.ROOM_ID_LENGTH), type };
}

// ── Password strength (0..3) ──────────────────────────────────────
function getPasswordStrength(pw) {
  if (!pw || pw.length < 4) return 0;
  let score = 0;
  if (pw.length >= 8)  score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9!@#$%^&*]/.test(pw)) score++;
  return score;
}

// ── User Dashboard API ────────────────────────────────────────────
function getUserSession() {
  try {
    const s = localStorage.getItem('mychat_user');
    return s ? JSON.parse(s) : null;
  } catch(e) { return null; }
}

function setUserSession(username, token) {
  localStorage.setItem('mychat_user', JSON.stringify({ username, token }));
}

function clearUserSession() {
  localStorage.removeItem('mychat_user');
}

async function fetchUserRooms() {
  const u = getUserSession();
  if (!u) throw new Error('Not logged in');
  const res = await fetch(`${CONFIG.API_BASE}/rooms/user?username=${encodeURIComponent(u.username)}&token=${encodeURIComponent(u.token)}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.rooms || [];
}

async function deleteUserRoom(slug) {
  const u = getUserSession();
  if (!u) throw new Error('Not logged in');
  const res = await fetch(`${CONFIG.API_BASE}/rooms/${encodeURIComponent(slug)}?username=${encodeURIComponent(u.username)}&token=${encodeURIComponent(u.token)}`, {
    method: 'DELETE'
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Deletion failed');
  return data;
}

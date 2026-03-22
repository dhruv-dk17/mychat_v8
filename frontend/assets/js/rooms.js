'use strict';

// ── User Auth API ───────────────────────────────────────────────────
async function registerUser(username, password) {
  const res = await fetch(`${CONFIG.API_BASE}/users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Registration failed');
  return data;
}

async function loginUser(username, password) {
  const res = await fetch(`${CONFIG.API_BASE}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
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
  const u = getUserSession();
  if (!u) throw new Error('Must be logged in to create permanent rooms');

  const payload = { slug, password, username: u.username, token: u.token };

  const res = await fetch(`${CONFIG.API_BASE}/rooms/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Registration failed');

  return { slug };
}

// ── Verify room password ──────────────────────────────────────────
async function verifyRoomPassword(slug, password) {
  const res  = await fetch(`${CONFIG.API_BASE}/rooms/verify-password`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ slug, password })
  });
  const data = await res.json();
  return data.valid === true;
}

// ── PeerJS ID helpers ─────────────────────────────────────────────
function hostPeerId(roomId, isPermanent) {
  return isPermanent
    ? `mychat8-perm-${roomId}-host`
    : `mychat8-${roomId}-host`;
}

function guestPeerId(roomId, isPermanent) {
  const rand = randomToken(2);
  return isPermanent
    ? `mychat8-perm-${roomId}-${rand}`
    : `mychat8-${roomId}-${rand}`;
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

async function resolvePermanentRoomRole(slug, preferredRole = 'guest') {
  try {
    const rooms = await fetchUserRooms();
    const isOwner = rooms.some(r => r.slug === slug);
    return isOwner ? 'host' : preferredRole;
  } catch (e) {
    return preferredRole;
  }
}

// ── Dead Drop Offline Messaging ───────────────────────────────────
async function sendDeadDropMessage(receiverUsername, messagePayload) {
  const u = getUserSession();
  if (!u) throw new Error('Must be logged in to send offline messages');

  const res = await fetch(`${CONFIG.API_BASE}/dead-drops`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'username': u.username,
      'token': u.token
    },
    body: JSON.stringify(messagePayload)
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to send dead drop');
}

async function fetchPendingDeadDrops() {
  const u = getUserSession();
  if (!u) return [];

  const res = await fetch(`${CONFIG.API_BASE}/dead-drops`, {
    headers: {
      'username': u.username,
      'token': u.token
    }
  });
  const data = await res.json();
  return data.drops || [];
}

async function confirmDeadDropDelivery(dropId) {
  const u = getUserSession();
  if (!u) return;
  await fetch(`${CONFIG.API_BASE}/dead-drops/${dropId}/confirm`, {
    method: 'POST',
    headers: {
      'username': u.username,
      'token': u.token
    }
  });
}

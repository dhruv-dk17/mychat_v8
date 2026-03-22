'use strict';

async function postJsonWithTimeout(path, payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);

  try {
    const res = await fetch(`${CONFIG.API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    if (!data.success) throw new Error(data.error || 'Request failed');
    return data;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Backend timed out. Render may be asleep or the API is down.');
    }
    if (err instanceof TypeError) {
      throw new Error('Cannot reach backend. Check the Render URL, CORS, and service status.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function registerUser(username, password) {
  return postJsonWithTimeout('/users/register', { username, password });
}

async function loginUser(username, password) {
  return postJsonWithTimeout('/users/login', { username, password });
}

async function checkRoomAvailability(slug) {
  const res = await fetch(`${CONFIG.API_BASE}/rooms/check/${encodeURIComponent(slug)}`);
  const data = await res.json();
  return data.available === true;
}

async function registerPermanentRoom(slug, password) {
  const u = getUserSession();
  if (!u) throw new Error('Must be logged in to create permanent rooms');

  const res = await fetch(`${CONFIG.API_BASE}/rooms/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, password, username: u.username, token: u.token })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'Registration failed');
  return { slug: data.slug || slug };
}

async function verifyRoomPassword(slug, password) {
  const res = await fetch(`${CONFIG.API_BASE}/rooms/verify-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data.error) throw new Error(data.error);
  return data.valid === true;
}

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

function createTempRoom(type) {
  return { id: randomRoomId(CONFIG.ROOM_ID_LENGTH), type };
}

function getPasswordStrength(pw) {
  if (!pw || pw.length < 4) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9!@#$%^&*]/.test(pw)) score++;
  return score;
}

function getUserSession() {
  try {
    const s = localStorage.getItem('mychat_user');
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to load rooms');
  return data.rooms || [];
}

async function deleteUserRoom(slug) {
  const u = getUserSession();
  if (!u) throw new Error('Not logged in');

  const res = await fetch(`${CONFIG.API_BASE}/rooms/${encodeURIComponent(slug)}?username=${encodeURIComponent(u.username)}&token=${encodeURIComponent(u.token)}`, {
    method: 'DELETE'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'Deletion failed');
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

async function fetchContacts() {
  const u = getUserSession();
  if (!u) throw new Error('Not logged in');

  const res = await fetch(`${CONFIG.API_BASE}/users/contacts?username=${encodeURIComponent(u.username)}&token=${encodeURIComponent(u.token)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load contacts');
  return data.contacts || [];
}

async function addContact(contactUsername) {
  const u = getUserSession();
  if (!u) throw new Error('Not logged in');

  const res = await fetch(`${CONFIG.API_BASE}/users/contacts?username=${encodeURIComponent(u.username)}&token=${encodeURIComponent(u.token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactUsername })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'Failed to add contact');
  return data.contacts || [];
}

async function deleteUserAccount(password) {
  const u = getUserSession();
  if (!u) throw new Error('Not logged in');

  const res = await fetch(`${CONFIG.API_BASE}/users/account`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u.username, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'Failed to delete account');
  clearUserSession();
  return data;
}

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
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'Failed to send dead drop');
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
  const data = await res.json().catch(() => ({}));
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

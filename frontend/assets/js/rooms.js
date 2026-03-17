'use strict';

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

  const res = await fetch(`${CONFIG.API_BASE}/rooms/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ slug, passwordHash, ownerTokenHash })
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

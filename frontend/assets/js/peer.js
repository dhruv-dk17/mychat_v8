'use strict';

// ── State ─────────────────────────────────────────────────────────
let peerInstance    = null;
let connectedPeers  = new Map();  // peerId → { conn, username, role }
let myRole          = 'guest';
let myUsername      = '';
let currentRoomId   = '';
let isRoomLocked    = false;
let currentRoomType = 'private';  // private | group | permanent

// ── Load PeerJS lazily ────────────────────────────────────────────
async function loadPeerJS() {
  if (window.Peer) return;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src     = 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.2/peerjs.min.js';
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── Init as Host ──────────────────────────────────────────────────
async function initAsHost(peerId, username, roomId) {
  await loadPeerJS();
  myRole = 'host';
  myUsername = username;
  currentRoomId = roomId;

  peerInstance = new Peer(peerId, CONFIG.PEERJS_CONFIG);
  peerInstance.on('open', id => {
    console.log('Host open:', id);
    updateConnectionUI('hosting');
  });
  peerInstance.on('connection', handleIncomingConnection);
  peerInstance.on('call',       handleIncomingCall);
  peerInstance.on('error',      handlePeerError);
}

// ── Init as Guest ─────────────────────────────────────────────────
async function initAsGuest(hostPeerIdStr, myPeerIdStr, username, roomId, passwordForPerm) {
  await loadPeerJS();
  myRole = 'guest';
  myUsername = username;
  currentRoomId = roomId;

  peerInstance = new Peer(myPeerIdStr, CONFIG.PEERJS_CONFIG);
  peerInstance.on('open', () => {
    const conn = peerInstance.connect(hostPeerIdStr, { reliable: true });
    // Send auth as first message when opened
    conn.on('open', async () => {
      const authMsg = { type: 'auth', username };
      if (passwordForPerm) authMsg.passwordHash = await sha256(passwordForPerm);
      conn.send(JSON.stringify(authMsg));
      setupConnection(conn);
    });
    conn.on('error', e => showToast('Connection error: ' + e.type, 'error'));
  });
  peerInstance.on('call',  handleIncomingCall);
  peerInstance.on('error', handlePeerError);
}

// ── Handle incoming connections (HOST side) ───────────────────────
function handleIncomingConnection(conn) {
  if (isRoomLocked) {
    conn.on('open', () => {
      conn.send(JSON.stringify({ type: 'room_locked' }));
      setTimeout(() => conn.close(), 1000);
    });
    return;
  }
  // Wait for first auth message
  conn.on('open', () => {
    conn.once('data', async (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type !== 'auth') { conn.close(); return; }

        // For permanent rooms — re-verify password at host side too
        if (currentRoomType === 'permanent' && msg.passwordHash) {
          try {
            const res  = await fetch(`${CONFIG.API_BASE}/rooms/verify-password`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ slug: currentRoomId, passwordHash: msg.passwordHash })
            });
            const data = await res.json();
            if (!data.valid) {
              conn.send(JSON.stringify({ type: 'auth_fail', reason: 'Invalid password' }));
              conn.close();
              return;
            }
          } catch (e) {
            conn.send(JSON.stringify({ type: 'auth_fail', reason: 'Server error' }));
            conn.close();
            return;
          }
        }

        // Group size limit
        if (currentRoomType === 'group' && connectedPeers.size >= CONFIG.MAX_GROUP_SIZE - 1) {
          conn.send(JSON.stringify({ type: 'auth_fail', reason: 'Room is full' }));
          conn.close();
          return;
        }

        // Auth success
        conn.send(JSON.stringify({ type: 'auth_ok' }));
        finalizeConnection(conn, msg.username);
      } catch (e) {
        conn.close();
      }
    });
  });
}

function finalizeConnection(conn, username) {
  connectedPeers.set(conn.peer, { conn, username, role: 'guest' });
  setupConnection(conn);
  broadcastUserList();
  broadcastSystemMessage(`${username} joined`);
  addUserToPanel(conn.peer, username, 'guest');
  updateOnlineCount();
}

// ── Setup data channel events ─────────────────────────────────────
function setupConnection(conn) {
  conn.on('data',  raw => {
    try { handleIncomingMessage(JSON.parse(raw), conn); }
    catch (e) { console.warn('Bad message', e); }
  });
  conn.on('close', () => handlePeerDisconnect(conn.peer));
  conn.on('error', () => handlePeerDisconnect(conn.peer));
}

// ── Route incoming messages ───────────────────────────────────────
function handleIncomingMessage(msg, conn) {
  switch (msg.type) {
    case 'msg':               receiveTextMessage(msg); break;
    case 'file_meta':         receiveFileMeta(msg); break;
    case 'file_chunk':        receiveFileChunk(msg); break;
    case 'voice_msg':         receiveVoiceMessage(msg); break;
    case 'clear_chat':        executeClearChat(msg.from); break;
    case 'typing':            showTypingIndicator(msg.from); break;
    case 'ping':              conn.send(JSON.stringify({ type: 'pong', ts: msg.ts })); break;
    case 'pong':              updatePeerPing(conn.peer, msg.ts); break;
    case 'reaction':          applyReaction(msg); break;
    case 'delete_msg':        deleteMessage(msg.messageId); break;
    case 'screenshot_attempt':onPeerScreenshotAttempt(msg.from); break;
    case 'devtools_detected': onPeerDevTools(msg.from); break;
    case 'kick':              if (msg.target === myUsername) executeKick(); break;
    case 'force_mute':        if (msg.target === myUsername) executeMute(); break;
    case 'promote':           if (msg.target === myUsername) becomeHost(); break;
    case 'room_locked':       showToast('Room is locked', 'warning'); navigateHome(); break;
    case 'room_end':          showRoomEndedModal(); break;
    case 'host_transfer':     if (msg.newHost === myUsername) becomeHost(); break;
    case 'user_list':         syncUserList(msg.users); break;
    case 'relay':             
      if (myRole === 'host') {
        relayToAll(msg.payload, conn);
        // Host also needs to see the message!
        if (msg.payload.type === 'msg') receiveTextMessage(msg.payload);
      }
      break;
    case 'auth_ok':           onAuthSuccess(); break;
    case 'auth_fail':         onAuthFail(msg.reason); break;
  }
}

// ── Relay (host relays guest→guest messages) ──────────────────────
function relayToAll(payload, senderConn) {
  const json = JSON.stringify(payload);
  connectedPeers.forEach(({ conn }) => {
    if (conn !== senderConn && conn.open) conn.send(json);
  });
}

// ── Broadcast / relay helpers ─────────────────────────────────────
function broadcastToPeers(message) {
  const json = JSON.stringify(message);
  connectedPeers.forEach(({ conn }) => { if (conn.open) conn.send(json); });
}

function broadcastOrRelay(msg) {
  if (myRole === 'host') {
    broadcastToPeers(msg);
  } else {
    const hostConn = [...connectedPeers.values()][0]?.conn;
    if (hostConn?.open) {
      hostConn.send(JSON.stringify({ type: 'relay', payload: msg }));
    }
  }
}

function broadcastUserList() {
  if (myRole !== 'host') return;
  const users = [...connectedPeers.entries()].map(([id, p]) => ({
    peerId: id, username: p.username, role: p.role
  }));
  users.push({ peerId: peerInstance.id, username: myUsername, role: 'host' });
  broadcastToPeers({ type: 'user_list', users });
}

function broadcastSystemMessage(text) {
  addSystemMessage(text);
  broadcastOrRelay({ type: 'msg', id: crypto.randomUUID(), from: 'system', text, ts: Date.now(), system: true });
}

// ── Peer disconnect ───────────────────────────────────────────────
function handlePeerDisconnect(peerId) {
  const p = connectedPeers.get(peerId);
  if (!p) return;
  connectedPeers.delete(peerId);
  removeUserFromPanel(peerId);
  addSystemMessage(`${p.username} left`);
  broadcastUserList();
  updateOnlineCount();
  if (p.role === 'host') considerHostTransfer();
}

// ── Host transfer ─────────────────────────────────────────────────
function considerHostTransfer() {
  if (myRole === 'host') return;
  const all = [...connectedPeers.keys(), peerInstance.id].sort();
  if (all[0] === peerInstance.id) becomeHost();
}

function becomeHost() {
  myRole = 'host';
  updateHostUI();
  addSystemMessage(`${myUsername} is now the host`);
  broadcastUserList();
}

// ── Host actions ──────────────────────────────────────────────────
function kickUser(peerId) {
  const p = connectedPeers.get(peerId);
  if (!p) return;
  p.conn.send(JSON.stringify({ type: 'kick', target: p.username }));
  setTimeout(() => {
    p.conn.close();
    handlePeerDisconnect(peerId);
  }, 500);
}

function muteUser(peerId) {
  const p = connectedPeers.get(peerId);
  if (p) p.conn.send(JSON.stringify({ type: 'force_mute', target: p.username }));
}

function promoteUser(peerId) {
  const p = connectedPeers.get(peerId);
  if (p) {
    p.role = 'host';
    p.conn.send(JSON.stringify({ type: 'promote', target: p.username }));
    myRole = 'guest';
    updateGuestUI();
    broadcastUserList();
  }
}

function lockRoom() {
  isRoomLocked = !isRoomLocked;
  showToast(isRoomLocked ? 'Room locked — no new connections' : 'Room unlocked', 'info');
}

function endRoom() {
  broadcastToPeers({ type: 'room_end' });
  setTimeout(() => { destroyPeer(); navigateHome(); }, 600);
}

// ── Ping manager ──────────────────────────────────────────────────
const _pingMap = new Map();

function updatePeerPing(peerId, sentTs) {
  _pingMap.set(peerId, Date.now() - sentTs);
  refreshUserPingDot(peerId, _pingMap.get(peerId));
}

setInterval(() => {
  const now = Date.now();
  connectedPeers.forEach(({ conn }) => {
    if (conn.open) conn.send(JSON.stringify({ type: 'ping', ts: now }));
  });
}, CONFIG.PING_INTERVAL_MS);

// ── Auth callbacks ────────────────────────────────────────────────
function onAuthSuccess() {
  updateConnectionUI('connected');
  // After auth_ok, host sends user list
}

function onAuthFail(reason) {
  showToast('Access denied: ' + (reason || 'Authentication failed'), 'error');
  setTimeout(navigateHome, 1500);
}

// ── Peer error handling ───────────────────────────────────────────
function handlePeerError(err) {
  console.error('PeerJS error:', err);
  if (err.type === 'peer-unavailable') {
    showToast('Host not found — is the room ID correct?', 'error');
    setTimeout(navigateHome, 2000);
  } else if (err.type === 'network') {
    showToast('Network error — check your connection', 'warning');
  } else {
    showToast('Connection error: ' + err.type, 'error');
  }
}

// ── Execute kicks / mutes ─────────────────────────────────────────
function executeKick() {
  showToast('You have been removed from this room', 'warning');
  setTimeout(() => { destroyPeer(); navigateHome(); }, 1500);
}

function executeMute() {
  if (typeof muteLocalAudio === 'function') muteLocalAudio();
  showToast('You have been muted by the host', 'warning');
}

// ── User list sync (guest side) ───────────────────────────────────
function syncUserList(users) {
  const panel = document.getElementById('user-list');
  if (!panel) return;
  panel.innerHTML = '';
  users.forEach(u => addUserToPanel(u.peerId, u.username, u.role));
  updateOnlineCount(users.length);
}

// ── Destroy peer cleanly ──────────────────────────────────────────
function destroyPeer() {
  try {
    broadcastToPeers({ type: 'user_left', username: myUsername });
  } catch (e) {}
  connectedPeers.forEach(({ conn }) => { try { conn.close(); } catch (e) {} });
  connectedPeers.clear();
  if (peerInstance) {
    try { peerInstance.destroy(); } catch (e) {}
    peerInstance = null;
  }
}

// ── Room end modal ────────────────────────────────────────────────
function showRoomEndedModal() {
  showToast('The host has ended this room', 'warning');
  setTimeout(() => { destroyPeer(); navigateHome(); }, 2000);
}

'use strict';

let _toastQueue = [];
let _toastRunning = false;
let _audioCtx = null;
let soundMuted = false;

function showToast(message, type = 'info') {
  _toastQueue.push({ message, type });
  if (!_toastRunning) _processToast();
}

function _processToast() {
  if (!_toastQueue.length) {
    _toastRunning = false;
    return;
  }
  _toastRunning = true;

  const { message, type } = _toastQueue.shift();
  const container = document.getElementById('toast-container');
  if (!container) {
    _toastRunning = false;
    return;
  }

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('toast-show'));
  });

  setTimeout(() => {
    el.classList.remove('toast-show');
    setTimeout(() => {
      el.remove();
      _processToast();
    }, 350);
  }, 3000);
}

function showModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('modal-visible');
}

function hideModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('modal-visible');
}

function showJoinRequestModal(username, onAccept, onReject) {
  const nameEl = document.getElementById('join-request-name');
  if (nameEl) nameEl.textContent = username;

  const acceptBtn = document.getElementById('accept-join-btn');
  const rejectBtn = document.getElementById('reject-join-btn');

  const finish = accepted => {
    hideModal('join-request-modal');
    if (accepted) onAccept();
    else onReject();
  };

  if (acceptBtn) acceptBtn.onclick = () => finish(true);
  if (rejectBtn) rejectBtn.onclick = () => finish(false);
  showModal('join-request-modal');
}

document.addEventListener('click', event => {
  if (event.target.classList.contains('modal-backdrop')) {
    event.target.classList.remove('modal-visible');
  }
});

function navigateHome() {
  const hasSession = typeof getUserSession === 'function' && !!getUserSession();
  window.location.href = hasSession ? 'chat.html' : 'index.html';
}

function navigateToChat(roomId, type, username, role, key, extraParams = {}) {
  const p = new URLSearchParams();
  if (roomId) p.set('roomId', roomId);
  if (type) p.set('type', type);
  if (username) p.set('username', username);
  if (role) p.set('role', role);

  if (extraParams && typeof extraParams === 'object') {
    Object.entries(extraParams).forEach(([paramKey, paramValue]) => {
      if (paramValue === undefined || paramValue === null || paramValue === '') return;
      p.set(paramKey, String(paramValue));
    });
  }

  let url = `chat.html?${p.toString()}`;
  if (key) url += `#${key}`;
  window.location.href = url;
}

function getChatParams() {
  const p = new URLSearchParams(window.location.search);
  const params = {
    roomId: p.get('roomId'),
    type: p.get('type'),
    username: p.get('username'),
    role: p.get('role'),
    peer: p.get('peer'),
    key: window.location.hash.slice(1)
  };

  p.forEach((value, key) => {
    if (params[key] !== undefined) return;
    params[key] = value;
  });
  return params;
}

async function copyToClipboard(text, btnEl) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied!', 'success');
    if (btnEl) {
      const originalText = btnEl.textContent;
      btnEl.textContent = 'Copied';
      btnEl.classList.add('copied');
      setTimeout(() => {
        btnEl.textContent = originalText;
        btnEl.classList.remove('copied');
      }, 2000);
    }
  } catch (error) {
    showToast('Copy failed. Select and copy manually.', 'error');
  }
}

function showWipeScreen() {
  document.getElementById('wipe-screen')?.classList.add('wipe-visible');
}

function showColdStartBanner() {
  document.getElementById('cold-start-banner')?.classList.add('banner-visible');
}

function hideColdStartBanner() {
  document.getElementById('cold-start-banner')?.classList.remove('banner-visible');
}

function initNetworkWatcher() {
  const banner = document.getElementById('network-banner');
  const update = () => {
    if (banner) banner.style.display = navigator.onLine ? 'none' : 'block';
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

async function initWithColdStartHandling() {
  const ready = await checkBackendHealth();
  if (!ready) await waitForBackend();
}

async function checkBackendHealth() {
  try {
    const res = await Promise.race([
      fetch(CONFIG.API_BASE + '/health'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CONFIG.HEALTH_TIMEOUT_MS))
    ]);
    return res.ok;
  } catch (error) {
    return false;
  }
}

async function waitForBackend() {
  while (true) {
    await new Promise(resolve => setTimeout(resolve, CONFIG.HEALTH_POLL_MS));
    try {
      const res = await fetch(CONFIG.API_BASE + '/health');
      if (res.ok) return;
    } catch (error) {
    }
  }
}

function getAudioContext() {
  if (!_audioCtx) {
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (error) {
    }
  }
  return _audioCtx;
}

function playMessageSound() {
  if (soundMuted || document.hasFocus()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.12);
  } catch (error) {
  }
}

function toggleSound(btnEl) {
  soundMuted = !soundMuted;
  if (btnEl) btnEl.textContent = soundMuted ? 'Mute' : 'Sound';
  showToast(soundMuted ? 'Sound muted' : 'Sound on', 'info');
}

function updateConnectionUI(state) {
  const statusEl = document.getElementById('connection-status');
  if (!statusEl) return;
  if (state === 'hosting') statusEl.textContent = 'Hosting';
  if (state === 'connected') statusEl.textContent = 'Connected';
}

function updateOnlineCount(n) {
  const el = document.getElementById('online-count');
  if (!el) return;
  const count = n !== undefined ? n : connectedPeers.size + 1;
  el.innerHTML = `<span class="dot dot-green"></span> ${count} online`;
}

function updateHostUI() {
  document.querySelectorAll('.host-only').forEach(el => {
    el.style.display = '';
  });
  document.getElementById('host-badge')?.style.setProperty('display', 'flex');
}

function updateGuestUI() {
  document.querySelectorAll('.host-only').forEach(el => {
    el.style.display = 'none';
  });
}

function updateMuteUI(muted) {
  const btn = document.getElementById('mute-btn');
  if (btn) btn.textContent = muted ? 'Muted' : 'Mute';
}

function addUserToPanel(peerId, username, role) {
  const list = document.getElementById('user-list');
  if (!list) return;

  document.getElementById('user-' + CSS.escape(peerId))?.remove();

  const row = document.createElement('div');
  row.className = 'user-row';
  row.id = 'user-' + peerId;

  const initials = username.slice(0, 2).toUpperCase();
  const isHost = role === 'host';

  row.innerHTML = `
    <div class="user-avatar">${initials}</div>
    <div class="user-info">
      <div class="user-name">${escHtml(username)}</div>
      <div class="user-role ${isHost ? 'host' : ''}">${isHost ? 'Host' : 'Member'}</div>
    </div>
    <div class="dot dot-green" id="ping-${CSS.escape(peerId)}"></div>
    ${myRole === 'host' && peerId !== peerInstance?.id
      ? `<button class="user-menu-btn" onclick="toggleUserMenu('${peerId}','${escHtml(username)}',this)">...</button>`
      : ''}
  `;
  list.appendChild(row);
}

function removeUserFromPanel(peerId) {
  document.getElementById('user-' + peerId)?.remove();
}

function toggleUserMenu(peerId, username, btnEl) {
  document.querySelectorAll('.user-menu-dropdown').forEach(dropdown => dropdown.remove());

  const menu = document.createElement('div');
  menu.className = 'user-menu-dropdown';
  menu.innerHTML = `
    <button onclick="muteUser('${peerId}')">Mute</button>
    <button onclick="kickUser('${peerId}')">Kick</button>
    <button onclick="promoteUser('${peerId}')">Promote to Host</button>
  `;

  btnEl.parentElement.style.position = 'relative';
  btnEl.parentElement.appendChild(menu);
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  }, 0);
}

function refreshUserPingDot(peerId, pingMs) {
  const dot = document.getElementById('ping-' + peerId);
  if (!dot) return;
  dot.className = 'dot ' + (pingMs < 150 ? 'dot-green' : pingMs < 400 ? 'dot-amber' : 'dot-red');
}

function showActiveCallUI() {
  document.getElementById('call-bar')?.classList.add('call-active');
}

function hideActiveCallUI() {
  document.getElementById('call-bar')?.classList.remove('call-active');
}

function showIncomingCallUI(callerPeerId, callback) {
  const nameEl = document.getElementById('caller-name');
  if (nameEl) {
    const peer = connectedPeers.get(callerPeerId);
    nameEl.textContent = peer ? peer.username : 'Unknown';
  }
  showModal('incoming-call-modal');

  document.getElementById('accept-call-btn')?.addEventListener('click', () => {
    hideModal('incoming-call-modal');
    callback(true);
  }, { once: true });

  document.getElementById('decline-call-btn')?.addEventListener('click', () => {
    hideModal('incoming-call-modal');
    callback(false);
  }, { once: true });
}

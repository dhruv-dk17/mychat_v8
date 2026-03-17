'use strict';

// ════════════════════════════════════════════
// APP ENTRY POINT
// ════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  initKeepAlive();
  initNetworkWatcher();

  const page = document.body.dataset.page;
  if (page === 'home') initHomePage();
  if (page === 'chat') initChatPage();
});

// ── Keep-alive (prevents Render free tier sleep) ──────────────────
function initKeepAlive() {
  fetch(CONFIG.API_BASE + '/health').catch(() => {});
  setInterval(() => fetch(CONFIG.API_BASE + '/health').catch(() => {}), CONFIG.KEEPALIVE_MS);
}

// ════════════════════════════════════════════
// HOME PAGE
// ════════════════════════════════════════════

async function initHomePage() {
  // Run cold-start check in background — don't block UI
  // Private/Group room buttons work without backend (P2P only)
  // Only Permanent room operations need the backend
  initWithColdStartHandling().catch(() => {});

  // Pre-fill join input from URL hash
  const hash = window.location.hash.slice(1);
  if (hash) {
    const el = document.getElementById('join-room-id');
    if (el) el.value = hash;
  }

  // ── Private Room ─────────────────────────────
  document.getElementById('create-private-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('create-private-btn');
    btn.disabled = true; btn.textContent = 'Creating...';
    const room = createTempRoom('private');
    const username = 'Host_' + randomToken(2);
    navigateToChat(room.id, 'private', username, 'host');
  });

  document.getElementById('join-private-btn')?.addEventListener('click', async () => {
    const id = document.getElementById('join-room-id')?.value.trim();
    if (!id || id.length < 4) {
      showToast('Enter a valid Room ID', 'warning'); return;
    }
    const username = document.getElementById('join-username')?.value.trim() || 'Guest_' + randomToken(2);
    navigateToChat(id, 'private', username, 'guest');
  });

  // ── Group Room ───────────────────────────────
  document.getElementById('create-group-btn')?.addEventListener('click', () => {
    const room = createTempRoom('group');
    const username = 'Host_' + randomToken(2);
    navigateToChat(room.id, 'group', username, 'host');
  });

  document.getElementById('join-group-btn')?.addEventListener('click', () => {
    const id   = document.getElementById('join-group-id')?.value.trim();
    const name = document.getElementById('join-group-username')?.value.trim();
    if (!id)   { showToast('Enter Room ID', 'warning'); return; }
    if (!name) { showToast('Enter a username', 'warning'); return; }
    navigateToChat(id, 'group', name, 'guest');
  });

  // ── Permanent Room — availability check ──────
  const slugInput = document.getElementById('perm-slug');
  if (slugInput) {
    slugInput.addEventListener('input', () => {
      slugInput.value = slugInput.value.toLowerCase().replace(/[^a-z0-9]/g, '');
    });
    let _availTimer;
    slugInput.addEventListener('input', () => {
      clearTimeout(_availTimer);
      const val = slugInput.value.trim();
      const ind = document.getElementById('slug-indicator');
      if (!ind) return;
      if (val.length < CONFIG.PERMANENT_ID_MIN) { ind.textContent = ''; ind.className = 'availability-indicator'; return; }
      ind.textContent = '● CHECKING...'; ind.className = 'availability-indicator indicator-amber';
      _availTimer = setTimeout(async () => {
        try {
          const ok = await checkRoomAvailability(val);
          ind.textContent = ok ? '● AVAILABLE' : '● TAKEN';
          ind.className   = 'availability-indicator ' + (ok ? 'indicator-green' : 'indicator-red');
        } catch (e) {
          ind.textContent = '● ERROR'; ind.className = 'availability-indicator indicator-red';
        }
      }, 500);
    });
  }

  // ── Password strength ─────────────────────────
  const permPw = document.getElementById('perm-password');
  if (permPw) {
    permPw.addEventListener('input', () => {
      const strength = getPasswordStrength(permPw.value);
      const fill = document.getElementById('pw-strength-fill');
      if (fill) {
        fill.className = 'pw-strength-fill';
        if (strength === 1) fill.classList.add('pw-strength-weak');
        if (strength === 2) fill.classList.add('pw-strength-medium');
        if (strength === 3) fill.classList.add('pw-strength-strong');
      }
    });
  }

  // ── Password show/hide ────────────────────────
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
    });
  });

  // ── Register permanent room ───────────────────
  document.getElementById('register-btn')?.addEventListener('click', async () => {
    const slug = document.getElementById('perm-slug')?.value.trim();
    const pw   = document.getElementById('perm-password')?.value;
    const btn  = document.getElementById('register-btn');
    const err  = document.getElementById('register-error');

    const showErr = msg => { if (err) { err.textContent = msg; err.classList.add('visible'); } };
    if (err) err.classList.remove('visible');

    if (!slug || slug.length < CONFIG.PERMANENT_ID_MIN) { showErr('Room ID must be 3-8 characters'); return; }
    if (!pw || pw.length < 4)                            { showErr('Password must be at least 4 characters'); return; }

    btn.disabled = true; btn.textContent = 'Registering...';
    try {
      const result = await registerPermanentRoom(slug, pw);
      showSuccessModal(result.slug, result.ownerToken);
    } catch (e) {
      showErr(e.message || 'Registration failed');
      btn.disabled = false; btn.textContent = '◎ Register & Host';
    }
  });

  // ── Join permanent room ───────────────────────
  document.getElementById('join-perm-btn')?.addEventListener('click', async () => {
    const slug = document.getElementById('join-perm-id')?.value.trim();
    const pw   = document.getElementById('join-perm-pw')?.value;
    const name = document.getElementById('join-perm-username')?.value.trim();
    const err  = document.getElementById('join-perm-error');
    const btn  = document.getElementById('join-perm-btn');

    const showErr = msg => { if (err) { err.textContent = msg; err.classList.add('visible'); } };
    if (err) err.classList.remove('visible');

    if (!slug) { showErr('Enter Room ID'); return; }
    if (!pw)   { showErr('Enter password'); return; }
    if (!name) { showErr('Enter a username'); return; }

    btn.disabled = true; btn.textContent = 'Verifying...';
    try {
      const valid = await verifyRoomPassword(slug, pw);
      if (!valid) { showErr('Incorrect password'); btn.disabled = false; btn.textContent = '→ Join Room'; return; }
      navigateToChat(slug, 'permanent', name, 'guest');
    } catch (e) {
      showErr('Verification failed — is the server awake?');
      btn.disabled = false; btn.textContent = '→ Join Room';
    }
  });

  // ── Success modal logic ───────────────────────
  function showSuccessModal(slug, ownerToken) {
    document.getElementById('success-slug').textContent   = slug;
    document.getElementById('success-token').textContent  = ownerToken;

    document.getElementById('copy-slug-btn')?.addEventListener('click', e =>
      copyToClipboard(slug, e.currentTarget));
    document.getElementById('copy-token-btn')?.addEventListener('click', e =>
      copyToClipboard(ownerToken, e.currentTarget));
    document.getElementById('enter-room-btn')?.addEventListener('click', () => {
      hideModal('success-modal');
      navigateToChat(slug, 'permanent', 'Host', 'host');
    }, { once: true });
    showModal('success-modal');
  }
}

// ════════════════════════════════════════════
// CHAT PAGE
// ════════════════════════════════════════════

async function initChatPage() {
  const params = getChatParams();
  if (!params.roomId || !params.username) { navigateHome(); return; }

  currentRoomType = params.type || 'private';
  const isPerm  = params.type === 'permanent';
  const isHost  = params.role === 'host';
  const hId     = hostPeerId(params.roomId, isPerm);
  const gId     = guestPeerId(params.roomId, isPerm);

  // Update top bar
  const ridEl = document.getElementById('room-id-display');
  if (ridEl) {
    ridEl.textContent = params.roomId;
    ridEl.addEventListener('click', () => copyToClipboard(params.roomId));
  }
  const badge = document.querySelector('.room-type-badge');
  if (badge) badge.textContent = (params.type || 'PRIVATE').toUpperCase();

  // Add self to user panel
  addUserToPanel('self', params.username, isHost ? 'host' : 'guest');
  updateOnlineCount(1);

  // Init peer
  if (isHost) {
    await initAsHost(hId, params.username, params.roomId);
    updateHostUI();
  } else {
    const pw = sessionStorage.getItem('joinPassword_' + params.roomId) || '';
    await initAsGuest(hId, gId, params.username, params.roomId, isPerm ? pw : null);
    updateGuestUI();
  }

  // Protect chat feed
  initChatProtection(document.getElementById('chat-feed'));

  // ── Input bar events ──────────────────────────
  const input = document.getElementById('msg-input');

  // Auto-resize textarea
  input?.addEventListener('input', () => {
    input.style.height = '44px';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
    sendTypingIndicator();
  });

  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const t = input.value.trim();
      if (t) { sendTextMessage(t); input.value = ''; input.style.height = '44px'; }
    }
  });

  document.getElementById('send-btn')?.addEventListener('click', () => {
    const t = input?.value.trim();
    if (t) { sendTextMessage(t); input.value = ''; input.style.height = '44px'; }
  });

  // File picker
  document.getElementById('file-input')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) { sendFile(file); e.target.value = ''; }
  });

  // Mic button
  const micBtn = document.getElementById('mic-btn');
  micBtn?.addEventListener('mousedown',  startVoiceRecording);
  micBtn?.addEventListener('touchstart', e => { e.preventDefault(); startVoiceRecording(); });
  micBtn?.addEventListener('mouseup',    stopVoiceRecording);
  micBtn?.addEventListener('touchend',   stopVoiceRecording);
  micBtn?.addEventListener('mouseleave', stopVoiceRecording);

  // Call button
  document.getElementById('call-btn')?.addEventListener('click', initiateCall);

  // Clear chat
  document.getElementById('clear-btn')?.addEventListener('click', broadcastClearChat);

  // Leave button
  document.getElementById('leave-btn')?.addEventListener('click', () => {
    destroyPeer();
    navigateHome();
  });

  // Back button
  document.getElementById('back-btn')?.addEventListener('click', () => {
    destroyPeer();
    navigateHome();
  });

  // User panel toggle
  document.getElementById('users-btn')?.addEventListener('click', () => {
    document.getElementById('user-panel')?.classList.toggle('panel-open');
  });
  document.getElementById('close-panel-btn')?.addEventListener('click', () => {
    document.getElementById('user-panel')?.classList.remove('panel-open');
  });

  // Search toggle
  let searchOpen = false;
  document.getElementById('search-btn')?.addEventListener('click', () => {
    searchOpen = !searchOpen;
    const sb = document.getElementById('search-bar');
    if (sb) {
      sb.classList.toggle('search-visible', searchOpen);
      if (searchOpen) document.getElementById('search-input')?.focus();
    }
  });
  document.getElementById('search-input')?.addEventListener('input', e => {
    searchMessages(e.target.value);
  });

  // Sound toggle
  document.getElementById('sound-btn')?.addEventListener('click', e => {
    toggleSound(e.currentTarget);
  });

  // Copy room ID icon in top bar
  document.getElementById('copy-room-btn')?.addEventListener('click', () => {
    copyToClipboard(params.roomId);
  });

  // Call bar: mute / end
  document.getElementById('mute-btn')?.addEventListener('click', toggleMicInCall);
  document.getElementById('end-call-btn')?.addEventListener('click', endCall);

  // Host-only: lock room, end room
  document.getElementById('lock-btn')?.addEventListener('click',     lockRoom);
  document.getElementById('end-room-btn')?.addEventListener('click', endRoom);

  // Timer modal options
  document.querySelectorAll('.timer-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const seconds = parseInt(btn.dataset.seconds);
      const modal   = document.getElementById('timer-modal');
      const msgId   = modal?.dataset.targetMsg;
      if (msgId && seconds) {
        setMessageTimer(msgId, seconds);
        broadcastOrRelay({ type: 'set_timer', messageId: msgId, seconds });
      }
      hideModal('timer-modal');
      showToast(`Message self-destructs in ${btn.textContent}`, 'info');
    });
  });

  // QR code button
  document.getElementById('qr-btn')?.addEventListener('click', () => {
    const url = window.location.origin + '/chat.html?roomId=' + params.roomId + '&type=' + params.type;
    const qr  = document.getElementById('qr-container');
    if (qr && window.QRCode) {
      qr.innerHTML = '';
      new QRCode(qr, { text: url, width: 180, height: 180, colorDark: '#6D28D9', colorLight: '#fff' });
    }
    showModal('qr-modal');
  });

  // Clean up on page hide
  window.addEventListener('beforeunload', () => { destroyPeer(); stopAllMediaStreams(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) activateBlurShield('Tab switched');
    else                 deactivateBlurShield();
  });

  // Initial shield — green
  setShieldIndicator('green');
}

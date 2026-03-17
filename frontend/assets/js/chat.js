'use strict';

let messages = [];

// ── Send text message ─────────────────────────────────────────────
function sendTextMessage(text) {
  if (!text || !text.trim()) return;
  const msg = {
    type: 'msg',
    id:   crypto.randomUUID(),
    from: myUsername,
    text: text.trim(),
    ts:   Date.now()
  };
  messages.push(msg);
  renderMessage(msg, true);
  broadcastOrRelay(msg);
}

// ── Receive text message ──────────────────────────────────────────
function receiveTextMessage(msg) {
  if (msg.system) { addSystemMessage(msg.text); return; }
  messages.push(msg);
  renderMessage(msg, false);
  playMessageSound();
}

// ── Render a message bubble ───────────────────────────────────────
function renderMessage(msg, isOwn) {
  const feed = document.getElementById('chat-feed');
  if (!feed) return;

  // Group consecutive messages from same sender
  const last = feed.lastElementChild;
  const showFrom = !isOwn && (!last || last.dataset.sender !== msg.from || last.classList.contains('msg-system'));

  const el = document.createElement('div');
  el.className   = 'msg ' + (isOwn ? 'msg-out' : 'msg-in');
  el.dataset.msgId  = msg.id;
  el.dataset.sender = msg.from;

  el.innerHTML = `
    ${showFrom ? `<span class="msg-from">${escHtml(msg.from)}</span>` : ''}
    <div class="msg-bubble">
      <p class="msg-text">${escHtml(msg.text)}</p>
    </div>
    <span class="msg-time">${fmtTime(msg.ts)}</span>
    <div class="msg-reactions" id="reactions-${msg.id}"></div>
  `;

  // Context menu
  el.addEventListener('contextmenu', e => { e.preventDefault(); showContextMenu(e, msg, isOwn); });
  el.addEventListener('touchstart',  e => {
    const t = setTimeout(() => showContextMenu(e.touches[0], msg, isOwn), 500);
    el.addEventListener('touchend', () => clearTimeout(t), { once: true });
  });

  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
}

// ── System message ────────────────────────────────────────────────
function addSystemMessage(text) {
  const feed = document.getElementById('chat-feed');
  if (!feed) return;
  const el = document.createElement('div');
  el.className = 'msg-system';
  el.textContent = text;
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
}

// ── Clear chat ────────────────────────────────────────────────────
function executeClearChat(clearedBy) {
  messages.forEach(m => { if (m.blobUrl) URL.revokeObjectURL(m.blobUrl); });
  messages = [];
  const feed = document.getElementById('chat-feed');
  if (feed) feed.innerHTML = '';
  addSystemMessage(`${clearedBy} cleared the chat`);
  destructTimers.forEach(t => clearTimeout(t));
  destructTimers.clear();
}

function broadcastClearChat() {
  executeClearChat(myUsername);
  broadcastOrRelay({ type: 'clear_chat', from: myUsername, ts: Date.now() });
}

// ── Delete message ────────────────────────────────────────────────
function deleteMessage(messageId) {
  const m = messages.find(x => x.id === messageId);
  if (m?.blobUrl) URL.revokeObjectURL(m.blobUrl);
  messages = messages.filter(x => x.id !== messageId);
  const el = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (el) el.remove();
  destructTimers.delete(messageId);
}

function sendDeleteMessage(messageId) {
  deleteMessage(messageId);
  broadcastOrRelay({ type: 'delete_msg', messageId });
}

// ── Typing indicator ──────────────────────────────────────────────
let _typingTimeout = null;
let _lastTypingSent = 0;

function sendTypingIndicator() {
  const now = Date.now();
  if (now - _lastTypingSent < CONFIG.TYPING_DEBOUNCE_MS) return;
  _lastTypingSent = now;
  broadcastOrRelay({ type: 'typing', from: myUsername });
}

let _typingClearTimer = null;
function showTypingIndicator(from) {
  const el = document.getElementById('typing-indicator');
  const nameEl = document.getElementById('typing-name');
  if (!el) return;
  if (nameEl) nameEl.textContent = from;
  el.classList.add('typing-visible');
  clearTimeout(_typingClearTimer);
  _typingClearTimer = setTimeout(() => el.classList.remove('typing-visible'), CONFIG.TYPING_CLEAR_MS);
}

// ── Reactions ─────────────────────────────────────────────────────
const myReactions = new Map(); // messageId → emoji

function sendReaction(messageId, emoji) {
  const existing = myReactions.get(messageId);
  const remove   = existing === emoji;
  if (remove) myReactions.delete(messageId);
  else        myReactions.set(messageId, emoji);

  const payload = { type: 'reaction', messageId, emoji, from: myUsername, remove };
  applyReaction(payload);
  broadcastOrRelay(payload);
}

function applyReaction(msg) {
  const container = document.getElementById(`reactions-${msg.messageId}`);
  if (!container) return;

  let pill = container.querySelector(`[data-emoji="${msg.emoji}"]`);
  if (!pill) {
    if (msg.remove) return;
    pill = document.createElement('button');
    pill.className = 'reaction-pill';
    pill.dataset.emoji = msg.emoji;
    pill.dataset.count = '0';
    pill.dataset.users = '';
    pill.addEventListener('click', () => sendReaction(msg.messageId, msg.emoji));
    container.appendChild(pill);
  }

  let users = pill.dataset.users ? pill.dataset.users.split(',').filter(Boolean) : [];
  if (msg.remove) {
    users = users.filter(u => u !== msg.from);
  } else if (!users.includes(msg.from)) {
    users.push(msg.from);
  }

  if (users.length === 0) { pill.remove(); return; }

  pill.dataset.users = users.join(',');
  pill.dataset.count = String(users.length);
  pill.textContent   = `${msg.emoji} ${users.length}`;
  pill.title         = users.join(', ');

  const isMe = msg.from === myUsername && !msg.remove;
  pill.classList.toggle('reacted-by-me', isMe || users.includes(myUsername));
}

// ── Context menu ──────────────────────────────────────────────────
let _activeCtxMenu = null;

function showContextMenu(e, msg, isOwn) {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'msg-context-menu';

  const emojis = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
  const emojiRow = document.createElement('div');
  emojiRow.className = 'ctx-emoji-row';
  emojis.forEach(em => {
    const btn = document.createElement('span');
    btn.className = 'ctx-emoji';
    btn.textContent = em;
    btn.addEventListener('click', () => { sendReaction(msg.id, em); closeContextMenu(); });
    emojiRow.appendChild(btn);
  });
  menu.appendChild(emojiRow);

  const actions = [
    { label: '📋 Copy Text', action: () => navigator.clipboard?.writeText(msg.text) },
    { label: '⏱ Set Timer', action: () => { closeContextMenu(); showTimerModal(msg.id); } },
  ];
  if (isOwn) {
    actions.push({ label: '🗑 Delete', action: () => { sendDeleteMessage(msg.id); }, danger: true });
  }

  actions.forEach(({ label, action, danger }) => {
    const btn = document.createElement('button');
    btn.className = 'ctx-item' + (danger ? ' ctx-danger' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => { action(); closeContextMenu(); });
    menu.appendChild(btn);
  });

  const x = Math.min(e.clientX || e.pageX, window.innerWidth  - 180);
  const y = Math.min(e.clientY || e.pageY, window.innerHeight - 180);
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  document.body.appendChild(menu);
  _activeCtxMenu = menu;

  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
}

function closeContextMenu() {
  if (_activeCtxMenu) { _activeCtxMenu.remove(); _activeCtxMenu = null; }
}

// ── Message search ────────────────────────────────────────────────
function searchMessages(query) {
  const feed = document.getElementById('chat-feed');
  if (!feed) return;

  // Remove existing highlights
  feed.querySelectorAll('.search-highlight').forEach(h => {
    const parent = h.parentNode;
    parent.replaceChild(document.createTextNode(h.textContent), h);
    parent.normalize();
  });

  if (!query) return;
  const q = query.toLowerCase();

  feed.querySelectorAll('.msg-text').forEach(el => {
    const text = el.textContent;
    if (text.toLowerCase().includes(q)) {
      const html = escHtml(text).replace(
        new RegExp(escHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        m => `<mark class="search-highlight">${m}</mark>`
      );
      el.innerHTML = html;
      el.closest('.msg')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

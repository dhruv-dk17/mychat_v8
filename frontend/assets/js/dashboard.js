'use strict';

const DASHBOARD_VIEW = {
  CHATS: 'chats',
  CONTACTS: 'contacts',
  SETTINGS: 'settings'
};

let currentDashboardView = DASHBOARD_VIEW.CHATS;
let dashboardRooms = [];
let acceptedContacts = [];
let incomingContactRequests = [];
let outgoingContactRequests = [];
let sidebarSearchTerm = '';

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'chat') return;

  const session = getUserSession();
  if (!session) {
    window.location.href = 'index.html';
    return;
  }

  hydrateDashboardChrome(session);
  bindDashboardEvents();
  syncChatShell();
  await refreshDashboardData();
  setDashboardView(DASHBOARD_VIEW.CHATS);
});

function hydrateDashboardChrome(session) {
  const navAvatar = document.getElementById('nav-avatar');
  if (navAvatar) navAvatar.textContent = session.username.substring(0, 2).toUpperCase();
  updateDashboardHero(session);
}

function bindDashboardEvents() {
  document.getElementById('nav-logout-btn')?.addEventListener('click', logoutToHome);

  bindDashboardViewButton('nav-chats-btn', DASHBOARD_VIEW.CHATS);
  bindDashboardViewButton('nav-contacts-btn', DASHBOARD_VIEW.CONTACTS);
  bindDashboardViewButton('nav-settings-btn', DASHBOARD_VIEW.SETTINGS);
  bindDashboardViewButton('mobile-nav-chats-btn', DASHBOARD_VIEW.CHATS);
  bindDashboardViewButton('mobile-nav-contacts-btn', DASHBOARD_VIEW.CONTACTS);
  bindDashboardViewButton('mobile-nav-settings-btn', DASHBOARD_VIEW.SETTINGS);

  const searchInput = document.getElementById('sidebar-search');
  searchInput?.addEventListener('input', event => {
    sidebarSearchTerm = event.target.value.trim().toLowerCase();
    renderSidebar();
  });

  const slugInput = document.getElementById('new-room-slug');
  slugInput?.addEventListener('input', () => {
    slugInput.value = slugInput.value.toLowerCase().replace(/[^a-z0-9]/g, '');
  });

  const contactInput = document.getElementById('new-contact-username');
  contactInput?.addEventListener('input', () => {
    contactInput.value = contactInput.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
  });

  document.getElementById('sidebar-new-chat')?.addEventListener('click', openComposerModal);
  document.getElementById('dashboard-quick-room')?.addEventListener('click', () => {
    setDashboardView(DASHBOARD_VIEW.CHATS);
    openComposerModal();
  });
  document.getElementById('dashboard-quick-contact')?.addEventListener('click', () => {
    setDashboardView(DASHBOARD_VIEW.CONTACTS);
    openComposerModal();
  });

  document.getElementById('btn-new-group')?.addEventListener('click', createGroupRoomFromModal);
  document.getElementById('btn-create-perm-room')?.addEventListener('click', createPermanentRoomFromModal);
  document.getElementById('btn-join-perm-room')?.addEventListener('click', joinPermanentRoomFromModal);
  document.getElementById('btn-add-contact')?.addEventListener('click', sendContactRequestFromModal);
}

function bindDashboardViewButton(id, view) {
  document.getElementById(id)?.addEventListener('click', () => setDashboardView(view));
}

function openComposerModal() {
  showModal('new-chat-modal');
  const focusTarget = currentDashboardView === DASHBOARD_VIEW.CONTACTS
    ? document.getElementById('new-contact-username')
    : document.getElementById('new-room-slug');
  focusTarget?.focus();
}

function syncChatShell() {
  const chatPlaceholder = document.getElementById('chat-placeholder');
  const chatActiveView = document.getElementById('chat-active-view');
  const chatWindowCol = document.querySelector('.chat-window-column');
  const params = getChatParams();
  const isRoomActive = Boolean(params.roomId && params.username);

  if (chatPlaceholder) chatPlaceholder.style.display = isRoomActive ? 'none' : 'flex';
  if (chatActiveView) chatActiveView.style.display = isRoomActive ? 'flex' : 'none';
  if (chatWindowCol) chatWindowCol.classList.toggle('active', isRoomActive);
}

async function refreshDashboardData() {
  const [roomsResult, contactsResult] = await Promise.allSettled([
    fetchUserRooms(),
    fetchContactState()
  ]);

  dashboardRooms = roomsResult.status === 'fulfilled'
    ? normalizeRoomList(roomsResult.value)
    : [];

  if (contactsResult.status === 'fulfilled') {
    const contactState = contactsResult.value || {};
    acceptedContacts = normalizeUsernameList(contactState.contacts);
    incomingContactRequests = normalizeUsernameList(contactState.incomingRequests);
    outgoingContactRequests = normalizeUsernameList(contactState.outgoingRequests);
  } else {
    acceptedContacts = [];
    incomingContactRequests = [];
    outgoingContactRequests = [];
  }

  if (roomsResult.status === 'rejected') {
    console.warn('Failed to load rooms', roomsResult.reason);
  }
  if (contactsResult.status === 'rejected') {
    console.warn('Failed to load contacts', contactsResult.reason);
  }

  updateDashboardHero(getUserSession());
}

function normalizeRoomList(rooms) {
  if (!Array.isArray(rooms)) return [];
  return rooms
    .filter(room => room && typeof room.slug === 'string')
    .map(room => ({ ...room, slug: room.slug.toLowerCase() }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

function normalizeUsernameList(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
}

function updateDashboardHero(session) {
  const titleEl = document.getElementById('dashboard-hero-title');
  const textEl = document.getElementById('dashboard-hero-text');
  const roomBadge = document.getElementById('dashboard-room-count-badge');
  const contactBadge = document.getElementById('dashboard-contact-count-badge');

  if (titleEl) titleEl.textContent = session ? `Welcome, ${session.username}` : 'Welcome';

  if (textEl) {
    if (currentDashboardView === DASHBOARD_VIEW.CONTACTS) {
      textEl.textContent = 'Send contact requests by username. Once accepted, direct chat opens instantly.';
    } else if (currentDashboardView === DASHBOARD_VIEW.SETTINGS) {
      textEl.textContent = 'Manage your account and room behavior from one place.';
    } else {
      textEl.textContent = 'Direct messages work like WhatsApp. Groups and permanent rooms stay available.';
    }
  }

  if (roomBadge) roomBadge.textContent = `${dashboardRooms.length} permanent room${dashboardRooms.length === 1 ? '' : 's'}`;
  if (contactBadge) contactBadge.textContent = `${acceptedContacts.length} contact${acceptedContacts.length === 1 ? '' : 's'}`;
}

function setDashboardView(view) {
  currentDashboardView = view;
  updateDashboardNav();
  updateSidebarChrome();
  updateDashboardHero(getUserSession());
  renderSidebar();
}

function updateDashboardNav() {
  document.getElementById('nav-chats-btn')?.classList.toggle('active', currentDashboardView === DASHBOARD_VIEW.CHATS);
  document.getElementById('nav-contacts-btn')?.classList.toggle('active', currentDashboardView === DASHBOARD_VIEW.CONTACTS);
  document.getElementById('nav-settings-btn')?.classList.toggle('active', currentDashboardView === DASHBOARD_VIEW.SETTINGS);
  document.getElementById('mobile-nav-chats-btn')?.classList.toggle('active', currentDashboardView === DASHBOARD_VIEW.CHATS);
  document.getElementById('mobile-nav-contacts-btn')?.classList.toggle('active', currentDashboardView === DASHBOARD_VIEW.CONTACTS);
  document.getElementById('mobile-nav-settings-btn')?.classList.toggle('active', currentDashboardView === DASHBOARD_VIEW.SETTINGS);
}

function updateSidebarChrome() {
  const titleEl = document.getElementById('sidebar-section-title');
  const searchBox = document.querySelector('.search-box');
  const searchInput = document.getElementById('sidebar-search');
  const newBtn = document.getElementById('sidebar-new-chat');

  if (titleEl) {
    titleEl.textContent = currentDashboardView === DASHBOARD_VIEW.CHATS
      ? 'Chats'
      : currentDashboardView === DASHBOARD_VIEW.CONTACTS
        ? 'Contacts'
        : 'Settings';
  }

  if (searchBox) searchBox.style.display = currentDashboardView === DASHBOARD_VIEW.SETTINGS ? 'none' : 'flex';

  if (searchInput) {
    searchInput.placeholder = currentDashboardView === DASHBOARD_VIEW.CONTACTS
      ? 'Search contacts and requests...'
      : 'Search chats...';
  }

  if (newBtn) {
    newBtn.style.display = currentDashboardView === DASHBOARD_VIEW.SETTINGS ? 'none' : 'block';
    newBtn.textContent = currentDashboardView === DASHBOARD_VIEW.CONTACTS ? '+ Add Username' : '+ New Chat';
  }
}

function renderSidebar() {
  const container = document.getElementById('sidebar-chat-list');
  if (!container) return;

  container.innerHTML = '';

  if (currentDashboardView === DASHBOARD_VIEW.SETTINGS) {
    renderSettingsView(container);
    return;
  }

  if (currentDashboardView === DASHBOARD_VIEW.CONTACTS) {
    renderContactsView(container);
    return;
  }

  renderChatsView(container);
}

function renderChatsView(container) {
  const session = getUserSession();
  const params = getChatParams();
  if (!session) return;

  const filteredContacts = acceptedContacts.filter(contact => contact.includes(sidebarSearchTerm));
  const filteredRooms = dashboardRooms.filter(room => room.slug.includes(sidebarSearchTerm));

  const groupQuick = document.createElement('div');
  groupQuick.className = 'sidebar-card';
  groupQuick.innerHTML = `
    <div class="sidebar-label">Quick Actions</div>
    <div class="sidebar-note">Start a new group, open a permanent room, or continue direct messages.</div>
    <button class="btn btn-ghost w-100" id="sidebar-start-group-btn">Start Group Chat</button>
  `;
  container.appendChild(groupQuick);
  document.getElementById('sidebar-start-group-btn')?.addEventListener('click', createGroupRoomFromSidebar);

  if (!filteredContacts.length && !filteredRooms.length) {
    renderEmptyState(container, sidebarSearchTerm
      ? `No chats match "${sidebarSearchTerm}".`
      : 'No chats yet. Add a contact request or create a room.');
    return;
  }

  if (filteredContacts.length) {
    container.appendChild(createSidebarHeading('Direct Messages'));
    filteredContacts.forEach(contact => {
      const dmRoomId = buildDirectMessageRoomId(session.username, contact);
      const isActive = params.type === 'direct'
        ? (params.peer === contact || params.roomId === dmRoomId)
        : false;
      const item = createSidebarItem({
        title: contact,
        desc: 'Secure direct chat',
        avatar: contact.substring(0, 2).toUpperCase(),
        active: isActive
      });
      item.addEventListener('click', () => openDirectConversation(contact));
      container.appendChild(item);
    });
  }

  if (filteredRooms.length) {
    container.appendChild(createSidebarHeading('Permanent Rooms'));
    filteredRooms.forEach(room => {
      const item = createSidebarItem({
        title: room.slug,
        desc: 'Password-protected room',
        avatar: 'PR',
        active: params.type === 'permanent' && params.roomId === room.slug,
        avatarStyle: 'background:rgba(34,197,94,0.2);color:#8ef6b3;'
      });
      item.addEventListener('click', () => openOwnedPermanentRoom(room.slug));
      container.appendChild(item);
    });
  }
}

function renderContactsView(container) {
  const filteredContacts = acceptedContacts.filter(contact => contact.includes(sidebarSearchTerm));
  const filteredIncoming = incomingContactRequests.filter(contact => contact.includes(sidebarSearchTerm));
  const filteredOutgoing = outgoingContactRequests.filter(contact => contact.includes(sidebarSearchTerm));

  const summary = document.createElement('div');
  summary.className = 'sidebar-card';
  summary.innerHTML = `
    <div class="sidebar-label">Contact Requests</div>
    <div class="sidebar-meta">
      <span class="sidebar-badge">${incomingContactRequests.length} incoming</span>
      <span class="sidebar-badge">${outgoingContactRequests.length} outgoing</span>
    </div>
    <div class="sidebar-note">Direct chat unlocks only after acceptance.</div>
  `;
  container.appendChild(summary);

  if (!filteredContacts.length && !filteredIncoming.length && !filteredOutgoing.length) {
    renderEmptyState(container, sidebarSearchTerm
      ? `No contacts match "${sidebarSearchTerm}".`
      : 'No contacts yet. Send a username request to start.');
    return;
  }

  if (filteredIncoming.length) {
    container.appendChild(createSidebarHeading('Incoming Requests'));
    filteredIncoming.forEach(username => {
      const requestItem = createRequestItem(username, 'incoming');
      container.appendChild(requestItem);
    });
  }

  if (filteredOutgoing.length) {
    container.appendChild(createSidebarHeading('Sent Requests'));
    filteredOutgoing.forEach(username => {
      const requestItem = createRequestItem(username, 'outgoing');
      container.appendChild(requestItem);
    });
  }

  if (filteredContacts.length) {
    container.appendChild(createSidebarHeading('Accepted Contacts'));
    filteredContacts.forEach(contact => {
      const item = createSidebarItem({
        title: contact,
        desc: 'Tap to open direct chat',
        avatar: contact.substring(0, 2).toUpperCase()
      });
      item.addEventListener('click', () => openDirectConversation(contact));
      container.appendChild(item);
    });
  }
}

function renderSettingsView(container) {
  const session = getUserSession();
  if (!session) return;

  container.innerHTML = `
    <div class="sidebar-stack">
      <div class="sidebar-card">
        <div class="sidebar-label">Signed In As</div>
        <div class="chat-list-item-title">${escHtml(session.username)}</div>
        <div class="sidebar-meta">
          <span class="sidebar-badge">${acceptedContacts.length} contacts</span>
          <span class="sidebar-badge">${dashboardRooms.length} rooms</span>
        </div>
      </div>
      <div class="sidebar-card">
        <div class="sidebar-label">Architecture</div>
        <div class="sidebar-note">Direct chats, group sessions, and permanent rooms use peer-to-peer encrypted transport.</div>
      </div>
      <div class="sidebar-actions">
        <button class="btn btn-ghost w-100" id="settings-logout-inline">Log Out</button>
        <button class="btn btn-danger-ghost w-100" id="settings-delete-inline">Delete Account</button>
      </div>
    </div>
  `;

  document.getElementById('settings-logout-inline')?.addEventListener('click', logoutToHome);
  document.getElementById('settings-delete-inline')?.addEventListener('click', deleteAccountFromSettings);
}

function createSidebarHeading(text) {
  const heading = document.createElement('div');
  heading.className = 'sidebar-label';
  heading.style.padding = '0.3rem 0.55rem 0';
  heading.textContent = text;
  return heading;
}

function createSidebarItem({ title, desc, avatar, active = false, avatarStyle = '' }) {
  const item = document.createElement('div');
  item.className = `chat-list-item${active ? ' active' : ''}`;

  const avatarEl = document.createElement('div');
  avatarEl.className = 'chat-list-item-avatar';
  avatarEl.textContent = avatar;
  avatarEl.style.cssText = avatarStyle;

  const info = document.createElement('div');
  info.className = 'chat-list-item-info';

  const titleEl = document.createElement('div');
  titleEl.className = 'chat-list-item-title';
  titleEl.textContent = title;

  const descEl = document.createElement('div');
  descEl.className = 'chat-list-item-desc';
  descEl.textContent = desc;

  info.appendChild(titleEl);
  info.appendChild(descEl);
  item.appendChild(avatarEl);
  item.appendChild(info);
  return item;
}

function createRequestItem(username, type) {
  const wrapper = document.createElement('div');
  wrapper.className = 'sidebar-card';

  if (type === 'incoming') {
    wrapper.innerHTML = `
      <div class="chat-list-item-title">${escHtml(username)}</div>
      <div class="sidebar-note">wants to connect with you</div>
      <div class="sidebar-actions-row">
        <button class="btn btn-primary w-100">Accept</button>
        <button class="btn btn-ghost w-100">Reject</button>
      </div>
    `;
    const [acceptBtn, rejectBtn] = wrapper.querySelectorAll('button');
    acceptBtn?.addEventListener('click', () => respondToRequest(username, 'accept'));
    rejectBtn?.addEventListener('click', () => respondToRequest(username, 'reject'));
  } else {
    wrapper.innerHTML = `
      <div class="chat-list-item-title">${escHtml(username)}</div>
      <div class="sidebar-note">request pending</div>
      <span class="sidebar-status-pill">Pending</span>
    `;
  }

  return wrapper;
}

function renderEmptyState(container, message) {
  const empty = document.createElement('div');
  empty.className = 'sidebar-empty';
  empty.innerHTML = `
    <div class="sidebar-empty-mark">+</div>
    <div>${escHtml(message)}</div>
  `;
  container.appendChild(empty);
}

function buildDirectMessageRoomId(userA, userB) {
  const normalized = [userA, userB].map(value => value.toLowerCase()).sort().join(':');
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let hash = 5381;

  for (const char of normalized) {
    hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  }

  let value = hash || normalized.length;
  let roomId = '';
  for (let index = 0; index < 8; index++) {
    const salt = normalized.charCodeAt(index % normalized.length);
    value = ((value ^ salt) * 2654435761) >>> 0;
    roomId += alphabet[value % alphabet.length];
  }

  return roomId;
}

function resolveDirectMessageRole(selfUsername, otherUsername) {
  const [hostUsername] = [selfUsername, otherUsername].map(value => value.toLowerCase()).sort();
  return selfUsername.toLowerCase() === hostUsername ? 'host' : 'guest';
}

async function openDirectConversation(contactUsername) {
  if (!acceptedContacts.includes(contactUsername.toLowerCase())) {
    showToast('Contact must accept first', 'warning');
    return;
  }

  const session = getUserSession();
  if (!session) return;

  const roomId = buildDirectMessageRoomId(session.username, contactUsername);
  const role = resolveDirectMessageRole(session.username, contactUsername);
  navigateToChat(roomId, 'direct', session.username, role, null, { peer: contactUsername });
}

function createGroupRoomFromSidebar() {
  const session = getUserSession();
  if (!session) return;
  const room = createTempRoom('group');
  navigateToChat(room.id, 'group', session.username, 'host');
}

function createGroupRoomFromModal() {
  hideModal('new-chat-modal');
  createGroupRoomFromSidebar();
}

async function createPermanentRoomFromModal() {
  const session = getUserSession();
  if (!session) return;

  const slugInput = document.getElementById('new-room-slug');
  const passwordInput = document.getElementById('new-room-password');
  const slug = slugInput?.value.trim().toLowerCase();
  const password = passwordInput?.value || '';

  if (!slug || slug.length < CONFIG.PERMANENT_ID_MIN || slug.length > CONFIG.PERMANENT_ID_MAX) {
    showToast('Enter a valid room ID (3-8 chars)', 'warning');
    return;
  }
  if (!password || password.length < 4) {
    showToast('Room password must be at least 4 characters', 'warning');
    return;
  }

  try {
    await registerPermanentRoom(slug, password);
    sessionStorage.setItem(`joinPassword_${slug}`, password);
    hideModal('new-chat-modal');
    if (slugInput) slugInput.value = '';
    if (passwordInput) passwordInput.value = '';
    await refreshDashboardData();
    setDashboardView(DASHBOARD_VIEW.CHATS);
    navigateToChat(slug, 'permanent', session.username, 'host');
  } catch (error) {
    showToast(error.message || 'Could not create room', 'error');
  }
}

async function joinPermanentRoomFromModal() {
  const session = getUserSession();
  if (!session) return;

  const slugInput = document.getElementById('new-room-slug');
  const passwordInput = document.getElementById('new-room-password');
  const slug = slugInput?.value.trim().toLowerCase();
  const password = passwordInput?.value || '';

  if (!slug) {
    showToast('Enter room ID', 'warning');
    return;
  }
  if (!password) {
    showToast('Enter room password', 'warning');
    return;
  }

  try {
    const valid = await verifyRoomPassword(slug, password);
    if (!valid) {
      showToast('Incorrect room password', 'error');
      return;
    }

    sessionStorage.setItem(`joinPassword_${slug}`, password);
    hideModal('new-chat-modal');
    if (slugInput) slugInput.value = '';
    if (passwordInput) passwordInput.value = '';

    const role = await resolvePermanentRoomRole(slug, 'guest');
    navigateToChat(slug, 'permanent', session.username, role);
  } catch (error) {
    showToast(error.message || 'Could not join room', 'error');
  }
}

async function openOwnedPermanentRoom(slug) {
  const session = getUserSession();
  if (!session) return;

  let password = sessionStorage.getItem(`joinPassword_${slug}`) || '';
  if (!password) password = prompt(`Enter password for ${slug}`) || '';
  if (!password) return;

  try {
    const valid = await verifyRoomPassword(slug, password);
    if (!valid) {
      sessionStorage.removeItem(`joinPassword_${slug}`);
      showToast('Incorrect password', 'error');
      return;
    }
    sessionStorage.setItem(`joinPassword_${slug}`, password);
    const role = await resolvePermanentRoomRole(slug, 'guest');
    navigateToChat(slug, 'permanent', session.username, role);
  } catch (error) {
    showToast(error.message || 'Could not join room', 'error');
  }
}

async function sendContactRequestFromModal() {
  const input = document.getElementById('new-contact-username');
  const session = getUserSession();
  if (!input || !session) return;

  const username = input.value.trim().toLowerCase();
  if (!username) {
    showToast('Enter a username', 'warning');
    return;
  }
  if (username === session.username.toLowerCase()) {
    showToast('You cannot add yourself', 'warning');
    return;
  }

  try {
    const result = await sendContactRequest(username);
    input.value = '';
    hideModal('new-chat-modal');
    await refreshDashboardData();
    setDashboardView(DASHBOARD_VIEW.CONTACTS);

    if (result.status === 'accepted') {
      showToast(`@${username} is now in your contacts`, 'success');
      return;
    }
    if (result.status === 'already_contact') {
      showToast(`@${username} is already in contacts`, 'info');
      return;
    }
    showToast(`Request sent to @${username}`, 'success');
  } catch (error) {
    showToast(error.message || 'Failed to send request', 'error');
  }
}

async function respondToRequest(fromUsername, action) {
  try {
    await respondContactRequest(fromUsername, action);
    await refreshDashboardData();
    setDashboardView(DASHBOARD_VIEW.CONTACTS);
    if (action === 'accept') {
      showToast(`Accepted @${fromUsername}`, 'success');
    } else {
      showToast(`Rejected @${fromUsername}`, 'info');
    }
  } catch (error) {
    showToast(error.message || 'Failed to update request', 'error');
  }
}

async function deleteAccountFromSettings() {
  if (!confirm('Delete your account and all owned permanent rooms? This cannot be undone.')) return;
  const password = prompt('Enter your account password to confirm:');
  if (!password) return;

  try {
    await deleteUserAccount(password);
    showToast('Account deleted', 'success');
    window.location.href = 'index.html';
  } catch (error) {
    showToast(error.message || 'Failed to delete account', 'error');
  }
}

function logoutToHome() {
  clearUserSession();
  window.location.href = 'index.html';
}

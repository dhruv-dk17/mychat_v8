'use strict';

const DASHBOARD_VIEW = {
  CHATS: 'chats',
  CONTACTS: 'contacts',
  SETTINGS: 'settings'
};

let currentDashboardView = DASHBOARD_VIEW.CHATS;
let dashboardRooms = [];
let dashboardContacts = [];
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
  if (navAvatar) {
    navAvatar.textContent = session.username.substring(0, 2).toUpperCase();
  }
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
  searchInput?.addEventListener('input', e => {
    sidebarSearchTerm = e.target.value.trim().toLowerCase();
    renderSidebar();
  });

  const slugInput = document.getElementById('new-room-slug');
  slugInput?.addEventListener('input', () => {
    slugInput.value = slugInput.value.toLowerCase().replace(/[^a-z0-9]/g, '');
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

  document.getElementById('btn-new-private')?.addEventListener('click', () => {
    const session = getUserSession();
    if (!session) return;
    const room = createTempRoom('private');
    navigateToChat(room.id, 'private', session.username, 'host');
  });

  document.getElementById('btn-new-group')?.addEventListener('click', () => {
    const session = getUserSession();
    if (!session) return;
    const room = createTempRoom('group');
    navigateToChat(room.id, 'group', session.username, 'host');
  });

  document.getElementById('btn-create-perm-room')?.addEventListener('click', createPermanentRoomFromModal);
  document.getElementById('btn-join-perm-room')?.addEventListener('click', joinPermanentRoomFromModal);
  document.getElementById('btn-add-contact')?.addEventListener('click', addContactFromModal);
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
    fetchContacts()
  ]);

  dashboardRooms = roomsResult.status === 'fulfilled'
    ? normalizeDashboardRooms(roomsResult.value)
    : [];
  dashboardContacts = contactsResult.status === 'fulfilled'
    ? normalizeDashboardContacts(contactsResult.value)
    : [];

  if (roomsResult.status === 'rejected') {
    console.warn('Failed to load rooms', roomsResult.reason);
  }
  if (contactsResult.status === 'rejected') {
    console.warn('Failed to load contacts', contactsResult.reason);
  }
  updateDashboardHero(getUserSession());
}

function normalizeDashboardRooms(rooms) {
  return Array.isArray(rooms)
    ? rooms
        .filter(room => room && typeof room.slug === 'string')
        .map(room => ({ ...room, slug: room.slug.toLowerCase() }))
        .sort((left, right) => left.slug.localeCompare(right.slug))
    : [];
}

function normalizeDashboardContacts(contacts) {
  return Array.from(new Set(
    (Array.isArray(contacts) ? contacts : [])
      .map(contact => String(contact || '').trim().toLowerCase())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
}

function updateDashboardHero(session) {
  const titleEl = document.getElementById('dashboard-hero-title');
  const textEl = document.getElementById('dashboard-hero-text');
  const roomBadge = document.getElementById('dashboard-room-count-badge');
  const contactBadge = document.getElementById('dashboard-contact-count-badge');

  if (titleEl) {
    titleEl.textContent = session ? `Welcome, ${session.username}` : 'Welcome back';
  }
  if (textEl) {
    textEl.textContent = currentDashboardView === DASHBOARD_VIEW.CONTACTS
      ? 'Keep your contact list tidy so direct rooms are one tap away.'
      : currentDashboardView === DASHBOARD_VIEW.SETTINGS
        ? 'Manage your account and understand how rooms behave before you jump back in.'
        : 'Open a room, add a contact, or jump back into a conversation.';
  }
  if (roomBadge) {
    roomBadge.textContent = `${dashboardRooms.length} room${dashboardRooms.length === 1 ? '' : 's'}`;
  }
  if (contactBadge) {
    contactBadge.textContent = `${dashboardContacts.length} contact${dashboardContacts.length === 1 ? '' : 's'}`;
  }
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

  if (searchBox) {
    searchBox.style.display = currentDashboardView === DASHBOARD_VIEW.SETTINGS ? 'none' : 'flex';
  }

  if (searchInput) {
    searchInput.placeholder = currentDashboardView === DASHBOARD_VIEW.CONTACTS
      ? 'Search contacts...'
      : 'Search rooms or contacts...';
  }

  if (newBtn) {
    newBtn.style.display = currentDashboardView === DASHBOARD_VIEW.SETTINGS ? 'none' : 'block';
    newBtn.textContent = currentDashboardView === DASHBOARD_VIEW.CONTACTS ? '+ Add Contact' : '+ New';
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
  const params = getChatParams();
  const session = getUserSession();
  if (!session) return;

  const filteredRooms = dashboardRooms.filter(room => room.slug.toLowerCase().includes(sidebarSearchTerm));
  const filteredContacts = dashboardContacts.filter(contact => contact.toLowerCase().includes(sidebarSearchTerm));

  if (!filteredRooms.length && !filteredContacts.length) {
    renderEmptyState(
      container,
      sidebarSearchTerm
        ? `No chats match "${sidebarSearchTerm}".`
        : 'No rooms or direct messages yet. Use + New to get started.'
    );
    return;
  }

  if (filteredRooms.length) {
    container.appendChild(createSidebarHeading('Permanent Rooms'));
    filteredRooms.forEach(room => {
      const item = createSidebarItem({
        title: room.slug,
        desc: 'Permanent room',
        avatar: 'R',
        active: params.roomId === room.slug,
        avatarStyle: 'background:rgba(139,92,246,0.2);color:var(--accent-bright);'
      });
      item.addEventListener('click', () => openOwnedPermanentRoom(room.slug));
      container.appendChild(item);
    });
  }

  if (filteredContacts.length) {
    container.appendChild(createSidebarHeading('Direct Messages'));
    filteredContacts.forEach(contact => {
      const dmRoomId = buildDirectMessageRoomId(session.username, contact);
      const item = createSidebarItem({
        title: contact,
        desc: 'Direct message room',
        avatar: contact.substring(0, 2).toUpperCase(),
        active: params.roomId === dmRoomId
      });
      item.addEventListener('click', () => openDirectConversation(contact));
      container.appendChild(item);
    });
  }
}

function renderContactsView(container) {
  const filteredContacts = dashboardContacts.filter(contact => contact.toLowerCase().includes(sidebarSearchTerm));

  const note = document.createElement('div');
  note.className = 'sidebar-card';
  note.innerHTML = `
    <div class="sidebar-label">Contacts</div>
    <div class="sidebar-note">Add usernames here, then open direct message rooms from the list.</div>
  `;
  container.appendChild(note);

  if (!filteredContacts.length) {
    renderEmptyState(
      container,
      sidebarSearchTerm
        ? `No contacts match "${sidebarSearchTerm}".`
        : 'No contacts yet. Use + Add Contact to start a direct conversation.'
    );
    return;
  }

  filteredContacts.forEach(contact => {
    const item = createSidebarItem({
      title: contact,
      desc: 'Tap to open direct message room',
      avatar: contact.substring(0, 2).toUpperCase()
    });
    item.addEventListener('click', () => openDirectConversation(contact));
    container.appendChild(item);
  });
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
          <span class="sidebar-badge">${dashboardRooms.length} room${dashboardRooms.length === 1 ? '' : 's'}</span>
          <span class="sidebar-badge">${dashboardContacts.length} contact${dashboardContacts.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div class="sidebar-card">
        <div class="sidebar-label">How Joining Works</div>
        <div class="sidebar-note">Permanent rooms need the shared room password. Direct messages use a deterministic 1-to-1 room so one user hosts and the other joins.</div>
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
  heading.style.padding = '0.25rem 0.5rem 0';
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
  const normalized = [userA, userB].map(v => v.toLowerCase()).sort().join(':');
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
  const [hostUsername] = [selfUsername, otherUsername].map(v => v.toLowerCase()).sort();
  return selfUsername.toLowerCase() === hostUsername ? 'host' : 'guest';
}

async function openDirectConversation(contactUsername) {
  const session = getUserSession();
  if (!session) return;

  const roomId = buildDirectMessageRoomId(session.username, contactUsername);
  const role = resolveDirectMessageRole(session.username, contactUsername);
  navigateToChat(roomId, 'direct', session.username, role);
}

async function createPermanentRoomFromModal() {
  const session = getUserSession();
  if (!session) return;

  const slugInput = document.getElementById('new-room-slug');
  const passwordInput = document.getElementById('new-room-password');
  const slug = slugInput?.value.trim().toLowerCase();
  const password = passwordInput?.value || '';

  if (!slug || slug.length < CONFIG.PERMANENT_ID_MIN) {
    showToast('Enter a valid room ID', 'warning');
    return;
  }
  if (slug.length > CONFIG.PERMANENT_ID_MAX) {
    showToast('Room ID is too long', 'warning');
    return;
  }
  if (!password || password.length < 4) {
    showToast('Use a room password with at least 4 characters', 'warning');
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
  } catch (e) {
    showToast(e.message || 'Could not create room', 'error');
  }
}

async function openOwnedPermanentRoom(slug) {
  const session = getUserSession();
  if (!session) return;

  let password = sessionStorage.getItem(`joinPassword_${slug}`) || '';
  if (!password) {
    password = prompt(`Enter password for ${slug}`) || '';
  }
  if (!password) return;

  try {
    const valid = await verifyRoomPassword(slug, password);
    if (!valid) {
      sessionStorage.removeItem(`joinPassword_${slug}`);
      showToast('Incorrect password', 'error');
      return;
    }

    sessionStorage.setItem(`joinPassword_${slug}`, password);
    navigateToChat(slug, 'permanent', session.username, 'host');
  } catch (e) {
    showToast(e.message || 'Could not join room', 'error');
  }
}

async function joinPermanentRoomFromModal() {
  const session = getUserSession();
  if (!session) return;

  const slugInput = document.getElementById('new-room-slug');
  const passwordInput = document.getElementById('new-room-password');
  const slug = slugInput?.value.trim().toLowerCase();
  const password = passwordInput?.value || '';

  if (!slug || slug.length < CONFIG.PERMANENT_ID_MIN) {
    showToast('Enter a valid room ID', 'warning');
    return;
  }
  if (!password) {
    showToast('Enter the room password', 'warning');
    return;
  }

  try {
    const valid = await verifyRoomPassword(slug, password);
    if (!valid) {
      showToast('Incorrect password', 'error');
      return;
    }

    sessionStorage.setItem(`joinPassword_${slug}`, password);
    hideModal('new-chat-modal');
    if (slugInput) slugInput.value = '';
    if (passwordInput) passwordInput.value = '';

    const role = await resolvePermanentRoomRole(slug, 'guest');
    navigateToChat(slug, 'permanent', session.username, role);
  } catch (e) {
    showToast(e.message || 'Could not join room', 'error');
  }
}

async function addContactFromModal() {
  const input = document.getElementById('new-contact-username');
  const session = getUserSession();
  if (!input || !session) return;

  const username = input.value.trim().toLowerCase();
  if (!username) {
    showToast('Enter a contact username', 'warning');
    return;
  }
  if (username === session.username.toLowerCase()) {
    showToast('You cannot add yourself', 'warning');
    return;
  }

  try {
    dashboardContacts = normalizeDashboardContacts(await addContact(username));
    input.value = '';
    hideModal('new-chat-modal');
    showToast(`Added ${username} to contacts`, 'success');
    updateDashboardHero(session);
    setDashboardView(DASHBOARD_VIEW.CONTACTS);
  } catch (e) {
    showToast(e.message || 'Failed to add contact', 'error');
  }
}

async function deleteAccountFromSettings() {
  if (!confirm('Delete your account and all owned permanent rooms? This cannot be undone.')) {
    return;
  }

  const password = prompt('Enter your current account password to confirm deletion:');
  if (!password) return;

  try {
    await deleteUserAccount(password);
    showToast('Account deleted', 'success');
    window.location.href = 'index.html';
  } catch (e) {
    showToast(e.message || 'Failed to delete account', 'error');
  }
}

function logoutToHome() {
  clearUserSession();
  window.location.href = 'index.html';
}

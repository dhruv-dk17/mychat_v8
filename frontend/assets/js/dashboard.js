'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  if (document.body.dataset.page !== 'chat') return;

  const session = getUserSession();
  if (!session) {
    window.location.href = 'index.html';
    return;
  }

  // Set avatar initials
  const navAvatar = document.getElementById('nav-avatar');
  if (navAvatar) {
    navAvatar.textContent = session.username.substring(0,2).toUpperCase();
  }

  document.getElementById('nav-logout-btn')?.addEventListener('click', () => {
    clearUserSession();
    window.location.href = 'index.html';
  });

  const chatPlaceholder = document.getElementById('chat-placeholder');
  const chatActiveView = document.getElementById('chat-active-view');
  const chatWindowCol = document.querySelector('.chat-window-column');

  const params = getChatParams();
  if (params.roomId) {
    // If we have a roomId, the chat view is active
    if (chatPlaceholder) chatPlaceholder.style.display = 'none';
    if (chatActiveView) chatActiveView.style.display = 'flex';
    if (chatWindowCol) chatWindowCol.classList.add('active'); // for mobile
  }

  document.getElementById('back-btn')?.addEventListener('click', () => {
    // On mobile or desktop, going back means leaving this chat view.
    // Instead of hiding it, we reload to chat.html to disconnect peer cleanly.
    window.location.href = 'chat.html';
  });

  document.getElementById('sidebar-new-chat')?.addEventListener('click', () => {
    showModal('new-chat-modal');
  });

  document.getElementById('btn-new-private')?.addEventListener('click', () => {
    const room = createTempRoom('private');
    const username = session.username;
    navigateToChat(room.id, 'private', username, 'host');
  });
  
  document.getElementById('btn-new-group')?.addEventListener('click', () => {
    const room = createTempRoom('group');
    const username = session.username;
    navigateToChat(room.id, 'group', username, 'host');
  });

  document.getElementById('btn-join-chat')?.addEventListener('click', async () => {
    const target = document.getElementById('new-chat-target').value.trim();
    if (!target) return;
    
    // Check if it's a permanent room ID (alphanumeric, 3-8 chars)
    if (/^[a-z0-9]{3,8}$/i.test(target)) {
      // Prompt password
      const pw = prompt('Enter room password:');
      if (pw) {
        verifyRoomPassword(target, pw).then(valid => {
           if (valid) {
             sessionStorage.setItem('joinPassword_' + target, pw);
             navigateToChat(target, 'permanent', session.username, 'guest');
           } else {
             showToast('Incorrect password', 'error');
           }
        }).catch(() => showToast('Error joining', 'error'));
      }
    } else {
      // It's a contact username. Add to contacts and reload.
      try {
        const res = await fetch(`${CONFIG.API_BASE}/users/contacts?username=${encodeURIComponent(session.username)}&token=${encodeURIComponent(session.token)}`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ contactUsername: target })
        });
        const data = await res.json();
        if (data.success) {
           showToast('Contact added!', 'success');
           hideModal('new-chat-modal');
           loadSidebarItems();
        } else {
           showToast(data.error || 'Failed to add contact', 'error');
        }
      } catch (e) {
        showToast('Server error', 'error');
      }
    }
  });

  await loadSidebarItems();
});

async function loadSidebarItems() {
  const container = document.getElementById('sidebar-chat-list');
  if (!container) return;
  const session = getUserSession();
  if (!session) return;

  container.innerHTML = '<div style="padding:1rem;color:var(--text-dim);font-size:0.8rem;text-align:center;">Loading...</div>';

  try {
    // Fetch permanent rooms
    const rooms = await fetchUserRooms();
    
    // Fetch contacts
    const res = await fetch(`${CONFIG.API_BASE}/users/contacts?username=${encodeURIComponent(session.username)}&token=${encodeURIComponent(session.token)}`);
    const data = await res.json();
    const contacts = data.contacts || [];

    const params = getChatParams();
    container.innerHTML = '';

    if (rooms.length > 0) {
      const hd = document.createElement('div');
      hd.style = 'color:var(--text-faint); font-weight:600; font-size:0.7rem; text-transform:uppercase; padding:0.5rem; margin-top:0.5rem;';
      hd.textContent = 'Your Rooms';
      container.appendChild(hd);

      rooms.forEach(r => {
        const item = document.createElement('div');
        item.className = 'chat-list-item' + (params.roomId === r.slug ? ' active' : '');
        item.onclick = () => {
           const pw = sessionStorage.getItem('joinPassword_' + r.slug);
           if (pw) {
              navigateToChat(r.slug, 'permanent', session.username, 'host');
           } else {
              const asked = prompt(`Enter password for ${r.slug}`);
              if (asked) {
                 sessionStorage.setItem('joinPassword_' + r.slug, asked);
                 navigateToChat(r.slug, 'permanent', session.username, 'host');
               }
           }
        };
        item.innerHTML = `
          <div class="chat-list-item-avatar" style="background:rgba(139,92,246,0.2);color:var(--accent-bright);">R</div>
          <div class="chat-list-item-info">
             <div class="chat-list-item-title">${r.slug}</div>
             <div class="chat-list-item-desc">Permanent Room</div>
          </div>
        `;
        container.appendChild(item);
      });
    }

    if (contacts.length > 0) {
      const hd = document.createElement('div');
      hd.style = 'color:var(--text-faint); font-weight:600; font-size:0.7rem; text-transform:uppercase; padding:0.5rem; margin-top:0.5rem;';
      hd.textContent = 'Direct Messages';
      container.appendChild(hd);

      contacts.forEach(c => {
         // Create a deterministic PM room id based on sorted usernames
         const sorted = [session.username, c].sort();
         const pmRoomId = 'pm_' + sorted[0] + '_' + sorted[1]; // Wait, room id must be 3-8 chars in v7. We can just use hash.

         const item = document.createElement('div');
         item.className = 'chat-list-item' + (params.roomId === pmRoomId ? ' active' : '');
         item.onclick = async () => {
             // For simplicity, direct messages are just private rooms where both parties know the ID
             const pmId = await _generatePmId(sorted[0], sorted[1]);
             navigateToChat(pmId, 'private', session.username, 'host'); 
         };
         item.innerHTML = `
          <div class="chat-list-item-avatar">${c.substring(0,2).toUpperCase()}</div>
          <div class="chat-list-item-info">
             <div class="chat-list-item-title">${c}</div>
             <div class="chat-list-item-desc">Offline (Dead Drop avail)</div>
          </div>
        `;
        container.appendChild(item);
      });
    }
    
    if (rooms.length === 0 && contacts.length === 0) {
      container.innerHTML = '<div style="padding:1rem;color:var(--text-dim);font-size:0.8rem;text-align:center;">No chats yet</div>';
    }
  } catch(e) {
    container.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:0.8rem;text-align:center;">Failed to load</div>';
  }
}

async function _generatePmId(u1, u2) {
   // Generates a 8-char lowercase alphanumeric PM ID
   const encoder = new TextEncoder();
   const data = encoder.encode(u1 + ':' + u2);
   const hashBuffer = await crypto.subtle.digest('SHA-256', data);
   const hashArray = Array.from(new Uint8Array(hashBuffer));
   const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
   let res = '';
   for(let i=0; res.length<8 && i<hashHex.length; i++) {
      if (/[a-z0-9]/.test(hashHex[i])) res += hashHex[i];
   }
   return res.padEnd(8, '0');
}

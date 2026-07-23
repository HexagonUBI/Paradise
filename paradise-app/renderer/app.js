/* ========================================================================
   Paradise UI <-> HarmonyClient glue
   ======================================================================== */
const client = new HarmonyClient();

const state = {
  mode: 'dms',              // 'dms' | 'guild'
  dmChannels: [],
  guilds: [],
  activeGuildId: null,
  guildChannels: {},         // guildId -> [channels]
  activeChannelId: null,
  channelMeta: {},           // channelId -> { name, sub, avatarUser, isGroup, pinned }
  messageCache: {},          // channelId -> [messages]
  messageHasMore: {},        // channelId -> boolean, whether older messages remain on the server
  messageLoadingMore: {},    // channelId -> boolean, guards against overlapping pagination fetches
  presence: {},              // userId -> status string
  relationships: [],         // friends / pending requests, from fetchRelationships()
  homeTab: 'online',         // 'online' | 'all' | 'pending' — which list the home page shows
  history: [],
  historyIndex: -1,
  settings: { typing: true, notif: true },
  typingTimers: {},          // channelId -> {users:Set, timeoutHandles:Map}
  lastTypingSent: 0,
};

const AVATAR_COLORS = ['#F3B49B','#9BC7EE','#A9CE8B','#E3B4E0','#F5D48A','#8FD3C6'];
function colorFor(id){
  let h = 0;
  const s = String(id || 'x');
  for(let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name){
  if(!name) return '?';
  return name.trim().slice(0,2).toUpperCase();
}

function showToast(msg){
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2600);
}

/* ---------------- avatar rendering ---------------- */
function fillAvatar(wrapEl, fallbackEl, user, size){
  const url = user && user.avatar ? client.cdnAvatarUrl(user.id, user.avatar) : null;
  wrapEl.style.background = colorFor(user && user.id);
  let img = wrapEl.querySelector('img.real-avatar');
  if(url){
    if(!img){ img = document.createElement('img'); img.className = 'real-avatar'; wrapEl.prepend(img); }
    img.src = url;
    img.style.display = 'block';
    if(fallbackEl) fallbackEl.style.display = 'none';
  } else {
    if(img) img.style.display = 'none';
    if(fallbackEl){ fallbackEl.style.display = 'block'; fallbackEl.textContent = initials(user && (user.username || user.name)); }
  }
}

function statusDotHtml(status){
  const s = ['online', 'idle', 'dnd'].includes(status) ? status : 'offline';
  const file = s === 'dnd' ? 'donotdisturb' : s;
  return `<img src="../assets/user_status/${file}.svg" alt="${s}">`;
}

/* ---------------- connect flow ---------------- */
// No publicly-documented always-on Harmony instance is guaranteed to be live, so we
// default to the official Spacebar instance (same Discord-compatible protocol family
// Harmony implements) and let anyone point elsewhere if they'd rather self-host.
const DEFAULT_INSTANCE = 'spacebar.chat';

const bootScreen = document.getElementById('boot-screen');
const connectScreen = document.getElementById('connect-screen');
const loginScreen = document.getElementById('login-screen');
const connectInput = document.getElementById('connect-input');
const connectError = document.getElementById('connect-error');
const connectBtn = document.getElementById('connect-btn');

connectBtn.addEventListener('click', () => doConnect(connectInput.value.trim(), false));
connectInput.addEventListener('keydown', e => { if(e.key === 'Enter') doConnect(connectInput.value.trim(), false); });

async function doConnect(val, silent){
  connectError.classList.remove('show');
  if(!val){ connectError.textContent = 'Enter an instance address first.'; connectError.classList.add('show'); return false; }
  if(!silent){ connectBtn.disabled = true; connectBtn.innerHTML = '<span class="spinner"></span>Connecting\u2026'; }
  try {
    await client.discover(val);
    document.getElementById('login-back-2').title = `Connected to ${val} \u2014 use a different instance`;
    document.getElementById('settings-instance-label').textContent = client.apiBase;
    bootScreen.classList.add('hidden');
    connectScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    document.getElementById('login-username').focus();
    return true;
  } catch(err){
    if(!silent){
      connectError.textContent = err.message || 'Could not reach that instance.';
      connectError.classList.add('show');
    }
    return false;
  } finally {
    if(!silent){ connectBtn.disabled = false; connectBtn.textContent = 'Connect'; }
  }
}

document.getElementById('login-back').addEventListener('click', () => {
  loginScreen.classList.add('hidden');
  connectScreen.classList.remove('hidden');
});
document.getElementById('login-back-2').addEventListener('click', () => {
  loginScreen.classList.add('hidden');
  connectScreen.classList.remove('hidden');
});

document.getElementById('auth-social-trello').addEventListener('click', () => openExternalLink('https://trello.com/b/ZQVstPXp/paradise-roadmap'));
document.getElementById('auth-social-github').addEventListener('click', () => openExternalLink('https://github.com/HexagonUBI/Paradise'));
document.getElementById('auth-social-discord').addEventListener('click', () => showToast('Not set up yet \u2014 check back soon'));

async function saveSession(){
  if(!window.paradiseNative) return;
  const remember = document.getElementById('remember-me-toggle');
  if(remember && !remember.checked) return;
  await window.paradiseNative.saveAuth({
    apiBase: client.apiBase,
    gatewayUrl: client.gatewayUrl,
    cdnBase: client.cdnBase,
    token: client.token,
  }).catch(() => {});
}

// Try a saved session first (Login/Register saving); fall back to auto-connecting
// to the default instance and showing Login/Register if there's nothing saved.
(async function autoBoot(){
  const saved = window.paradiseNative ? await window.paradiseNative.loadAuth().catch(() => null) : null;
  if(saved && saved.apiBase && saved.token){
    client.apiBase = saved.apiBase;
    client.gatewayUrl = saved.gatewayUrl;
    client.cdnBase = saved.cdnBase;
    client.token = saved.token;
    document.getElementById('settings-instance-label').textContent = client.apiBase;
    bootScreen.classList.remove('hidden');
    try {
      await boot();
      return;
    } catch(err){
      // saved token no longer valid; clear it and fall through to a normal login
      if(window.paradiseNative) await window.paradiseNative.clearAuth().catch(() => {});
    }
  }

  const ok = await doConnect(DEFAULT_INSTANCE, true);
  if(!ok){
    bootScreen.classList.add('hidden');
    connectScreen.classList.remove('hidden');
    connectError.textContent = `Couldn't reach the default instance (${DEFAULT_INSTANCE}) automatically. Enter an instance to connect manually.`;
    connectError.classList.add('show');
  }
})();

/* ---------------- login / register ---------------- */
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const loginFields = document.getElementById('login-fields');
const registerFields = document.getElementById('register-fields');
const loginError = document.getElementById('login-error');

tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active'); tabRegister.classList.remove('active');
  loginFields.style.display = ''; registerFields.style.display = 'none';
  loginError.classList.remove('show');
  document.getElementById('login-username').focus();
});
tabRegister.addEventListener('click', () => {
  tabRegister.classList.add('active'); tabLogin.classList.remove('active');
  registerFields.style.display = ''; loginFields.style.display = 'none';
  loginError.classList.remove('show');
  document.getElementById('reg-username').focus();
});

function wireReadyState(fieldIds, btnId){
  const btn = document.getElementById(btnId);
  const check = () => {
    const ready = fieldIds.every(id => document.getElementById(id).value.trim().length > 0);
    btn.classList.toggle('ready', ready);
  };
  fieldIds.forEach(id => document.getElementById(id).addEventListener('input', check));
  check();
}
wireReadyState(['login-username', 'login-password'], 'login-btn');
wireReadyState(['reg-username', 'reg-email', 'reg-password'], 'register-btn');

document.getElementById('login-account-switch').addEventListener('click', () => {
  document.getElementById('login-username').focus();
});

document.getElementById('login-btn').addEventListener('click', async () => {
  const login = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  loginError.classList.remove('show');
  if(!login || !password){ loginError.textContent = 'Enter your username/email and password.'; loginError.classList.add('show'); return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Logging in\u2026';
  try {
    await client.login(login, password);
    await saveSession();
    await boot();
  } catch(err){
    loginError.textContent = err.message || 'Login failed.';
    loginError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Log in';
  }
});

document.getElementById('register-btn').addEventListener('click', async () => {
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const btn = document.getElementById('register-btn');
  loginError.classList.remove('show');
  if(!username || !email || !password){ loginError.textContent = 'Fill in all fields to register.'; loginError.classList.add('show'); return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Creating account\u2026';
  try {
    await client.register(username, email, password);
    await saveSession();
    await boot();
  } catch(err){
    loginError.textContent = err.message || 'Registration failed.';
    loginError.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Create account';
  }
});

/* ---------------- connection status ---------------- */
client.addEventListener('gateway-status', (e) => {
  const { status } = e.detail;
  const meStatus = document.getElementById('me-status');
  if(meStatus){
    if(status === 'ready') meStatus.textContent = 'Online';
    else if(status === 'connecting' || status === 'identifying') meStatus.textContent = 'Connecting\u2026';
    else if(status === 'reconnecting') meStatus.textContent = 'Reconnecting\u2026';
    else if(status === 'error' || status === 'invalid-session') meStatus.textContent = 'Connection error';
    else if(status === 'closed') meStatus.textContent = 'Disconnected';
  }
  if(window.paradiseNative && window.paradiseNative.setTrayStatus){
    if(status === 'ready') window.paradiseNative.setTrayStatus('connected');
    else if(status === 'connecting' || status === 'identifying') window.paradiseNative.setTrayStatus('connecting');
    else if(status === 'reconnecting' || status === 'closed') window.paradiseNative.setTrayStatus('unstable');
    else if(status === 'error' || status === 'invalid-session') window.paradiseNative.setTrayStatus('disconnected');
  }
});

/* ---------------- boot after auth ---------------- */
async function boot(){
  loginScreen.classList.add('hidden');
  document.getElementById('me-status').textContent = 'Loading your data\u2026';

  let me;
  try { me = await client.fetchMe(); }
  catch(err){ showFatalAuthError(err); return; }

  bootScreen.classList.add('hidden');
  connectScreen.classList.add('hidden');
  loginScreen.classList.add('hidden');

  fillAvatar(document.getElementById('me-avatar-wrap'), document.getElementById('me-avatar-fallback'), me);
  document.getElementById('me-name').textContent = me.username || me.email || 'You';
  document.getElementById('me-status').textContent = 'Online';

  try {
    const [dms, guilds, rels] = await Promise.all([
      client.fetchDMs().catch(() => []),
      client.fetchGuilds().catch(() => []),
      client.fetchRelationships().catch(() => []),
    ]);
    state.dmChannels = dms || [];
    state.guilds = guilds || [];
    state.relationships = rels || [];
  } catch(err){ /* non-fatal; leave lists empty */ }

  renderGuildRail();
  renderDmList();
  client.connectGateway();
  showHomePanel();
}

function showFatalAuthError(err){
  bootScreen.classList.add('hidden');
  connectScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  document.getElementById('login-username').focus();
  loginError.textContent = 'Connected, but could not load your account: ' + (err.message || err);
  loginError.classList.add('show');
}

/* ---------------- gateway events ---------------- */
client.addEventListener('ready', (e) => {
  const d = e.detail;
  if(Array.isArray(d.presences)){
    d.presences.forEach(p => { state.presence[p.user_id || (p.user && p.user.id)] = p.status; });
  }
  if(Array.isArray(d.private_channels) && d.private_channels.length){
    state.dmChannels = d.private_channels;
    if(state.mode === 'dms') renderDmList();
  }
  if(Array.isArray(d.guilds) && d.guilds.length){
    state.guilds = d.guilds.map(g => g.properties || g);
    renderGuildRail();
  }
});

client.addEventListener('message', (e) => {
  const msg = e.detail;
  const list = state.messageCache[msg.channel_id];
  if(list) list.push(msg);
  if(msg.channel_id === state.activeChannelId){
    appendMessageEl(msg);
    if((msg.attachments || []).some(a => a.content_type && a.content_type.startsWith('image/'))) renderMediaGrid(msg.channel_id);
  } else {
    const known = state.dmChannels.some(ch => ch.id === msg.channel_id);
    if(!known){
      // We don't have this channel yet (a missed/out-of-order channel-create,
      // or a channel that existed before this session started some other way) -
      // recover by re-pulling the DM list instead of silently losing the unread ping.
      client.fetchDMs().then(channels => {
        state.dmChannels = channels || [];
        if(state.mode === 'dms') renderDmList();
        bumpUnread(msg.channel_id);
      }).catch(() => {});
    } else {
      bumpUnread(msg.channel_id);
    }
    if(state.settings.notif){
      const authorName = msg.author ? msg.author.username : 'Someone';
      showToast(authorName + ': ' + (msg.content || '[attachment]'));
    }
  }
});

client.addEventListener('typing', (e) => {
  if(!state.settings.typing) return;
  const d = e.detail;
  if(d.channel_id !== state.activeChannelId) return;
  if(client.user && d.user_id === client.user.id) return;
  showTypingFor(d.user_id, d.member && d.member.user ? d.member.user.username : 'Someone');
});

client.addEventListener('presence', (e) => {
  const d = e.detail;
  const uid = d.user_id || (d.user && d.user.id);
  if(!uid) return;
  state.presence[uid] = d.status;
  updatePresenceUI(uid, d.status);
  if(document.getElementById('home-panel').style.display !== 'none') renderFriendsList();
});

/* ---------------- guild rail ---------------- */
function renderGuildRail(){
  const rail = document.getElementById('guild-list');
  rail.innerHTML = '';
  state.guilds.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'rail-btn square';
    btn.dataset.tip = g.name || 'Server';
    btn.dataset.guild = g.id;
    const iconUrl = g.icon ? client.cdnGuildIconUrl(g.id, g.icon) : null;
    if(iconUrl){
      const img = document.createElement('img');
      img.alt = '';
      img.addEventListener('error', () => {
        btn.innerHTML = '';
        btn.textContent = initials(g.name);
        btn.style.background = colorFor(g.id);
      }, { once: true });
      img.src = iconUrl;
      btn.appendChild(img);
    } else {
      btn.textContent = initials(g.name);
      btn.style.background = colorFor(g.id);
    }
    btn.addEventListener('click', () => selectGuild(g.id));
    attachTooltip(btn);
    rail.appendChild(btn);
  });
}

function attachTooltip(btn){
  const tooltip = document.getElementById('rail-tooltip');
  btn.addEventListener('mouseenter', () => {
    const r = btn.getBoundingClientRect();
    tooltip.textContent = btn.dataset.tip;
    tooltip.style.left = (r.right + 10) + 'px';
    tooltip.style.top = (r.top + r.height/2 - 12) + 'px';
    tooltip.classList.add('show');
  });
  btn.addEventListener('mouseleave', () => tooltip.classList.remove('show'));
}
document.querySelectorAll('.rail-btn[data-tip]').forEach(attachTooltip);

async function selectGuild(guildId){
  hideHomePanel();
  state.mode = 'guild';
  state.activeGuildId = guildId;
  document.querySelectorAll('#guild-list .rail-btn').forEach(b => b.classList.toggle('active', b.dataset.guild === guildId));
  document.getElementById('logo-rail-btn').classList.remove('active');
  document.getElementById('home-row').classList.remove('active');
  const guild = state.guilds.find(g => g.id === guildId);
  document.getElementById('home-row-label').textContent = guild ? guild.name : 'Server';

  const scroll = document.getElementById('dm-scroll');
  scroll.innerHTML = '<div class="empty-state small">Loading channels\u2026</div>';

  if(!state.guildChannels[guildId]){
    try {
      state.guildChannels[guildId] = await client._rest('GET', `/guilds/${guildId}/channels`);
    } catch(err){
      scroll.innerHTML = `<div class="empty-state small">Couldn't load channels: ${err.message}</div>`;
      return;
    }
  }
  renderChannelList(state.guildChannels[guildId]);
}

function renderChannelList(channels){
  const scroll = document.getElementById('dm-scroll');
  scroll.innerHTML = '';
  const textChannels = (channels || []).filter(c => c.type === 0 || c.type === 5);
  if(!textChannels.length){ scroll.innerHTML = '<div class="empty-state small">No text channels here.</div>'; return; }
  const label = document.createElement('div');
  label.className = 'section-label';
  label.textContent = 'Text channels';
  scroll.appendChild(label);
  textChannels.forEach(c => {
    const item = document.createElement('div');
    item.className = 'dm-item';
    item.dataset.chat = c.id;
    item.innerHTML = `
      <div class="avatar" style="background:${colorFor(c.id)};">#</div>
      <div class="dm-text">
        <div class="dm-name">${escapeHtml(c.name || 'channel')}</div>
        <div class="dm-preview">${escapeHtml(c.topic || '')}</div>
      </div>`;
    item.addEventListener('click', () => selectChannel(c.id, {
      name: c.name, sub: c.topic || '', isGroup: true, isGuildChannel: true,
    }, true));
    scroll.appendChild(item);
  });
}

/* ---------------- home / DM list ---------------- */
document.getElementById('logo-rail-btn').addEventListener('click', () => document.getElementById('home-row').click());
document.getElementById('home-row').addEventListener('click', () => {
  state.mode = 'dms';
  state.activeGuildId = null;
  state.activeChannelId = null;
  document.getElementById('home-row-label').textContent = 'Home';
  document.querySelectorAll('#guild-list .rail-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('logo-rail-btn').classList.add('active');
  document.getElementById('home-row').classList.add('active');
  document.querySelectorAll('.dm-item').forEach(i => i.classList.remove('active'));
  renderDmList();
  showHomePanel();
});

/* ---------------- home page: friends list + add friend ---------------- */
const ICON_MESSAGE = '<svg width="14" height="14" viewBox="0 0 20 18" fill="none"><path d="M2 1h16a1 1 0 011 1v11a1 1 0 01-1 1H7l-4 4v-4H2a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8.5l4 4 8-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_X = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function showHomePanel(){
  document.getElementById('chat-placeholder').style.display = 'none';
  document.getElementById('chat-active').style.display = 'none';
  document.getElementById('home-panel').style.display = 'flex';
  renderFriendsList();
}
function hideHomePanel(){
  document.getElementById('home-panel').style.display = 'none';
}

async function loadFriends(){
  try {
    const rels = await client.fetchRelationships();
    state.relationships = rels || [];
  } catch(err){ /* keep whatever we already have cached */ }
  if(document.getElementById('home-panel').style.display !== 'none') renderFriendsList();
}

function renderFriendsList(){
  const list = document.getElementById('home-list');
  const rels = state.relationships || [];
  list.innerHTML = '';

  if(state.homeTab === 'pending'){
    const incoming = rels.filter(r => r.type === 3);
    const outgoing = rels.filter(r => r.type === 4);
    if(!incoming.length && !outgoing.length){
      list.innerHTML = '<div class="empty-state small">No pending friend requests.</div>';
      return;
    }
    if(incoming.length) renderFriendSection(list, 'Incoming', incoming, 'incoming');
    if(outgoing.length) renderFriendSection(list, 'Outgoing', outgoing, 'outgoing');
    return;
  }

  let friends = rels.filter(r => r.type === 1);
  if(state.homeTab === 'online'){
    friends = friends.filter(r => { const st = state.presence[r.user && r.user.id]; return st && st !== 'offline'; });
  }
  if(!friends.length){
    list.innerHTML = `<div class="empty-state small">${state.homeTab === 'online' ? 'No friends online right now.' : 'No friends yet. Use \u201cAdd Friend\u201d above to find someone.'}</div>`;
    return;
  }
  friends.sort((a,b) => ((a.user && a.user.username) || '').localeCompare((b.user && b.user.username) || ''));
  renderFriendSection(list, state.homeTab === 'online' ? 'Online' : 'All friends', friends, 'friend');
}

function renderFriendSection(container, label, rels, kind){
  const lab = document.createElement('div');
  lab.className = 'home-section-label';
  lab.textContent = `${label} \u2014 ${rels.length}`;
  container.appendChild(lab);
  rels.forEach(r => container.appendChild(buildFriendRow(r, kind)));
}

function buildFriendRow(rel, kind){
  const user = rel.user || {};
  const status = state.presence[user.id];
  const row = document.createElement('div');
  row.className = 'friend-row';
  row.innerHTML = `
    <div class="avatar"><span class="fallback-init"></span>
      <div class="status-badge">${kind === 'friend' ? statusDotHtml(status) : ''}</div>
    </div>
    <div class="friend-info">
      <div class="friend-name">${escapeHtml(user.username || 'Unknown')}</div>
      <div class="friend-sub">${kind === 'friend'
        ? ({ online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb' }[status] || 'Offline')
        : kind === 'incoming' ? 'Incoming friend request' : 'Outgoing friend request'}</div>
    </div>
    <div class="friend-actions"></div>`;
  const avEl = row.querySelector('.avatar');
  fillAvatar(avEl, avEl.querySelector('.fallback-init'), user, 36);
  avEl.addEventListener('click', () => openProfileOverview(user, status));

  const actions = row.querySelector('.friend-actions');
  const addAction = (icon, title, danger, handler) => {
    const btn = document.createElement('button');
    if(danger) btn.className = 'danger';
    btn.title = title;
    btn.innerHTML = icon;
    btn.addEventListener('click', handler);
    actions.appendChild(btn);
  };
  if(kind === 'friend'){
    addAction(ICON_MESSAGE, 'Message', false, () => openDmWithUser(user));
    addAction(ICON_X, 'Remove friend', true, () => removeFriend(user));
  } else if(kind === 'incoming'){
    addAction(ICON_CHECK, 'Accept', false, () => acceptFriend(user));
    addAction(ICON_X, 'Ignore', true, () => removeFriend(user));
  } else if(kind === 'outgoing'){
    addAction(ICON_X, 'Cancel request', true, () => removeFriend(user));
  }
  return row;
}

async function openDmWithUser(user){
  try {
    const ch = await client.openDM(user.id);
    if(!state.dmChannels.some(c => c.id === ch.id)) state.dmChannels.unshift(ch);
    const info = dmDisplayInfo(ch);
    state.channelMeta[ch.id] = { ...info, channel: ch };
    state.mode = 'dms';
    document.querySelectorAll('#guild-list .rail-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('logo-rail-btn').classList.add('active');
    document.getElementById('home-row').classList.add('active');
    document.getElementById('home-row-label').textContent = 'Home';
    renderDmList();
    hideHomePanel();
    await selectChannel(ch.id, info, true);
  } catch(err){
    showToast('Could not open conversation: ' + err.message);
  }
}

async function acceptFriend(user){
  try {
    await client.acceptFriendRequest(user.id);
    showToast('You are now friends with ' + (user.username || 'them'));
    await loadFriends();
  } catch(err){ showToast('Failed: ' + err.message); }
}

async function removeFriend(user){
  try {
    await client.removeRelationship(user.id);
    await loadFriends();
  } catch(err){ showToast('Failed: ' + err.message); }
}

document.querySelectorAll('#home-tabs .home-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#home-tabs .home-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.homeTab;
    const isAdd = which === 'add';
    document.getElementById('home-add-friend').style.display = isAdd ? 'block' : 'none';
    document.getElementById('home-list').style.display = isAdd ? 'none' : 'block';
    if(!isAdd){
      state.homeTab = which;
      renderFriendsList();
    } else {
      document.getElementById('add-friend-input').focus();
    }
  });
});

async function sendFriendRequestFromForm(){
  const input = document.getElementById('add-friend-input');
  const msgEl = document.getElementById('add-friend-msg');
  const raw = input.value.trim();
  msgEl.className = 'home-add-friend-msg';
  if(!raw){ msgEl.textContent = 'Enter a username first.'; msgEl.classList.add('show', 'error'); return; }
  let username = raw, discriminator;
  if(raw.includes('#')){ [username, discriminator] = raw.split('#'); }
  const btn = document.getElementById('add-friend-btn');
  btn.disabled = true;
  btn.textContent = 'Sending\u2026';
  try {
    await client.sendFriendRequest(username, discriminator);
    msgEl.textContent = `Friend request sent to ${raw}.`;
    msgEl.classList.add('show', 'success');
    input.value = '';
    await loadFriends();
  } catch(err){
    msgEl.textContent = err.message || 'Could not send that friend request.';
    msgEl.classList.add('show', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Friend Request';
  }
}
document.getElementById('add-friend-btn').addEventListener('click', sendFriendRequestFromForm);
document.getElementById('add-friend-input').addEventListener('keydown', e => { if(e.key === 'Enter') sendFriendRequestFromForm(); });

client.addEventListener('relationship-add', () => loadFriends());
client.addEventListener('relationship-remove', () => loadFriends());

// A brand-new DM/group channel someone just started with us. Without this,
// the very first message in a new conversation has nowhere to attach to in
// the UI (no sidebar item to bump unread on, no cache entry) until the whole
// app is restarted and READY re-fetches private_channels from scratch.
client.addEventListener('channel-create', (e) => {
  const ch = e.detail;
  if(!ch || !ch.id) return;
  if(state.dmChannels.some(existing => existing.id === ch.id)) return;
  state.dmChannels.unshift(ch);
  if(state.mode === 'dms') renderDmList();
});

function dmDisplayInfo(channel){
  const meId = client.user ? client.user.id : null;
  const others = (channel.recipients || []).filter(r => r.id !== meId);
  if(channel.type === 3 || others.length > 1){
    const name = channel.name || others.map(o => o.username).join(', ') || 'Group chat';
    return { name, sub: others.length + ' members', isGroup: true, avatarUser: others[0] || null, others };
  }
  const u = others[0] || channel.recipients?.[0];
  return { name: u ? u.username : 'Unknown user', sub: u && u.custom_status ? u.custom_status.text : '', isGroup: false, avatarUser: u, others: u ? [u] : [] };
}

function renderDmList(){
  const scroll = document.getElementById('dm-scroll');
  scroll.innerHTML = '';
  if(!state.dmChannels.length){
    scroll.innerHTML = '<div class="empty-state small">No conversations yet. Once you DM someone on this instance, it\'ll show up here.</div>';
    return;
  }
  const label = document.createElement('div');
  label.className = 'section-label';
  label.textContent = 'Direct messages';
  scroll.appendChild(label);

  const q = document.getElementById('dm-search').value.trim().toLowerCase();

  state.dmChannels.forEach(ch => {
    const info = dmDisplayInfo(ch);
    if(q && !info.name.toLowerCase().includes(q)) return;
    state.channelMeta[ch.id] = { ...info, channel: ch };
    const item = document.createElement('div');
    item.className = 'dm-item';
    item.dataset.chat = ch.id;
    if(ch.id === state.activeChannelId) item.classList.add('active');
    const status = info.avatarUser ? state.presence[info.avatarUser.id] : null;
    item.innerHTML = `
      <div class="avatar" data-avatar-for="${ch.id}">
        <span class="fallback-init"></span>
        <div class="status-badge">${statusDotHtml(status)}</div>
      </div>
      <div class="dm-text">
        <div class="dm-name">${escapeHtml(info.name)}</div>
        <div class="dm-preview">${escapeHtml(info.sub || '')}</div>
      </div>`;
    const avEl = item.querySelector('.avatar');
    fillAvatar(avEl, avEl.querySelector('.fallback-init'), info.avatarUser, 38);
    item.addEventListener('click', () => selectChannel(ch.id, info, false));
    const badge = item.querySelector('.status-badge');
    if(badge && info.avatarUser){
      badge.addEventListener('click', (e) => { e.stopPropagation(); openProfileOverview(info.avatarUser, status, info.sub); });
    }
    scroll.appendChild(item);
  });
}
document.getElementById('dm-search').addEventListener('input', renderDmList);

function bumpUnread(channelId){
  const item = document.querySelector(`.dm-item[data-chat="${channelId}"]`);
  if(item){
    const nameEl = item.querySelector('.dm-name');
    nameEl.style.fontWeight = '800';
  }
}

/* ---------------- channel selection & messages ---------------- */
function escapeHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function selectChannel(channelId, info, pushHistory){
  hideHomePanel();
  state.activeChannelId = channelId;
  document.querySelectorAll('.dm-item').forEach(i => i.classList.toggle('active', i.dataset.chat === channelId));

  document.getElementById('chat-placeholder').style.display = 'none';
  document.getElementById('chat-active').style.display = 'flex';
  document.getElementById('composer-input').disabled = false;

  const meta = { ...info };
  state.channelMeta[channelId] = { ...(state.channelMeta[channelId] || {}), ...meta };
  renderChatHeaderFor(channelId);

  document.getElementById('messages').innerHTML = '<div class="empty-state small">Loading messages\u2026</div>';
  document.getElementById('typing').classList.remove('show');

  if(!state.messageCache[channelId]){
    try {
      const msgs = await client.fetchMessages(channelId, 50);
      state.messageCache[channelId] = (msgs || []).slice().reverse();
      state.messageHasMore[channelId] = (msgs || []).length >= 50;
    } catch(err){
      document.getElementById('messages').innerHTML = `<div class="empty-state small">Couldn't load messages: ${escapeHtml(err.message)}</div>`;
      state.messageCache[channelId] = [];
      state.messageHasMore[channelId] = false;
    }
  }
  renderMessages(channelId);
  renderMediaGrid(channelId);

  if(pushHistory !== false){
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push({ channelId, meta, isGuild: state.mode === 'guild' });
    state.historyIndex = state.history.length - 1;
    updateNavButtons();
  }
}

function renderChatHeaderFor(channelId){
  const meta = state.channelMeta[channelId] || {};
  document.getElementById('header-name').textContent = meta.name || 'Conversation';
  document.getElementById('header-sub').textContent = meta.sub || '';
  const wrap = document.getElementById('header-avatar-wrap');
  const fb = document.getElementById('header-avatar-fallback');
  fillAvatar(wrap, fb, meta.avatarUser, 38);
  const badge = document.getElementById('header-status-badge');
  if(meta.isGroup){ badge.style.display = 'none'; }
  else {
    badge.style.display = 'flex';
    badge.innerHTML = statusDotHtml(meta.avatarUser ? state.presence[meta.avatarUser.id] : null);
  }

  // profile panel mirrors the header contact
  document.getElementById('profile-name').textContent = meta.name || '';
  document.getElementById('profile-sub').textContent = meta.sub || '';
  fillAvatar(document.getElementById('profile-avatar-wrap'), document.getElementById('profile-avatar-fallback'), meta.avatarUser, 88);
  const pBadge = document.getElementById('profile-status-badge');
  if(meta.isGroup){ pBadge.style.display = 'none'; } else {
    pBadge.style.display = 'flex';
    pBadge.innerHTML = statusDotHtml(meta.avatarUser ? state.presence[meta.avatarUser.id] : null);
  }
  document.getElementById('profile-bio').textContent = (meta.avatarUser && meta.avatarUser.bio) || 'No bio yet.';
  renderMediaGrid(channelId);

  document.getElementById('pinned-banner').classList.add('hidden');
}

function renderMediaGrid(channelId){
  const grid = document.getElementById('media-grid');
  const header = document.getElementById('media-header');
  const cache = state.messageCache[channelId] || [];
  const images = [];
  cache.forEach(m => {
    (m.attachments || []).forEach(a => {
      if(a.content_type && a.content_type.startsWith('image/')) images.push(a);
    });
  });
  if(!images.length){
    grid.style.display = 'none';
    header.style.display = 'none';
    grid.innerHTML = '';
    return;
  }
  header.style.display = '';
  grid.style.display = '';
  grid.innerHTML = images.map(a => `<img src="${a.url || a.proxy_url}" alt="${escapeHtml(a.filename || 'shared media')}">`).join('');
}

function updatePresenceUI(userId, status){
  document.querySelectorAll(`[data-avatar-for]`).forEach(el => {
    const chId = el.dataset.avatarFor;
    const meta = state.channelMeta[chId];
    if(meta && meta.avatarUser && meta.avatarUser.id === userId){
      const badge = el.querySelector('.status-badge');
      if(badge) badge.innerHTML = statusDotHtml(status);
    }
  });
  const activeMeta = state.channelMeta[state.activeChannelId];
  if(activeMeta && activeMeta.avatarUser && activeMeta.avatarUser.id === userId){
    document.getElementById('header-status-badge').innerHTML = statusDotHtml(status);
    document.getElementById('profile-status-badge').innerHTML = statusDotHtml(status);
  }
}

async function loadOlderMessages(channelId){
  if(!channelId) return;
  if(state.messageLoadingMore[channelId]) return;
  if(state.messageHasMore[channelId] === false) return;
  const cache = state.messageCache[channelId] || [];
  const oldest = cache[0];
  if(!oldest) return;

  state.messageLoadingMore[channelId] = true;
  const el = document.getElementById('messages');
  const spinner = document.createElement('div');
  spinner.className = 'empty-state small history-loading';
  spinner.textContent = 'Loading earlier messages\u2026';
  if(channelId === state.activeChannelId) el.prepend(spinner);

  try {
    const older = await client.fetchMessages(channelId, 50, oldest.id);
    const batch = (older || []).slice().reverse();
    state.messageHasMore[channelId] = batch.length >= 50;
    if(batch.length){
      state.messageCache[channelId] = batch.concat(state.messageCache[channelId] || []);
      if(channelId === state.activeChannelId){
        const prevHeight = el.scrollHeight;
        const prevTop = el.scrollTop;
        spinner.remove();
        renderMessages(channelId, { preserveScroll: true });
        el.scrollTop = el.scrollHeight - prevHeight + prevTop;
      }
    } else {
      spinner.remove();
    }
  } catch(err){
    spinner.remove();
    // Non-fatal: leave hasMore as-is so the user can retry by scrolling again.
  } finally {
    state.messageLoadingMore[channelId] = false;
  }
}

function renderMessages(channelId, opts){
  const el = document.getElementById('messages');
  el.innerHTML = '';
  const msgs = state.messageCache[channelId] || [];
  if(!msgs.length){
    el.innerHTML = '<div class="empty-state small">No messages yet. Say hello!</div>';
    return;
  }
  msgs.forEach(m => appendMessageEl(m, false));
  if(!opts || !opts.preserveScroll) el.scrollTop = el.scrollHeight;
}

function editedTag(m){
  return m.edited_timestamp ? '<span class="edited-tag">(edited)</span>' : '';
}

function actionsHtml(){
  return `<div class="msg-actions">
    <button class="msg-action-btn" data-action="edit" title="Edit message">${ICON_EDIT}</button>
    <button class="msg-action-btn" data-action="delete" title="Delete message">${ICON_DELETE}</button>
  </div>`;
}

const ICON_EDIT = '<svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M2 18l.7-3.9L13.6 3.2a1 1 0 011.4 0l1.8 1.8a1 1 0 010 1.4L6.9 17.3 2 18z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const ICON_DELETE = '<svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M8 5V3a1 1 0 011-1h2a1 1 0 011 1v2m-8 0 1 12a1 1 0 001 1h6a1 1 0 001-1l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 44 44" fill="none"><circle cx="22" cy="22" r="22" fill="rgba(20,30,40,.45)"/><path d="M18 14.5l13 7.5-13 7.5v-15z" fill="#fff"/></svg>';
const ICON_STICKER = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/><circle cx="7.3" cy="7.3" r="1.2" fill="currentColor"/><path d="M4 14l3-3 3 3 3-4 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function appendMessageEl(m, scroll){
  const el = document.getElementById('messages');
  if(el.querySelector('.empty-state')) el.innerHTML = '';
  const mine = client.user && m.author && m.author.id === client.user.id;
  const row = document.createElement('div');
  row.className = 'msg-row ' + (mine ? 'mine' : 'theirs');
  row.dataset.msgId = m.id;
  row.dataset.channelId = m.channel_id || state.activeChannelId;
  const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

  const bodyHtml = renderMessageBody(m);

  if(mine){
    row.innerHTML = `<span class="msg-time">${time}</span><div class="msg-bubble-stack">${bodyHtml}</div>${actionsHtml()}`;
  } else {
    const meta = state.channelMeta[state.activeChannelId] || {};
    const author = m.author || {};
    row.innerHTML = `
      ${meta.isGroup ? `<span class="msg-author">${escapeHtml(author.username || '')}</span>` : ''}
      <span class="msg-time">${time}</span>
      <div class="theirs-wrap">
        <div class="avatar" id="msg-av-${m.id}"><span class="fallback-init"></span></div>
        <div class="msg-bubble-stack">${bodyHtml}</div>
      </div>`;
  }
  el.appendChild(row);
  if(!mine){
    const avEl = row.querySelector(`#msg-av-${CSS.escape(String(m.id))}`);
    if(avEl) fillAvatar(avEl, avEl.querySelector('.fallback-init'), m.author, 26);
  }
  if(scroll !== false) el.scrollTop = el.scrollHeight;
}

function findMessageRow(messageId){
  const el = document.getElementById('messages');
  return el.querySelector(`.msg-row[data-msg-id="${CSS.escape(String(messageId))}"]`);
}

function updateMessageEl(m){
  const row = findMessageRow(m.id);
  if(!row) return;
  const bubble = row.querySelector('[data-role="bubble-text"]');
  if(bubble) bubble.innerHTML = `${escapeHtml(m.content || '')}${editedTag(m)}`;
}

function removeMessageEl(messageId){
  const row = findMessageRow(messageId);
  if(row) row.remove();
  const el = document.getElementById('messages');
  if(!el.children.length) el.innerHTML = '<div class="empty-state small">No messages yet. Say hello!</div>';
}

/* ---------------- edit / delete own messages ---------------- */
function startEditMessage(row){
  const channelId = row.dataset.channelId;
  const messageId = row.dataset.msgId;
  const cache = state.messageCache[channelId] || [];
  const msg = cache.find(x => String(x.id) === String(messageId));
  const bubble = row.querySelector('[data-role="bubble-text"]');
  if(!bubble || row.querySelector('.edit-box')) return;

  const original = msg ? (msg.content || '') : bubble.textContent;
  const combo = bubble.closest('.attach-combo');
  if(combo) combo.classList.add('editing');
  bubble.style.display = 'none';
  const box = document.createElement('div');
  box.className = 'edit-box';
  box.innerHTML = `<textarea class="edit-textarea">${escapeHtml(original)}</textarea>
    <div class="edit-hint">escape to <span data-role="cancel">cancel</span> &middot; enter to <span data-role="save">save</span></div>`;
  bubble.insertAdjacentElement('afterend', box);
  const textarea = box.querySelector('textarea');
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
  textarea.addEventListener('input', () => { textarea.style.height = 'auto'; textarea.style.height = textarea.scrollHeight + 'px'; });

  const cancel = () => { box.remove(); bubble.style.display = ''; if(combo) combo.classList.remove('editing'); };
  const save = async () => {
    const newContent = textarea.value.trim();
    if(!newContent){ cancel(); return; }
    if(newContent === original){ cancel(); return; }
    try {
      const updated = await client.editMessage(channelId, messageId, newContent);
      if(msg) { msg.content = updated.content != null ? updated.content : newContent; msg.edited_timestamp = updated.edited_timestamp || new Date().toISOString(); }
      updateMessageEl(msg || { id: messageId, content: newContent, edited_timestamp: new Date().toISOString() });
      cancel();
    } catch(err){
      showToast('Failed to edit: ' + err.message);
    }
  };
  box.querySelector('[data-role="cancel"]').addEventListener('click', cancel);
  box.querySelector('[data-role="save"]').addEventListener('click', save);
  textarea.addEventListener('keydown', e => {
    if(e.key === 'Escape'){ e.preventDefault(); cancel(); }
    else if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); save(); }
  });
}

async function deleteMessageRow(row){
  const channelId = row.dataset.channelId;
  const messageId = row.dataset.msgId;
  if(!confirm('Delete this message? This cannot be undone.')) return;
  try {
    await client.deleteMessage(channelId, messageId);
    const cache = state.messageCache[channelId];
    if(cache){
      const idx = cache.findIndex(x => String(x.id) === String(messageId));
      if(idx !== -1) cache.splice(idx, 1);
    }
    removeMessageEl(messageId);
  } catch(err){
    showToast('Failed to delete: ' + err.message);
  }
}

document.getElementById('messages').addEventListener('click', (e) => {
  const item = e.target.closest('.media-item');
  const video = item && item.querySelector('video');
  if(!video) return;
  if(video.paused){ video.controls = true; video.play(); item.classList.add('playing'); }
  else { video.pause(); item.classList.remove('playing'); }
});

document.getElementById('messages').addEventListener('click', (e) => {
  const btn = e.target.closest('.msg-action-btn');
  if(!btn) return;
  const row = e.target.closest('.msg-row');
  if(!row) return;
  if(btn.dataset.action === 'edit') startEditMessage(row);
  if(btn.dataset.action === 'delete') deleteMessageRow(row);
});

client.addEventListener('message-update', (e) => {
  const m = e.detail;
  const cache = state.messageCache[m.channel_id];
  if(cache){
    const idx = cache.findIndex(x => String(x.id) === String(m.id));
    if(idx !== -1) cache[idx] = { ...cache[idx], ...m };
  }
  if(m.channel_id === state.activeChannelId) updateMessageEl(m);
});

client.addEventListener('message-delete', (e) => {
  const d = e.detail;
  const cache = state.messageCache[d.channel_id];
  if(cache){
    const idx = cache.findIndex(x => String(x.id) === String(d.id));
    if(idx !== -1) cache.splice(idx, 1);
  }
  if(d.channel_id === state.activeChannelId) removeMessageEl(d.id);
});

function attachmentKind(a){
  const ct = (a.content_type || '').toLowerCase();
  if(ct.startsWith('image/')) return 'image';
  if(ct.startsWith('video/')) return 'video';
  const ext = (a.filename || '').split('.').pop().toLowerCase();
  if(['png','jpg','jpeg','gif','webp','bmp'].includes(ext)) return 'image';
  if(['mp4','webm','mov','mkv','avi'].includes(ext)) return 'video';
  return 'file';
}

function mediaItemHtml(a){
  const url = a.url || a.proxy_url;
  const kind = attachmentKind(a);
  if(kind === 'video'){
    return `<div class="media-item kind-video"><video src="${url}" preload="metadata" muted playsinline></video><div class="video-play-overlay">${ICON_PLAY}</div></div>`;
  }
  return `<div class="media-item kind-image"><img src="${url}" alt="${escapeHtml(a.filename||'')}"></div>`;
}

function attachmentHtml(a){
  return `<div class="attach-bubble"><img src="../assets/chats/template_attachment.png" alt=""><div class="attach-meta"><div class="fname"><a href="${a.url||'#'}" target="_blank" rel="noopener">${escapeHtml(a.filename||'file')}</a></div><div class="fsize">${Math.round((a.size||0)/1024)} KB</div></div></div>`;
}

function stickerHtml(s){
  const name = escapeHtml(s.name || 'sticker');
  const url = client.cdnStickerUrl(s.id, s.format_type);
  const fallback = `<div class="sticker-fallback" title="${name}">${ICON_STICKER}<span>${name}</span></div>`;
  if(!url) return `<div class="sticker-frame broken">${fallback}</div>`;
  return `<div class="sticker-frame"><img src="${url}" alt="${name}" onerror="this.style.display='none';this.parentElement.classList.add('broken')">${fallback}</div>`;
}

function renderMessageBody(m){
  // Defensive: stickers aren't wired up on the backend side yet, but render them
  // properly (per DesignRules) the moment a message ever carries sticker_items.
  if(m.sticker_items && m.sticker_items.length){
    return m.sticker_items.map(s => stickerHtml(s)).join('');
  }

  const atts = m.attachments || [];
  const media = atts.filter(a => attachmentKind(a) !== 'file');
  const files = atts.filter(a => attachmentKind(a) === 'file');

  let html = '';
  if(media.length){
    const rowHtml = media.map(a => mediaItemHtml(a)).join('');
    const gridClass = media.length === 1 ? 'grid-1' : media.length <= 4 ? 'grid-2' : 'grid-3';
    const caption = m.content ? `<div class="media-caption" data-role="bubble-text">${escapeHtml(m.content)}${editedTag(m)}</div>` : '';
    html += `<div class="attach-combo"><div class="media-row ${gridClass}">${rowHtml}</div>${caption}</div>`;
  }
  if(files.length){
    html += files.map(a => attachmentHtml(a)).join('');
    if(!media.length && m.content) html += `<div class="bubble" data-role="bubble-text">${escapeHtml(m.content)}${editedTag(m)}</div>`;
  }
  if(!media.length && !files.length){
    html += `<div class="bubble" data-role="bubble-text">${escapeHtml(m.content || '')}${editedTag(m)}</div>`;
  }
  return html;
}

/* ---------------- back / forward ---------------- */
function updateNavButtons(){
  document.getElementById('back-btn').disabled = state.historyIndex <= 0;
  document.getElementById('fwd-btn').disabled = state.historyIndex >= state.history.length - 1;
}
document.getElementById('back-btn').addEventListener('click', () => {
  if(state.historyIndex > 0){ state.historyIndex--; const h = state.history[state.historyIndex]; selectChannel(h.channelId, h.meta, false); updateNavButtons(); }
});
document.getElementById('fwd-btn').addEventListener('click', () => {
  if(state.historyIndex < state.history.length - 1){ state.historyIndex++; const h = state.history[state.historyIndex]; selectChannel(h.channelId, h.meta, false); updateNavButtons(); }
});

/* ---------------- composer ---------------- */
const input = document.getElementById('composer-input');
const sendBtn = document.getElementById('send-btn');
function updateSendState(){ sendBtn.disabled = input.value.trim().length === 0 || !state.activeChannelId; }
input.addEventListener('input', () => {
  updateSendState();
  maybeSendTyping();
  tapTypingIcon();
});
updateSendState();

function tapTypingIcon(){
  const icn = document.getElementById('typing-icn');
  icn.classList.add('tap');
  setTimeout(() => icn.classList.remove('tap'), 110);
}

function maybeSendTyping(){
  if(!state.settings.typing || !state.activeChannelId) return;
  const now = Date.now();
  if(now - state.lastTypingSent < 6000) return;
  state.lastTypingSent = now;
  client.sendTyping(state.activeChannelId);
}

async function sendMessage(){
  const text = input.value.trim();
  if(!text || !state.activeChannelId) return;
  const channelId = state.activeChannelId;
  input.value = '';
  updateSendState();
  sendBtn.disabled = true;
  try {
    const msg = await client.sendMessage(channelId, text);
    if(!state.messageCache[channelId]) state.messageCache[channelId] = [];
    // avoid double-render if the gateway echo also arrives
    if(!state.messageCache[channelId].some(m => m.id === msg.id)){
      state.messageCache[channelId].push(msg);
      if(channelId === state.activeChannelId) appendMessageEl(msg);
    }
  } catch(err){
    showToast('Failed to send: ' + err.message);
  } finally {
    updateSendState();
  }
}
sendBtn.addEventListener('click', sendMessage);
input.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); sendMessage(); } });

/* ---------------- typing indicator display ---------------- */
const typingUsersByChannel = {};
function showTypingFor(userId, username){
  const key = state.activeChannelId;
  if(!typingUsersByChannel[key]) typingUsersByChannel[key] = new Map();
  const map = typingUsersByChannel[key];
  clearTimeout(map.get(userId));
  map.set(userId, setTimeout(() => {
    map.delete(userId);
    renderTypingLine(key);
  }, 6000));
  renderTypingLine(key);
}
function renderTypingLine(channelId){
  if(channelId !== state.activeChannelId) return;
  const map = typingUsersByChannel[channelId];
  const el = document.getElementById('typing');
  const textEl = document.getElementById('typing-text');
  if(!map || map.size === 0){ el.classList.remove('show'); return; }
  const names = [...map.keys()].map(id => {
    const meta = state.channelMeta[channelId];
    if(meta && meta.avatarUser && meta.avatarUser.id === id) return meta.avatarUser.username;
    return 'Someone';
  });
  textEl.textContent = names.join(', ') + (names.length > 1 ? ' are' : ' is') + ' thinking\u2026';
  el.classList.add('show');
}

/* ---------------- attachments ---------------- */
document.getElementById('attach-btn').addEventListener('click', () => document.getElementById('file-input').click());
document.getElementById('file-input').addEventListener('change', async function(){
  const file = this.files[0];
  this.value = '';
  if(!file || !state.activeChannelId) return;
  const channelId = state.activeChannelId;
  showToast('Uploading ' + file.name + '\u2026');
  try {
    const msg = await client.sendMessage(channelId, '', file);
    if(!state.messageCache[channelId]) state.messageCache[channelId] = [];
    state.messageCache[channelId].push(msg);
    if(channelId === state.activeChannelId) appendMessageEl(msg);
  } catch(err){
    showToast('Upload failed: ' + err.message);
  }
});

/* ---------------- emoji picker ---------------- */
const EMOJI = ['\u{1F600}','\u{1F602}','\u{1F60D}','\u{1F62D}','\u{1F525}','\u{1F389}','\u{1F44D}','\u{1F64C}','\u{1F60E}','\u{1F480}','\u{1F979}','\u{1F634}','\u{1F91D}','\u{1F440}','\u{2728}','\u{1F605}','\u{1F643}','\u{1F624}'];
const picker = document.getElementById('emoji-picker');
EMOJI.forEach(e => {
  const b = document.createElement('button');
  b.textContent = e;
  b.addEventListener('click', () => { input.value += e; updateSendState(); picker.classList.remove('show'); input.focus(); });
  picker.appendChild(b);
});
document.getElementById('emoji-btn').addEventListener('click', function(e){ e.stopPropagation(); picker.classList.toggle('show'); });

/* ---------------- header actions ---------------- */
function openCall(kind){
  const meta = state.channelMeta[state.activeChannelId] || {};
  document.getElementById('call-title').textContent = 'Calling ' + (meta.name || 'user') + '\u2026';
  document.getElementById('call-sub').textContent = kind;
  const av = document.getElementById('call-avatar');
  av.innerHTML = '<span class="fallback-init"></span>';
  fillAvatar(av, av.querySelector('.fallback-init'), meta.avatarUser, 76);
  document.getElementById('call-overlay').classList.add('show');
}
document.getElementById('video-call-btn').addEventListener('click', () => openCall('Video call'));
document.getElementById('voice-call-btn').addEventListener('click', () => openCall('Voice call'));
document.getElementById('profile-video-btn').addEventListener('click', () => openCall('Video call'));
document.getElementById('profile-call-btn').addEventListener('click', () => openCall('Voice call'));
document.getElementById('end-call-btn').addEventListener('click', () => document.getElementById('call-overlay').classList.remove('show'));

document.getElementById('more-btn').addEventListener('click', function(e){ e.stopPropagation(); document.getElementById('context-menu').classList.toggle('show'); });
document.querySelectorAll('#context-menu div[data-action]').forEach(opt => {
  opt.addEventListener('click', function(e){
    e.stopPropagation();
    const action = this.dataset.action;
    document.getElementById('context-menu').classList.remove('show');
    const meta = state.channelMeta[state.activeChannelId] || {};
    if(action === 'profile') showToast('Viewing ' + (meta.name || 'profile'));
    if(action === 'mute') showToast('Conversation muted');
    if(action === 'refresh'){
      delete state.messageCache[state.activeChannelId];
      selectChannel(state.activeChannelId, meta, false);
    }
    if(action === 'block') showToast((meta.name || 'User') + ' blocked (client-side only)');
  });
});

document.getElementById('unpin-btn').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('pinned-banner').classList.add('hidden'); });

/* ---------------- mic / deafen / settings ---------------- */
document.getElementById('mic-btn').addEventListener('click', function(){ this.classList.toggle('toggled-off'); showToast(this.classList.contains('toggled-off') ? 'Microphone muted' : 'Microphone unmuted'); });
document.getElementById('deafen-btn').addEventListener('click', function(){ this.classList.toggle('toggled-off'); showToast(this.classList.contains('toggled-off') ? 'Deafened' : 'Undeafened'); });

const settingsModal = document.getElementById('settings-modal');
document.getElementById('settings-btn').addEventListener('click', () => {
  settingsModal.classList.add('show');
  if(client.user){
    document.getElementById('settings-account-username').textContent = client.user.username || '\u2014';
    document.getElementById('settings-account-bio').textContent = client.user.bio || 'No bio yet.';
  }
});
document.getElementById('settings-close').addEventListener('click', () => settingsModal.classList.remove('show'));
document.getElementById('settings-logout-btn').addEventListener('click', performLogout);

document.querySelectorAll('#settings-nav .settings-nav-item').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#settings-nav .settings-nav-item').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`.settings-panel[data-panel="${tab.dataset.panel}"]`).classList.add('active');
  });
});

function openExternalLink(url){
  if(window.paradiseNative && window.paradiseNative.openExternal) window.paradiseNative.openExternal(url);
  else showToast('Open ' + url + ' in your browser');
}
const notConfiguredYet = () => showToast('Not set up yet \u2014 check back soon');

document.getElementById('settings-social-trello').addEventListener('click', () => openExternalLink('https://trello.com/b/ZQVstPXp/paradise-roadmap'));
document.getElementById('settings-social-github').addEventListener('click', () => openExternalLink('https://github.com/HexagonUBI/Paradise'));
document.getElementById('settings-social-discord').addEventListener('click', notConfiguredYet);
document.getElementById('settings-link-roadmap').addEventListener('click', () => openExternalLink('https://trello.com/b/ZQVstPXp/paradise-roadmap'));
document.getElementById('settings-link-report').addEventListener('click', () => openExternalLink('https://github.com/HexagonUBI/Paradise/issues'));
document.getElementById('settings-link-suggest').addEventListener('click', () => openExternalLink('https://github.com/HexagonUBI/Paradise/issues'));
document.getElementById('settings-link-feedback').addEventListener('click', () => openExternalLink('https://github.com/HexagonUBI/Paradise/issues'));
document.getElementById('settings-link-help').addEventListener('click', notConfiguredYet);
document.getElementById('settings-link-status').addEventListener('click', notConfiguredYet);

/* ---------------- auto-update ---------------- */
(function initUpdater(){
  const settingsRow = document.getElementById('settings-update-row');
  const settingsBtn = document.getElementById('settings-update-btn');
  const titlebarBtn = document.getElementById('titlebar-update-btn');
  const versionEl = document.getElementById('settings-version-id');
  const updateTextEl = document.getElementById('settings-update-text');

  if(window.paradiseNative && window.paradiseNative.getAppVersion){
    window.paradiseNative.getAppVersion().then(v => { if(v) versionEl.textContent = v; }).catch(() => {});
  }
  if(!window.paradiseNative || !window.paradiseNative.onUpdateAvailable) return;

  function showUpdateUI(info){
    settingsRow.classList.remove('hidden');
    titlebarBtn.classList.remove('hidden');
    updateTextEl.textContent = (info && info.version) ? `A new update is available (${info.version}).` : 'A new update is available.';
    if(info && info.version) titlebarBtn.title = `Version ${info.version} is available \u2014 click to download`;
  }

  function startDownload(){
    settingsBtn.disabled = true;
    titlebarBtn.disabled = true;
    titlebarBtn.title = 'Downloading update\u2026';
    showToast('Downloading the latest version\u2026');
    window.paradiseNative.startUpdateDownload();
  }
  settingsBtn.addEventListener('click', startDownload);
  titlebarBtn.addEventListener('click', startDownload);

  // Covers both timing cases: the check finishing after we've already loaded
  // (event), and the check having already finished before we registered (poll).
  window.paradiseNative.getPendingUpdate().then(info => { if(info) showUpdateUI(info); }).catch(() => {});
  window.paradiseNative.onUpdateAvailable(showUpdateUI);

  window.paradiseNative.onUpdateDownloadProgress((progress) => {
    const pct = progress && progress.percent ? Math.round(progress.percent) : 0;
    titlebarBtn.title = `Downloading update\u2026 ${pct}%`;
  });
  window.paradiseNative.onUpdateDownloaded(() => {
    showToast('Update downloaded \u2014 Paradise is restarting itself to finish\u2026');
  });
  window.paradiseNative.onUpdateManual((info) => {
    settingsBtn.disabled = false;
    titlebarBtn.disabled = false;
    titlebarBtn.title = 'Update available — click to download';
    showToast('Downloaded \u2014 opened the file so you can install it (this build type can\u2019t update itself automatically).');
    void info;
  });
  window.paradiseNative.onUpdateError((info) => {
    settingsBtn.disabled = false;
    titlebarBtn.disabled = false;
    titlebarBtn.title = 'Update available — click to download';
    showToast((info && info.message) ? `Update failed: ${info.message}` : 'Update failed \u2014 try again later.');
  });
})();

/* ---------------- patch notes (pulled live from GitHub Releases) ----------------
   Deliberately not a separate CHANGELOG file to hand-maintain - whatever gets
   written in a release's notes on GitHub is what shows up here, so there's
   exactly one place to keep up to date instead of two. */
const patchNotesModal = document.getElementById('patch-notes-modal');
const patchNotesList = document.getElementById('patch-notes-list');
let patchNotesLoaded = false;

function renderMarkdownLite(md){
  if(!md) return '';
  let html = escapeHtml(md).replace(/\r\n/g, '\n');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  const out = [];
  let inList = false;
  for(const line of html.split('\n')){
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if(bullet){
      if(!inList){ out.push('<ul>'); inList = true; }
      out.push(`<li>${bullet[1]}</li>`);
      continue;
    }
    if(inList){ out.push('</ul>'); inList = false; }
    if(!line.trim()) continue;
    out.push(/^<h[1-3]>/.test(line) ? line : `<p>${line}</p>`);
  }
  if(inList) out.push('</ul>');
  return out.join('');
}

async function loadPatchNotes(){
  if(patchNotesLoaded) return;
  try {
    const res = await fetch('https://api.github.com/repos/HexagonUBI/Paradise/releases', {
      headers: { 'Accept': 'application/vnd.github+json' },
    });
    if(!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const releases = await res.json();
    if(!Array.isArray(releases) || !releases.length){
      patchNotesList.innerHTML = '<div class="empty-state small">No patch notes published yet.</div>';
      return;
    }
    patchNotesList.innerHTML = releases.slice(0, 15).map(rel => {
      const version = escapeHtml(rel.name || rel.tag_name || 'Unknown version');
      const date = rel.published_at ? new Date(rel.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
      const body = rel.body ? renderMarkdownLite(rel.body) : '<p><em>No description provided.</em></p>';
      return `<div class="patch-note-entry">
        <div class="patch-note-version">${version}</div>
        <div class="patch-note-date">${escapeHtml(date)}</div>
        <div class="patch-note-content">${body}</div>
      </div>`;
    }).join('');
    patchNotesLoaded = true;
  } catch(err){
    patchNotesList.innerHTML = `<div class="empty-state small">Couldn\u2019t load patch notes: ${escapeHtml(err.message)}</div>`;
  }
}

document.getElementById('settings-patch-notes-btn').addEventListener('click', () => {
  patchNotesModal.classList.add('show');
  loadPatchNotes();
});
document.getElementById('patch-notes-close').addEventListener('click', () => patchNotesModal.classList.remove('show'));
patchNotesModal.addEventListener('click', (e) => { if(e.target === patchNotesModal) patchNotesModal.classList.remove('show'); });

/* ---------------- profile overview modal ---------------- */
const overviewModal = document.getElementById('profile-overview-modal');
function openProfileOverview(user, statusOverride, subOverride){
  const wrap = document.getElementById('overview-avatar-wrap');
  const fb = document.getElementById('overview-avatar-fallback');
  fillAvatar(wrap, fb, user, 80);
  document.getElementById('overview-name').textContent = (user && (user.username || user.name)) || 'Unknown';
  const status = statusOverride || (user ? state.presence[user.id] : null);
  document.getElementById('overview-status-badge').innerHTML = statusDotHtml(status);
  const statusLabel = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb' }[status] || 'Offline';
  document.getElementById('overview-sub').textContent = subOverride || statusLabel;
  document.getElementById('overview-bio').textContent = (user && user.bio) || 'No bio yet.';
  overviewModal.classList.add('show');
}
document.getElementById('overview-close').addEventListener('click', () => overviewModal.classList.remove('show'));
overviewModal.addEventListener('click', (e) => { if(e.target === overviewModal) overviewModal.classList.remove('show'); });

// wire the static status bumps (me-card, chat header, right-side profile panel)
document.querySelector('#me-avatar-wrap .status-badge').addEventListener('click', (e) => {
  e.stopPropagation();
  openProfileOverview(client.user, 'online');
});
document.getElementById('header-status-badge').addEventListener('click', (e) => {
  e.stopPropagation();
  const meta = state.channelMeta[state.activeChannelId] || {};
  if(meta.avatarUser) openProfileOverview(meta.avatarUser, null, meta.sub);
});
document.getElementById('profile-status-badge').addEventListener('click', (e) => {
  e.stopPropagation();
  const meta = state.channelMeta[state.activeChannelId] || {};
  if(meta.avatarUser) openProfileOverview(meta.avatarUser, null, meta.sub);
});
document.getElementById('profile-avatar-wrap').addEventListener('click', () => {
  const meta = state.channelMeta[state.activeChannelId] || {};
  if(meta.avatarUser) openProfileOverview(meta.avatarUser, null, meta.sub);
});
document.getElementById('typing-toggle').addEventListener('change', function(){ state.settings.typing = this.checked; });
document.getElementById('notif-toggle').addEventListener('change', function(){ state.settings.notif = this.checked; });

/* ---------------- tabs / filter ---------------- */
document.querySelectorAll('.nav-tabs .tab').forEach(tab => {
  tab.addEventListener('click', function(){
    document.querySelectorAll('.nav-tabs .tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    document.getElementById('tab-indicator-img').src = `../assets/tab_indicator_${this.dataset.tab === 'requests' ? 'requests' : 'messages'}.svg`;
    if(this.dataset.tab === 'requests'){
      document.getElementById('dm-scroll').innerHTML = '<div class="empty-state small">No pending message requests.</div>';
    } else {
      state.mode === 'guild' ? renderChannelList(state.guildChannels[state.activeGuildId]) : renderDmList();
    }
  });
});
document.getElementById('filter-toggle').addEventListener('click', function(e){ e.stopPropagation(); document.getElementById('filter-menu').classList.toggle('show'); });
document.querySelectorAll('#filter-menu div').forEach(opt => {
  opt.addEventListener('click', function(e){
    e.stopPropagation();
    document.querySelectorAll('#filter-menu div').forEach(o => o.classList.remove('active'));
    this.classList.add('active');
    document.getElementById('filter-menu').classList.remove('show');
    // 'unread'/'groups' filtering left as a light-touch visual filter over the current list
    const filter = this.dataset.filter;
    document.querySelectorAll('.dm-item').forEach(item => {
      if(filter === 'all'){ item.style.display = ''; return; }
      if(filter === 'unread'){ item.style.display = item.querySelector('.dm-name').style.fontWeight === '800' ? '' : 'none'; return; }
      if(filter === 'groups'){
        const meta = state.channelMeta[item.dataset.chat];
        item.style.display = meta && meta.isGroup ? '' : 'none';
      }
    });
  });
});

/* ---------------- endless chat history (scroll-up pagination) ---------------- */
document.getElementById('messages').addEventListener('scroll', function(){
  if(this.scrollTop < 80) loadOlderMessages(state.activeChannelId);
});

/* ---------------- close-behavior: ask / minimize to tray / quit ----------------
   The actual "close Paradise?" confirmation is now a real separate OS window
   (see main.js showCloseConfirmWindow) styled like a native app-quit dialog,
   not an in-page overlay - this block only drives the Settings > General pill
   control for the underlying preference. */
const closeBehaviorPills = document.getElementById('close-behavior-pills');
function setActiveCloseBehaviorPill(value){
  closeBehaviorPills.querySelectorAll('.pill-choice').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}
closeBehaviorPills.querySelectorAll('.pill-choice').forEach(btn => {
  btn.addEventListener('click', () => {
    setActiveCloseBehaviorPill(btn.dataset.value);
    if(window.paradiseNative) window.paradiseNative.setCloseBehavior(btn.dataset.value);
  });
});
if(window.paradiseNative){
  window.paradiseNative.getCloseBehavior().then(value => setActiveCloseBehaviorPill(value || 'ask')).catch(() => {});
  // Keeps the Settings pill in sync if "remember my choice" was checked in the separate confirm window.
  if(window.paradiseNative.onCloseBehaviorChanged){
    window.paradiseNative.onCloseBehaviorChanged((value) => setActiveCloseBehaviorPill(value || 'ask'));
  }
}

/* ---------------- window chrome (real OS window, via preload bridge) ---------------- */
document.getElementById('brand-btn').addEventListener('click', () => document.getElementById('home-row').click());
document.getElementById('add-server-btn').addEventListener('click', () => showToast('Server creation isn\u2019t wired up yet'));
document.getElementById('min-btn').addEventListener('click', () => window.paradiseNative.minimize());
document.getElementById('max-btn').addEventListener('click', () => window.paradiseNative.toggleMaximize());
document.getElementById('close-btn').addEventListener('click', () => window.paradiseNative.close());

async function performLogout(){
  client.disconnectGateway();
  if(window.paradiseNative) await window.paradiseNative.clearAuth().catch(() => {});
  location.reload();
}

document.getElementById('logout-btn').addEventListener('click', performLogout);

if(window.paradiseNative){
  const maxIcon = document.getElementById('max-btn');
  const setMaxIcon = (maximized) => {
    maxIcon.innerHTML = maximized
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M8 8V5a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1h-3M8 8H5a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-3M8 8h8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" stroke-width="2"/></svg>';
  };
  window.paradiseNative.isMaximized().then(setMaxIcon);
  window.paradiseNative.onWindowStateChange((state) => setMaxIcon(state.maximized));
}

document.addEventListener('click', () => {
  document.getElementById('filter-menu').classList.remove('show');
  document.getElementById('context-menu').classList.remove('show');
  document.getElementById('emoji-picker').classList.remove('show');
});

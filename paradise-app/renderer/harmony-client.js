/* =========================================================================
   Harmony client library
   Talks to any Harmony / Spacebar (Discord-API-compatible) instance:
     - instance discovery via /.well-known/spacebar
     - REST auth + messaging
     - Gateway (WebSocket) for realtime events

   This is a real network client. It will only work against a Harmony
   instance that has CORS enabled for the origin this page is served from.
   ========================================================================= */

const GatewayOp = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
};

class HarmonyError extends Error {
  constructor(message, cause){ super(message); this.name = 'HarmonyError'; this.cause = cause; }
}

class HarmonyClient extends EventTarget {
  constructor(){
    super();
    this.apiBase = null;      // e.g. https://api.example.com/api/v9
    this.gatewayUrl = null;   // e.g. wss://gateway.example.com
    this.cdnBase = null;
    this.token = null;
    this.ws = null;
    this.heartbeatTimer = null;
    this.seq = null;
    this.sessionId = null;
    this.user = null;
    this.reconnectAttempts = 0;
    this._closedByUser = false;
  }

  emit(name, detail){ this.dispatchEvent(new CustomEvent(name, { detail })); }

  /* ---------------- instance discovery ---------------- */
  async discover(domainOrUrl){
    let input = domainOrUrl.trim();
    if(!/^https?:\/\//i.test(input)) input = 'https://' + input;
    const url = new URL(input);

    // If the user already pasted a full API base (contains /api), just use it directly.
    if(/\/api(\/|$)/i.test(url.pathname)){
      this.apiBase = input.replace(/\/$/, '');
      await this._deriveFromApiBase();
      return { api: this.apiBase, gateway: this.gatewayUrl, cdn: this.cdnBase };
    }

    // Otherwise try well-known discovery on the bare domain.
    const wellKnownUrl = `${url.protocol}//${url.host}/.well-known/spacebar`;
    try {
      const res = await fetch(wellKnownUrl, { headers: { 'Accept': 'application/json' } });
      if(!res.ok) throw new Error('well-known returned ' + res.status);
      const data = await res.json();
      this.apiBase = (data.api || '').replace(/\/$/, '');
      this.gatewayUrl = data.gateway || null;
      this.cdnBase = data.cdn || null;
      if(!this.apiBase) throw new Error('well-known response missing api field');
      if(!this.gatewayUrl) await this._deriveFromApiBase(true);
      return { api: this.apiBase, gateway: this.gatewayUrl, cdn: this.cdnBase };
    } catch(err){
      // Fall back: assume api.<domain>/api/v9 convention, and derive gateway similarly.
      this.apiBase = `${url.protocol}//${url.host}/api/v9`;
      await this._deriveFromApiBase();
      return { api: this.apiBase, gateway: this.gatewayUrl, cdn: this.cdnBase, guessed: true };
    }
  }

  async _deriveFromApiBase(skipApiCheck){
    // Ask the instance itself for its gateway endpoint (Discord-compatible /gateway route).
    try {
      const res = await fetch(`${this.apiBase}/gateway`);
      if(res.ok){
        const data = await res.json();
        if(data.url) this.gatewayUrl = data.url;
      }
    } catch(e){ /* ignore, we'll fall back below */ }

    if(!this.gatewayUrl){
      // Best-effort guess: swap api.* host for gateway.* host.
      try {
        const u = new URL(this.apiBase);
        const host = u.host.replace(/^api\./, 'gateway.');
        this.gatewayUrl = `wss://${host}`;
      } catch(e){ /* leave null, caller must supply manually */ }
    }
  }

  /* ---------------- REST ---------------- */
  async _rest(method, path, body, isForm){
    if(!this.apiBase) throw new HarmonyError('Not connected to an instance yet.');
    const headers = {};
    if(this.token) headers['Authorization'] = this.token;
    let fetchBody;
    if(isForm){
      fetchBody = body; // FormData sets its own content-type
    } else if(body !== undefined){
      headers['Content-Type'] = 'application/json';
      fetchBody = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(this.apiBase + path, { method, headers, body: fetchBody });
    } catch(err){
      throw new HarmonyError(
        `Network request to ${this.apiBase}${path} failed. This almost always means the instance is unreachable or hasn't enabled CORS for this origin.`, err
      );
    }
    let data = null;
    const text = await res.text();
    if(text){ try{ data = JSON.parse(text); } catch(e){ data = text; } }
    if(!res.ok){
      const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
      const e = new HarmonyError(msg);
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  async login(login, password){
    const data = await this._rest('POST', '/auth/login', { login, password, undelete: false });
    if(data && data.mfa){
      const e = new HarmonyError('This account has multi-factor authentication enabled. MFA login is not supported in this client.');
      e.mfa = true;
      throw e;
    }
    if(!data || !data.token) throw new HarmonyError('Login succeeded but no token was returned.');
    this.token = data.token;
    return data.token;
  }

  async register(username, email, password){
    const data = await this._rest('POST', '/auth/register', {
      username, email, password, consent: true, date_of_birth: '2000-01-01'
    });
    if(!data || !data.token) throw new HarmonyError('Registration succeeded but no token was returned.');
    this.token = data.token;
    return data.token;
  }

  async fetchMe(){ return this._rest('GET', '/users/@me'); }
  async fetchDMs(){ return this._rest('GET', '/users/@me/channels'); }
  async fetchGuilds(){ return this._rest('GET', '/users/@me/guilds'); }
  async fetchMessages(channelId, limit, before){
    let path = `/channels/${channelId}/messages?limit=${limit||50}`;
    if(before) path += `&before=${encodeURIComponent(before)}`;
    return this._rest('GET', path);
  }

  async sendMessage(channelId, content, file){
    if(file){
      const form = new FormData();
      form.append('payload_json', JSON.stringify({ content: content || '' }));
      form.append('files[0]', file, file.name);
      return this._rest('POST', `/channels/${channelId}/messages`, form, true);
    }
    return this._rest('POST', `/channels/${channelId}/messages`, { content });
  }

  async sendTyping(channelId){
    try { await this._rest('POST', `/channels/${channelId}/typing`); } catch(e){ /* non-critical */ }
  }

  async editMessage(channelId, messageId, content){
    return this._rest('PATCH', `/channels/${channelId}/messages/${messageId}`, { content });
  }

  async deleteMessage(channelId, messageId){
    return this._rest('DELETE', `/channels/${channelId}/messages/${messageId}`);
  }

  async openDM(recipientId){
    return this._rest('POST', '/users/@me/channels', { recipients: [recipientId] });
  }

  /* ---------------- friends / relationships ---------------- */
  async fetchRelationships(){ return this._rest('GET', '/users/@me/relationships'); }

  async sendFriendRequest(username, discriminator){
    const body = discriminator ? { username, discriminator } : { username };
    return this._rest('POST', '/users/@me/relationships', body);
  }

  async acceptFriendRequest(userId){ return this._rest('PUT', `/users/@me/relationships/${userId}`, { type: 1 }); }
  async removeRelationship(userId){ return this._rest('DELETE', `/users/@me/relationships/${userId}`); }

  _resolveCdnBase(){
    return this.cdnBase || (this.apiBase ? this.apiBase.replace(/\/api\/v\d+$/, '').replace(/^https?:\/\/api\./, 'https://cdn.') : null);
  }

  cdnAvatarUrl(userId, avatarHash){
    if(!avatarHash) return null;
    const base = this._resolveCdnBase();
    if(!base) return null;
    const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
    return `${base}/avatars/${userId}/${avatarHash}.${ext}`;
  }

  cdnGuildIconUrl(guildId, iconHash){
    if(!iconHash) return null;
    const base = this._resolveCdnBase();
    if(!base) return null;
    const ext = iconHash.startsWith('a_') ? 'gif' : 'png';
    return `${base}/icons/${guildId}/${iconHash}.${ext}`;
  }

  /* ---------------- Gateway ---------------- */
  connectGateway(){
    if(!this.gatewayUrl) throw new HarmonyError('No gateway URL known for this instance.');
    this._closedByUser = false;
    const url = this.gatewayUrl.replace(/\/$/, '') + '/?encoding=json&v=9';
    this.emit('gateway-status', { status: 'connecting' });
    let ws;
    try { ws = new WebSocket(url); }
    catch(err){ this.emit('gateway-status', { status: 'error', error: err }); return; }
    this.ws = ws;

    ws.onopen = () => { this.reconnectAttempts = 0; };
    ws.onmessage = (ev) => this._handleGatewayMessage(ev);
    ws.onerror = (ev) => this.emit('gateway-status', { status: 'error', error: ev });
    ws.onclose = (ev) => {
      clearInterval(this.heartbeatTimer);
      this.emit('gateway-status', { status: 'closed', code: ev.code, reason: ev.reason });
      if(!this._closedByUser){
        this.reconnectAttempts++;
        const delay = Math.min(30000, 1000 * Math.pow(1.6, this.reconnectAttempts));
        this.emit('gateway-status', { status: 'reconnecting', inMs: delay });
        setTimeout(() => { if(!this._closedByUser) this.connectGateway(); }, delay);
      }
    };
  }

  disconnectGateway(){
    this._closedByUser = true;
    clearInterval(this.heartbeatTimer);
    if(this.ws) this.ws.close();
  }

  _send(op, d){
    if(this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d }));
  }

  _identify(){
    this._send(GatewayOp.IDENTIFY, {
      token: this.token,
      properties: { os: 'web', browser: 'Paradise', device: 'Paradise' },
      compress: false,
      capabilities: 4093,
    });
  }

  _handleGatewayMessage(ev){
    let payload;
    try { payload = JSON.parse(ev.data); } catch(e){ return; }
    const { op, d, s, t } = payload;
    if(s != null) this.seq = s;

    switch(op){
      case GatewayOp.HELLO: {
        const interval = d.heartbeat_interval;
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => this._send(GatewayOp.HEARTBEAT, this.seq), interval);
        this._identify();
        this.emit('gateway-status', { status: 'identifying' });
        break;
      }
      case GatewayOp.HEARTBEAT_ACK:
        break;
      case GatewayOp.INVALID_SESSION:
        this.emit('gateway-status', { status: 'invalid-session' });
        break;
      case GatewayOp.RECONNECT:
        if(this.ws) this.ws.close();
        break;
      case GatewayOp.DISPATCH:
        this._handleDispatch(t, d);
        break;
    }
  }

  _handleDispatch(type, d){
    switch(type){
      case 'READY':
        this.user = d.user;
        this.sessionId = d.session_id;
        this.emit('gateway-status', { status: 'ready' });
        this.emit('ready', d);
        break;
      case 'MESSAGE_CREATE':
        this.emit('message', d);
        break;
      case 'MESSAGE_UPDATE':
        this.emit('message-update', d);
        break;
      case 'MESSAGE_DELETE':
        this.emit('message-delete', d);
        break;
      case 'TYPING_START':
        this.emit('typing', d);
        break;
      case 'PRESENCE_UPDATE':
        this.emit('presence', d);
        break;
      case 'CHANNEL_CREATE':
        this.emit('channel-create', d);
        break;
      case 'RELATIONSHIP_ADD':
        this.emit('relationship-add', d);
        break;
      case 'RELATIONSHIP_REMOVE':
        this.emit('relationship-remove', d);
        break;
      default:
        this.emit('dispatch', { type, d });
    }
  }
}

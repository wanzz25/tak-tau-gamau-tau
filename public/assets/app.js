// ═══════════════════════════════════════════════════
// MC AutoBackup v3 — Vercel Edition
// Data: localStorage | Proxy: /api/*
// ═══════════════════════════════════════════════════

// ─── Storage (semua data di localStorage) ────────
const DB = {
  // Users
  getUsers() { return this._get('users', [{ id:1, username:'admin', password:'wanzz3369', role:'admin', displayName:'Wanzz', createdAt: new Date().toISOString(), lastLogin:null }]); },
  saveUsers(v) { this._set('users', v); },

  // API Keys
  getKeys()   { return this._get('apikeys', []); },
  saveKeys(v) { this._set('apikeys', v); },

  // Backup history
  getBackups()   { return this._get('backups', []); },
  saveBackups(v) { this._set('backups', v.slice(0, 500)); },

  // Session
  getSession()  { return this._get('session', null); },
  setSession(v) { this._set('session', v); },
  clearSession(){ localStorage.removeItem('mcb_session'); },

  _get(k, def) { try { const v = localStorage.getItem('mcb_'+k); return v ? JSON.parse(v) : def; } catch { return def; } },
  _set(k, v)   { localStorage.setItem('mcb_'+k, JSON.stringify(v)); }
};

// ─── Auth ─────────────────────────────────────────
const Auth = {
  login(username, password) {
    const users = DB.getUsers();
    const user  = users.find(u => u.username === username && u.password === password);
    if (!user) return null;
    // update lastLogin
    const idx = users.findIndex(u => u.id === user.id);
    users[idx].lastLogin = new Date().toISOString();
    DB.saveUsers(users);
    const session = { id: user.id, username: user.username, role: user.role, displayName: user.displayName };
    DB.setSession(session);
    return session;
  },
  logout() { DB.clearSession(); },
  me()     { return DB.getSession(); },
  require(to = '/index.html') {
    const s = this.me();
    if (!s) { window.location.href = to; return null; }
    return s;
  },
  requireAdmin(to = '/pages/dashboard.html') {
    const s = this.require();
    if (s && s.role !== 'admin') { window.location.href = to; return null; }
    return s;
  }
};

// ─── API Keys Manager ─────────────────────────────
const KeyDB = {
  getAll()   { return DB.getKeys(); },
  getActive(){ return DB.getKeys().filter(k => k.active); },

  add({ label, panelUrl, apiKey, serverUuid, prefix }) {
    const keys = DB.getKeys();
    const entry = {
      id:         Date.now(),
      label:      label.trim(),
      panelUrl:   panelUrl.trim().replace(/\/$/,''),
      apiKey:     apiKey.trim(),   // tersimpan di localStorage
      serverUuid: serverUuid.trim(),
      prefix:     (prefix||'mc-backup').trim(),
      active:     true,
      createdAt:  new Date().toISOString(),
      lastUsed:   null, lastTest: null, testStatus: null, serverName: null
    };
    keys.push(entry);
    DB.saveKeys(keys);
    return entry;
  },

  update(id, fields) {
    const keys = DB.getKeys();
    const idx  = keys.findIndex(k => k.id === id);
    if (idx === -1) return false;
    const allowed = ['label','panelUrl','apiKey','serverUuid','prefix','active','testStatus','lastTest','serverName','lastUsed'];
    allowed.forEach(f => { if (fields[f] !== undefined) keys[idx][f] = fields[f]; });
    DB.saveKeys(keys);
    return true;
  },

  delete(id) {
    DB.saveKeys(DB.getKeys().filter(k => k.id !== id));
  },

  maskKey(key) { return key ? '••••••••' + key.slice(-6) : '—'; }
};

// ─── Backup History ───────────────────────────────
const BackupDB = {
  getAll()  { return DB.getBackups(); },
  add(entry){ const all = DB.getBackups(); all.unshift({ id: Date.now(), createdAt: new Date().toISOString(), ...entry }); DB.saveBackups(all); },
  delete(id){ DB.saveBackups(DB.getBackups().filter(b => b.id !== id)); },
  trimForKey(keyId, max) {
    let all = DB.getBackups();
    const forKey = all.filter(b => b.keyId === keyId);
    const toRemove = forKey.slice(max).map(b => b.id);
    if (toRemove.length) DB.saveBackups(all.filter(b => !toRemove.includes(b.id)));
  }
};

// ─── Vercel API Proxy ─────────────────────────────
const Proxy = {
  async call(endpoint, body) {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  },

  // Test koneksi panel
  async test(key) {
    return this.call('/api/test', {
      panelUrl: key.panelUrl, apiKey: key.apiKey, serverUuid: key.serverUuid
    });
  },

  // Buat backup
  async createBackup(key, name) {
    return this.call('/api/backup/create', {
      panelUrl: key.panelUrl, apiKey: key.apiKey, serverUuid: key.serverUuid,
      name, isLocked: false
    });
  },

  // Cek status backup
  async backupStatus(key, backupUuid) {
    return this.call('/api/backup/status', {
      panelUrl: key.panelUrl, apiKey: key.apiKey, serverUuid: key.serverUuid, backupUuid
    });
  }
};

// ─── Toast ────────────────────────────────────────
const Toast = {
  _c: null,
  init() { if (!this._c) { let e=document.getElementById('toast'); if(!e){e=document.createElement('div');e.id='toast';document.body.appendChild(e);} this._c=e; } },
  show(msg, type='ok', dur=3500) {
    this.init();
    const el=document.createElement('div');
    el.className='toast-item'+(type==='err'?' err':type==='warn'?' warn':'');
    el.textContent=(type==='err'?'✖ ':type==='warn'?'⚠ ':'✔ ')+msg;
    this._c.appendChild(el);
    requestAnimationFrame(()=>el.classList.add('show'));
    setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),400);},dur);
  },
  ok(m)   { this.show(m,'ok'); },
  err(m)  { this.show(m,'err'); },
  warn(m) { this.show(m,'warn'); }
};

// ─── Helpers ──────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function fmtSize(mb) {
  if (!mb) return '0 MB';
  return mb >= 1024 ? (mb/1024).toFixed(2)+' GB' : parseFloat(mb).toFixed(1)+' MB';
}
function avatarColor(l) {
  return ['#00e5a0','#60a5fa','#f472b6','#ffd166','#a78bfa','#fb923c'][(l||'A').charCodeAt(0)%6];
}
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

const KEY_COLORS=['#00e5a0','#60a5fa','#f472b6','#ffd166','#a78bfa','#fb923c','#34d399','#f87171'];
function keyColor(i){ return KEY_COLORS[i%KEY_COLORS.length]; }

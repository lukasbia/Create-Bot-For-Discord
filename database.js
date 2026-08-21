/**
 * Lightweight JSON-file database (Termux-friendly, no native deps)
 */
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch {}
  return { users: {}, bots: {}, scripts: {}, variables: {}, logs: {} };
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 0));
}

let store = load();

function persist() {
  save(store);
}

const users = {
  upsert(googleProfile) {
    const gid = googleProfile.id;
    let user = Object.values(store.users).find(u => u.google_id === gid);
    if (user) {
      user.name = googleProfile.displayName;
      user.email = googleProfile.emails?.[0]?.value || '';
      user.avatar = googleProfile.photos?.[0]?.value || '';
      user.last_login = Math.floor(Date.now() / 1000);
    } else {
      const id = uuid();
      user = {
        id,
        google_id: gid,
        email: googleProfile.emails?.[0]?.value || '',
        name: googleProfile.displayName,
        avatar: googleProfile.photos?.[0]?.value || '',
        created_at: Math.floor(Date.now() / 1000),
        last_login: Math.floor(Date.now() / 1000)
      };
      store.users[id] = user;
    }
    persist();
    return user;
  },
  findById(id) {
    return store.users[id] || null;
  }
};

const bots = {
  listByUser(userId) {
    return Object.values(store.bots)
      .filter(b => b.user_id === userId)
      .map(b => ({
        id: b.id, name: b.name, avatar: b.avatar, banner: b.banner,
        status: b.status, hosting_until: b.hosting_until,
        invite_url: b.invite_url, client_id: b.client_id, created_at: b.created_at
      }))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  },
  get(id) {
    return store.bots[id] || null;
  },
  create({ userId, name, token, clientId, avatar, banner, inviteUrl }) {
    const id = uuid();
    const now = Math.floor(Date.now() / 1000);
    store.bots[id] = {
      id, user_id: userId, name, token,
      client_id: clientId || null,
      avatar: avatar || null,
      banner: banner || null,
      invite_url: inviteUrl || null,
      status: 'offline',
      hosting_until: 0,
      created_at: now,
      updated_at: now
    };
    persist();
    return store.bots[id];
  },
  update(id, fields) {
    const b = store.bots[id];
    if (!b) return null;
    const allowed = ['name', 'token', 'avatar', 'banner', 'status', 'hosting_until', 'invite_url', 'client_id'];
    for (const k of allowed) {
      if (fields[k] !== undefined) b[k] = fields[k];
    }
    b.updated_at = Math.floor(Date.now() / 1000);
    persist();
    return b;
  },
  delete(id) {
    delete store.bots[id];
    for (const sid of Object.keys(store.scripts)) {
      if (store.scripts[sid].bot_id === id) delete store.scripts[sid];
    }
    for (const vid of Object.keys(store.variables)) {
      if (store.variables[vid].bot_id === id) delete store.variables[vid];
    }
    delete store.logs[id];
    persist();
  },
  getToken(id) {
    return store.bots[id]?.token || null;
  }
};

const scripts = {
  listByBot(botId) {
    return Object.values(store.scripts)
      .filter(s => s.bot_id === botId)
      .map(s => ({
        id: s.id, name: s.name, trigger_type: s.trigger_type,
        trigger_value: s.trigger_value, language: s.language,
        enabled: s.enabled, created_at: s.created_at, updated_at: s.updated_at
      }))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  },
  get(id) {
    return store.scripts[id] || null;
  },
  create({ botId, name, triggerType, triggerValue, language, source, compiledJs }) {
    const id = uuid();
    const now = Math.floor(Date.now() / 1000);
    store.scripts[id] = {
      id, bot_id: botId, name,
      trigger_type: triggerType || 'message',
      trigger_value: triggerValue || '',
      language: language || 'cbscript',
      source: source || '',
      compiled_js: compiledJs || '',
      enabled: 1,
      created_at: now,
      updated_at: now
    };
    persist();
    return store.scripts[id];
  },
  update(id, fields) {
    const s = store.scripts[id];
    if (!s) return null;
    const allowed = ['name', 'trigger_type', 'trigger_value', 'language', 'source', 'compiled_js', 'enabled'];
    for (const k of allowed) {
      if (fields[k] !== undefined) s[k] = fields[k];
    }
    s.updated_at = Math.floor(Date.now() / 1000);
    persist();
    return s;
  },
  delete(id) {
    delete store.scripts[id];
    persist();
  },
  getEnabledForBot(botId) {
    return Object.values(store.scripts).filter(s => s.bot_id === botId && s.enabled);
  }
};

const variables = {
  listByBot(botId) {
    return Object.values(store.variables)
      .filter(v => v.bot_id === botId)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  get(botId, name, scope = 'global') {
    return Object.values(store.variables).find(v =>
      v.bot_id === botId && v.name === name && v.scope === scope
    ) || null;
  },
  set({ botId, name, value, scope = 'global' }) {
    let v = this.get(botId, name, scope);
    if (v) {
      v.value = String(value ?? '');
      v.updated_at = Math.floor(Date.now() / 1000);
    } else {
      const id = uuid();
      v = {
        id, bot_id: botId, name,
        value: String(value ?? ''),
        scope,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000)
      };
      store.variables[id] = v;
    }
    persist();
    return v;
  },
  delete(id) {
    delete store.variables[id];
    persist();
  },
  deleteByName(botId, name, scope = 'global') {
    const v = this.get(botId, name, scope);
    if (v) this.delete(v.id);
  }
};

const logs = {
  add(botId, level, message) {
    if (!store.logs[botId]) store.logs[botId] = [];
    store.logs[botId].push({
      id: Date.now(),
      bot_id: botId,
      level: level || 'info',
      message: String(message).slice(0, 4000),
      created_at: Math.floor(Date.now() / 1000)
    });
    if (store.logs[botId].length > 300) {
      store.logs[botId] = store.logs[botId].slice(-300);
    }
    persist();
  },
  list(botId, limit = 100) {
    const arr = store.logs[botId] || [];
    return arr.slice(-limit).reverse();
  },
  clear(botId) {
    store.logs[botId] = [];
    persist();
  }
};

module.exports = { users, bots, scripts, variables, logs };

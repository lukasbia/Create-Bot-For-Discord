require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const Database = require('./database');
const BotManager = require('./bot-manager');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'db.json'));
const botManager = new BotManager(db);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'cbscript_default_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Simple rate limiter
const rateLimits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 60;

  if (!rateLimits.has(ip)) rateLimits.set(ip, []);
  const requests = rateLimits.get(ip).filter(t => now - t < windowMs);
  requests.push(now);
  rateLimits.set(ip, requests);

  if (requests.length > maxRequests) {
    return res.status(429).json({ error: 'Too many requests. Slow down.' });
  }
  next();
}
app.use(rateLimit);

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.user = db.getUserById(req.session.userId);
  if (!req.user) {
    req.session.destroy();
    return res.status(401).json({ error: 'User not found' });
  }
  next();
}

// ─── DISCORD OAUTH ───
app.get('/auth/discord', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
  const scope = encodeURIComponent('identify');
  const url = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/?error=oauth_denied');

  try {
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const { access_token } = tokenRes.data;

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const discordUser = userRes.data;
    let user = db.getUserByDiscordId(discordUser.id);

    if (!user) {
      user = db.createUser({
        discord_id: discordUser.id,
        username: discordUser.username,
        avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null,
        access_token,
        refresh_token: tokenRes.data.refresh_token
      });
    } else {
      db.updateUser = (id, updates) => {
        const u = db.getUserById(id);
        if (u) { Object.assign(u, updates); db.save(); }
        return u;
      };
      db.updateUser(user.id, {
        username: discordUser.username,
        avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : user.avatar,
        access_token,
        refresh_token: tokenRes.data.refresh_token
      });
    }

    req.session.userId = user.id;
    res.redirect('/');
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    res.redirect('/?error=oauth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    discord_id: req.user.discord_id,
    username: req.user.username,
    avatar: req.user.avatar
  });
});

// ─── BOTS ───
app.get('/api/bots', requireAuth, (req, res) => {
  const bots = db.getBotsByUser(req.user.id).map(b => ({
    ...b,
    token: undefined // Never send token to client
  }));
  res.json(bots);
});

app.post('/api/bots', requireAuth, (req, res) => {
  const { name, token } = req.body;
  if (!name || !token) return res.status(400).json({ error: 'Name and token required' });
  if (name.length > 32) return res.status(400).json({ error: 'Name too long (max 32)' });
  if (!token.match(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)) {
    return res.status(400).json({ error: 'Invalid token format' });
  }

  const bot = db.createBot({
    user_id: req.user.id,
    name: name.trim(),
    token: token.trim(),
    avatar_url: null,
    banner_url: null
  });

  res.json({ ...bot, token: undefined });
});

app.get('/api/bots/:id', requireAuth, (req, res) => {
  const bot = db.getBot(parseInt(req.params.id));
  if (!bot || bot.user_id !== req.user.id) return res.status(404).json({ error: 'Bot not found' });
  res.json({ ...bot, token: undefined });
});

app.put('/api/bots/:id', requireAuth, (req, res) => {
  const bot = db.getBot(parseInt(req.params.id));
  if (!bot || bot.user_id !== req.user.id) return res.status(404).json({ error: 'Bot not found' });

  const updates = {};
  if (req.body.name) updates.name = req.body.name.trim();
  if (req.body.token) {
    if (!req.body.token.match(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)) {
      return res.status(400).json({ error: 'Invalid token format' });
    }
    updates.token = req.body.token.trim();
  }

  db.updateBot(bot.id, updates);
  res.json({ ...db.getBot(bot.id), token: undefined });
});

app.delete('/api/bots/:id', requireAuth, async (req, res) => {
  const bot = db.getBot(parseInt(req.params.id));
  if (!bot || bot.user_id !== req.user.id) return res.status(404).json({ error: 'Bot not found' });

  await botManager.stopBot(bot.id);
  db.deleteBot(bot.id);
  res.json({ success: true });
});

// ─── HOSTING ───
app.post('/api/bots/:id/start', requireAuth, async (req, res) => {
  const bot = db.getBot(parseInt(req.params.id));
  if (!bot || bot.user_id !== req.user.id) return res.status(404).json({ error: 'Bot not found' });

  try {
    await botManager.startBot(bot.id);
    res.json({ success: true, status: 'online' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bots/:id/stop', requireAuth, async (req, res) => {
  const bot = db.getBot(parseInt(req.params.id));
  if (!bot || bot.user_id !== req.user.id) return res.status(404).json({ error: 'Bot not found' });

  await botManager.stopBot(bot.id);
  res.json({ success: true, status: 'offline' });
});

app.post('/api/bots/:id/restart', requireAuth, async (req, res) => {
  const bot = db.getBot(parseInt(req.params.id));
  if (!bot || bot.user_id !== req.user.id) return res.status(404).json({ error: 'Bot not found' });

  try {
    await botManager.restartBot(bot.id);
    res.json({ success: true, status: 'online' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bots/:id/hosting', requireAuth, (req, res) => {
  const bot = db.getBot(parseInt(req.params.id));
  if (!bot || bot.user_id !== req.user.id) return res.status(404).json({ error: 'Bot not found' });

  // Add 24 hours to hosting
  const now = new Date();
  const currentExpiry = bot.hosting_expires_at ? new Date(bot.hosting_expires_at) : now;
  const baseTime = currentExpiry > now ? currentExpiry : now;
  const newExpiry = new Date(baseTime.getTime() + 24 * 60 * 60 * 1000);

  db.updateBot(bot.id, { hosting_expires_at: newExpiry.toISOString() });
  db.addLog(bot.id, 'info', `Hosting extended until ${newExpiry.toLocaleString()}`);

  // If bot is running, reschedule expiry check
  if (botManager.clients.has(bot.id)) {
    botManager.scheduleExpiryCheck(bot.id);
  }

  res.json({
    success: true,
    hosting_expires_at: newExpiry.toISOString(),
    message: `Hosting extended by 24 hours. Expires: ${newExpiry.toLocaleString()}`
  });
});

// ─── SCRIPTS ───
app.get('/api/bots/:id/scripts', requireAuth, (req, res) => {
  const bot = db.getBot(parseInt(req.params.id));
  if (!bot || bot.user_id !== req.user.id) return res.status(404).json({ error: 'Bot not found' });
  res.json(db.getScripts(bot.id));
});

app.post('/api/bots/:id/scripts', requireAuth, (req, res) => {
  const bot = db.getBot(parseInt(req.params.id));
  if (!bot || bot.user_id !== req.user.id) return res.status(404).json({ error: 'Bot not found' });

  const { name, trigger, language, code } = req.body;
  if (!name || !trigger || !language || code === undefined) {
    return res.status(400).json({ error: 'Name, trigger, language, and code required' });
  }

  const validLangs = ['cbscript', 'javascript', 'python'];
  if (!validLangs.includes(language)) {
    return res.status(400).json({ error: 'Invalid language. Use cbscript, javascript, or python' });
  }

  let compiledCode = null;
  if (language === 'cbscript') {
    try {
      const compiler = require('./cbscript-compiler');
      const c = new compiler();
      const result = c.compile(code, trigger);
      compiledCode = result.code;
    } catch (err) {
      return res.status(400).json({ error: `Compilation failed: ${err.message}` });
    }
  }

  const script = db.createScript({
    bot_id: bot.id,
    name: name.trim(),
    trigger: trigger.trim(),
    language,
    code: code.trim(),
    compiled_code: compiledCode
  });

  // Restart bot if online to load new script
  if (botManager.clients.has(bot.id)) {
    botManager.restartBot(bot.id).catch(() => {});
  }

  res.json(script);
});

app.put('/api/scripts/:id', requireAuth, (req, res) => {
  const script = db.getScript(parseInt(req.params.id));
  if (!script) return res.status(404).json({ error: 'Script not found' });

  const bot = db.getBot(script.bot_id);
  if (!bot || bot.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const updates = {};
  if (req.body.name) updates.name = req.body.name.trim();
  if (req.body.trigger) updates.trigger = req.body.trigger.trim();
  if (req.body.code !== undefined) updates.code = req.body.code.trim();
  if (req.body.language) updates.language = req.body.language;

  if (updates.language === 'cbscript' || (updates.code && script.language === 'cbscript')) {
    try {
      const compiler = require('./cbscript-compiler');
      const c = new compiler();
      const result = c.compile(updates.code || script.code, updates.trigger || script.trigger);
      updates.compiled_code = result.code;
    } catch (err) {
      return res.status(400).json({ error: `Compilation failed: ${err.message}` });
    }
  }

  db.updateScript(script.id, updates);

  if (botManager.clients.has(bot.id)) {
    botManager.restartBot(bot.id).catch(() => {});
  }

  res.json(db.getScript(script.id));
});

app.delete('/api/scripts/:id', requireAuth, (req, res) => {
  const script = db.getScript(parseInt(req.params.id));
  if (!script) return res.status(404).json({ error: 'Script not found' });

  const bot = db.getBot(script.bot_id);
  if (!bot || bot.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  db.deleteScript(script.id);

  if (botManager.clients.has(bot.id)) {
    botManager.restartBot(bot.id).catch(() => {});
  }

  res.json({ success: true });
});

// ─── VARIABLES ───
app.get('/api/bots/:id/variables', requireAuth, (req, res) => {
  const bot = db.getBot(parseInt(req.params.id));
  if (!bot || bot.user_id !== req.user.id) return res.status(404).json({ error: 'Bot not found' });
  res.json(db.getVariables(bot.id));
});

app.post('/api/bots/:id/variables', requireAuth, (req, res) => {
  const bot = db.getBot(parseInt(req.params.id));
  if (!bot || bot.user_id !== req.user.id) return res.status(404).json({ error: 'Bot not found' });

  const { name, value, scope } = req.body;
  if (!name) return res.status(400).json({ error: 'Variable name required' });

  db.setVariable(bot.id, name.trim(), value !== undefined ? String(value) : '', scope || 'global');
  res.json(db.getVariable(bot.id, name.trim(), scope || 'global'));
});

app.put('/api/variables/:id', requireAuth, (req, res) => {
  const variables = db.data.variables;
  const variable = variables.find(v => v.id === parseInt(req.params.id));
  if (!variable) return res.status(404).json({ error: 'Variable not found' });

  const bot = db.getBot(variable.bot_id);
  if (!bot || bot.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  if (req.body.name) variable.name = req.body.name.trim();
  if (req.body.value !== undefined) variable.value = String(req.body.value);
  if (req.body.scope) variable.scope = req.body.scope;
  variable.updated_at = new Date().toISOString();
  db.save();

  res.json(variable);
});

app.delete('/api/variables/:id', requireAuth, (req, res) => {
  const variables = db.data.variables;
  const variable = variables.find(v => v.id === parseInt(req.params.id));
  if (!variable) return res.status(404).json({ error: 'Variable not found' });

  const bot = db.getBot(variable.bot_id);
  if (!bot || bot.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  db.deleteVariable(bot.id, variable.name, variable.scope);
  res.json({ success: true });
});

// ─── LOGS ───
app.get('/api/bots/:id/logs', requireAuth, (req, res) => {
  const bot = db.getBot(parseInt(req.params.id));
  if (!bot || bot.user_id !== req.user.id) return res.status(404).json({ error: 'Bot not found' });
  const limit = parseInt(req.query.limit) || 100;
  res.json(db.getLogs(bot.id, limit));
});

// ─── STATIC FILES ───
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║     CBScript Platform Server v1.0        ║`);
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║  Running on: http://0.0.0.0:${PORT}          ║`);
  console.log(`║  Data dir:  ${DATA_DIR}        ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
  console.log('Make sure to set up your .env file with Discord credentials.');
  console.log('Create a Discord app at https://discord.com/developers/applications\n');
});

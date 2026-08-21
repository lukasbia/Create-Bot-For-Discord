const express = require('express');
const router = express.Router();
const { bots, scripts, variables, logs, users } = require('../db/database');
const manager = require('../bots/manager');
const { transpile, detectLanguage } = require('../transpiler/cbscript');
const { Client } = require('discord.js');

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function requireBotOwner(req, res, next) {
  const bot = bots.get(req.params.botId || req.body.botId);
  if (!bot || bot.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  req.bot = bot;
  next();
}

// Current user
router.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    avatar: req.user.avatar
  });
});

// Bots list
router.get('/bots', requireAuth, (req, res) => {
  const list = bots.listByUser(req.user.id);
  res.json(list);
});

// Create bot
router.post('/bots', requireAuth, async (req, res) => {
  try {
    const { name, token } = req.body;
    if (!name || !token) return res.status(400).json({ error: 'Name and token required' });

    // Validate token by quick login
    let clientId = null;
    let avatar = null;
    let inviteUrl = null;
    try {
      const testClient = new Client({ intents: [] });
      await testClient.login(token);
      clientId = testClient.user.id;
      avatar = testClient.user.displayAvatarURL({ size: 256 });
      inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`;
      testClient.destroy();
    } catch (e) {
      return res.status(400).json({ error: 'Invalid Discord bot token: ' + e.message });
    }

    // Give 1 hour free hosting on create so user can test
    const now = Math.floor(Date.now() / 1000);
    const bot = bots.create({
      userId: req.user.id,
      name: String(name).slice(0, 64),
      token,
      clientId,
      avatar,
      inviteUrl
    });
    bots.update(bot.id, { hosting_until: now + 3600 }); // 1h free

    res.json(bots.get(bot.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get one bot
router.get('/bots/:botId', requireAuth, requireBotOwner, (req, res) => {
  const b = { ...req.bot };
  delete b.token; // never send token to frontend
  res.json(b);
});

// Update bot (name / token)
router.patch('/bots/:botId', requireAuth, requireBotOwner, async (req, res) => {
  const { name, token } = req.body;
  const fields = {};
  if (name) fields.name = String(name).slice(0, 64);
  if (token) {
    // re-validate
    try {
      const testClient = new Client({ intents: [] });
      await testClient.login(token);
      fields.token = token;
      fields.client_id = testClient.user.id;
      fields.avatar = testClient.user.displayAvatarURL({ size: 256 });
      fields.invite_url = `https://discord.com/oauth2/authorize?client_id=${testClient.user.id}&permissions=8&scope=bot%20applications.commands`;
      testClient.destroy();
    } catch (e) {
      return res.status(400).json({ error: 'Invalid token: ' + e.message });
    }
  }
  const updated = bots.update(req.params.botId, fields);
  const out = { ...updated };
  delete out.token;
  res.json(out);
});

// Delete bot
router.delete('/bots/:botId', requireAuth, requireBotOwner, async (req, res) => {
  await manager.stopBot(req.params.botId);
  bots.delete(req.params.botId);
  res.json({ ok: true });
});

// Start / stop / restart
router.post('/bots/:botId/start', requireAuth, requireBotOwner, async (req, res) => {
  const result = await manager.startBot(req.params.botId);
  res.json(result);
});

router.post('/bots/:botId/stop', requireAuth, requireBotOwner, async (req, res) => {
  await manager.stopBot(req.params.botId);
  res.json({ ok: true });
});

router.post('/bots/:botId/restart', requireAuth, requireBotOwner, async (req, res) => {
  const result = await manager.restartBot(req.params.botId);
  res.json(result);
});

// Watch ad → +1 day hosting
router.post('/bots/:botId/watch-ad', requireAuth, requireBotOwner, (req, res) => {
  // In production you would verify an ad network reward callback.
  // Here we grant 1 day of real hosting.
  const until = manager.extendHosting(req.params.botId, 1);
  // Auto start if not running
  if (!manager.isRunning(req.params.botId)) {
    manager.startBot(req.params.botId).catch(() => {});
  }
  res.json({ ok: true, hosting_until: until });
});

// Scripts
router.get('/bots/:botId/scripts', requireAuth, requireBotOwner, (req, res) => {
  res.json(scripts.listByBot(req.params.botId));
});

router.post('/bots/:botId/scripts', requireAuth, requireBotOwner, (req, res) => {
  const { name, trigger_type, trigger_value, language, source } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  let lang = language || detectLanguage(source || '');
  let compiled = '';
  const src = source || defaultHelloWorld(lang);

  if (lang === 'cbscript') {
    compiled = transpile(src);
  }

  const script = scripts.create({
    botId: req.params.botId,
    name: String(name).slice(0, 64),
    triggerType: trigger_type || 'message',
    triggerValue: trigger_value || '',
    language: lang,
    source: src,
    compiledJs: compiled
  });
  res.json(script);
});

router.get('/bots/:botId/scripts/:scriptId', requireAuth, requireBotOwner, (req, res) => {
  const s = scripts.get(req.params.scriptId);
  if (!s || s.bot_id !== req.params.botId) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

router.put('/bots/:botId/scripts/:scriptId', requireAuth, requireBotOwner, (req, res) => {
  const s = scripts.get(req.params.scriptId);
  if (!s || s.bot_id !== req.params.botId) return res.status(404).json({ error: 'Not found' });

  const { name, trigger_type, trigger_value, language, source, enabled } = req.body;
  const fields = {};
  if (name !== undefined) fields.name = String(name).slice(0, 64);
  if (trigger_type !== undefined) fields.trigger_type = trigger_type;
  if (trigger_value !== undefined) fields.trigger_value = trigger_value;
  if (language !== undefined) fields.language = language;
  if (enabled !== undefined) fields.enabled = enabled ? 1 : 0;

  if (source !== undefined) {
    fields.source = source;
    const lang = language || s.language || detectLanguage(source);
    fields.language = lang;
    if (lang === 'cbscript') {
      fields.compiled_js = transpile(source);
    } else {
      fields.compiled_js = '';
    }
  }

  const updated = scripts.update(req.params.scriptId, fields);
  res.json(updated);
});

router.delete('/bots/:botId/scripts/:scriptId', requireAuth, requireBotOwner, (req, res) => {
  const s = scripts.get(req.params.scriptId);
  if (!s || s.bot_id !== req.params.botId) return res.status(404).json({ error: 'Not found' });
  scripts.delete(req.params.scriptId);
  res.json({ ok: true });
});

// Variables
router.get('/bots/:botId/variables', requireAuth, requireBotOwner, (req, res) => {
  res.json(variables.listByBot(req.params.botId));
});

router.post('/bots/:botId/variables', requireAuth, requireBotOwner, (req, res) => {
  const { name, value } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const v = variables.set({
    botId: req.params.botId,
    name: String(name).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64),
    value: value ?? '',
    scope: 'global'
  });
  res.json(v);
});

router.delete('/bots/:botId/variables/:varId', requireAuth, requireBotOwner, (req, res) => {
  variables.delete(req.params.varId);
  res.json({ ok: true });
});

// Console
router.get('/bots/:botId/console', requireAuth, requireBotOwner, (req, res) => {
  res.json(logs.list(req.params.botId, 150));
});

router.delete('/bots/:botId/console', requireAuth, requireBotOwner, (req, res) => {
  logs.clear(req.params.botId);
  res.json({ ok: true });
});

// Transpile preview (for editor)
router.post('/transpile', requireAuth, (req, res) => {
  const { source } = req.body;
  try {
    const js = transpile(source || '');
    res.json({ ok: true, js });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function defaultHelloWorld(lang) {
  if (lang === 'javascript') {
    return `// Hello World (JavaScript)
console.log("Hello World from CBScript Platform!");
await ctx.reply("Hello World!", false);`;
  }
  if (lang === 'python') {
    return `# Hello World (Python) - note: Python is stored but not executed yet
print("Hello World")`;
  }
  // CBScript default
  return `<nif c{Hello World script - prints to console and replies}
<nif reply{Hello World!,false}`;
}

module.exports = router;

const fs = require('fs');
const path = require('path');

class Database {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { users: [], bots: [], scripts: [], variables: [], logs: [] };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch (e) {
      console.error('DB load error:', e.message);
      this.data = { users: [], bots: [], scripts: [], variables: [], logs: [] };
    }
  }

  save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error('DB save error:', e.message);
    }
  }

  // Users
  getUserByDiscordId(discordId) {
    return this.data.users.find(u => u.discord_id === discordId);
  }

  getUserById(id) {
    return this.data.users.find(u => u.id === id);
  }

  createUser(user) {
    user.id = this.data.users.length ? Math.max(...this.data.users.map(u => u.id)) + 1 : 1;
    user.created_at = new Date().toISOString();
    this.data.users.push(user);
    this.save();
    return user;
  }

  // Bots
  getBotsByUser(userId) {
    return this.data.bots.filter(b => b.user_id === userId);
  }

  getBot(id) {
    return this.data.bots.find(b => b.id === id);
  }

  createBot(bot) {
    bot.id = this.data.bots.length ? Math.max(...this.data.bots.map(b => b.id)) + 1 : 1;
    bot.status = 'offline';
    bot.client_id = null;
    bot.hosting_expires_at = null;
    bot.created_at = new Date().toISOString();
    this.data.bots.push(bot);
    this.save();
    return bot;
  }

  updateBot(id, updates) {
    const bot = this.getBot(id);
    if (bot) {
      Object.assign(bot, updates);
      this.save();
    }
    return bot;
  }

  deleteBot(id) {
    this.data.bots = this.data.bots.filter(b => b.id !== id);
    this.data.scripts = this.data.scripts.filter(s => s.bot_id !== id);
    this.data.variables = this.data.variables.filter(v => v.bot_id !== id);
    this.data.logs = this.data.logs.filter(l => l.bot_id !== id);
    this.save();
  }

  updateBotStatus(id, status) {
    return this.updateBot(id, { status });
  }

  // Scripts
  getScripts(botId) {
    return this.data.scripts.filter(s => s.bot_id === botId);
  }

  getScript(id) {
    return this.data.scripts.find(s => s.id === id);
  }

  createScript(script) {
    script.id = this.data.scripts.length ? Math.max(...this.data.scripts.map(s => s.id)) + 1 : 1;
    script.created_at = new Date().toISOString();
    this.data.scripts.push(script);
    this.save();
    return script;
  }

  updateScript(id, updates) {
    const script = this.getScript(id);
    if (script) {
      Object.assign(script, updates);
      this.save();
    }
    return script;
  }

  deleteScript(id) {
    this.data.scripts = this.data.scripts.filter(s => s.id !== id);
    this.save();
  }

  // Variables
  getVariables(botId) {
    return this.data.variables.filter(v => v.bot_id === botId);
  }

  getVariable(botId, name, scope = 'global') {
    return this.data.variables.find(v => v.bot_id === botId && v.name === name && v.scope === scope);
  }

  setVariable(botId, name, value, scope = 'global') {
    const v = this.getVariable(botId, name, scope);
    if (v) {
      v.value = String(value);
      v.updated_at = new Date().toISOString();
    } else {
      this.data.variables.push({
        id: this.data.variables.length ? Math.max(...this.data.variables.map(v => v.id)) + 1 : 1,
        bot_id: botId,
        name,
        value: String(value),
        scope,
        created_at: new Date().toISOString()
      });
    }
    this.save();
  }

  deleteVariable(botId, name, scope = 'global') {
    this.data.variables = this.data.variables.filter(v => !(v.bot_id === botId && v.name === name && v.scope === scope));
    this.save();
  }

  // Logs
  getLogs(botId, limit = 200) {
    return this.data.logs
      .filter(l => l.bot_id === botId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  addLog(botId, type, message) {
    this.data.logs.push({
      id: this.data.logs.length ? Math.max(...this.data.logs.map(l => l.id)) + 1 : 1,
      bot_id: botId,
      type,
      message: String(message).substring(0, 1000),
      created_at: new Date().toISOString()
    });
    // Keep only last 1000 logs per bot
    const botLogs = this.data.logs.filter(l => l.bot_id === botId);
    if (botLogs.length > 1000) {
      const idsToDelete = botLogs.slice(0, botLogs.length - 1000).map(l => l.id);
      this.data.logs = this.data.logs.filter(l => !idsToDelete.includes(l.id));
    }
    this.save();
  }
}

module.exports = Database;

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const CBScriptCompiler = require('./cbscript-compiler');

class VariableManager {
  constructor(db, botId) {
    this.db = db;
    this.botId = botId;
  }

  async get(name, scope = 'global') {
    const v = this.db.getVariable(this.botId, name, scope);
    return v ? v.value : null;
  }

  async set(name, value, scope = 'global') {
    this.db.setVariable(this.botId, name, value, scope);
  }

  async add(name, value, scope = 'global') {
    const v = await this.get(name, scope);
    const num = parseFloat(v || 0) + parseFloat(value);
    await this.set(name, String(num), scope);
  }

  async sub(name, value, scope = 'global') {
    const v = await this.get(name, scope);
    const num = parseFloat(v || 0) - parseFloat(value);
    await this.set(name, String(num), scope);
  }

  async reset(name, scope = 'global') {
    this.db.deleteVariable(this.botId, name, scope);
  }

  async getUser(name, userId) {
    return this.get(name, `user:${userId}`);
  }

  async setUser(name, value, userId) {
    return this.set(name, value, `user:${userId}`);
  }

  async getGuild(name, guildId) {
    return this.get(name, `guild:${guildId}`);
  }

  async setGuild(name, value, guildId) {
    return this.set(name, value, `guild:${guildId}`);
  }
}

class BotManager {
  constructor(db) {
    this.db = db;
    this.clients = new Map();
    this.compiler = new CBScriptCompiler();
    this.expiryTimers = new Map();
  }

  async startBot(botId) {
    const bot = this.db.getBot(botId);
    if (!bot) throw new Error('Bot not found');

    // Check hosting expiry
    if (bot.hosting_expires_at) {
      const expires = new Date(bot.hosting_expires_at);
      if (expires <= new Date()) {
        throw new Error('Hosting expired. Watch an ad to extend hosting.');
      }
    }

    if (this.clients.has(botId)) {
      await this.stopBot(botId);
    }

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
      ]
    });

    const scripts = this.db.getScripts(botId);
    const compiledScripts = [];

    for (const script of scripts) {
      if (script.language === 'cbscript') {
        try {
          const compiled = this.compiler.compile(script.code, script.trigger);
          compiledScripts.push({ ...script, compiled });
        } catch (err) {
          this.db.addLog(botId, 'error', `Failed to compile script "${script.name}": ${err.message}`);
        }
      } else {
        compiledScripts.push({ ...script, compiled: null });
      }
    }

    // Ready event
    client.on('ready', () => {
      this.db.updateBotStatus(botId, 'online');
      this.db.updateBot(botId, { client_id: client.user.id });
      this.db.addLog(botId, 'info', `Bot "${client.user.tag}" is online`);

      for (const script of compiledScripts) {
        if (script.trigger === 'ready') {
          this.executeScript(script, { client, botId, db: this.db, startTime: Date.now(), botId });
        }
      }
    });

    // Message event
    client.on('messageCreate', async (message) => {
      if (message.author.bot) return;

      const args = message.content.trim().split(/\s+/);
      const guild = message.guild;
      const member = message.member;
      const vars = new VariableManager(this.db, botId);

      for (const script of compiledScripts) {
        let shouldRun = false;
        const trigger = script.trigger;

        if (trigger === 'message') {
          shouldRun = true;
        } else if (trigger.startsWith('message:')) {
          shouldRun = message.content === trigger.slice(8);
        } else if (trigger.startsWith('command:')) {
          const prefix = trigger.slice(8);
          shouldRun = message.content.startsWith(prefix);
        } else if (trigger.startsWith('startsWith:')) {
          shouldRun = message.content.startsWith(trigger.slice(11));
        } else if (trigger.startsWith('contains:')) {
          shouldRun = message.content.includes(trigger.slice(9));
        }

        if (shouldRun) {
          const ctx = {
            message, client, args, guild,
            channel: message.channel, member,
            author: message.author, vars,
            db: this.db, startTime: Date.now()
          };

          try {
            await this.executeScript(script, ctx);
          } catch (err) {
            this.db.addLog(botId, 'error', `Script "${script.name}": ${err.message}`);
          }
        }
      }
    });

    // Member join event
    client.on('guildMemberAdd', async (member) => {
      for (const script of compiledScripts) {
        if (script.trigger === 'join') {
          const vars = new VariableManager(this.db, botId);
          const ctx = {
            client, guild: member.guild, member,
            author: member.user, channel: null,
            message: null, args: [], vars,
            db: this.db, startTime: Date.now()
          };
          try {
            await this.executeScript(script, ctx);
          } catch (err) {
            this.db.addLog(botId, 'error', `Script "${script.name}": ${err.message}`);
          }
        }
      }
    });

    client.on('error', (err) => {
      this.db.addLog(botId, 'error', `Client error: ${err.message}`);
    });

    client.on('shardError', (err) => {
      this.db.addLog(botId, 'error', `Shard error: ${err.message}`);
    });

    try {
      await client.login(bot.token);
      this.clients.set(botId, { client, scripts: compiledScripts });
      this.scheduleExpiryCheck(botId);
      return true;
    } catch (err) {
      this.db.addLog(botId, 'error', `Login failed: ${err.message}`);
      throw err;
    }
  }

  async stopBot(botId) {
    const entry = this.clients.get(botId);
    if (entry) {
      try {
        entry.client.destroy();
      } catch (e) {}
      this.clients.delete(botId);
    }
    if (this.expiryTimers.has(botId)) {
      clearTimeout(this.expiryTimers.get(botId));
      this.expiryTimers.delete(botId);
    }
    this.db.updateBotStatus(botId, 'offline');
    this.db.addLog(botId, 'info', 'Bot stopped');
  }

  async executeScript(script, ctx) {
    if (script.language === 'cbscript' && script.compiled) {
      const fn = new Function('ctx', `
        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
        ${script.compiled.code}
        return ${script.compiled.functionName}(ctx);
      `);
      await fn(ctx);
    } else if (script.language === 'javascript') {
      const fn = new Function('ctx', `
        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
        ${script.code}
      `);
      await fn(ctx);
    } else if (script.language === 'python') {
      ctx.db.addLog(script.bot_id, 'warn', 'Python scripts require Python runtime. Install python and configure exec.');
    }
  }

  isOnline(botId) {
    const entry = this.clients.get(botId);
    return entry ? entry.client.ws.status === 0 : false;
  }

  scheduleExpiryCheck(botId) {
    const bot = this.db.getBot(botId);
    if (!bot || !bot.hosting_expires_at) return;

    const expires = new Date(bot.hosting_expires_at);
    const now = new Date();
    const msUntilExpiry = expires - now;

    if (msUntilExpiry <= 0) {
      this.stopBot(botId);
      this.db.addLog(botId, 'info', 'Hosting expired, bot stopped');
      return;
    }

    const timer = setTimeout(() => {
      this.stopBot(botId);
      this.db.addLog(botId, 'info', 'Hosting expired, bot stopped');
    }, Math.min(msUntilExpiry, 86400000)); // Max 24h check

    if (this.expiryTimers.has(botId)) clearTimeout(this.expiryTimers.get(botId));
    this.expiryTimers.set(botId, timer);
  }

  async restartBot(botId) {
    await this.stopBot(botId);
    await new Promise(r => setTimeout(r, 1000));
    return this.startBot(botId);
  }

  getBotUptime(botId) {
    const entry = this.clients.get(botId);
    if (!entry || !entry.client.readyAt) return 0;
    return Date.now() - entry.client.readyAt;
  }
}

module.exports = BotManager;

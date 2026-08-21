const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { bots, scripts, variables, logs } = require('../db/database');
const { transpile } = require('../transpiler/cbscript');
const EventEmitter = require('events');

class BotManager extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map(); // botId -> Client
    this.contexts = new Map(); // botId -> runtime helpers
  }

  async startBot(botId) {
    const bot = bots.get(botId);
    if (!bot) throw new Error('Bot not found');
    if (this.clients.has(botId)) {
      await this.stopBot(botId);
    }

    // Hosting check
    const now = Math.floor(Date.now() / 1000);
    if (bot.hosting_until < now) {
      bots.update(botId, { status: 'offline' });
      logs.add(botId, 'warn', 'Hosting expired. Watch an ad or extend hosting to go online.');
      this.emit('status', botId, 'offline');
      return { ok: false, reason: 'hosting_expired' };
    }

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
      ],
      partials: [Partials.Channel, Partials.Message]
    });

    const startTime = Date.now();

    // Runtime context factory for scripts
    const makeCtx = (message, interaction) => {
      const guild = message?.guild || interaction?.guild;
      const author = message?.author || interaction?.user;
      let currentEmbed = null;
      let components = [];
      let jsonObj = {};

      return {
        // IO
        async sendMessage(text, returnId) {
          if (!message?.channel) return null;
          const payload = { content: String(text ?? '') };
          if (currentEmbed) payload.embeds = [currentEmbed];
          if (components.length) payload.components = components;
          const m = await message.channel.send(payload);
          currentEmbed = null;
          components = [];
          logs.add(botId, 'print', `[send] ${text}`);
          return returnId ? m.id : null;
        },
        async reply(text, mention = false) {
          if (!message) return null;
          const payload = { content: String(text ?? ''), allowedMentions: { repliedUser: !!mention } };
          if (currentEmbed) payload.embeds = [currentEmbed];
          if (components.length) payload.components = components;
          const m = await message.reply(payload).catch(() => message.channel.send(payload));
          currentEmbed = null;
          components = [];
          logs.add(botId, 'print', `[reply] ${text}`);
          return m;
        },
        async editMessage(channelId, messageId, newText) {
          const ch = await client.channels.fetch(channelId).catch(() => null);
          if (!ch) return;
          const msg = await ch.messages.fetch(messageId).catch(() => null);
          if (msg) await msg.edit({ content: String(newText) });
        },
        async deleteMessage(channelId, messageId) {
          const ch = await client.channels.fetch(channelId).catch(() => null);
          if (!ch) return;
          const msg = await ch.messages.fetch(messageId).catch(() => null);
          if (msg) await msg.delete().catch(() => {});
        },
        noMention() { /* flag handled in reply */ },
        suppressErrors(msg) { /* noop for now */ },
        alwaysReply() {},
        getMessage() { return message?.content || ''; },
        noArgs() { return !(message?.content || '').split(/\s+/).slice(1).length; },
        argsCheck(howMany, errorMsg) {
          const args = (message?.content || '').split(/\s+/).slice(1);
          if (args.length < Number(howMany)) {
            if (errorMsg) this.reply(errorMsg);
            throw new Error('argsCheck failed');
          }
        },

        // Embeds
        createEmbed() {
          currentEmbed = new EmbedBuilder();
          return currentEmbed;
        },
        embedTitle(title, url) {
          if (!currentEmbed) currentEmbed = new EmbedBuilder();
          currentEmbed.setTitle(String(title || ''));
          if (url) currentEmbed.setURL(String(url));
        },
        embedDescription(desc) {
          if (!currentEmbed) currentEmbed = new EmbedBuilder();
          currentEmbed.setDescription(String(desc || ''));
        },
        embedColor(color) {
          if (!currentEmbed) currentEmbed = new EmbedBuilder();
          try { currentEmbed.setColor(color); } catch {}
        },
        embedAddField(title, desc, inline) {
          if (!currentEmbed) currentEmbed = new EmbedBuilder();
          currentEmbed.addFields({ name: String(title), value: String(desc || '\u200b'), inline: !!inline });
        },
        embedFooter(text, icon) {
          if (!currentEmbed) currentEmbed = new EmbedBuilder();
          currentEmbed.setFooter({ text: String(text || ''), iconURL: icon || undefined });
        },
        embedAuthor(name, icon, url) {
          if (!currentEmbed) currentEmbed = new EmbedBuilder();
          currentEmbed.setAuthor({ name: String(name || ''), iconURL: icon || undefined, url: url || undefined });
        },
        embedImage(url) {
          if (!currentEmbed) currentEmbed = new EmbedBuilder();
          if (url) currentEmbed.setImage(String(url));
        },
        embedThumbnail(url) {
          if (!currentEmbed) currentEmbed = new EmbedBuilder();
          if (url) currentEmbed.setThumbnail(String(url));
        },
        embedTimestamp() {
          if (!currentEmbed) currentEmbed = new EmbedBuilder();
          currentEmbed.setTimestamp();
        },

        // Variables
        getVar(name, scopeId) {
          const v = variables.get(botId, name, 'global');
          return v ? v.value : '';
        },
        setVar(name, value) {
          variables.set({ botId, name, value: String(value), scope: 'global' });
        },
        addVar(name, value) {
          const cur = Number(this.getVar(name)) || 0;
          this.setVar(name, cur + Number(value));
        },
        subVar(name, value) {
          const cur = Number(this.getVar(name)) || 0;
          this.setVar(name, cur - Number(value));
        },
        resetVar(name) {
          variables.set({ botId, name, value: '', scope: 'global' });
        },
        getUserVar(name, userId) {
          const v = variables.get(botId, `${name}_${userId}`, 'user');
          return v ? v.value : '';
        },
        setUserVar(name, value, userId) {
          variables.set({ botId, name: `${name}_${userId}`, value: String(value), scope: 'user' });
        },
        getGuildVar(name, guildId) {
          const v = variables.get(botId, `${name}_${guildId}`, 'guild');
          return v ? v.value : '';
        },
        setGuildVar(name, value, guildId) {
          variables.set({ botId, name: `${name}_${guildId}`, value: String(value), scope: 'guild' });
        },

        // Entity
        authorID() { return author?.id || ''; },
        authorTag() { return author?.tag || ''; },
        username(userId) {
          if (!userId) return author?.username || '';
          return client.users.cache.get(userId)?.username || '';
        },
        nickname(userId, guildId) {
          const g = guildId ? client.guilds.cache.get(guildId) : guild;
          const m = g?.members.cache.get(userId || author?.id);
          return m?.nickname || m?.user?.username || '';
        },
        userAvatar(userId) {
          const u = userId ? client.users.cache.get(userId) : author;
          return u?.displayAvatarURL({ size: 256 }) || '';
        },
        userJoined(userId) {
          const m = guild?.members.cache.get(userId || author?.id);
          return m?.joinedAt?.toISOString() || '';
        },
        userRoles(userId) {
          const m = guild?.members.cache.get(userId || author?.id);
          return m ? [...m.roles.cache.keys()].join(',') : '';
        },
        isBot() { return !!author?.bot; },
        async isBanned(userId) {
          if (!guild) return false;
          try {
            const ban = await guild.bans.fetch(userId);
            return !!ban;
          } catch { return false; }
        },

        // Moderation (requires permissions)
        async ban(userId, reason, days) {
          if (!guild) return;
          await guild.members.ban(userId, { reason: reason || 'CBScript', deleteMessageSeconds: (Number(days) || 0) * 86400 }).catch(e => logs.add(botId, 'error', e.message));
        },
        async kick(userId, reason) {
          if (!guild) return;
          await guild.members.kick(userId, reason || 'CBScript').catch(e => logs.add(botId, 'error', e.message));
        },
        async giveRole(userId, roleId) {
          const m = await guild?.members.fetch(userId).catch(() => null);
          if (m) await m.roles.add(roleId).catch(e => logs.add(botId, 'error', e.message));
        },
        async takeRole(userId, roleId) {
          const m = await guild?.members.fetch(userId).catch(() => null);
          if (m) await m.roles.remove(roleId).catch(e => logs.add(botId, 'error', e.message));
        },
        async createChannel(name, type, categoryId, reason) {
          if (!guild) return;
          const t = type === 'voice' ? 2 : 0;
          await guild.channels.create({ name, type: t, parent: categoryId || undefined, reason }).catch(e => logs.add(botId, 'error', e.message));
        },
        async removeChannel(channelId, reason) {
          const ch = await client.channels.fetch(channelId).catch(() => null);
          if (ch) await ch.delete(reason).catch(e => logs.add(botId, 'error', e.message));
        },
        async channelTyping(channelId) {
          const ch = channelId ? await client.channels.fetch(channelId).catch(() => null) : message?.channel;
          if (ch && ch.sendTyping) await ch.sendTyping();
        },
        async pinMessage(channelId, messageId) {
          const ch = await client.channels.fetch(channelId).catch(() => null);
          const msg = await ch?.messages.fetch(messageId).catch(() => null);
          if (msg) await msg.pin().catch(e => logs.add(botId, 'error', e.message));
        },

        // Math
        calculate(expr) {
          try {
            // Safe-ish eval for basic math
            const cleaned = String(expr).replace(/[^0-9+\-*/().%\s]/g, '');
            return Function(`"use strict"; return (${cleaned})`)();
          } catch { return 0; }
        },
        random(min, max) {
          min = Number(min) || 0;
          max = Number(max) || 100;
          return Math.floor(Math.random() * (max - min + 1)) + min;
        },
        round(num, decimals) {
          const d = Number(decimals) || 0;
          return Number(Number(num).toFixed(d));
        },
        ceil(num) { return Math.ceil(Number(num)); },
        floor(num) { return Math.floor(Number(num)); },
        sqrt(num) { return Math.sqrt(Number(num)); },
        abs(num) { return Math.abs(Number(num)); },

        // JSON
        jsonParse(str) {
          try { jsonObj = JSON.parse(str); return jsonObj; } catch { return {}; }
        },
        jsonSetString(key, value) {
          jsonObj[key] = value;
        },
        jsonStringify() { return JSON.stringify(jsonObj); },
        jsonGet(key) { return jsonObj[key]; },

        // Interactions (basic)
        addButton(style, customId, label, emoji, disabled) {
          const styles = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger, link: ButtonStyle.Link };
          const btn = new ButtonBuilder()
            .setCustomId(String(customId))
            .setLabel(String(label || 'Button'))
            .setStyle(styles[String(style).toLowerCase()] || ButtonStyle.Primary)
            .setDisabled(!!disabled);
          if (emoji) btn.setEmoji(emoji);
          if (!components.length) components.push(new ActionRowBuilder());
          components[0].addComponents(btn);
        },

        // System
        ping() { return client.ws.ping; },
        executionTime() { return Date.now() - startTime; },
        botOwnerID() { return bot.user_id; },
        serverID() { return guild?.id || ''; },
        serverName() { return guild?.name || ''; },
        channelsCount() { return guild?.channels.cache.size || 0; },
        membersCount() { return guild?.memberCount || 0; },
        emojisCount() { return guild?.emojis.cache.size || 0; },

        // Logging helper for scripts
        log(...args) {
          logs.add(botId, 'print', args.map(String).join(' '));
        }
      };
    };

    client.once('ready', () => {
      bots.update(botId, {
        status: 'online',
        avatar: client.user.displayAvatarURL({ size: 256 }),
        client_id: client.user.id,
        invite_url: `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`
      });
      logs.add(botId, 'info', `Bot online as ${client.user.tag}`);
      this.emit('status', botId, 'online');
      this.emit('ready', botId, client.user);
    });

    client.on('error', (err) => {
      logs.add(botId, 'error', err.message);
      this.emit('error', botId, err);
    });

    client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      try {
        const enabledScripts = scripts.getEnabledForBot(botId);
        for (const script of enabledScripts) {
          if (script.trigger_type === 'message' || script.trigger_type === 'command') {
            // Simple trigger matching: if trigger_value is set, content must include it / start with it
            const content = message.content || '';
            if (script.trigger_value) {
              if (script.trigger_type === 'command') {
                if (!content.startsWith(script.trigger_value)) continue;
              } else if (!content.toLowerCase().includes(script.trigger_value.toLowerCase())) {
                continue;
              }
            }

            let code = script.compiled_js;
            if (script.language === 'cbscript') {
              code = script.compiled_js || transpile(script.source);
            } else if (script.language === 'javascript') {
              code = script.source;
            } else if (script.language === 'python') {
              logs.add(botId, 'warn', 'Python scripts are not executed on this runtime (use CBScript or JS).');
              continue;
            }

            const ctx = makeCtx(message, null);
            // Expose console.log style
            const sandbox = {
              ctx,
              console: {
                log: (...a) => logs.add(botId, 'print', a.map(String).join(' ')),
                error: (...a) => logs.add(botId, 'error', a.map(String).join(' ')),
                warn: (...a) => logs.add(botId, 'warn', a.map(String).join(' '))
              },
              message,
              client
            };

            try {
              const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
              const fn = new AsyncFunction('ctx', 'console', 'message', 'client', code);
              await fn(ctx, sandbox.console, message, client);
            } catch (e) {
              logs.add(botId, 'error', `Script "${script.name}": ${e.message}`);
            }
          }
        }
      } catch (e) {
        logs.add(botId, 'error', e.message);
      }
    });

    try {
      bots.update(botId, { status: 'starting' });
      this.emit('status', botId, 'starting');
      await client.login(bot.token);
      this.clients.set(botId, client);
      return { ok: true };
    } catch (e) {
      bots.update(botId, { status: 'error' });
      logs.add(botId, 'error', `Login failed: ${e.message}`);
      this.emit('status', botId, 'error');
      client.destroy();
      return { ok: false, reason: e.message };
    }
  }

  async stopBot(botId) {
    const client = this.clients.get(botId);
    if (client) {
      client.destroy();
      this.clients.delete(botId);
    }
    bots.update(botId, { status: 'offline' });
    logs.add(botId, 'info', 'Bot stopped');
    this.emit('status', botId, 'offline');
  }

  async restartBot(botId) {
    await this.stopBot(botId);
    return this.startBot(botId);
  }

  getStatus(botId) {
    const bot = bots.get(botId);
    if (!bot) return 'unknown';
    return bot.status;
  }

  isRunning(botId) {
    return this.clients.has(botId);
  }

  // Extend hosting by 1 day (ad reward simulation - real would integrate ad network)
  extendHosting(botId, days = 1) {
    const bot = bots.get(botId);
    if (!bot) return null;
    const now = Math.floor(Date.now() / 1000);
    const base = Math.max(bot.hosting_until || 0, now);
    const until = base + (days * 86400);
    bots.update(botId, { hosting_until: until });
    logs.add(botId, 'info', `Hosting extended until ${new Date(until * 1000).toISOString()}`);
    return until;
  }

  // Auto-stop expired bots
  checkExpired() {
    const now = Math.floor(Date.now() / 1000);
    for (const [botId, client] of this.clients) {
      const bot = bots.get(botId);
      if (bot && bot.hosting_until < now) {
        this.stopBot(botId);
        logs.add(botId, 'warn', 'Hosting expired – bot stopped.');
      }
    }
  }
}

const manager = new BotManager();

// Periodic hosting check
setInterval(() => manager.checkExpired(), 60 * 1000);

module.exports = manager;

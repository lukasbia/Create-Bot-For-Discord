class CBScriptCompiler {
  constructor() {
    this.embedVar = null;
    this.rowVar = null;
    this.hasEmbed = false;
    this.hasComponents = false;
    this.indent = 2;
  }

  compile(code, trigger) {
    this.embedVar = '_embed_' + Math.random().toString(36).substr(2, 8);
    this.rowVar = '_row_' + Math.random().toString(36).substr(2, 8);
    this.hasEmbed = false;
    this.hasComponents = false;
    this.indent = 2;

    const lines = code.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('//') && !l.startsWith('/*'));

    const body = [];
    const funcName = 'handler_' + trigger.replace(/[^a-zA-Z0-9]/g, '_');

    body.push(`async function ${funcName}(ctx) {`);
    body.push(`  const { message, client, args, guild, channel, member, author, vars, db, startTime, botId } = ctx;`);
    body.push(`  let ${this.embedVar} = null;`);
    body.push(`  let ${this.rowVar} = null;`);
    body.push(`  let _suppress = false;`);
    body.push(`  let _errorMsg = null;`);
    body.push(`  let _replyOptions = {};`);
    body.push(`  let _msgContent = message ? message.content : '';`);
    body.push(`  try {`);

    for (const line of lines) {
      const compiled = this.compileLine(line);
      if (compiled) body.push(compiled);
    }

    // Send embed if built
    if (this.hasEmbed) {
      body.push(`    if (${this.embedVar}) {`);
      body.push(`      if (!_replyOptions.embeds) _replyOptions.embeds = [];`);
      body.push(`      _replyOptions.embeds.push(${this.embedVar});`);
      body.push(`    }`);
    }
    if (this.hasComponents) {
      body.push(`    if (${this.rowVar}) {`);
      body.push(`      if (!_replyOptions.components) _replyOptions.components = [];`);
      body.push(`      _replyOptions.components.push(${this.rowVar});`);
      body.push(`    }`);
    }

    body.push(`  } catch (_err) {`);
    body.push(`    if (!_suppress) throw _err;`);
    body.push(`    if (_errorMsg && channel) await channel.send(_errorMsg);`);
    body.push(`  }`);
    body.push(`}`);

    return {
      trigger,
      functionName: funcName,
      code: body.join('\n')
    };
  }

  compileLine(line) {
    if (!line.startsWith('<nif ')) return null;

    let content = line.slice(5);
    if (content.endsWith('>')) content = content.slice(0, -1);

    const braceIdx = content.indexOf('{');
    let cmd, args = '';

    if (braceIdx === -1) {
      cmd = content.trim();
    } else {
      cmd = content.slice(0, braceIdx).trim();
      const endBrace = content.lastIndexOf('}');
      args = content.slice(braceIdx + 1, endBrace !== -1 ? endBrace : undefined);
    }

    const ind = '  ' + ' '.repeat(this.indent);

    switch (cmd) {
      case 'c':
        return `${ind}// ${args}`;

      case 'if':
        this.indent += 2;
        return `${ind}if (${this.parseCondition(args)}) {`;

      case 'elseif':
        this.indent -= 2;
        const oldInd = '  ' + ' '.repeat(this.indent);
        this.indent += 2;
        return `${oldInd}} else if (${this.parseCondition(args)}) {`;

      case 'else':
        this.indent -= 2;
        const oldInd2 = '  ' + ' '.repeat(this.indent);
        this.indent += 2;
        return `${oldInd2}} else {`;

      case 'endif':
        this.indent -= 2;
        return `${ind}}`;

      case 'stop':
        return `${ind}return;`;

      case 'sendMessage': {
        const parts = this.splitArgs(args);
        const text = this.str(parts[0] || '');
        return `${ind}await channel.send(${text});`;
      }

      case 'reply': {
        const [rText, rMention] = this.splitArgs(args);
        return `${ind}await message.reply({ content: ${this.str(rText)}, allowedMentions: { repliedUser: ${rMention !== 'false'} } });`;
      }

      case 'nomention':
        return `${ind}_replyOptions.allowedMentions = { parse: [] };`;

      case 'alwaysReply':
        return `${ind}_replyOptions.reply = { messageReference: message.id };`;

      case 'message':
        return `${ind}_msgContent = message.content;`;

      case 'noargs':
        return `${ind}if (!args.length) return;`;

      case 'argsCheck': {
        const [num, errMsg] = this.splitArgs(args);
        return `${ind}if (args.length < ${num}) { if (channel) await channel.send(${this.str(errMsg || 'Not enough arguments')}); return; }`;
      }

      case 'createEmbed':
        this.hasEmbed = true;
        return `${ind}${this.embedVar} = new EmbedBuilder();`;

      case 'title': {
        const [tTitle, tUrl] = this.splitArgs(args);
        if (tUrl) {
          return `${ind}if (${this.embedVar}) ${this.embedVar}.setTitle(${this.str(tTitle)}).setURL(${this.str(tUrl)});`;
        }
        return `${ind}if (${this.embedVar}) ${this.embedVar}.setTitle(${this.str(tTitle)});`;
      }

      case 'description':
        return `${ind}if (${this.embedVar}) ${this.embedVar}.setDescription(${this.str(args)});`;

      case 'color':
        return `${ind}if (${this.embedVar}) ${this.embedVar}.setColor(${this.str(args)});`;

      case 'addField': {
        const [fName, fDesc, fInline] = this.splitArgs(args);
        return `${ind}if (${this.embedVar}) ${this.embedVar}.addFields({ name: ${this.str(fName)}, value: ${this.str(fDesc)}, inline: ${fInline === 'true'} });`;
      }

      case 'footer': {
        const [fText, fIcon] = this.splitArgs(args);
        if (fIcon) {
          return `${ind}if (${this.embedVar}) ${this.embedVar}.setFooter({ text: ${this.str(fText)}, iconURL: ${this.str(fIcon)} });`;
        }
        return `${ind}if (${this.embedVar}) ${this.embedVar}.setFooter({ text: ${this.str(fText)} });`;
      }

      case 'author': {
        const [aName, aIcon, aUrl] = this.splitArgs(args);
        let auth = `name: ${this.str(aName)}`;
        if (aIcon) auth += `, iconURL: ${this.str(aIcon)}`;
        if (aUrl) auth += `, url: ${this.str(aUrl)}`;
        return `${ind}if (${this.embedVar}) ${this.embedVar}.setAuthor({ ${auth} });`;
      }

      case 'image':
        return `${ind}if (${this.embedVar}) ${this.embedVar}.setImage(${this.str(args)});`;

      case 'thumbnail':
        return `${ind}if (${this.embedVar}) ${this.embedVar}.setThumbnail(${this.str(args)});`;

      case 'addTimestamp':
        return `${ind}if (${this.embedVar}) ${this.embedVar}.setTimestamp();`;

      case 'getVar': {
        const [gvName, gvScope] = this.splitArgs(args);
        return `${ind}const _var_${this.safeName(gvName)} = await vars.get(${this.str(gvName)}, ${this.str(gvScope || 'global')});`;
      }

      case 'setVar': {
        const [svName, svVal, svScope] = this.splitArgs(args);
        return `${ind}await vars.set(${this.str(svName)}, ${this.str(svVal)}, ${this.str(svScope || 'global')});`;
      }

      case 'addVar': {
        const [avName, avVal, avScope] = this.splitArgs(args);
        return `${ind}await vars.add(${this.str(avName)}, ${avVal}, ${this.str(avScope || 'global')});`;
      }

      case 'subVar': {
        const [subvName, subvVal, subvScope] = this.splitArgs(args);
        return `${ind}await vars.sub(${this.str(subvName)}, ${subvVal}, ${this.str(subvScope || 'global')});`;
      }

      case 'resetVar': {
        const [rvName, rvScope] = this.splitArgs(args);
        return `${ind}await vars.reset(${this.str(rvName)}, ${this.str(rvScope || 'global')});`;
      }

      case 'getUserVar': {
        const [uvName, uvId] = this.splitArgs(args);
        return `${ind}const _uservar_${this.safeName(uvName)} = await vars.getUser(${this.str(uvName)}, ${this.str(uvId)});`;
      }

      case 'setUserVar': {
        const [suvName, suvVal, suvId] = this.splitArgs(args);
        return `${ind}await vars.setUser(${this.str(suvName)}, ${this.str(suvVal)}, ${this.str(suvId)});`;
      }

      case 'getGuildVar': {
        const [gvName2, gvId] = this.splitArgs(args);
        return `${ind}const _guildvar_${this.safeName(gvName2)} = await vars.getGuild(${this.str(gvName2)}, ${this.str(gvId)});`;
      }

      case 'setGuildVar': {
        const [sgvName, sgvVal, sgvId] = this.splitArgs(args);
        return `${ind}await vars.setGuild(${this.str(sgvName)}, ${this.str(sgvVal)}, ${this.str(sgvId)});`;
      }

      case 'authorID':
        return `${ind}const _authorID = author ? author.id : null;`;

      case 'authorTag':
        return `${ind}const _authorTag = author ? author.tag : null;`;

      case 'username': {
        const [uId] = this.splitArgs(args);
        if (uId) {
          return `${ind}const _username_${this.safeName(uId)} = await client.users.fetch(${this.str(uId)}).then(u => u.username).catch(() => null);`;
        }
        return `${ind}const _username = author ? author.username : null;`;
      }

      case 'nickname': {
        const [nUid, nGid] = this.splitArgs(args);
        return `${ind}const _nickname = member ? member.displayName : (author ? author.username : null);`;
      }

      case 'userAvatar': {
        const [uaId] = this.splitArgs(args);
        if (uaId) {
          return `${ind}const _userAvatar = await client.users.fetch(${this.str(uaId)}).then(u => u.displayAvatarURL()).catch(() => null);`;
        }
        return `${ind}const _userAvatar = author ? author.displayAvatarURL() : null;`;
      }

      case 'userJoined':
        return `${ind}const _userJoined = member ? member.joinedAt : null;`;

      case 'userRoles':
        return `${ind}const _userRoles = member ? member.roles.cache.map(r => r.id) : [];`;

      case 'bot':
        return `${ind}const _isBot = author ? author.bot : false;`;

      case 'isBanned': {
        const [ibId] = this.splitArgs(args);
        return `${ind}const _isBanned = guild ? await guild.bans.fetch(${this.str(ibId)}).then(() => true).catch(() => false) : false;`;
      }

      case 'ban': {
        const [bUid, bReason, bDays] = this.splitArgs(args);
        const reason = this.str(bReason || 'No reason provided');
        const days = bDays || 0;
        return `${ind}if (member && member.bannable) await member.ban({ reason: ${reason}, deleteMessageDays: ${days} });`;
      }

      case 'kick': {
        const [kUid, kReason] = this.splitArgs(args);
        return `${ind}if (member && member.kickable) await member.kick(${this.str(kReason || 'No reason provided')});`;
      }

      case 'giveRole': {
        const [grUid, grRid] = this.splitArgs(args);
        return `${ind}if (member) await member.roles.add(${this.str(grRid)}).catch(() => {});`;
      }

      case 'takeRole': {
        const [trUid, trRid] = this.splitArgs(args);
        return `${ind}if (member) await member.roles.remove(${this.str(trRid)}).catch(() => {});`;
      }

      case 'channelTyping':
        return `${ind}if (channel && channel.sendTyping) await channel.sendTyping();`;

      case 'pinMessage': {
        const [pCh, pMsg] = this.splitArgs(args);
        return `${ind}try { const _pmsg = await (await client.channels.fetch(${this.str(pCh)})).messages.fetch(${this.str(pMsg)}); await _pmsg.pin(); } catch(e) {}`;
      }

      case 'deleteMessage': {
        const [dCh, dMsg] = this.splitArgs(args);
        return `${ind}try { const _dch = await client.channels.fetch(${this.str(dCh)}); const _dmsg = await _dch.messages.fetch(${this.str(dMsg)}); await _dmsg.delete(); } catch(e) {}`;
      }

      case 'editMessage': {
        const [eCh, eMsg, eText] = this.splitArgs(args);
        return `${ind}try { const _ech = await client.channels.fetch(${this.str(eCh)}); const _emsg = await _ech.messages.fetch(${this.str(eMsg)}); await _emsg.edit(${this.str(eText)}); } catch(e) {}`;
      }

      case 'createChannel': {
        const [ccName, ccType, ccCat, ccReason] = this.splitArgs(args);
        const typeStr = ccType === 'voice' ? 'ChannelType.GuildVoice' : 'ChannelType.GuildText';
        let opts = `name: ${this.str(ccName)}, type: ${typeStr}`;
        if (ccCat) opts += `, parent: ${this.str(ccCat)}`;
        if (ccReason) opts += `, reason: ${this.str(ccReason)}`;
        return `${ind}if (guild) await guild.channels.create({ ${opts} });`;
      }

      case 'removeChannel': {
        const [rcId, rcReason] = this.splitArgs(args);
        return `${ind}try { const _rch = await client.channels.fetch(${this.str(rcId)}); if (_rch && _rch.deletable) await _rch.delete(${this.str(rcReason || '')}); } catch(e) {}`;
      }

      case 'calculate':
        return `${ind}const _calc = ${args};`;

      case 'random': {
        const [rMin, rMax] = this.splitArgs(args);
        return `${ind}const _random = Math.floor(Math.random() * (${rMax} - ${rMin} + 1)) + ${rMin};`;
      }

      case 'round': {
        const [roNum, roDec] = this.splitArgs(args);
        const dec = roDec || 0;
        return `${ind}const _round = Math.round(${roNum} * Math.pow(10, ${dec})) / Math.pow(10, ${dec});`;
      }

      case 'ceil':
        return `${ind}const _ceil = Math.ceil(${args});`;

      case 'floor':
        return `${ind}const _floor = Math.floor(${args});`;

      case 'sqrt':
        return `${ind}const _sqrt = Math.sqrt(${args});`;

      case 'abs':
        return `${ind}const _abs = Math.abs(${args});`;

      case 'ping':
        return `${ind}const _ping = client.ws.ping;`;

      case 'serverID':
        return `${ind}const _serverID = guild ? guild.id : null;`;

      case 'serverName':
        return `${ind}const _serverName = guild ? guild.name : null;`;

      case 'channelsCount':
        return `${ind}const _channelsCount = guild ? guild.channels.cache.size : 0;`;

      case 'membersCount':
        return `${ind}const _membersCount = guild ? guild.memberCount : 0;`;

      case 'emojisCount':
        return `${ind}const _emojisCount = guild ? guild.emojis.cache.size : 0;`;

      case 'suppressErrors':
        return `${ind}_suppress = true; _errorMsg = ${this.str(args || '')};`;

      case 'jsonParse':
        return `${ind}let _json = JSON.parse(${this.str(args)});`;

      case 'jsonStringify':
        return `${ind}const _jsonStr = JSON.stringify(_json);`;

      case 'json':
        return `${ind}const _jsonVal = _json?.[${this.str(args)}];`;

      case 'jsonSetString': {
        const [jsKey, jsVal] = this.splitArgs(args);
        return `${ind}if (!_json) _json = {}; _json[${this.str(jsKey)}] = ${this.str(jsVal)};`;
      }

      case 'and': {
        const conds = this.splitArgs(args).map(c => this.parseCondition(c));
        return `${ind}const _and = [${conds.join(', ')}].every(Boolean);`;
      }

      case 'or': {
        const conds = this.splitArgs(args).map(c => this.parseCondition(c));
        return `${ind}const _or = [${conds.join(', ')}].some(Boolean);`;
      }

      case 'botOwnerID':
        return `${ind}const _ownerID = process.env.BOT_OWNER_ID || null;`;

      case 'executionTime':
        return `${ind}const _execTime = Date.now() - startTime;`;

      case 'addButton': {
        const [abStyle, abId, abLabel, abEmoji, abDisabled] = this.splitArgs(args);
        this.hasComponents = true;
        const style = this.capitalize(abStyle || 'Primary');
        let btn = `new ButtonBuilder().setCustomId(${this.str(abId)}).setLabel(${this.str(abLabel)}).setStyle(ButtonStyle.${style})`;
        if (abEmoji) btn += `.setEmoji(${this.str(abEmoji)})`;
        if (abDisabled === 'true') btn += '.setDisabled(true)';
        return `${ind}if (!${this.rowVar}) ${this.rowVar} = new ActionRowBuilder(); ${this.rowVar}.addComponents(${btn});`;
      }

      case 'addSelectMenuOption':
        this.hasComponents = true;
        return `${ind}// Select menu: use JS for complex menus`;

      case 'addTextInput':
        return `${ind}// Text input: use JS for modals`;

      case 'consolePrint':
        return `${ind}db.addLog(botId, 'info', ${this.str(args)});`;

      case 'print':
        return `${ind}db.addLog(botId, 'info', ${this.str(args)});`;

      default:
        return `${ind}// Unknown command: ${cmd}`;
    }
  }

  parseCondition(cond) {
    let c = cond.trim();
    c = c.replace(/\$message/g, '(message ? message.content : "")');
    c = c.replace(/\$authorID/g, '(author ? author.id : "")');
    c = c.replace(/\$authorTag/g, '(author ? author.tag : "")');
    c = c.replace(/\$serverID/g, '(guild ? guild.id : "")');
    c = c.replace(/\$channelID/g, '(channel ? channel.id : "")');
    c = c.replace(/\$args/g, '(args ? args.length : 0)');
    c = c.replace(/\$ping/g, 'client.ws.ping');
    c = c.replace(/\$random/g, 'Math.random()');
    c = c.replace(/\$nickname/g, '(member ? member.displayName : "")');
    c = c.replace(/\$username/g, '(author ? author.username : "")');
    c = c.replace(/\$botOwnerID/g, '(process.env.BOT_OWNER_ID || "")');
    c = c.replace(/\$serverName/g, '(guild ? guild.name : "")');
    c = c.replace(/\$membersCount/g, '(guild ? guild.memberCount : 0)');
    c = c.replace(/==/g, '===');
    c = c.replace(/!=/g, '!==');
    return c;
  }

  str(s) {
    if (!s) return "''";
    s = s.trim();
    if (s.startsWith('$')) {
      const varName = s.slice(1);
      if (varName.startsWith('{') && varName.endsWith('}')) {
        return varName.slice(1, -1);
      }
      return varName;
    }
    if (s.startsWith('_var_') || s.startsWith('_calc') || s.startsWith('_random') ||
        s.startsWith('_round') || s.startsWith('_ceil') || s.startsWith('_floor') ||
        s.startsWith('_sqrt') || s.startsWith('_abs') || s.startsWith('_ping') ||
        s.startsWith('_serverID') || s.startsWith('_serverName') || s.startsWith('_channelsCount') ||
        s.startsWith('_membersCount') || s.startsWith('_emojisCount') || s.startsWith('_authorID') ||
        s.startsWith('_authorTag') || s.startsWith('_username') || s.startsWith('_nickname') ||
        s.startsWith('_avatar') || s.startsWith('_isBot') || s.startsWith('_isBanned') ||
        s.startsWith('_joined') || s.startsWith('_roles') || s.startsWith('_jsonVal') ||
        s.startsWith('_jsonStr') || s.startsWith('_and') || s.startsWith('_or') ||
        s.startsWith('_ownerID') || s.startsWith('_execTime') || s.startsWith('_msgContent')) {
      return s;
    }
    return `'${s.replace(/'/g, "\\'")}'`;
  }

  splitArgs(args) {
    if (!args) return [];
    return args.split(',').map(a => a.trim());
  }

  safeName(name) {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
  }

  capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
}

module.exports = CBScriptCompiler;

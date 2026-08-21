/**
 * CBScript → JavaScript Transpiler
 * Based on NIF-ESOTERIC BYTECODE SPECIFICATION v4.0.2-OMEGA
 * Converts <nif ...> tags into executable discord.js compatible JS
 */

const TAG_MAP = {
  // Logical flow
  'if': { code: 'if', type: 'block_start' },
  'elseif': { code: 'else if', type: 'block_start' },
  'else': { code: 'else', type: 'block_start' },
  'endif': { code: '}', type: 'block_end' },
  'and': { code: '&&', type: 'op' },
  'or': { code: '||', type: 'op' },
  'stop': { code: 'return;', type: 'stmt' },
  'c': { code: '//', type: 'comment' },

  // IO
  'sendMessage': { fn: 'sendMessage', args: ['text', 'returnId'] },
  'editMessage': { fn: 'editMessage', args: ['channelId', 'messageId', 'newText'] },
  'deleteMessage': { fn: 'deleteMessage', args: ['channelId', 'messageId'] },
  'reply': { fn: 'reply', args: ['text', 'mention'] },
  'nomention': { fn: 'noMention', args: [] },
  'suppressErrors': { fn: 'suppressErrors', args: ['msg'] },
  'alwaysReply': { fn: 'alwaysReply', args: [] },
  'message': { fn: 'getMessage', args: [] },
  'noargs': { fn: 'noArgs', args: [] },
  'argsCheck': { fn: 'argsCheck', args: ['howMany', 'errorMsg'] },

  // Embeds
  'createEmbed': { fn: 'createEmbed', args: [] },
  'title': { fn: 'embedTitle', args: ['title', 'url'] },
  'description': { fn: 'embedDescription', args: ['desc'] },
  'color': { fn: 'embedColor', args: ['color'] },
  'addField': { fn: 'embedAddField', args: ['title', 'desc', 'inline'] },
  'footer': { fn: 'embedFooter', args: ['text', 'icon'] },
  'author': { fn: 'embedAuthor', args: ['name', 'icon', 'url'] },
  'image': { fn: 'embedImage', args: ['url'] },
  'thumbnail': { fn: 'embedThumbnail', args: ['url'] },
  'addTimestamp': { fn: 'embedTimestamp', args: [] },

  // Variables
  'getVar': { fn: 'getVar', args: ['name', 'scopeId'] },
  'setVar': { fn: 'setVar', args: ['name', 'value', 'scopeId'] },
  'addVar': { fn: 'addVar', args: ['name', 'value', 'scopeId'] },
  'subVar': { fn: 'subVar', args: ['name', 'value', 'scopeId'] },
  'resetVar': { fn: 'resetVar', args: ['name', 'scopeId'] },
  'getUserVar': { fn: 'getUserVar', args: ['name', 'userId'] },
  'setUserVar': { fn: 'setUserVar', args: ['name', 'value', 'userId'] },
  'getGuildVar': { fn: 'getGuildVar', args: ['name', 'guildId'] },
  'setGuildVar': { fn: 'setGuildVar', args: ['name', 'value', 'guildId'] },

  // Entity
  'authorID': { fn: 'authorID', args: [] },
  'authorTag': { fn: 'authorTag', args: [] },
  'username': { fn: 'username', args: ['userId'] },
  'nickname': { fn: 'nickname', args: ['userId', 'guildId'] },
  'userAvatar': { fn: 'userAvatar', args: ['userId'] },
  'userJoined': { fn: 'userJoined', args: ['userId'] },
  'userRoles': { fn: 'userRoles', args: ['userId'] },
  'bot': { fn: 'isBot', args: [] },
  'isBanned': { fn: 'isBanned', args: ['userId'] },

  // Moderation
  'ban': { fn: 'ban', args: ['userId', 'reason', 'days'] },
  'kick': { fn: 'kick', args: ['userId', 'reason'] },
  'giveRole': { fn: 'giveRole', args: ['userId', 'roleId'] },
  'takeRole': { fn: 'takeRole', args: ['userId', 'roleId'] },
  'createChannel': { fn: 'createChannel', args: ['name', 'type', 'categoryId', 'reason'] },
  'removeChannel': { fn: 'removeChannel', args: ['channelId', 'reason'] },
  'channelTyping': { fn: 'channelTyping', args: ['channelId'] },
  'pinMessage': { fn: 'pinMessage', args: ['channelId', 'messageId'] },

  // Math
  'calculate': { fn: 'calculate', args: ['expr'] },
  'random': { fn: 'random', args: ['min', 'max'] },
  'round': { fn: 'round', args: ['num', 'decimals'] },
  'ceil': { fn: 'ceil', args: ['num'] },
  'floor': { fn: 'floor', args: ['num'] },
  'sqrt': { fn: 'sqrt', args: ['num'] },
  'abs': { fn: 'abs', args: ['num'] },

  // JSON
  'jsonParse': { fn: 'jsonParse', args: ['str'] },
  'jsonSetString': { fn: 'jsonSetString', args: ['key', 'value'] },
  'jsonStringify': { fn: 'jsonStringify', args: [] },
  'json': { fn: 'jsonGet', args: ['key'] },

  // Interactions
  'addButton': { fn: 'addButton', args: ['style', 'customId', 'label', 'emoji', 'disabled'] },
  'addSelectMenuOption': { fn: 'addSelectMenuOption', args: ['customId', 'label', 'value', 'desc', 'emoji', 'def'] },
  'addTextInput': { fn: 'addTextInput', args: ['customId', 'label', 'style', 'required', 'min', 'max', 'placeholder'] },

  // System
  'ping': { fn: 'ping', args: [] },
  'executionTime': { fn: 'executionTime', args: [] },
  'botOwnerID': { fn: 'botOwnerID', args: [] },
  'serverID': { fn: 'serverID', args: [] },
  'serverName': { fn: 'serverName', args: [] },
  'channelsCount': { fn: 'channelsCount', args: [] },
  'membersCount': { fn: 'membersCount', args: [] },
  'emojisCount': { fn: 'emojisCount', args: [] },
};

function escapeJS(str) {
  if (str === undefined || str === null) return '""';
  return JSON.stringify(String(str));
}

function parseArgs(argStr) {
  if (!argStr || !argStr.trim()) return [];
  const args = [];
  let current = '';
  let depth = 0;
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < argStr.length; i++) {
    const ch = argStr[i];
    if ((ch === '"' || ch === "'") && (i === 0 || argStr[i - 1] !== '\\')) {
      if (!inQuote) {
        inQuote = true;
        quoteChar = ch;
      } else if (ch === quoteChar) {
        inQuote = false;
      }
      current += ch;
    } else if (ch === '{' && !inQuote) {
      depth++;
      current += ch;
    } else if (ch === '}' && !inQuote) {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0 && !inQuote) {
      args.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function transpileTag(tagName, argStr) {
  const lower = tagName.toLowerCase();
  const meta = TAG_MAP[lower] || TAG_MAP[tagName];
  if (!meta) {
    return `/* unknown tag: ${tagName} */`;
  }

  if (meta.type === 'comment') {
    return `// ${argStr || ''}`;
  }
  if (meta.type === 'stmt') {
    return meta.code;
  }
  if (meta.type === 'block_end') {
    return '}';
  }
  if (meta.type === 'block_start') {
    if (meta.code === 'else') return 'else {';
    const cond = argStr ? transpileCondition(argStr) : 'true';
    return `${meta.code} (${cond}) {`;
  }
  if (meta.type === 'op') {
    const parts = parseArgs(argStr);
    return parts.map(p => transpileCondition(p)).join(` ${meta.code} `);
  }

  // Function call style
  const args = parseArgs(argStr);
  const mapped = (meta.args || []).map((name, i) => {
    const val = args[i];
    if (val === undefined || val === '') return 'undefined';
    // If it looks like a nested tag or expression, keep as is after light transpile
    if (val.includes('<nif') || val.startsWith('$')) {
      return transpileInline(val);
    }
    // Boolean-ish
    if (val.toLowerCase() === 'true' || val.toLowerCase() === 'false') return val.toLowerCase();
    // Number
    if (!isNaN(val) && val.trim() !== '') return val;
    return escapeJS(val);
  });

  return `await ctx.${meta.fn}(${mapped.join(', ')})`;
}

function transpileCondition(expr) {
  if (!expr) return 'true';
  // Simple support for nested tags inside conditions
  return transpileInline(expr);
}

function transpileInline(text) {
  if (!text) return '""';
  // Replace <nif tag{args}> occurrences
  const tagRegex = /<nif\s+([a-zA-Z0-9_]+)(?:\{([^}]*)\})?>/gi;
  let result = '';
  let lastIndex = 0;
  let match;
  const re = new RegExp(tagRegex);

  while ((match = re.exec(text)) !== null) {
    // text before tag
    const before = text.slice(lastIndex, match.index);
    if (before) result += escapeJS(before) + ' + ';
    const tagName = match[1];
    const args = match[2] || '';
    result += `(${transpileTag(tagName, args)}) + `;
    lastIndex = re.lastIndex;
  }
  const after = text.slice(lastIndex);
  if (after) result += escapeJS(after);
  else if (result.endsWith(' + ')) result = result.slice(0, -3);

  if (!result) return escapeJS(text);
  // Clean trailing
  result = result.replace(/\s*\+\s*$/, '');
  return result || '""';
}

/**
 * Main transpile function
 * Input: raw CBScript source
 * Output: async JS function body that can be executed inside a bot context
 */
function transpile(source) {
  if (!source || typeof source !== 'string') {
    return '// empty script\nreturn;';
  }

  const lines = source.split(/\r?\n/);
  const out = [];
  out.push('// Transpiled CBScript → JS');
  out.push('// Runtime context is available as `ctx`');
  out.push('');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push('');
      continue;
    }

    // Full line tags
    const fullTag = trimmed.match(/^<nif\s+([a-zA-Z0-9_]+)(?:\{([^}]*)\})?>$/i);
    if (fullTag) {
      out.push(transpileTag(fullTag[1], fullTag[2] || '') + ';');
      continue;
    }

    // Mixed content / multiple tags on one line
    if (trimmed.includes('<nif')) {
      // For reply / sendMessage style lines that contain text + tags
      // We treat the whole line as a potential send/reply if it starts with those, else evaluate
      const sendMatch = trimmed.match(/^<nif\s+(sendMessage|reply)\{([^}]*)\}>/i);
      if (sendMatch) {
        out.push(transpileTag(sendMatch[1], sendMatch[2]) + ';');
      } else {
        // Generic: evaluate all tags and if there's plain text treat as reply
        const hasOnlyTags = /^(\s*<nif\s+[a-zA-Z0-9_]+(?:\{[^}]*\})?>\s*)+$/i.test(trimmed);
        if (hasOnlyTags) {
          // multiple statements
          const multi = trimmed.matchAll(/<nif\s+([a-zA-Z0-9_]+)(?:\{([^}]*)\})?>/gi);
          for (const m of multi) {
            out.push(transpileTag(m[1], m[2] || '') + ';');
          }
        } else {
          // Treat as reply text with possible tags
          out.push(`await ctx.reply(${transpileInline(trimmed)}, false);`);
        }
      }
      continue;
    }

    // Plain text line → reply
    out.push(`await ctx.reply(${escapeJS(trimmed)}, false);`);
  }

  return out.join('\n');
}

/**
 * Detect language from source
 */
function detectLanguage(source) {
  if (!source) return 'cbscript';
  const s = source.trim();
  if (s.includes('<nif ') || s.includes('<nif\t') || /^<nif/i.test(s)) return 'cbscript';
  if (s.startsWith('def ') || s.includes('print(') || s.includes('import ') || s.startsWith('#')) return 'python';
  if (s.includes('console.log') || s.includes('async function') || s.includes('require(') || s.includes('module.exports')) return 'javascript';
  // Default to CBScript for this platform
  return 'cbscript';
}

module.exports = {
  transpile,
  detectLanguage,
  TAG_MAP
};

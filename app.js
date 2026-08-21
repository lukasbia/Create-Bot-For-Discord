/* CBScript Platform Frontend */
(function () {
  'use strict';

  const state = {
    user: null,
    bots: [],
    currentBotId: null,
    currentBot: null,
    scripts: [],
    variables: [],
    editingScriptId: null,
    consoleTimer: null
  };

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  function toast(msg, ms = 2400) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const el = $('#screen-' + id);
    if (el) el.classList.add('active');
  }

  function showPanel(name) {
    $$('.panel').forEach(p => p.classList.remove('active'));
    const p = $('#panel-' + name);
    if (p) p.classList.add('active');
    $$('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.panel === name);
    });
    if (name === 'console') startConsolePoll();
    else stopConsolePoll();
    if (name === 'scripts') loadScripts();
    if (name === 'variables') loadVariables();
    if (name === 'dashboard') refreshDashboard();
  }

  function openModal(id) {
    $('#modal-overlay').classList.remove('hidden');
    $$('.modal-window').forEach(m => m.classList.add('hidden'));
    const m = $('#modal-' + id);
    if (m) m.classList.remove('hidden');
  }

  function closeModals() {
    $('#modal-overlay').classList.add('hidden');
    $$('.modal-window').forEach(m => m.classList.add('hidden'));
    state.editingScriptId = null;
  }

  // Auth
  async function checkAuth() {
    try {
      const res = await fetch('/auth/status', { credentials: 'include' });
      const data = await res.json();
      if (data.authenticated) {
        state.user = data.user;
        $('#user-name').textContent = data.user.name || 'User';
        if (data.user.avatar) {
          $('#user-avatar').src = data.user.avatar;
          $('#user-avatar').style.display = '';
        }
        showScreen('bots');
        await loadBots();
      } else {
        showScreen('login');
      }
    } catch {
      showScreen('login');
    }
  }

  // Bots
  async function loadBots() {
    try {
      state.bots = await api('/bots');
      renderBotList();
    } catch (e) {
      toast(e.message);
    }
  }

  function renderBotList() {
    const list = $('#bot-list');
    const empty = $('#bot-list-empty');
    list.innerHTML = '';
    if (!state.bots.length) {
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    state.bots.forEach(b => {
      const card = document.createElement('div');
      card.className = 'bot-card';
      card.innerHTML = `
        <img class="bot-avatar" src="${b.avatar || ''}" alt="" onerror="this.style.background='var(--tint-soft)'" />
        <div class="info">
          <h4>${esc(b.name)}</h4>
          <div class="meta">
            <span class="status-dot ${b.status || 'offline'}" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle"></span>
            ${esc(b.status || 'offline')}
          </div>
        </div>
        <button class="btn-edit" data-id="${b.id}">Edit</button>
      `;
      card.querySelector('.btn-edit').onclick = () => openBot(b.id);
      list.appendChild(card);
    });
  }

  async function openBot(id) {
    state.currentBotId = id;
    try {
      state.currentBot = await api('/bots/' + id);
      showScreen('editor');
      showPanel('dashboard');
      refreshDashboard();
    } catch (e) {
      toast(e.message);
    }
  }

  function refreshDashboard() {
    const b = state.currentBot;
    if (!b) return;
    $('#dash-name').textContent = b.name;
    $('#dash-avatar').src = b.avatar || '';
    const status = b.status || 'offline';
    $('#dash-status-dot').className = 'status-dot ' + status;
    $('#dash-status-text').textContent = status.charAt(0).toUpperCase() + status.slice(1);
    $('#dash-client-id').textContent = b.client_id || '—';
    if (b.hosting_until) {
      const d = new Date(b.hosting_until * 1000);
      $('#dash-hosting').textContent = d.toLocaleString();
    } else {
      $('#dash-hosting').textContent = 'Expired';
    }
  }

  // Scripts
  async function loadScripts() {
    if (!state.currentBotId) return;
    try {
      state.scripts = await api(`/bots/${state.currentBotId}/scripts`);
      renderScripts();
    } catch (e) {
      toast(e.message);
    }
  }

  function renderScripts() {
    const list = $('#script-list');
    const empty = $('#script-list-empty');
    list.innerHTML = '';
    if (!state.scripts.length) {
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    state.scripts.forEach(s => {
      const card = document.createElement('div');
      card.className = 'script-card';
      card.innerHTML = `
        <div class="info" style="flex:1">
          <h4 style="font-size:15px;font-weight:600">${esc(s.name)}</h4>
          <div class="meta">${esc(s.language)} · ${esc(s.trigger_type)}${s.trigger_value ? ' · ' + esc(s.trigger_value) : ''}</div>
        </div>
        <span class="badge">${s.enabled ? 'ON' : 'OFF'}</span>
        <button class="btn-edit" data-id="${s.id}">Edit</button>
      `;
      card.querySelector('.btn-edit').onclick = () => editScript(s.id);
      list.appendChild(card);
    });
  }

  async function editScript(id) {
    try {
      const s = await api(`/bots/${state.currentBotId}/scripts/${id}`);
      state.editingScriptId = id;
      $('#script-modal-title').textContent = 'Edit script';
      $('#script-name').value = s.name;
      $('#script-trigger').value = s.trigger_value || '';
      $('#script-lang').value = s.language || 'cbscript';
      $('#code-editor').value = s.source || '';
      updateEditorHighlight();
      updateEditorStats();
      openModal('script');
    } catch (e) {
      toast(e.message);
    }
  }

  function openCreateScript() {
    state.editingScriptId = null;
    $('#script-modal-title').textContent = 'Create a script';
    $('#script-name').value = '';
    $('#script-trigger').value = '';
    $('#script-lang').value = 'cbscript';
    $('#code-editor').value = `<nif c{Hello World script - prints to console and replies}
<nif reply{Hello World!,false}`;
    updateEditorHighlight();
    updateEditorStats();
    openModal('script');
  }

  // Code editor highlight (simple)
  function highlightCBScript(src) {
    return esc(src)
      .replace(/(&lt;nif\s+)([a-zA-Z0-9_]+)/g, '<span class="tok-tag">$1$2</span>')
      .replace(/\{/g, '<span class="tok-brace">{</span>')
      .replace(/\}/g, '<span class="tok-brace">}</span>')
      .replace(/(&lt;nif\s+c\{)([^}]*)(\})/g, '<span class="tok-comment">$1$2$3</span>');
  }

  function updateEditorHighlight() {
    const src = $('#code-editor').value;
    const lang = $('#script-lang').value;
    let html;
    if (lang === 'cbscript') {
      html = highlightCBScript(src);
    } else {
      html = esc(src)
        .replace(/\b(const|let|var|function|async|await|return|if|else|for|while|class|new|this)\b/g, '<span class="tok-kw">$1</span>')
        .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '<span class="tok-string">$&</span>')
        .replace(/(\/\/.*$)/gm, '<span class="tok-comment">$1</span>');
    }
    $('#code-highlight').innerHTML = html + '\n';
  }

  function updateEditorStats() {
    const src = $('#code-editor').value;
    const lines = src ? src.split('\n').length : 1;
    const chars = src.length;
    $('#line-count').textContent = lines + (lines === 1 ? ' line' : ' lines');
    $('#char-count').textContent = chars + (chars === 1 ? ' character' : ' characters');
  }

  // Variables
  async function loadVariables() {
    if (!state.currentBotId) return;
    try {
      state.variables = await api(`/bots/${state.currentBotId}/variables`);
      renderVariables();
    } catch (e) {
      toast(e.message);
    }
  }

  function renderVariables() {
    const list = $('#var-list');
    const empty = $('#var-list-empty');
    list.innerHTML = '';
    if (!state.variables.length) {
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    state.variables.forEach(v => {
      const card = document.createElement('div');
      card.className = 'var-card';
      card.innerHTML = `
        <div class="info" style="flex:1">
          <h4 style="font-size:15px;font-weight:600">${esc(v.name)}</h4>
          <div class="meta">${esc(String(v.value).slice(0, 40))}</div>
        </div>
        <button class="btn-edit" data-id="${v.id}" style="background:rgba(255,69,58,0.15);color:var(--danger)">Delete</button>
      `;
      card.querySelector('.btn-edit').onclick = async () => {
        if (!confirm('Delete variable?')) return;
        await api(`/bots/${state.currentBotId}/variables/${v.id}`, { method: 'DELETE' });
        loadVariables();
      };
      list.appendChild(card);
    });
  }

  // Console
  function startConsolePoll() {
    stopConsolePoll();
    loadConsole();
    state.consoleTimer = setInterval(loadConsole, 2500);
  }
  function stopConsolePoll() {
    if (state.consoleTimer) {
      clearInterval(state.consoleTimer);
      state.consoleTimer = null;
    }
  }

  async function loadConsole() {
    if (!state.currentBotId) return;
    try {
      const rows = await api(`/bots/${state.currentBotId}/console`);
      const out = $('#console-output');
      out.innerHTML = rows.slice().reverse().map(r => {
        const t = new Date(r.created_at * 1000).toLocaleTimeString();
        return `<div class="console-line ${esc(r.level)}"><span class="console-time">${t}</span>${esc(r.message)}</div>`;
      }).join('');
      out.scrollTop = out.scrollHeight;
    } catch {}
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Event bindings
  function bind() {
    $('#btn-google-login').onclick = () => { location.href = '/auth/google'; };
    $('#btn-logout').onclick = () => { location.href = '/auth/logout'; };

    $('#btn-create-bot').onclick = () => {
      $('#new-bot-name').value = '';
      $('#new-bot-token').value = '';
      openModal('create-bot');
    };

    $('#btn-save-bot').onclick = async () => {
      const name = $('#new-bot-name').value.trim();
      const token = $('#new-bot-token').value.trim();
      if (!name || !token) return toast('Name and token required');
      try {
        await api('/bots', { method: 'POST', body: { name, token } });
        closeModals();
        toast('Bot created');
        await loadBots();
      } catch (e) {
        toast(e.message);
      }
    };

    $$('.close-modal').forEach(el => el.onclick = closeModals);
    $('#modal-overlay').onclick = (e) => {
      if (e.target === $('#modal-overlay')) closeModals();
    };

    // Back buttons
    ['btn-back-bots', 'btn-back-bots-2', 'btn-back-bots-3', 'btn-back-bots-4', 'btn-back-bots-5'].forEach(id => {
      const el = $('#' + id);
      if (el) el.onclick = () => {
        stopConsolePoll();
        state.currentBotId = null;
        showScreen('bots');
        loadBots();
      };
    });

    // Nav
    $$('.nav-item').forEach(n => {
      n.onclick = () => showPanel(n.dataset.panel);
    });

    // Dashboard actions
    $('#btn-invite').onclick = () => {
      const url = state.currentBot?.invite_url;
      if (url) window.open(url, '_blank');
      else toast('Invite link not ready');
    };

    $('#btn-watch-ad').onclick = async () => {
      try {
        toast('Watching ad…');
        // Simulated ad delay – real integration would show an ad SDK
        await new Promise(r => setTimeout(r, 1500));
        const res = await api(`/bots/${state.currentBotId}/watch-ad`, { method: 'POST' });
        toast('Hosting extended +1 day');
        state.currentBot = await api('/bots/' + state.currentBotId);
        refreshDashboard();
      } catch (e) {
        toast(e.message);
      }
    };

    // Scripts
    $('#btn-create-script').onclick = openCreateScript;

    $('#code-editor').addEventListener('input', () => {
      updateEditorHighlight();
      updateEditorStats();
    });
    $('#code-editor').addEventListener('scroll', () => {
      $('#code-highlight').scrollTop = $('#code-editor').scrollTop;
      $('#code-highlight').scrollLeft = $('#code-editor').scrollLeft;
    });
    $('#script-lang').addEventListener('change', updateEditorHighlight);

    $('#btn-save-script').onclick = async () => {
      const name = $('#script-name').value.trim();
      const trigger = $('#script-trigger').value.trim();
      const language = $('#script-lang').value;
      const source = $('#code-editor').value;
      if (!name) return toast('Name required');
      try {
        if (state.editingScriptId) {
          await api(`/bots/${state.currentBotId}/scripts/${state.editingScriptId}`, {
            method: 'PUT',
            body: { name, trigger_value: trigger, language, source }
          });
          toast('Script saved');
        } else {
          await api(`/bots/${state.currentBotId}/scripts`, {
            method: 'POST',
            body: { name, trigger_type: trigger ? 'command' : 'message', trigger_value: trigger, language, source }
          });
          toast('Script created');
        }
        closeModals();
        loadScripts();
      } catch (e) {
        toast(e.message);
      }
    };

    // Variables
    $('#btn-create-var').onclick = () => {
      $('#var-name').value = '';
      $('#var-value').value = '';
      openModal('variable');
    };
    $('#btn-save-var').onclick = async () => {
      const name = $('#var-name').value.trim();
      const value = $('#var-value').value;
      if (!name) return toast('Name required');
      try {
        await api(`/bots/${state.currentBotId}/variables`, {
          method: 'POST',
          body: { name, value }
        });
        closeModals();
        toast('Variable saved');
        loadVariables();
      } catch (e) {
        toast(e.message);
      }
    };

    // Console clear
    $('#btn-clear-console').onclick = async () => {
      await api(`/bots/${state.currentBotId}/console`, { method: 'DELETE' });
      loadConsole();
    };

    // Settings
    $('#btn-save-settings').onclick = async () => {
      const name = $('#set-name').value.trim();
      const token = $('#set-token').value.trim();
      const body = {};
      if (name) body.name = name;
      if (token) body.token = token;
      if (!Object.keys(body).length) return toast('Nothing to save');
      try {
        state.currentBot = await api(`/bots/${state.currentBotId}`, { method: 'PATCH', body });
        toast('Saved');
        refreshDashboard();
      } catch (e) {
        toast(e.message);
      }
    };

    $('#btn-restart-bot').onclick = async () => {
      try {
        toast('Restarting…');
        await api(`/bots/${state.currentBotId}/restart`, { method: 'POST' });
        state.currentBot = await api('/bots/' + state.currentBotId);
        refreshDashboard();
        toast('Restarted');
      } catch (e) {
        toast(e.message);
      }
    };

    $('#btn-delete-bot').onclick = async () => {
      if (!confirm('Delete this bot permanently?')) return;
      try {
        await api(`/bots/${state.currentBotId}`, { method: 'DELETE' });
        state.currentBotId = null;
        showScreen('bots');
        loadBots();
        toast('Bot deleted');
      } catch (e) {
        toast(e.message);
      }
    };

    // Populate settings when opening panel
    const origShow = showPanel;
    // already handled in showPanel for other panels; settings fill:
    document.querySelector('[data-panel="settings"]').addEventListener('click', () => {
      if (state.currentBot) {
        $('#set-name').value = state.currentBot.name || '';
        $('#set-token').value = '';
      }
    });
  }

  // Init
  bind();
  checkAuth();
})();

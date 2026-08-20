// ═══════════════════════════════════════════
// CBScript Platform - Frontend Logic
// ═══════════════════════════════════════════

const API = {
  get: (url) => fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : Promise.reject(r)),
  post: (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) }).then(r => r.ok ? r.json() : Promise.reject(r)),
  put: (url, body) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) }).then(r => r.ok ? r.json() : Promise.reject(r)),
  del: (url) => fetch(url, { method: 'DELETE', credentials: 'include' }).then(r => r.ok ? r.json() : Promise.reject(r))
};

// ─── State ───
let currentUser = null;
let bots = [];
let currentBot = null;
let currentTab = 'dashboard';
let scripts = [];
let variables = [];
let logsInterval = null;
let editingScriptId = null;
let editingVarId = null;

// ─── Init ───
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    currentUser = await API.get('/api/me');
    showApp();
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appContainer').style.display = 'none';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appContainer').style.display = 'block';
  document.getElementById('userName').textContent = currentUser.username;
  document.getElementById('userAvatar').textContent = currentUser.username.charAt(0).toUpperCase();
  if (currentUser.avatar) {
    document.getElementById('userAvatar').innerHTML = `<img src="${currentUser.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  }
  loadBots();
}

// ─── Bots ───
async function loadBots() {
  try {
    bots = await API.get('/api/bots');
    renderBots();
  } catch (err) {
    showToast('Failed to load bots', 'error');
  }
}

function renderBots() {
  const grid = document.getElementById('botGrid');
  const empty = document.getElementById('botEmpty');

  if (!bots.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = bots.map(bot => `
    <div class="bot-card animate-fade-in" onclick="openBot(${bot.id})" style="animation-delay:${bots.indexOf(bot) * 0.05}s">
      <div class="bot-banner">
        <div class="bot-avatar-wrap">
          <div class="bot-avatar">${bot.name.charAt(0).toUpperCase()}</div>
        </div>
      </div>
      <div class="bot-card-body">
        <div class="bot-card-name">${escapeHtml(bot.name)}</div>
        <div class="bot-card-meta">
          <span class="status-badge ${bot.status === 'online' ? 'status-online' : 'status-offline'}">
            ${bot.status === 'online' ? 'Online' : 'Offline'}
          </span>
          ${bot.hosting_expires_at ? `<span style="margin-left:6px; color:var(--text-muted);">⏱ ${formatTimeLeft(bot.hosting_expires_at)}</span>` : ''}
        </div>
        <div style="display:flex; gap:8px;">
          <span class="script-lang-badge lang-cbscript" style="font-size:10px;">Edit →</span>
        </div>
      </div>
    </div>
  `).join('');
}

function showCreateBotModal() {
  document.getElementById('newBotName').value = '';
  document.getElementById('newBotToken').value = '';
  openModal('modalCreateBot');
}

async function createBot() {
  const name = document.getElementById('newBotName').value.trim();
  const token = document.getElementById('newBotToken').value.trim();

  if (!name || !token) {
    showToast('Name and token are required', 'error');
    return;
  }

  try {
    await API.post('/api/bots', { name, token });
    closeModal('modalCreateBot');
    showToast('Bot created successfully');
    loadBots();
  } catch (err) {
    const data = await err.json().catch(() => ({}));
    showToast(data.error || 'Failed to create bot', 'error');
  }
}

// ─── Bot Editor ───
async function openBot(botId) {
  currentBot = bots.find(b => b.id === botId);
  if (!currentBot) return;

  document.getElementById('botListScreen').style.display = 'none';
  document.getElementById('botEditorScreen').style.display = 'block';
  document.getElementById('bottomNav').style.display = 'flex';
  document.getElementById('pageTitle').textContent = currentBot.name;
  document.getElementById('createBotFab').style.display = 'none';

  switchTab('dashboard');
}

function backToBots() {
  currentBot = null;
  document.getElementById('botListScreen').style.display = 'block';
  document.getElementById('botEditorScreen').style.display = 'none';
  document.getElementById('bottomNav').style.display = 'none';
  document.getElementById('pageTitle').textContent = 'My Bots';
  document.getElementById('createBotFab').style.display = 'flex';
  if (logsInterval) clearInterval(logsInterval);
  loadBots();
}

function switchTab(tab) {
  currentTab = tab;

  // Update nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Show content
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).style.display = 'block';

  if (logsInterval) { clearInterval(logsInterval); logsInterval = null; }

  if (tab === 'dashboard') loadDashboard();
  if (tab === 'scripts') loadScripts();
  if (tab === 'console') { loadLogs(); logsInterval = setInterval(loadLogs, 3000); }
  if (tab === 'variables') loadVariables();
  if (tab === 'settings') loadSettings();
}

// ─── Dashboard ───
async function loadDashboard() {
  if (!currentBot) return;

  document.getElementById('dashName').textContent = currentBot.name;
  document.getElementById('dashAvatar').textContent = currentBot.name.charAt(0).toUpperCase();

  const statusEl = document.getElementById('dashStatus');
  statusEl.className = 'status-badge ' + (currentBot.status === 'online' ? 'status-online' : 'status-offline');
  statusEl.textContent = currentBot.status === 'online' ? 'Online' : 'Offline';

  const hostingEl = document.getElementById('dashHosting');
  if (currentBot.hosting_expires_at) {
    hostingEl.style.display = 'inline-flex';
    hostingEl.textContent = '⏱ ' + formatTimeLeft(currentBot.hosting_expires_at);
  } else {
    hostingEl.style.display = 'none';
  }

  // Invite link
  const inviteBtn = document.getElementById('dashInvite');
  if (currentBot.client_id) {
    inviteBtn.href = `https://discord.com/oauth2/authorize?client_id=${currentBot.client_id}&permissions=8&scope=bot%20applications.commands`;
    inviteBtn.style.display = 'inline-flex';
  } else {
    inviteBtn.href = '#';
    inviteBtn.style.display = 'inline-flex';
    inviteBtn.onclick = (e) => { e.preventDefault(); showToast('Start the bot first to generate invite link', 'warning'); };
  }

  // Buttons
  const isOnline = currentBot.status === 'online';
  document.getElementById('btnStartBot').style.display = isOnline ? 'none' : 'inline-flex';
  document.getElementById('btnStopBot').style.display = isOnline ? 'inline-flex' : 'none';

  // Stats
  const botScripts = await API.get(`/api/bots/${currentBot.id}/scripts`).catch(() => []);
  const botVars = await API.get(`/api/bots/${currentBot.id}/variables`).catch(() => []);

  document.getElementById('dashScripts').textContent = botScripts.length;
  document.getElementById('dashVars').textContent = botVars.length;
  document.getElementById('dashUptime').textContent = isOnline ? 'Active' : '--';
}

async function startBot() {
  if (!currentBot) return;
  try {
    await API.post(`/api/bots/${currentBot.id}/start`);
    showToast('Bot started');
    currentBot.status = 'online';
    loadDashboard();
  } catch (err) {
    const data = await err.json().catch(() => ({}));
    showToast(data.error || 'Failed to start bot', 'error');
  }
}

async function stopBot() {
  if (!currentBot) return;
  try {
    await API.post(`/api/bots/${currentBot.id}/stop`);
    showToast('Bot stopped');
    currentBot.status = 'offline';
    loadDashboard();
  } catch (err) {
    showToast('Failed to stop bot', 'error');
  }
}

async function restartBot() {
  if (!currentBot) return;
  try {
    await API.post(`/api/bots/${currentBot.id}/restart`);
    showToast('Bot restarted');
    currentBot.status = 'online';
    loadDashboard();
  } catch (err) {
    const data = await err.json().catch(() => ({}));
    showToast(data.error || 'Failed to restart bot', 'error');
  }
}

// ─── Ad / Hosting ───
function showAdModal() {
  document.getElementById('adTimer').style.display = 'none';
  document.getElementById('btnWatchAdConfirm').style.display = 'inline-flex';
  document.getElementById('btnWatchAdDone').style.display = 'none';
  document.getElementById('adProgressBar').style.width = '0%';
  openModal('modalAd');
}

function watchAd() {
  const timerEl = document.getElementById('adTimer');
  const btnConfirm = document.getElementById('btnWatchAdConfirm');
  const btnDone = document.getElementById('btnWatchAdDone');
  const bar = document.getElementById('adProgressBar');

  btnConfirm.style.display = 'none';
  timerEl.style.display = 'block';

  let seconds = 5;
  timerEl.textContent = seconds;
  bar.style.width = '0%';

  const interval = setInterval(() => {
    seconds--;
    timerEl.textContent = seconds;
    bar.style.width = ((5 - seconds) / 5 * 100) + '%';

    if (seconds <= 0) {
      clearInterval(interval);
      timerEl.style.display = 'none';
      btnDone.style.display = 'inline-flex';
      bar.style.width = '100%';
    }
  }, 1000);
}

async function confirmAdWatch() {
  if (!currentBot) return;
  try {
    const res = await API.post(`/api/bots/${currentBot.id}/hosting`);
    currentBot.hosting_expires_at = res.hosting_expires_at;
    closeModal('modalAd');
    showToast(res.message);
    loadDashboard();
  } catch (err) {
    showToast('Failed to extend hosting', 'error');
  }
}

// ─── Scripts ───
async function loadScripts() {
  if (!currentBot) return;
  try {
    scripts = await API.get(`/api/bots/${currentBot.id}/scripts`);
    renderScripts();
  } catch {
    showToast('Failed to load scripts', 'error');
  }
}

function renderScripts() {
  const list = document.getElementById('scriptsList');
  const empty = document.getElementById('scriptsEmpty');

  if (!scripts.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = scripts.map(s => `
    <div class="script-item animate-fade-in" onclick="editScript(${s.id})" style="animation-delay:${scripts.indexOf(s) * 0.04}s">
      <div>
        <div style="font-weight:700; margin-bottom:4px;">${escapeHtml(s.name)}</div>
        <div style="font-size:12px; color:var(--text-muted);">Trigger: ${escapeHtml(s.trigger)}</div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="script-lang-badge lang-${s.language}">${s.language}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>
  `).join('');
}

function showCreateScriptModal() {
  editingScriptId = null;
  document.getElementById('scriptModalTitle').textContent = 'New Script';
  document.getElementById('scriptId').value = '';
  document.getElementById('scriptName').value = '';
  document.getElementById('scriptTrigger').value = '';
  document.getElementById('scriptLang').value = 'cbscript';
  document.getElementById('scriptCode').value = `<nif c{Hello World Example - CBScript}
<nif consolePrint{Hello World! This is your first CBScript.}
<nif sendMessage{Hello World!}
<nif createEmbed
<nif title{Welcome}
<nif description{This bot is powered by CBScript}
<nif color{#6366f1}
<nif addTimestamp`;
  document.getElementById('btnDeleteScript').style.display = 'none';
  document.getElementById('editorFilename').textContent = 'script.cbscript';
  updateCodeStats();
  openModal('modalScript');
}

function editScript(id) {
  const script = scripts.find(s => s.id === id);
  if (!script) return;

  editingScriptId = id;
  document.getElementById('scriptModalTitle').textContent = 'Edit Script';
  document.getElementById('scriptId').value = id;
  document.getElementById('scriptName').value = script.name;
  document.getElementById('scriptTrigger').value = script.trigger;
  document.getElementById('scriptLang').value = script.language;
  document.getElementById('scriptCode').value = script.code;
  document.getElementById('btnDeleteScript').style.display = 'inline-flex';
  document.getElementById('editorFilename').textContent = `script.${script.language === 'cbscript' ? 'cbscript' : script.language === 'javascript' ? 'js' : 'py'}`;
  updateCodeStats();
  openModal('modalScript');
}

async function saveScript() {
  const name = document.getElementById('scriptName').value.trim();
  const trigger = document.getElementById('scriptTrigger').value.trim();
  const language = document.getElementById('scriptLang').value;
  const code = document.getElementById('scriptCode').value;

  if (!name || !trigger) {
    showToast('Name and trigger are required', 'error');
    return;
  }

  try {
    if (editingScriptId) {
      await API.put(`/api/scripts/${editingScriptId}`, { name, trigger, language, code });
      showToast('Script updated');
    } else {
      await API.post(`/api/bots/${currentBot.id}/scripts`, { name, trigger, language, code });
      showToast('Script created');
    }
    closeModal('modalScript');
    loadScripts();
  } catch (err) {
    const data = await err.json().catch(() => ({}));
    showToast(data.error || 'Failed to save script', 'error');
  }
}

async function deleteScript() {
  if (!editingScriptId) return;
  if (!confirm('Delete this script?')) return;

  try {
    await API.del(`/api/scripts/${editingScriptId}`);
    closeModal('modalScript');
    showToast('Script deleted');
    loadScripts();
  } catch {
    showToast('Failed to delete script', 'error');
  }
}

// Code editor stats
const codeEditor = document.getElementById('scriptCode');
if (codeEditor) {
  codeEditor.addEventListener('input', updateCodeStats);
}

function updateCodeStats() {
  const code = document.getElementById('scriptCode').value;
  const lines = code.split('\n').length;
  const chars = code.length;
  document.getElementById('codeStats').textContent = `Lines: ${lines} | Characters: ${chars}`;
}

// Language change updates filename
document.getElementById('scriptLang')?.addEventListener('change', (e) => {
  const ext = e.target.value === 'cbscript' ? 'cbscript' : e.target.value === 'javascript' ? 'js' : 'py';
  document.getElementById('editorFilename').textContent = `script.${ext}`;
});

// ─── Console ───
async function loadLogs() {
  if (!currentBot) return;
  try {
    const logs = await API.get(`/api/bots/${currentBot.id}/logs?limit=100`);
    renderLogs(logs);
  } catch {
    // silent fail for auto-refresh
  }
}

function renderLogs(logs) {
  const body = document.getElementById('consoleBody');
  if (!logs.length) {
    body.innerHTML = '<div class="console-line" style="color:var(--text-muted);">No logs yet. Start your bot to see activity.</div>';
    return;
  }

  body.innerHTML = logs.map(log => {
    const time = new Date(log.created_at).toLocaleTimeString();
    const typeClass = log.type === 'error' ? 'console-type-error' : log.type === 'warn' ? 'console-type-warn' : log.type === 'success' ? 'console-type-success' : 'console-type-info';
    return `<div class="console-line">
      <span class="console-time">${time}</span>
      <span class="${typeClass}">[${log.type.toUpperCase()}]</span>
      <span style="color:var(--text-secondary);">${escapeHtml(log.message)}</span>
    </div>`;
  }).join('');

  body.scrollTop = body.scrollHeight;
}

function clearConsole() {
  document.getElementById('consoleBody').innerHTML = '<div class="console-line" style="color:var(--text-muted);">Console cleared.</div>';
}

// ─── Variables ───
async function loadVariables() {
  if (!currentBot) return;
  try {
    variables = await API.get(`/api/bots/${currentBot.id}/variables`);
    renderVariables();
  } catch {
    showToast('Failed to load variables', 'error');
  }
}

function renderVariables() {
  const list = document.getElementById('varsList');
  const empty = document.getElementById('varsEmpty');

  if (!variables.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = variables.map(v => `
    <div class="var-card animate-fade-in" onclick="editVar(${v.id})" style="animation-delay:${variables.indexOf(v) * 0.04}s; cursor:pointer;">
      <div class="var-name">${escapeHtml(v.name)}</div>
      <div class="var-value">${escapeHtml(v.value)}</div>
      <span class="var-scope">${v.scope}</span>
    </div>
  `).join('');
}

function showCreateVarModal() {
  editingVarId = null;
  document.getElementById('varModalTitle').textContent = 'New Variable';
  document.getElementById('varId').value = '';
  document.getElementById('varName').value = '';
  document.getElementById('varValue').value = '';
  document.getElementById('varScope').value = 'global';
  document.getElementById('btnDeleteVar').style.display = 'none';
  openModal('modalVar');
}

function editVar(id) {
  const v = variables.find(x => x.id === id);
  if (!v) return;

  editingVarId = id;
  document.getElementById('varModalTitle').textContent = 'Edit Variable';
  document.getElementById('varId').value = id;
  document.getElementById('varName').value = v.name;
  document.getElementById('varValue').value = v.value;
  document.getElementById('varScope').value = v.scope;
  document.getElementById('btnDeleteVar').style.display = 'inline-flex';
  openModal('modalVar');
}

async function saveVar() {
  const name = document.getElementById('varName').value.trim();
  const value = document.getElementById('varValue').value;
  const scope = document.getElementById('varScope').value;

  if (!name) {
    showToast('Variable name is required', 'error');
    return;
  }

  try {
    if (editingVarId) {
      await API.put(`/api/variables/${editingVarId}`, { name, value, scope });
      showToast('Variable updated');
    } else {
      await API.post(`/api/bots/${currentBot.id}/variables`, { name, value, scope });
      showToast('Variable created');
    }
    closeModal('modalVar');
    loadVariables();
  } catch {
    showToast('Failed to save variable', 'error');
  }
}

async function deleteVar() {
  if (!editingVarId) return;
  if (!confirm('Delete this variable?')) return;

  try {
    await API.del(`/api/variables/${editingVarId}`);
    closeModal('modalVar');
    showToast('Variable deleted');
    loadVariables();
  } catch {
    showToast('Failed to delete variable', 'error');
  }
}

// ─── Settings ───
function loadSettings() {
  if (!currentBot) return;
  document.getElementById('settingName').value = currentBot.name;
  document.getElementById('settingToken').value = '';
  document.getElementById('deleteBotName').textContent = currentBot.name;
}

async function saveSettings() {
  const name = document.getElementById('settingName').value.trim();
  const token = document.getElementById('settingToken').value.trim();

  const updates = {};
  if (name) updates.name = name;
  if (token) updates.token = token;

  if (!Object.keys(updates).length) {
    showToast('No changes to save');
    return;
  }

  try {
    await API.put(`/api/bots/${currentBot.id}`, updates);
    if (name) {
      currentBot.name = name;
      document.getElementById('pageTitle').textContent = name;
    }
    showToast('Settings saved');
  } catch (err) {
    const data = await err.json().catch(() => ({}));
    showToast(data.error || 'Failed to save settings', 'error');
  }
}

function showDeleteConfirm() {
  openModal('modalDelete');
}

async function deleteBot() {
  if (!currentBot) return;
  try {
    await API.del(`/api/bots/${currentBot.id}`);
    closeModal('modalDelete');
    showToast('Bot deleted');
    backToBots();
  } catch {
    showToast('Failed to delete bot', 'error');
  }
}

// ─── Modals ───
function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
}

// ─── Toast ───
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toastIcon');
  const text = document.getElementById('toastMsg');

  text.textContent = msg;
  icon.textContent = type === 'error' ? '✕' : type === 'warning' ? '!' : '✓';
  toast.style.borderColor = type === 'error' ? 'rgba(248,113,113,0.3)' : type === 'warning' ? 'rgba(251,191,36,0.3)' : 'rgba(52,211,153,0.3)';

  toast.style.transform = 'translateX(-50%) translateY(0)';
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(-100px)';
  }, 3000);
}

// ─── Utilities ───
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTimeLeft(isoDate) {
  const diff = new Date(isoDate) - new Date();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours/24)}d ${hours%24}h left`;
  return `${hours}h ${mins}m left`;
}

// Handle back button
window.addEventListener('popstate', () => {
  if (currentBot) backToBots();
});

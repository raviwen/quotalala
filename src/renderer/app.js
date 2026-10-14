const api = window.quotalalaAPI;
const $ = id => document.getElementById(id);
let lang = 'tr', translations = {}, state = { agents: {}, healthRunning: false };
let models = [], settings = {}, logs = [], sessions = [], selectedSession = null, displayedSession = null;
let currentLevel = 'all', currentAgent = 'all', activeTab = 'liveStreamTab', busy = false, contextTarget = null;
let viewedTurns = [];
let project = { cwd: null, name: null, recentProjects: [] };
const openActivityIds = new Set();
const t = key => translations[key] || key;
function el(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
function button(text, action, className = 'btn-ghost') { const btn = el('button', className, text); btn.addEventListener('click', () => perform(action)); return btn; }
function notice(text) { $('notice').textContent = text; }
async function perform(action) { try { await action(); } catch (error) { notice(t('operationFailed') + ' ' + error.message); } }
async function copy(text) { await api.copy(text); notice(t('copied')); }
function copyButton(text, className = 'copy-row') { const btn = button('⧉', () => copy(text), className); btn.title = t('copy'); btn.setAttribute('aria-label', t('copy')); return btn; }
async function setLanguage(value) {
  translations = await (await fetch(`i18n/${value}.json`)).json(); lang = value; document.documentElement.lang = value;
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
  $('langTr').classList.toggle('active', lang === 'tr'); $('langEn').classList.toggle('active', lang === 'en');
  await api.setLanguage(value); renderProject(); renderState(); renderLogs(); renderHistory(); renderTurns(viewedTurns);
}
function renderProject() {
  const name = project.name || t('openProject');
  for (const id of ['projectName', 'sidebarProjectName', 'composerProjectName', 'contextProjectName']) $(id).textContent = name;
  $('cwdInput').value = project.cwd || '';
  $('projectPath').textContent = project.cwd || t('chooseProjectHint');
  $('projectPath').title = project.cwd || '';
  const select = $('recentProjects'); select.replaceChildren();
  const placeholder = el('option', '', t('switchProject')); placeholder.value = ''; select.append(placeholder);
  for (const cwd of project.recentProjects || []) {
    const option = el('option', '', cwd.split(/[\\/]/).filter(Boolean).at(-1)); option.value = cwd; option.title = cwd; select.append(option);
  }
  $('recentProjects').setAttribute('aria-label', t('switchProject'));
  for (const id of ['memoryInput', 'saveMemoryBtn', 'resetMemoryBtn']) $(id).disabled = !project.cwd || busy;
}
async function openProject(cwd) {
  if (busy || state.healthRunning) return;
  const next = await api.openWorkspace(cwd);
  if (!next.cwd || next.cwd === project.cwd) return;
  project = next; newSession(); renderProject(); renderState(); await refreshHistory(); await loadMemory();
  $('promptInput').focus();
}
function modelLabel(id) {
  const list = models.filter(m => m.agent === id && !m.preview);
  const descriptions = [];
  for (const level of ['hafif', 'orta', 'güçlü']) {
    const model = list.find(m => m.level === level || m.levels?.[level]);
    if (model) descriptions.push(`${t(level)}: ${model.levels?.[level]?.model || model.name}`);
  }
  return descriptions.join('\n') || t('defaultModel');
}
function detail(label, value, id) {
  const row = el('div', 'detail-row'); row.append(el('span', 'detail-label', t(label)));
  const val = el('span', 'detail-val mono', value); if (id) val.id = id; row.append(val); return row;
}
function statusLabel(agent) {
  if (!agent.enabled) return t('disabled');
  if (agent.status === 'testing') return t('testing');
  if (agent.status === 'running') return t('running');
  if (agent.status === 'limited') return t('limited');
  if (agent.status === 'unauthenticated') return t('statusAuth');
  if (agent.status === 'missing') return t('statusMissing');
  if (agent.status === 'error') return t('errorStatus');
  return t(agent.health?.healthy ? 'statusHealthy' : 'notTested');
}
function renderState() {
  const grid = $('agentsGrid'); grid.replaceChildren();
  const active = Object.values(state.agents).filter(a => a.enabled);
  const healthy = active.filter(a => a.health?.healthy && a.status === 'idle').length;
  $('systemHealthBadge').textContent = state.healthRunning ? t('healthRunning') : `${healthy}/${active.length} ${t('agentsReady')}`;
  $('systemHealthBadge').className = 'status-pill ' + (state.healthRunning || healthy && healthy < active.length ? 'status-partial' : healthy && healthy === active.length ? 'status-ready' : 'status-loading');
  $('runAllHealthBtn').disabled = busy || state.healthRunning;
  $('planAndExecuteBtn').disabled = busy || state.healthRunning || !project.cwd;
  $('planAndExecuteBtn').textContent = t(busy ? 'dispatching' : 'dispatchBtn');
  $('cwdInput').disabled = busy; $('chooseFolderBtn').disabled = busy;
  $('recentProjects').disabled = busy || state.healthRunning;
  for (const id of ['memoryInput', 'saveMemoryBtn', 'resetMemoryBtn']) $(id).disabled = !project.cwd || busy;
  for (const [id, agent] of Object.entries(state.agents)) {
    const card = el('div', 'agent-card' + (agent.enabled ? '' : ' agent-disabled')); card.id = `agent-${id}`;
    const top = el('div', 'agent-top');
    const brand = el('div', 'agent-brand'); brand.append(el('div', `brand-avatar ${id}-avatar`, id === 'codex' ? '›_' : id[0].toUpperCase()));
    const name = el('div'); name.append(el('h3', 'agent-name', agent.name), el('span', 'agent-role', t('role' + id[0].toUpperCase() + id.slice(1)))); brand.append(name);
    const badge = el('span', 'agent-status-badge status-' + (!agent.enabled ? 'neutral' : ['running', 'testing'].includes(agent.status) ? 'running' : ['error', 'missing'].includes(agent.status) ? 'error' : ['limited', 'unauthenticated'].includes(agent.status) ? 'warning' : agent.health?.healthy ? 'idle' : 'neutral'), statusLabel(agent)); badge.id = `${id}-badge`;
    top.append(brand, badge); card.append(top);
    const details = el('div', 'agent-details');
    details.append(detail('cliVersion', agent.health?.version || '—', `${id}-version`), detail('model', modelLabel(id), `${id}-model`),
      detail('authStatus', agent.health?.authInfo?.loggedIn ? t('signedIn') : agent.status === 'unauthenticated' ? t('statusAuth') : t('unknown')),
      detail('lastHealthRes', agent.health ? (agent.health.healthy ? `✓ OK (${((agent.health.durationMs || 0) / 1000).toFixed(1)}s)` : t('errorStatus')) : t('notTested'), `${id}-test-res`));
    const statline = el('div', 'agent-statline'); statline.append(el('span', '', t('jobsCompleted')), el('strong', '', String(agent.jobsCompleted || 0))); card.append(statline);
    const meter = el('progress'); meter.max = 100; meter.value = Math.min(100, (agent.jobsCompleted || 0) * 15); meter.title = t('usageHint'); card.append(meter);
    const controls = el('div', 'agent-controls');
    const inspector = el('details', 'agent-inspector'); inspector.append(el('summary', '', t('agentDetails')), details, detail('renewal', agent.rateLimitedUntil ? new Date(agent.rateLimitedUntil).toLocaleString(lang) : '—'));
    const test = button(t('testSingle'), () => testHealth(id), 'btn btn-secondary btn-sm'); test.disabled = !agent.enabled || busy || state.healthRunning; test.dataset.agent = id; inspector.append(test); controls.append(inspector); card.append(controls);
    if (id === 'gemini') {
      const toggle = button(t(agent.enabled ? 'disable' : 'enable'), async () => {
        if (!agent.enabled && !confirm(t('geminiRisk'))) return;
        settings = await api.saveSettings({ geminiEnabled: !agent.enabled, geminiRiskAccepted: !agent.enabled });
        state = await api.getState(); renderState();
      }, 'agent-toggle'); toggle.id = 'geminiToggle'; toggle.disabled = busy || state.healthRunning; toggle.setAttribute('aria-pressed', String(agent.enabled)); controls.append(toggle);
    }
    grid.append(card);
  }
}
function appendLog(value) {
  const entry = LogModel.normalize(value); if (entry.state) { state = entry.state; renderState(); }
  logs.push(entry); renderLogs();
}
function visibleLogs() { return LogModel.filter(logs, currentLevel, currentAgent); }
function renderLogs() {
  const terminal = $('terminalWindow'); terminal.replaceChildren(); $('errorCards').replaceChildren();
  for (const entry of visibleLogs()) {
    const row = el('div', `terminal-line log-${entry.level}`); row.dataset.level = entry.level; row.dataset.agent = entry.agent || '';
    row.append(el('span', 'log-icon', LogModel.icons[entry.level] || 'ℹ'), el('span', 'log-text', `${new Date(entry.timestamp).toLocaleTimeString(lang)}${entry.agent ? ' [' + entry.agent + ']' : ''} ${entry.text}`), copyButton(LogModel.text([entry])));
    terminal.append(row);
    if (entry.level === 'error') {
      const key = entry.cause === 'policy' ? 'policy' : LogModel.errorKey(entry), card = el('div', 'error-card');
      card.append(el('strong', '', `${key} • ${entry.agent || t('system')} • ${new Date(entry.timestamp).toLocaleString(lang)}`), el('p', '', t(`error_${key}`)));
      let solution = t(`solution_${key}`);
      const command = entry.agent === 'gemini' ? 'agy' : entry.agent === 'codex' ? 'codex' : 'claude';
      card.append(el('p', '', solution.replace('{command}', command)));
      const details = el('details'); details.append(el('summary', '', t('rawOutput')));
      const raw = el('pre', 'raw-output', entry.raw || entry.text); details.append(raw, copyButton(entry.raw || entry.text, 'btn-ghost copy-raw'));
      card.append(details); $('errorCards').append(card);
    }
  }
  terminal.scrollTop = terminal.scrollHeight;
}
function outputBlock(text) {
  const box = el('div', 'output-block');
  box.append(button(t('copyAll'), () => copy(text), 'btn-ghost copy-output-all'));
  for (const line of String(text).split('\n')) {
    const row = el('div', 'output-row'); row.append(el('span', 'output-text', line || '\u200b'), copyButton(line)); box.append(row);
  }
  return box;
}
function activityPayload(event, events, turn) {
  const assignment = events.find(item => item.id === event.assignmentId);
  const nextAssignment = event.type === 'agent_switched' ? events.slice(events.indexOf(event) + 1).find(item => item.type === 'task_assigned' && item.step === event.step && item.agent === event.toAgent) : null;
  const result = events.find(item => item.assignmentId === (nextAssignment?.id || event.assignmentId || event.id) && ['task_completed', 'task_failed', 'task_blocked', 'final_review_completed', 'final_review_failed'].includes(item.type));
  return {
    input: event.input ?? assignment?.input ?? nextAssignment?.input ?? (event.type.startsWith('session_') ? turn.prompt : undefined),
    output: event.output ?? result?.output ?? (event.type === 'session_started' ? turn.result?.finalResult || turn.error : undefined)
  };
}
function renderTimeline(turns) {
  const container = $('timelineContainer'); container.replaceChildren(); container.hidden = !turns.length;
  $('timelineEmpty').hidden = !!turns.length;
  if (!turns.length) return;
  container.append(el('h3', 'timeline-heading', t('activityHeading')));
  for (const turn of turns) {
    const events = turn.activities || [];
    const group = el('div', 'timeline-turn');
    group.append(el('p', 'timeline-turn-label', `${new Date(turn.startedAt || events[0]?.timestamp || Date.now()).toLocaleDateString(lang)} • ${(turn.prompt || '').slice(0, 100)}`));
    if (!events.length) { group.append(el('p', 'muted', t('activityEmpty'))); container.append(group); continue; }
    const list = el('ol', 'timeline-list');
    for (const event of events) {
      const row = el('li', 'timeline-row');
      const details = el('details', 'timeline-event timeline-' + event.type); details.dataset.activityId = event.id; details.dataset.type = event.type;
      const summary = el('summary');
      const time = el('time', 'timeline-time', new Date(event.timestamp).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })); time.dateTime = event.timestamp;
      summary.append(time, el('span', 'timeline-title', ActivityModel.format(event, t))); details.append(summary);
      let loaded = false;
      function loadPayload() {
        if (loaded) return; loaded = true;
        const payload = el('div', 'timeline-payload');
        if (event.model !== undefined || event.level !== undefined) payload.append(el('p', 'timeline-meta', `${t('model')}: ${event.model || t('defaultModel')} • ${t(event.level || 'defaultModel')}`));
        if (event.reason) payload.append(el('p', 'timeline-meta', `${t('reason')}: ${event.reason}`));
        const data = activityPayload(event, events, turn);
        for (const [key, label] of [['input', 'activityInput'], ['output', 'activityOutput']]) {
          payload.append(el('strong', '', t(label)));
          payload.append(data[key] !== undefined ? outputBlock(String(data[key])) : el('p', 'muted', t('activityNoData')));
        }
        details.append(payload);
      }
      details.open = openActivityIds.has(event.id);
      if (details.open) loadPayload();
      details.addEventListener('toggle', () => {
        if (!details.isConnected) return;
        if (details.open) { openActivityIds.add(event.id); loadPayload(); } else openActivityIds.delete(event.id);
      });
      row.append(details); list.append(row);
    }
    group.append(list); container.append(group);
  }
}
function renderTurns(turns) {
  viewedTurns = turns;
  renderTimeline(turns);
  const stream = $('streamContainer'); stream.replaceChildren();
  if (!turns.length) { stream.append(el('div', 'stream-empty', t('emptyStream'))); return; }
  for (const turn of turns) {
    const promptCard = el('div', 'step-card'); promptCard.append(el('strong', '', t('promptLabel')), outputBlock(turn.prompt || '')); stream.append(promptCard);
    if (turn.plan) {
      const card = el('div', 'step-card'); card.append(el('strong', '', t('coordinatorPlan')), el('p', '', turn.plan.summary || '')); stream.append(card);
      for (const task of turn.plan.subtasks || []) {
        const output = (turn.outputs || turn.result?.outputs || []).find(o => o.step === task.step);
        const step = el('div', 'step-card');
        if (output) step.append(el('span', output.success ? 'log-success' : 'log-warning', t('session_' + (output.status || (output.success ? 'completed' : 'failed')))));
        step.append(el('strong', '', `${task.step}. ${task.title} • ${output?.agent || task.agent} • ${output ? output.model || t('defaultModel') : task.model || t('defaultModel')} • ${t(output && Object.hasOwn(output, 'level') ? output.level || 'defaultModel' : task.level || 'orta')}`), el('p', '', `${t('reason')}: ${output?.rationale || task.rationale || ''}`), outputBlock(output?.output || t('waitingTask')));
        stream.append(step);
      }
    }
    if (turn.result?.finalResult) { const card = el('div', 'step-card'); card.append(el('strong', '', t('finalResult')), outputBlock(turn.result.finalResult)); stream.append(card); }
    if (turn.error) { const card = el('div', 'step-card log-error'); card.append(outputBlock(turn.error)); stream.append(card); }
  }
}
function renderHistory() {
  $('historyList').replaceChildren();
  $('historyCount').textContent = sessions.length;
  const projects = new Map(); for (const session of sessions) { if (!projects.has(session.cwd)) projects.set(session.cwd, []); projects.get(session.cwd).push(session); }
  if (!sessions.length) $('historyList').append(el('p', 'muted', t('emptyHistory')));
  for (const [cwd, items] of projects) {
    const project = el('details', 'history-project'); project.open = true; const summary = el('summary', '', cwd.split(/[\\/]/).filter(Boolean).at(-1)); summary.title = cwd; project.append(summary);
    for (const item of items) {
      const row = el('div', 'history-item' + (displayedSession === item.id ? ' selected' : ''));
      row.append(button(item.title, () => openSession(item.id), 'history-open'), el('small', '', `${new Date(item.updatedAt).toLocaleString(lang)} • ${(item.agents || []).join(', ')} • ${t('session_' + item.status)}`));
      row.append(button(t('continue'), () => openSession(item.id, true)), button(t('rename'), async () => { const title = prompt(t('sessionTitle'), item.title); if (title) { await api.renameSession({ id: item.id, title }); await refreshHistory(); } }), button(t('delete'), async () => {
        if (!confirm(t('deleteSessionConfirm'))) return;
        await api.deleteSession(item.id); if (displayedSession === item.id) newSession(); await refreshHistory();
      })); row.querySelectorAll('button').forEach(btn => { btn.disabled = busy; }); project.append(row);
    }
    $('historyList').append(project);
  }
  $('sessionLabel').textContent = selectedSession ? t('continuingSession') : displayedSession ? t('viewingSession') : t('newSession');
}
async function refreshHistory() { sessions = await api.listSessions(); renderHistory(); }
async function loadMemory() {
  const memory = project.cwd ? await api.getMemory(project.cwd) : { summary: '' };
  $('memoryInput').value = memory.summary; $('memoryCount').textContent = `${memory.summary.length}/2000`;
}
async function openSession(id, resume = false) {
  if (busy) return;
  const session = await api.openSession(id); displayedSession = id; selectedSession = resume ? id : null;
  if (session.cwd !== project.cwd) { project = await api.openWorkspace(session.cwd); renderProject(); }
  renderTurns(session.turns); logs = session.turns.flatMap(turn => turn.logs || []); renderLogs(); renderHistory(); await loadMemory();
  if (resume) { $('promptInput').focus(); notice(t('resumeHint')); }
}
function newSession() { if (busy) return; selectedSession = displayedSession = null; logs = []; renderTurns([]); renderLogs(); renderHistory(); $('promptInput').value = ''; }
async function testHealth(id) {
  if (busy || state.healthRunning) return;
  try { state = await api.runHealthCheck(id); }
  catch (error) { appendLog({ level: 'error', agent: id || null, text: error.message, raw: error.message, errorType: 'other' }); }
  finally { try { state = await api.getState(); } finally { state.healthRunning = false; renderState(); } }
}
async function runSession() {
  if (busy || state.healthRunning || !project.cwd) return;
  const prompt = $('promptInput').value.trim(); if (!prompt) { notice(t('enterPrompt')); return; }
  busy = true; renderState(); renderHistory(); $('newSessionBtn').disabled = true;
  const live = { prompt, startedAt: new Date().toISOString(), outputs: [], activities: [] }; viewedTurns = selectedSession ? [...viewedTurns, live] : [live]; logs = selectedSession ? logs : []; renderTurns(viewedTurns); renderLogs();
  try {
    const result = await api.runSession({ prompt, sessionId: selectedSession });
    displayedSession = result.session.id; selectedSession = result.saved ? result.session.id : null;
    renderTurns(result.session.turns); logs = result.session.turns.flatMap(turn => turn.logs || []); renderLogs();
    notice(t(result.saved ? 'sessionSaved' : 'sessionNotSaved')); await loadMemory();
  } catch (error) { appendLog({ level: 'error', text: error.message, errorType: 'other', raw: error.message }); }
  finally { busy = false; $('newSessionBtn').disabled = false; try { state = await api.getState(); await refreshHistory(); } finally { renderState(); } }
}
function selectRegion(region) { const selection = window.getSelection(); selection.removeAllRanges(); const range = document.createRange(); range.selectNodeContents(region); selection.addRange(range); }
function contentText(region) { return [...region.querySelectorAll('.output-text, .log-text, .raw-output')].map(node => node.textContent).join('\n'); }
document.querySelectorAll('.selectable').forEach(region => {
  region.addEventListener('contextmenu', event => { event.preventDefault(); contextTarget = region; perform(() => api.textMenu({ selection: window.getSelection().toString(), all: contentText(region) })); });
  region.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectRegion(region); } });
});
api.onSelectAll(() => { if (contextTarget) selectRegion(contextTarget); });
api.onState(value => { state = value; renderState(); });
api.onLog(appendLog);
api.onPlan(({ plan }) => { if (busy) { viewedTurns.at(-1).plan = plan; renderTurns(viewedTurns); } });
api.onOutput(({ output }) => { if (busy) { viewedTurns.at(-1).outputs.push(output); renderTurns(viewedTurns); } });
api.onActivity(({ turnId, activity }) => {
  const turn = viewedTurns.at(-1);
  if (!busy || !turn || turn.id && turn.id !== turnId) return;
  turn.id = turnId; turn.activities ||= [];
  if (!turn.activities.some(item => item.id === activity.id)) turn.activities.push(activity);
  renderTimeline(viewedTurns);
});
$('runAllHealthBtn').addEventListener('click', () => perform(() => testHealth()));
$('planAndExecuteBtn').addEventListener('click', () => perform(runSession));
$('newSessionBtn').addEventListener('click', newSession);
$('langTr').addEventListener('click', () => perform(() => setLanguage('tr')));
$('langEn').addEventListener('click', () => perform(() => setLanguage('en')));
$('chooseFolderBtn').addEventListener('click', () => perform(() => openProject()));
$('recentProjects').addEventListener('change', () => perform(() => openProject($('recentProjects').value || undefined)));
$('memoryInput').addEventListener('input', () => { $('memoryCount').textContent = `${$('memoryInput').value.length}/2000`; });
$('saveMemoryBtn').addEventListener('click', () => perform(async () => { await api.saveMemory({ cwd: project.cwd, summary: $('memoryInput').value }); notice(t('memorySaved')); }));
$('resetMemoryBtn').addEventListener('click', () => perform(async () => { if (confirm(t('resetMemoryConfirm'))) { await api.resetMemory(project.cwd); await loadMemory(); } }));
$('clearLogsBtn').addEventListener('click', () => { logs = []; renderLogs(); });
$('copyAllBtn').addEventListener('click', () => perform(() => copy(activeTab === 'terminalLogTab' ? LogModel.text(visibleLogs()) : contentText($(activeTab === 'timelineTab' ? 'timelineContainer' : 'streamContainer')))));
$('levelFilters').querySelectorAll('[data-level]').forEach(btn => btn.addEventListener('click', () => { currentLevel = btn.dataset.level; $('levelFilters').querySelectorAll('[data-level]').forEach(node => node.classList.toggle('active', node === btn)); renderLogs(); }));
$('agentFilter').addEventListener('change', () => { currentAgent = $('agentFilter').value; renderLogs(); });
document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => { activeTab = btn.dataset.tab; document.querySelectorAll('.tab-btn').forEach(node => node.classList.toggle('active', node === btn)); document.querySelectorAll('.tab-content').forEach(node => node.classList.toggle('active', node.id === activeTab)); }));
$('settingsBtn').addEventListener('click', () => perform(async () => { settings = await api.getSettings(); $('saveHistoryInput').checked = settings.saveHistory; $('modelsInput').value = JSON.stringify(models, null, 2); $('settingsDialog').showModal(); }));
$('closeSettingsBtn').addEventListener('click', () => $('settingsDialog').close());
$('saveHistoryInput').addEventListener('change', () => perform(async () => { settings = await api.saveSettings({ saveHistory: $('saveHistoryInput').checked }); }));
$('clearHistoryBtn').addEventListener('click', () => perform(async () => { if (!confirm(t('clearHistoryConfirm'))) return; await api.clearHistory(); newSession(); await refreshHistory(); await loadMemory(); }));
$('saveModelsBtn').addEventListener('click', () => perform(async () => { const list = JSON.parse($('modelsInput').value); if (!await api.saveModels(list)) throw new Error(t('operationFailed')); models = await api.getModels(); renderState(); notice(t('modelsSaved')); }));
window.addEventListener('DOMContentLoaded', () => perform(async () => {
  [state, models, settings, project] = await Promise.all([api.getState(), api.getModels(), api.getSettings(), api.getWorkspace()]);
  await setLanguage('tr'); await refreshHistory(); await loadMemory();
  if (project.error) notice(t('projectUnavailable') + ' ' + project.error);
}));
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); newSession(); $('promptInput').focus(); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && document.activeElement === $('promptInput')) { event.preventDefault(); perform(runSession); }
});

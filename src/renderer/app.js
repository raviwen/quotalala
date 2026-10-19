const api = window.quotalalaAPI;
const $ = id => document.getElementById(id);
let lang = 'tr', translations = {}, state = { agents: {}, healthRunning: false };
let models = [], settings = {}, logs = [], sessions = [], selectedSession = null, displayedSession = null;
let currentLevel = 'all', currentAgent = 'all', activeTab = 'liveStreamTab', busy = false, contextTarget = null;
let viewedTurns = [], resumePending = false, pendingApproval = null;
let roomView = null, inspectedMessage = null, roomCollapsed = false, roomTurnId = null;
let deferredWorkspace = null;
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
  document.querySelectorAll('[data-i18n-aria]').forEach(node => node.setAttribute('aria-label', t(node.dataset.i18nAria)));
  document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
  $('langTr').classList.toggle('active', lang === 'tr'); $('langEn').classList.toggle('active', lang === 'en');
  await api.setLanguage(value); renderProject(); renderState(); renderLogs(); renderHistory(); renderTurns(viewedTurns);
  if (inspectedMessage && !$('roomMessageDetails').hidden) showRoomMessage(inspectedMessage, false);
}
function showAgentDetails(id) {
  $('agentCardsDetails').open = true;
  const card = $('agent-' + id); if (card) { card.scrollIntoView({ block: 'nearest' }); card.querySelector('summary')?.focus(); }
}
function showRoomMessage(message, focus = true) {
  inspectedMessage = message;
  $('roomMessageDetails').hidden = false;
  $('roomMessageTitle').textContent = message.from + ' → ' + message.to + (message.taskTitle ? ' • ' + message.taskTitle : '');
  $('roomMessageBody').replaceChildren(outputBlock(message.text));
  if (focus) $('roomMessageDetails').focus({ preventScroll: true });
}
function renderRoom() {
  roomView ||= new TeamRoomView({ scene: $('roomScene'), t, onInspect: showRoomMessage, onDetails: showAgentDetails });
  const turn = roomTurnId ? viewedTurns.find(item => item.id === roomTurnId) || viewedTurns.at(-1) : viewedTurns.at(-1);
  const room = TeamRoomModel.project({ agents: state.agents, turn, live: busy && turn === viewedTurns.at(-1), approval: !!pendingApproval, boardTasks });
  roomView.update(room);
  if (inspectedMessage?.id?.startsWith('board-') && !$('roomMessageDetails').hidden) {
    const task = boardTasks.find(task => inspectedMessage.id.endsWith(task.id));
    const latest = room.desks.find(desk => desk.message?.id?.endsWith(task?.id))?.message;
    if (latest) showRoomMessage(latest, false);
  }
  $('roomBody').hidden = roomCollapsed; $('toggleRoomBtn').textContent = t(roomCollapsed ? 'roomExpand' : 'roomCollapse'); $('toggleRoomBtn').setAttribute('aria-expanded', String(!roomCollapsed));
}
function resetRoomSelection() { roomTurnId = null; inspectedMessage = null; $('roomMessageDetails').hidden = true; }
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
  $('planAndExecuteBtn').textContent = t(busy ? 'dispatching' : 'addTask');
  $('stopBtn').disabled = !busy;
  for (const id of ['runMode', 'directAgent', 'directLevel', 'timeoutSeconds', 'previewPlan', 'verifyRun']) $(id).disabled = busy;
  $('previewPlan').disabled ||= $('runMode').value === 'economic';
  $('verifyRun').disabled ||= $('runMode').value === 'economic';
  const isEconomic = $('runMode').value === 'economic';
  const economicControls = $('economicControls');
  if (economicControls) {
    economicControls.hidden = !isEconomic;
  }
  for (const option of $('directAgent').options) { const agent = state.agents[option.value]; option.disabled = !agent?.enabled || ['limited', 'missing', 'unauthenticated', 'error'].includes(agent.status); }
  const selectedAgentId = $('directAgent').value;
  const selectedAgentState = state.agents[selectedAgentId];
  const isAgentLimited = isEconomic && selectedAgentState?.status === 'limited';
  const warningEl = $('agentQuotaWarning');
  if (warningEl) {
    warningEl.hidden = !isAgentLimited;
  }
  if (!busy && $('directAgent').selectedOptions[0]?.disabled && !isAgentLimited) { const ready = [...$('directAgent').options].find(option => !option.disabled); if (ready) $('directAgent').value = ready.value; }
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
    card.append(el('small', 'muted', t('usageHint')));
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
  renderRoom();
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
  const result = events.find(item => item.assignmentId === (nextAssignment?.id || event.assignmentId || event.id) && ['task_completed', 'task_failed', 'task_blocked', 'agent_question', 'coordination_completed', 'coordination_failed', 'final_review_completed', 'final_review_failed'].includes(item.type));
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
  renderRoom();
  renderTimeline(turns);
  const stream = $('streamContainer'); stream.replaceChildren();
  if (!turns.length) { stream.append(el('div', 'stream-empty', t('emptyStream'))); return; }
  for (const turn of turns) {
    const promptCard = el('div', 'step-card'); promptCard.append(el('strong', '', t('promptLabel')), outputBlock(turn.prompt || '')); stream.append(promptCard);
    if (turn.plan) {
      const card = el('div', 'step-card'); card.append(el('strong', '', t(turn.options?.mode === 'economic' ? 'economic' : 'coordinatorPlan')), el('p', '', turn.plan.summary || '')); stream.append(card);
      for (const task of turn.plan.subtasks || []) {
        const output = (turn.outputs || turn.result?.outputs || []).find(o => o.step === task.step);
        const step = el('div', 'step-card');
        if (output) step.append(el('span', output.success ? 'log-success' : 'log-warning', t('session_' + (output.status || (output.success ? 'completed' : 'failed')))));
        step.append(el('strong', '', `${task.step}. ${task.title} • ${output?.agent || task.agent} • ${output ? output.model || t('defaultModel') : task.model || t('defaultModel')} • ${t(output && Object.hasOwn(output, 'level') ? output.level || 'defaultModel' : task.level || 'orta')}`), el('p', '', `${t('reason')}: ${output?.rationale || task.rationale || ''}`), outputBlock(output?.output || t('waitingTask')));
        if (output) { step.append(el('p', 'muted', `${t('reportedResult')}: ${t('session_' + (output.success ? 'completed' : output.status || 'failed'))} • ${t('verifiedResult')}: ${t('notVerified')}`));
          if (output.evidence) step.append(el('strong', '', t('fileReferences')), outputBlock((output.evidence.fileReferences || []).join('\n') || t('noneObserved')), el('strong', '', t('executedChecks')), outputBlock((output.evidence.executedChecks || []).map(c => `${c.command} → ${c.exitCode}`).join('\n') || t('noneObserved')), el('p', 'muted', t('checkLimits'))); }
        stream.append(step);
      }
    }
    const conversation = (turn.activities || []).filter(event => ['agent_question', 'coordinator_reply', 'coordinator_decision', 'coordination_stopped'].includes(event.type));
    if (conversation.length) {
      const card = el('section', 'step-card team-conversation'); card.append(el('h3', '', t('teamConversation')));
      for (const event of conversation) {
        const row = el('div', 'team-message'); row.append(el('strong', '', ActivityModel.format(event, t)), outputBlock(event.type === 'coordinator_decision' ? event.reason || '' : event.output || t('activity_cause_' + event.cause))); card.append(row);
      }
      stream.append(card);
    }
    if (turn.status) stream.append(el('p', 'muted', t('session_' + turn.status)));
    if (turn.stream?.length) { const raw = el('details', 'step-card'); raw.open = busy && turn === turns.at(-1); raw.append(el('summary', '', t('liveOutput'))); raw.append(outputBlock(turn.stream.map(c => `[${c.agent} ${c.stream}] ${c.text}`).join(''))); stream.append(raw); }
    if (turn.evidence) { const card = el('div', 'step-card'); card.append(el('strong', '', t('observedChanges')), outputBlock(turn.evidence.changedFiles.join('\n') || t('noneObserved')), el('p', 'muted', t('evidenceLimits'))); stream.append(card); }
    if (turn.result?.verification && turn.result.verification.status !== 'not_requested') { const card = el('div', 'step-card'); card.append(el('strong', '', t('verification') + (turn.result.verification.status === 'failed' ? ' • ' + t('session_failed') : '')), outputBlock(turn.result.verification.output || t('notVerified')), outputBlock((turn.result.verification.evidence?.executedChecks || []).map(c => `${c.command} → ${c.exitCode}`).join('\n') || t('noneObserved'))); stream.append(card); }
    if (turn.result?.finalResult) { const card = el('div', 'step-card'); card.append(el('strong', '', t(turn.options?.mode === 'economic' ? 'directResult' : 'finalResult')), outputBlock(turn.result.finalResult)); stream.append(card); }
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
  resetRoomSelection();
  const session = await api.openSession(id); resumePending = resume && !!session.turns.at(-1)?.plan && !['completed'].includes(session.turns.at(-1)?.status);
  if (resumePending) { $('promptInput').value = session.turns.at(-1).prompt; const options = session.turns.at(-1).options; if (options) applyRunOptions(options); } displayedSession = id; selectedSession = resume ? id : null;
  if (session.cwd !== project.cwd) { project = await api.openWorkspace(session.cwd); renderProject(); }
  renderTurns(session.turns); logs = session.turns.flatMap(turn => turn.logs || []); renderLogs(); renderHistory(); await loadMemory();
  if (resume) { $('promptInput').focus(); notice(t(resumePending ? 'resumeIncompleteHint' : 'resumeHint')); }
}
function newSession() { if (busy) return; resetRoomSelection(); resumePending = false; selectedSession = displayedSession = null; logs = []; renderTurns([]); renderLogs(); renderHistory(); $('promptInput').value = ''; }
async function testHealth(id) {
  if (busy || state.healthRunning) return;
  try { state = await api.runHealthCheck(id); }
  catch (error) { appendLog({ level: 'error', agent: id || null, text: error.message, raw: error.message, errorType: 'other' }); }
  finally { try { state = await api.getState(); } finally { state.healthRunning = false; renderState(); } }
}
async function runSession() {
  if (busy || state.healthRunning || !project.cwd) return;
  const prompt = $('promptInput').value.trim(); if (!prompt) { notice(t('enterPrompt')); return; }
  resetRoomSelection(); busy = true; renderState(); renderHistory(); $('newSessionBtn').disabled = true;
  const live = { prompt, options: readRunOptions(), startedAt: new Date().toISOString(), outputs: [], activities: [] }; viewedTurns = selectedSession ? [...viewedTurns, live] : [live]; logs = selectedSession ? logs : []; renderTurns(viewedTurns); renderLogs();
  try {
    const options = readRunOptions();
    await api.saveSettings(options);
    const result = await api.runSession({ prompt, sessionId: selectedSession, resume: resumePending, options });
    resumePending = false;
    displayedSession = result.session.id; selectedSession = result.saved ? result.session.id : null;
    renderTurns(result.session.turns); logs = result.session.turns.flatMap(turn => turn.logs || []); renderLogs();
    notice(t('session_' + result.session.status) + ' • ' + t(result.saved ? 'sessionSaved' : 'sessionNotSaved'));
    if (result.session.status === 'failed' && !live.plan) { $('runMode').value = 'economic'; notice(t('directHint')); } await loadMemory();
  } catch (error) { appendLog({ level: 'error', text: error.message, errorType: 'other', raw: error.message }); }
  finally { if ($('planDialog').open) $('planDialog').close(); pendingApproval = null; try { state = await api.getState(); await refreshHistory(); } finally { busy = false; $('newSessionBtn').disabled = false; renderState(); if (deferredWorkspace) { const next = deferredWorkspace; deferredWorkspace = null; receiveWorkspace(next); } } }
}
function selectRegion(region) { const selection = window.getSelection(); selection.removeAllRanges(); const range = document.createRange(); range.selectNodeContents(region); selection.addRange(range); }
function contentText(region) { return [...region.querySelectorAll('.output-text, .log-text, .raw-output')].map(node => node.textContent).join('\n'); }
document.querySelectorAll('.selectable').forEach(region => {
  region.addEventListener('contextmenu', event => { event.preventDefault(); contextTarget = region; perform(() => api.textMenu({ selection: window.getSelection().toString(), all: contentText(region) })); });
  region.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectRegion(region); } });
});
function readRunOptions() { return { mode: $('runMode').value, agent: $('directAgent').value, level: $('directLevel').value, timeout: Number($('timeoutSeconds').value) * 1000, previewPlan: $('previewPlan').checked, verify: $('verifyRun').checked }; }
function applyRunOptions(options) { $('runMode').value = options.mode || 'coordinated'; $('directAgent').value = options.agent || 'codex'; $('directLevel').value = options.level || 'hafif'; $('timeoutSeconds').value = (options.timeout || 180000) / 1000; $('previewPlan').checked = !!options.previewPlan; $('verifyRun').checked = !!options.verify; }
api.onStream(chunk => { if (!busy || !viewedTurns.length) return; const turn = viewedTurns.at(-1); turn.stream ||= []; const old = chunk.snapshot ? turn.stream.findIndex(item => item.streamId === chunk.streamId && item.stream === chunk.stream) : -1; if (old >= 0) turn.stream[old] = chunk; else turn.stream.push(chunk); renderTurns(viewedTurns); });
api.onApproval(({ runId, plan }) => {
  pendingApproval = { runId, plan }; renderRoom(); $('planEditor').replaceChildren(); $('planError').textContent = '';
  for (const task of plan.subtasks) {
    const row = el('div', 'step-card'); row.dataset.step = task.step;
    const title = el('input'); title.value = task.title; title.className = 'plan-title'; title.setAttribute('aria-label', t('taskTitle'));
    const prompt = el('textarea'); prompt.value = task.prompt; prompt.className = 'plan-prompt'; prompt.setAttribute('aria-label', t('promptLabel'));
    const reason = el('input'); reason.value = task.rationale || ''; reason.className = 'plan-reason'; reason.setAttribute('aria-label', t('reason'));
    const agent = $('directAgent').cloneNode(true); agent.removeAttribute('id'); agent.disabled = false; agent.className = 'plan-agent'; agent.value = task.agent;
    const level = $('directLevel').cloneNode(true); level.removeAttribute('id'); level.disabled = false; level.className = 'plan-level'; level.value = task.level;
    row.append(title, agent, level, reason, prompt, button(t('delete'), () => row.remove())); $('planEditor').append(row);
  }
  $('planDialog').showModal();
});
$('approvePlanBtn').addEventListener('click', async () => {
  if (!pendingApproval) return;
  const { runId, plan } = pendingApproval;
  const subtasks = [...$('planEditor').children].map(row => ({ ...plan.subtasks.find(task => task.step === Number(row.dataset.step)), title: row.querySelector('.plan-title').value, prompt: row.querySelector('.plan-prompt').value, rationale: row.querySelector('.plan-reason').value, agent: row.querySelector('.plan-agent').value, level: row.querySelector('.plan-level').value }));
  try { await api.approvePlan({ runId, plan: { ...plan, subtasks } }); if (pendingApproval?.runId === runId) { pendingApproval = null; $('planDialog').close(); } renderRoom(); }
  catch (error) { $('planError').textContent = error.message; }
});
async function stopSession() { await api.cancelSession(); pendingApproval = null; renderRoom(); if ($('planDialog').open) $('planDialog').close(); }
$('stopBtn').addEventListener('click', () => perform(stopSession)); $('cancelPlanBtn').addEventListener('click', () => perform(stopSession));
$('planDialog').addEventListener('cancel', event => { event.preventDefault(); perform(stopSession); });
$('runMode').addEventListener('change', renderState);
$('directAgent').addEventListener('change', renderState);
function receiveWorkspace(value) { if (busy) { deferredWorkspace = value; return; } project = value; newSession(); renderProject(); renderState(); perform(async () => { await refreshHistory(); await loadMemory(); }); }
api.onWorkspace(receiveWorkspace);
api.onSelectAll(() => { if (contextTarget) selectRegion(contextTarget); });
api.onState(value => { state = value; renderState(); });
api.onLog(appendLog);
api.onPlan(({ plan }) => { if (busy) { viewedTurns.at(-1).plan = plan; renderTurns(viewedTurns); } });
api.onOutput(({ output }) => { if (busy) { const outputs = viewedTurns.at(-1).outputs; const old = outputs.findIndex(item => item.step === output.step); if (old >= 0) outputs.splice(old, 1); outputs.push(output); renderTurns(viewedTurns); } });
api.onActivity(({ turnId, activity }) => {
  const turn = viewedTurns.at(-1);
  if (!busy || !turn || turn.id && turn.id !== turnId) return;
  turn.id = turnId; turn.activities ||= [];
  if (!turn.activities.some(item => item.id === activity.id)) turn.activities.push(activity);
  if (['agent_question', 'coordinator_reply', 'coordinator_decision', 'coordination_stopped'].includes(activity.type)) renderTurns(viewedTurns); else renderTimeline(viewedTurns);
  renderRoom();
});
api.onSessionFocus(target => perform(async () => {
  if (busy) {
    if (viewedTurns.at(-1)?.id !== target.turnId) { notice(t('roomOtherSession')); return; }
  } else { await openSession(target.sessionId); roomTurnId = target.turnId; renderRoom(); }
  roomCollapsed = false; renderRoom();
  if (target.kind === 'approval' && $('planDialog').open) $('approvePlanBtn').focus();
  else { $('teamRoom').scrollIntoView({ block: 'center' }); $('toggleRoomBtn').focus({ preventScroll: true }); }
}));
$('toggleRoomBtn').addEventListener('click', () => { roomCollapsed = !roomCollapsed; renderRoom(); });
$('closeRoomMessageBtn').addEventListener('click', () => { inspectedMessage = null; $('roomMessageDetails').hidden = true; $('roomLatestMessage').focus(); });
$('runAllHealthBtn').addEventListener('click', () => perform(() => testHealth()));
async function submitTask() {
  if (busy || state.healthRunning || !project.cwd) return;
  const text = $('promptInput').value.trim();
  if (!text) { notice(t('enterPrompt')); return; }
  $('promptInput').value = '';
  // Ensure board tab is active
  activeTab = 'boardTab';
  document.querySelectorAll('.tab-btn').forEach(node => node.classList.toggle('active', node.dataset.tab === 'boardTab'));
  document.querySelectorAll('.tab-content').forEach(node => node.classList.toggle('active', node.id === 'boardTab'));
  try {
    await api.addBoardTask({ request: text });
  } catch (error) {
    // Give the typed task back: it was never accepted by the main process.
    $('promptInput').value = text;
    throw error;
  }
}
$('planAndExecuteBtn').addEventListener('click', () => perform(submitTask));
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
let showingRawModels = false;

function parseModelRowData(m) {
  let level = 'orta';
  let cost = 1;
  let thinking = 'none';
  if (m.levels && typeof m.levels === 'object') {
    const firstKey = Object.keys(m.levels)[0];
    if (firstKey) {
      level = firstKey;
      cost = m.levels[firstKey]?.cost ?? 1;
      thinking = m.levels[firstKey]?.thinking || 'none';
    }
  } else if (m.level) {
    level = m.level;
    cost = m.cost ?? 1;
    thinking = m.thinking || 'none';
  }
  const originalLevels = m.levels && typeof m.levels === 'object' && Object.keys(m.levels).length
    ? m.levels
    : (m.level ? { [m.level]: { cost: m.cost ?? 1, description: m.description, ...(m.thinking ? { thinking: m.thinking } : {}) } } : null);
  return {
    agent: m.agent || 'claude',
    name: m.name || '',
    displayName: m.displayName || m.name || '',
    level,
    cost: Number(cost) || 1,
    thinking,
    preview: !!m.preview,
    source: m.source || '',
    originalLevels,
    verified: m.verified === undefined || m.verified === null ? null : m.verified === true
  };
}

function levelDetailsForRow(meta, level, cost, thinking) {
  const details = {
    cost: Number.isFinite(cost) && cost > 0 ? cost : 1,
    description: meta?.levels?.[level]?.description || `${t(level)}`
  };
  if (thinking && thinking !== 'none') details.thinking = thinking;
  return details;
}

function agentDatalist(agentId) {
  return agentId === 'codex' ? 'codexModelsList' : agentId === 'gemini' ? 'geminiModelsList' : 'claudeModelsList';
}

function renderModelsTable(modelList) {
  const tbody = $('modelsTableBody');
  if (!tbody) return;
  tbody.replaceChildren();
  $('modelsTableError').hidden = true;
  $('modelsTableError').textContent = '';

  const items = Array.isArray(modelList) ? modelList : [];
  items.forEach((item, index) => {
    const data = parseModelRowData(item);
    const tr = el('tr');
    tr.dataset.index = String(index);
    // Preserve the full multi-tier entry and verification across edits/saves.
    tr.modelMeta = { levels: data.originalLevels, verified: data.verified };

    // Agent dropdown
    const tdAgent = el('td');
    const selAgent = el('select', 'model-agent-select');
    for (const a of ['claude', 'codex', 'gemini']) {
      const opt = el('option', '', a);
      opt.value = a;
      opt.selected = a === data.agent;
      selAgent.append(opt);
    }
    tdAgent.append(selAgent);

    // Name input
    const tdName = el('td');
    const inName = el('input');
    inName.type = 'text';
    inName.value = data.name;
    inName.className = 'model-name-input';
    inName.setAttribute('list', agentDatalist(data.agent));
    tdName.append(inName);

    selAgent.addEventListener('change', () => {
      inName.setAttribute('list', agentDatalist(selAgent.value));
    });

    // DisplayName input
    const tdDisplayName = el('td');
    const inDisplayName = el('input');
    inDisplayName.type = 'text';
    inDisplayName.value = data.displayName;
    inDisplayName.className = 'model-displayname-input';
    tdDisplayName.append(inDisplayName);

    // Level dropdown
    const tdLevel = el('td');
    const selLevel = el('select', 'model-level-select');
    for (const lvl of ['hafif', 'orta', 'güçlü']) {
      const opt = el('option', '', t(lvl));
      opt.value = lvl;
      opt.selected = lvl === data.level;
      selLevel.append(opt);
    }
    tdLevel.append(selLevel);

    // Thinking dropdown
    const tdThinking = el('td');
    const selThinking = el('select', 'model-thinking-select');
    const thinkingOptions = [
      { val: 'none', label: t('thinkingNone') },
      { val: 'low', label: t('thinkingLow') },
      { val: 'medium', label: t('thinkingMedium') },
      { val: 'high', label: t('thinkingHigh') },
      { val: 'xhigh', label: t('thinkingXHigh') },
      { val: 'max', label: t('thinkingMax') }
    ];
    for (const to of thinkingOptions) {
      const opt = el('option', '', to.label);
      opt.value = to.val;
      opt.selected = to.val === data.thinking;
      selThinking.append(opt);
    }
    tdThinking.append(selThinking);

    // Cost input
    const tdCost = el('td');
    const inCost = el('input');
    inCost.type = 'number';
    inCost.min = '1';
    inCost.value = String(data.cost);
    inCost.className = 'model-cost-input';
    tdCost.append(inCost);

    // Preview checkbox
    const tdPreview = el('td');
    const inPreview = el('input');
    inPreview.type = 'checkbox';
    inPreview.checked = data.preview;
    inPreview.className = 'model-preview-input';
    tdPreview.append(inPreview);

    // Source input
    const tdSource = el('td');
    const inSource = el('input');
    inSource.type = 'text';
    inSource.value = data.source;
    inSource.className = 'model-source-input';
    tdSource.append(inSource);

    // Delete button
    const tdDelete = el('td');
    const delBtn = button(t('deleteModelRow'), () => {
      tr.remove();
      syncModelsTableToRaw();
    }, 'btn-ghost');
    tdDelete.append(delBtn);

    // Re-sync raw on input change
    for (const input of [selAgent, inName, inDisplayName, selLevel, selThinking, inCost, inPreview, inSource]) {
      input.addEventListener('change', () => {
        tr.classList.remove('row-error');
        syncModelsTableToRaw();
      });
    }

    tr.append(tdAgent, tdName, tdDisplayName, tdLevel, tdThinking, tdCost, tdPreview, tdSource, tdDelete);
    tbody.append(tr);
  });
}

function getModelsFromTable() {
  const tbody = $('modelsTableBody');
  if (!tbody) return [];
  const rows = tbody.querySelectorAll('tr');
  const result = [];
  let hasError = false;
  let firstErrorMsg = '';

  rows.forEach((tr, idx) => {
    tr.classList.remove('row-error');
    const agent = tr.querySelector('.model-agent-select')?.value;
    const name = tr.querySelector('.model-name-input')?.value.trim();
    const displayName = tr.querySelector('.model-displayname-input')?.value.trim();
    const level = tr.querySelector('.model-level-select')?.value;
    const cost = Number(tr.querySelector('.model-cost-input')?.value);
    const preview = tr.querySelector('.model-preview-input')?.checked;
    const source = tr.querySelector('.model-source-input')?.value.trim();

    const thinking = tr.querySelector('.model-thinking-select')?.value;

    let rowError = null;
    if (!['claude', 'codex', 'gemini'].includes(agent)) {
      rowError = t('modelErrAgent');
    } else if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(name)) {
      rowError = t('modelErrName');
    } else if (!['hafif', 'orta', 'güçlü'].includes(level)) {
      rowError = t('modelErrLevel');
    } else if (!Number.isFinite(cost) || cost <= 0) {
      rowError = t('modelErrCost');
    } else if (!source) {
      rowError = t('modelErrSource');
    }

    if (rowError) {
      tr.classList.add('row-error');
      hasError = true;
      if (!firstErrorMsg) {
        firstErrorMsg = t('modelsRowError').replace('{row}', String(idx + 1)).replace('{msg}', rowError);
      }
    }

    // Keep every tier the row originally had; only the edited tier is re-written.
    const meta = tr.modelMeta;
    const levels = { ...(meta?.levels || {}) };
    levels[level] = levelDetailsForRow(meta, level, cost, thinking);

    const modelObj = {
      agent,
      name,
      displayName: displayName || name,
      preview: !!preview,
      source,
      levels
    };
    if (meta?.verified !== null && meta?.verified !== undefined) modelObj.verified = meta.verified;
    result.push(modelObj);
  });

  if (hasError) {
    const errEl = $('modelsTableError');
    errEl.hidden = false;
    errEl.textContent = firstErrorMsg;
    throw new Error(firstErrorMsg);
  }

  $('modelsTableError').hidden = true;
  return result;
}

function syncModelsTableToRaw() {
  try {
    const list = [];
    const tbody = $('modelsTableBody');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach(tr => {
      const agent = tr.querySelector('.model-agent-select')?.value;
      const name = tr.querySelector('.model-name-input')?.value.trim() || '';
      const displayName = tr.querySelector('.model-displayname-input')?.value.trim() || name;
      const level = tr.querySelector('.model-level-select')?.value || 'orta';
      const thinking = tr.querySelector('.model-thinking-select')?.value;
      const cost = Number(tr.querySelector('.model-cost-input')?.value) || 1;
      const preview = tr.querySelector('.model-preview-input')?.checked || false;
      const source = tr.querySelector('.model-source-input')?.value.trim() || '';
      const meta = tr.modelMeta;
      const levels = { ...(meta?.levels || {}) };
      levels[level] = levelDetailsForRow(meta, level, cost, thinking);
      const row = { agent, name, displayName, preview, source, levels };
      if (meta?.verified !== null && meta?.verified !== undefined) row.verified = meta.verified;
      list.push(row);
    });
    $('modelsInput').value = JSON.stringify(list, null, 2);
  } catch {}
}

$('addModelRowBtn')?.addEventListener('click', () => {
  const tbody = $('modelsTableBody');
  if (!tbody) return;
  const newRow = [{
    agent: 'claude',
    name: 'new-model',
    displayName: 'New Model',
    level: 'hafif',
    cost: 1,
    preview: false,
    source: 'Verified CLI'
  }];
  const tr = el('tr');
  const tdAgent = el('td');
  const selAgent = el('select', 'model-agent-select');
  for (const a of ['claude', 'codex', 'gemini']) {
    const opt = el('option', '', a);
    opt.value = a;
    selAgent.append(opt);
  }
  tdAgent.append(selAgent);

  const tdName = el('td');
  const inName = el('input');
  inName.type = 'text';
  inName.value = 'new-model';
  inName.className = 'model-name-input';
  inName.setAttribute('list', agentDatalist(selAgent.value));
  selAgent.addEventListener('change', () => {
    inName.setAttribute('list', agentDatalist(selAgent.value));
  });
  tdName.append(inName);

  const tdDisplayName = el('td');
  const inDisplayName = el('input');
  inDisplayName.type = 'text';
  inDisplayName.value = 'New Model';
  inDisplayName.className = 'model-displayname-input';
  tdDisplayName.append(inDisplayName);

  const tdLevel = el('td');
  const selLevel = el('select', 'model-level-select');
  for (const lvl of ['hafif', 'orta', 'güçlü']) {
    const opt = el('option', '', t(lvl));
    opt.value = lvl;
    selLevel.append(opt);
  }
  tdLevel.append(selLevel);

  const tdThinking = el('td');
  const selThinking = el('select', 'model-thinking-select');
  const newThinkingOptions = [
    { val: 'none', label: t('thinkingNone') },
    { val: 'low', label: t('thinkingLow') },
    { val: 'medium', label: t('thinkingMedium') },
    { val: 'high', label: t('thinkingHigh') },
    { val: 'xhigh', label: t('thinkingXHigh') },
    { val: 'max', label: t('thinkingMax') }
  ];
  for (const to of newThinkingOptions) {
    const opt = el('option', '', to.label);
    opt.value = to.val;
    selThinking.append(opt);
  }
  tdThinking.append(selThinking);

  const tdCost = el('td');
  const inCost = el('input');
  inCost.type = 'number';
  inCost.min = '1';
  inCost.value = '1';
  inCost.className = 'model-cost-input';
  tdCost.append(inCost);

  const tdPreview = el('td');
  const inPreview = el('input');
  inPreview.type = 'checkbox';
  inPreview.checked = false;
  inPreview.className = 'model-preview-input';
  tdPreview.append(inPreview);

  const tdSource = el('td');
  const inSource = el('input');
  inSource.type = 'text';
  inSource.value = 'CLI alias';
  inSource.className = 'model-source-input';
  tdSource.append(inSource);

  const tdDelete = el('td');
  const delBtn = button(t('deleteModelRow'), () => {
    tr.remove();
    syncModelsTableToRaw();
  }, 'btn-ghost');
  tdDelete.append(delBtn);

  for (const input of [selAgent, inName, inDisplayName, selLevel, selThinking, inCost, inPreview, inSource]) {
    input.addEventListener('change', () => {
      tr.classList.remove('row-error');
      syncModelsTableToRaw();
    });
  }

  tr.append(tdAgent, tdName, tdDisplayName, tdLevel, tdThinking, tdCost, tdPreview, tdSource, tdDelete);
  tbody.append(tr);
  syncModelsTableToRaw();
});

$('toggleRawModelsBtn')?.addEventListener('click', () => {
  showingRawModels = !showingRawModels;
  $('modelsTableContainer').hidden = showingRawModels;
  $('modelsRawContainer').hidden = !showingRawModels;
  $('toggleRawModelsBtn').textContent = t(showingRawModels ? 'showAsTable' : 'showAsJSON');
  if (!showingRawModels) {
    try {
      const parsed = JSON.parse($('modelsInput').value);
      renderModelsTable(parsed);
    } catch {}
  } else {
    syncModelsTableToRaw();
  }
});

$('settingsBtn').addEventListener('click', () => perform(async () => {
  settings = await api.getSettings();
  $('saveHistoryInput').checked = settings.saveHistory;
  $('notificationsInput').checked = settings.notificationsEnabled !== false;
  $('notificationsInput').disabled = busy;
  if ($('autoMergeInput')) {
    $('autoMergeInput').checked = settings.autoMerge === true;
    $('autoMergeInput').disabled = busy;
  }
  if ($('coordinatorModelSelect')) {
    $('coordinatorModelSelect').value = settings.coordinatorModel || 'sonnet';
  }
  const savedLimits = settings.limits || {};
  for (const [id, key] of [['limitSubtasks', 'subtasks'], ['limitAttempts', 'attemptsPerTask'], ['limitReplies', 'repliesPerTask'], ['limitRounds', 'coordinationRounds'], ['limitCalls', 'calls']]) {
    if ($(id) && savedLimits[key] !== undefined) $(id).value = String(savedLimits[key]);
  }
  $('modelsInput').value = JSON.stringify(models, null, 2);
  showingRawModels = false;
  $('modelsTableContainer').hidden = false;
  $('modelsRawContainer').hidden = true;
  $('toggleRawModelsBtn').textContent = t('showAsJSON');
  renderModelsTable(models);
  $('settingsDialog').showModal();
}));
$('closeSettingsBtn').addEventListener('click', () => $('settingsDialog').close());
$('saveHistoryInput').addEventListener('change', () => perform(async () => { settings = await api.saveSettings({ saveHistory: $('saveHistoryInput').checked }); }));
$('notificationsInput').addEventListener('change', () => perform(async () => { settings = await api.saveSettings({ notificationsEnabled: $('notificationsInput').checked }); }));
$('autoMergeInput')?.addEventListener('change', () => perform(async () => {
  settings = await api.saveSettings({ autoMerge: $('autoMergeInput').checked });
  notice(t('settingsSaved') || 'Ayar kaydedildi.');
}));
$('coordinatorModelSelect')?.addEventListener('change', () => perform(async () => {
  settings = await api.saveSettings({ coordinatorModel: $('coordinatorModelSelect').value });
  notice(t('settingsSaved') || 'Ayar kaydedildi.');
}));
const limitFields = { limitSubtasks: 'subtasks', limitAttempts: 'attemptsPerTask', limitReplies: 'repliesPerTask', limitRounds: 'coordinationRounds', limitCalls: 'calls' };
for (const id of Object.keys(limitFields)) $(id)?.addEventListener('change', () => perform(async () => {
  const limits = {};
  for (const [field, key] of Object.entries(limitFields)) limits[key] = Number($(field).value);
  settings = await api.saveSettings({ limits });
  notice(t('settingsSaved') || 'Ayar kaydedildi.');
}));
$('clearHistoryBtn').addEventListener('click', () => perform(async () => { if (!confirm(t('clearHistoryConfirm'))) return; await api.clearHistory(); newSession(); await refreshHistory(); await loadMemory(); }));
$('saveModelsBtn').addEventListener('click', () => perform(async () => {
  let listToSave;
  if (showingRawModels) {
    try {
      listToSave = JSON.parse($('modelsInput').value);
    } catch {
      $('modelsTableError').hidden = false;
      $('modelsTableError').textContent = t('modelsInvalidJSON');
      throw new Error(t('modelsInvalidJSON'));
    }
  } else {
    listToSave = getModelsFromTable();
  }
  if (!await api.saveModels(listToSave)) {
    throw new Error(t('operationFailed'));
  }
  models = await api.getModels();
  renderState();
  notice(t('modelsSaved'));
  $('modelsTableError').hidden = true;
}));
let boardTasks = [], selectedBoardTaskId = null, boardStreams = new Map(), boardStreamFrame = null;

function boardStatusLabel(status, resumeAt) {
  if (status === 'waiting_quota' && resumeAt) {
    const timeStr = new Date(resumeAt).toLocaleTimeString();
    return `${t('status_waiting_quota')} (${timeStr})`;
  }
  return t(`status_${status}`) || status;
}

function renderBoard() {
  const container = $('boardList');
  if (!container) return;
  container.replaceChildren();

  if (!boardTasks.length) {
    container.append(el('div', 'stream-empty', t('boardEmpty')));
    return;
  }

  for (const task of boardTasks) {
    const card = el('div', `board-card ${task.id === selectedBoardTaskId ? 'active' : ''}`);
    card.id = `board-task-${task.id}`;

    const header = el('div', 'board-card-header');
    const title = el('span', 'board-card-title', task.title || task.request.slice(0, 50));
    const badge = el('span', `badge badge-${task.status}`, boardStatusLabel(task.status, task.resumeAt));
    header.append(title, badge);

    const meta = el('div', 'board-card-meta');
    if (task.agent) meta.append(el('span', '', `${task.agent.toUpperCase()} • ${task.level || ''}`));
    if (task.branch) meta.append(el('span', '', `⑂ ${task.branch}`));
    header.append(meta);

    const lastHist = task.history?.at(-1);
    const historyLine = el('div', 'board-card-history', lastHist ? `${lastHist.type === 'status' ? '• ' : '― '}${lastHist.text}` : '');

    card.append(header, historyLine);
    card.addEventListener('click', () => {
      selectedBoardTaskId = task.id;
      renderBoard();
      renderBoardDetail(task.id);
    });
    container.append(card);
  }

  if (selectedBoardTaskId) {
    renderBoardDetail(selectedBoardTaskId);
  }
}

function renderBoardDetail(taskId) {
  const task = boardTasks.find(t => t.id === taskId);
  const modal = $('boardDetailModal');
  const body = $('boardDetailBody');
  if (!task || !modal || !body) return;

  modal.hidden = false;
  $('boardDetailTitle').textContent = task.title || task.request.slice(0, 50) || t('boardDefaultTitle');
  body.replaceChildren();

  // Subtitle line directly under title: Status badge + Agent / Level (+ Branch)
  const subline = el('div', 'board-detail-subline');
  subline.append(el('span', `badge badge-${task.status}`, boardStatusLabel(task.status, task.resumeAt)));
  if (task.agent) {
    subline.append(el('span', '', `${task.agent.toUpperCase()} • ${task.level || ''}`));
  }
  if (task.branch) {
    subline.append(el('span', '', `⑂ ${task.branch}`));
  }
  body.append(subline);

  // İSTEK: User original request
  const reqSec = el('div', 'board-detail-section');
  reqSec.append(el('strong', '', t('boardDetailRequest')), el('p', '', task.request));
  body.append(reqSec);

  // AJAN TALİMATI: Collapsed by default, toggled with Göster / Gizle
  if (task.workerPrompt) {
    const promptSec = el('div', 'board-detail-section');
    const details = el('details');
    const summary = el('summary', '', `▶ ${t('show')} ${t('taskInstruction')}`);
    details.append(summary, el('p', '', task.workerPrompt));
    details.addEventListener('toggle', () => {
      summary.textContent = details.open
        ? `▼ ${t('hide')} ${t('taskInstruction')}`
        : `▶ ${t('show')} ${t('taskInstruction')}`;
    });
    promptSec.append(details);
    body.append(promptSec);
  }

  if (task.status === 'needs_user') {
    const qSec = el('div', 'board-detail-section');
    qSec.append(el('strong', '', t('boardDetailQuestion')), el('p', '', task.question || t('boardAwaitAnswer')));
    const ansRow = el('div', 'board-composer');
    const ansInput = el('input', 'board-input');
    ansInput.placeholder = t('userAnswerPlaceholder');
    const sendBtn = button(t('btnSendAnswer'), async () => {
      if (!ansInput.value.trim()) return;
      await api.answerBoardTask({ taskId: task.id, text: ansInput.value.trim() });
    }, 'btn btn-accent');
    ansRow.append(ansInput, sendBtn);
    qSec.append(ansRow);
    body.append(qSec);
  }

  if (task.result) {
    let cleanResult = task.result;
    try {
      const parsed = JSON.parse(task.result.trim());
      if (parsed && typeof parsed === 'object') {
        cleanResult = parsed.result || parsed.message || parsed.summary || task.result;
      }
    } catch {}
    const resSec = el('div', 'board-detail-section');
    resSec.append(el('strong', '', t('boardDetailResult')), el('div', 'output-block', cleanResult));
    body.append(resSec);
  }

  const streamText = boardStreams.get(task.id) || task.liveOutput;
  if (streamText) {
    const streamSec = el('div', 'board-detail-section');
    const details = el('details');
    // Open only while task is running or planning
    const isLive = ['running', 'planning', 'review'].includes(task.status);
    details.open = isLive || task.status === 'failed';
    const summary = el('summary', '', `${details.open ? '▼' : '▶'} ${t('taskLiveOutput')}`);
    details.append(summary, el('div', 'output-block', streamText));
    details.addEventListener('toggle', () => {
      summary.textContent = `${details.open ? '▼' : '▶'} ${t('taskLiveOutput')}`;
    });
    streamSec.append(details);
    body.append(streamSec);
  }

  if (task.history?.length) {
    const histSec = el('div', 'board-detail-section');
    const details = el('details');
    details.open = false; // Collapsed by default for cleaner UX
    const summary = el('summary', '', `▶ ${t('taskHistory')} (${task.history.length})`);
    const histBox = el('div', 'terminal-window selectable');
    for (const h of task.history) {
      const line = el('div', 'terminal-line');
      const timeStr = new Date(h.at).toLocaleTimeString();
      line.append(el('span', 'timeline-time', timeStr), el('span', 'log-text', ` [${h.type}] ${h.text}`));
      histBox.append(line);
    }
    details.append(summary, histBox);
    details.addEventListener('toggle', () => {
      summary.textContent = `${details.open ? '▼' : '▶'} ${t('taskHistory')} (${task.history.length})`;
    });
    histSec.append(details);
    body.append(histSec);
  }

  const actRow = el('div', 'board-detail-actions');
  if (task.status === 'ready_to_merge') {
    const mergeBtn = button(t('btnMerge'), async () => {
      const res = await api.mergeBoardTask({ taskId: task.id });
      if (res.ok) {
        notice(t('status_merged'));
      } else if (res.reason === 'dirty') {
        notice(t('mergeDirtyWarning'));
      } else if (res.reason === 'conflict') {
        notice(t('status_needs_user'));
      }
    }, 'btn btn-accent');
    actRow.append(mergeBtn);
  }

  if (task.status === 'failed') {
    const retryBtn = button(t('btnRetry'), async () => {
      await api.retryBoardTask({ taskId: task.id });
    }, 'btn btn-secondary');
    actRow.append(retryBtn);
  }

  if (['queued', 'planning', 'running', 'waiting_quota', 'needs_user', 'review'].includes(task.status)) {
    const cancelBtn = button(t('btnCancel'), async () => {
      await api.cancelBoardTask({ taskId: task.id });
    }, 'btn btn-secondary');
    actRow.append(cancelBtn);
  }

  body.append(actRow);
}

async function loadBoard() {
  try {
    boardTasks = await api.listBoard();
    renderBoard();
    renderRoom();
  } catch {}
}

api.onBoardChanged(payload => {
  // Same guard as onBoardStream: never apply another project's board state.
  if (payload.cwd && payload.cwd !== project.cwd) return;
  if (payload.tasks) {
    // Drop cached live streams for terminal tasks; detail view falls back to
    // the persisted task.liveOutput.
    for (const task of payload.tasks) {
      if (['merged', 'failed', 'cancelled'].includes(task.status)) boardStreams.delete(task.id);
    }
    boardTasks = payload.tasks;
    renderBoard();
    renderRoom();
  }
});

api.onBoardStream(payload => {
  if (!payload.taskId || !payload.chunk) return;
  if (payload.cwd && payload.cwd !== project.cwd) return;
  const current = boardStreams.get(payload.taskId) || '';
  const addition = typeof payload.chunk === 'string' ? payload.chunk : (payload.chunk.text || '');
  boardStreams.set(payload.taskId, (payload.chunk.replace ? addition : current + addition).slice(-20000));
  const task = boardTasks.find(task => task.id === payload.taskId);
  if (task) task.liveOutput = boardStreams.get(payload.taskId);
  if (boardStreamFrame === null) boardStreamFrame = requestAnimationFrame(() => {
    boardStreamFrame = null;
    if (selectedBoardTaskId && boardStreams.has(selectedBoardTaskId)) renderBoardDetail(selectedBoardTaskId);
    renderRoom();
  });
});

// NOTE: task submission happens through submitTask(); the old boardAddBtn
// handler was removed when its DOM ids no longer existed in index.html.

$('boardDetailCloseBtn')?.addEventListener('click', () => {
  selectedBoardTaskId = null;
  $('boardDetailModal').hidden = true;
  renderBoard();
});

window.addEventListener('DOMContentLoaded', () => perform(async () => {
  [state, models, settings, project] = await Promise.all([api.getState(), api.getModels(), api.getSettings(), api.getWorkspace()]);
  applyRunOptions(settings); await setLanguage('tr'); await refreshHistory(); await loadMemory(); await loadBoard();
  if (project.error) notice(t('projectUnavailable') + ' ' + project.error);
}));
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); newSession(); $('promptInput').focus(); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && document.activeElement === $('promptInput')) { event.preventDefault(); perform(submitTask); }
});

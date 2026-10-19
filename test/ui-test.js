// Electron UI checks use mocked CLIs; no subscription quota is consumed.
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const root = path.resolve('.test-artifacts', 'ui-' + randomUUID());
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'electron'));
app.setPath('sessionData', path.join(root, 'electron-session'));
process.env.QUOTALALA_DATA_DIR = root;
const { HistoryStore } = require('../src/main/storage');
const { SessionRunner } = require('../src/main/session-runner');
const { HealthService } = require('../src/main/health');
const store = new HistoryStore(root);
const { WorkspaceManager } = require('../src/main/workspace');
const workspace = new WorkspaceManager(root);
workspace.open(process.cwd());
const state = { agents: {
  claude: { id: 'claude', name: 'Claude Code', enabled: true, status: 'idle', jobsCompleted: 0 },
  codex: { id: 'codex', name: 'ChatGPT / Codex', enabled: true, status: 'idle', jobsCompleted: 0 },
  gemini: { id: 'gemini', name: 'Google Gemini', enabled: false, status: 'idle', jobsCompleted: 0 }
} };
let workerCalls = 0;
let win, selectMenuRequested = false;
const emit = (channel, data) => win.webContents.send(channel, data);
const health = new HealthService({
  agents: ['claude', 'codex', 'gemini'].map(id => ({ id, runHealthTest: async () => ({ id, healthy: id === 'claude', message: id === 'claude' ? 'OK' : 'login required', version: 'mock-v1', rawStderr: id === 'claude' ? '' : 'login required', authInfo: { loggedIn: id === 'claude' } }) })),
  quota: { getState: () => state, getAgent: id => state.agents[id], setAgentStatus: (id, status, details = {}) => Object.assign(state.agents[id], { status }, details) },
  models: { getModelByLevel: () => null }, emit
});
const runner = new SessionRunner({ store, emit, coordinator: {
  validatePlan: value => { if (!value.subtasks.length || value.subtasks.some(task => !state.agents[task.agent]?.enabled)) throw new Error('Invalid plan'); return value; },
  planSubtasks: async (prompt, context) => { context.cliSessions.claude = 'mock-id'; return { summary: 'Mock plan', subtasks: [{ step: 1, title: '<img src=x onerror=alert(1)>', agent: 'claude', level: 'hafif', prompt, rationale: 'Small task', model: 'mock-light' }] }; },
  executePlan: async (plan, context) => {
    workerCalls++;
    if (context.prompt === 'cancel fixture') {
      context.onChunk({ agent: 'claude', stream: 'stdout', text: 'LIVE PARTIAL\n' });
      await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true }));
      throw Object.assign(new Error('Cancelled'), { cancelled: true });
    }
    const assigned = context.activity({ type: 'task_assigned', agent: 'claude', model: 'mock-light', level: 'hafif', step: 1, taskTitle: 'API routes', reason: 'Small task', input: 'Mock task input' });
    const output = { step: 1, title: 'OK', agent: 'claude', output: 'OK\nSecond line', model: 'mock-light', success: true };
    context.activity({ type: 'task_completed', agent: 'claude', model: 'mock-light', level: 'hafif', step: 1, taskTitle: 'API routes', assignmentId: assigned.id, output: output.output });
    context.onOutput(output);
    const review = context.activity({ type: 'final_review_started', agent: 'claude', input: output.output });
    context.activity({ type: 'output_transferred', fromAgent: 'claude', toAgent: 'claude', taskTitle: 'API routes', assignmentId: review.id, input: output.output });
    context.activity({ type: 'final_review_completed', agent: 'claude', assignmentId: review.id, output: 'OK\n<script>unsafe()</script>' });
    return { plan, outputs: [output], finalResult: 'OK\n<script>unsafe()</script>', success: true };
  },
  updateMemory: async () => 'Project: test. Recent work: OK. Open tasks: none.'
} });
const handlers = {
  'state:get': () => health.snapshot(), 'health:run': id => health.run(id),
  'settings:get': () => store.getSettings(), 'settings:save': changes => { const settings = store.saveSettings(changes); state.agents.gemini.enabled = settings.geminiEnabled; health.publish(); return settings; },
  'models:get': () => [{ agent: 'claude', name: 'mock-light', source: 'mock', level: 'hafif', cost: 1 }],
  'models:save': list => { return true; },
  'workspace:get': () => workspace.get(), 'workspace:open': cwd => workspace.open(cwd || process.cwd()),
  'sessions:list': () => store.list(workspace.get().cwd), 'sessions:open': id => store.open(id), 'sessions:rename': ({ id, title }) => store.rename(id, title),
  'memory:get': cwd => store.memory(cwd || process.cwd()), 'memory:save': ({ cwd, summary }) => store.saveMemory(cwd, summary, true),
  'session:cancel': () => runner.cancel(), 'session:approve': data => runner.approvePlan(data),
  'session:run': data => runner.run({ ...data, cwd: workspace.requireProject() }), 'clipboard:copy': text => clipboard.writeText(text),
  'language:set': () => {}, 'text:menu': () => { selectMenuRequested = true; emit('text:select-all', {}); },
  'board:list': () => [{ id: 'task-mock-1', title: 'Mock Task 1', request: 'Mock request', status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), type: 'status', text: 'Görev kuyruğa eklendi' }] }],
  'board:add': ({ request }) => ({ id: 'task-mock-2', title: request, request, status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [] }),
  'board:answer': () => {}, 'board:cancel': () => {}, 'board:merge': () => ({ ok: true }), 'board:retry': () => {}
};
for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(name, (event, ...args) => handler(...args));
async function js(code) { return win.webContents.executeJavaScript(code); }
async function until(expression) {
  for (let i = 0; i < 100; i++) { if (await js(expression)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  console.error(await js("JSON.stringify({busy, notice:document.getElementById('notice').textContent, runDisabled:document.getElementById('planAndExecuteBtn').disabled, pending:!!pendingApproval})"));
  throw new Error('UI condition timed out: ' + expression);
}
app.whenReady().then(async () => {
  const watchdog = setTimeout(() => { console.error('UI test exceeded 60 seconds.'); app.exit(1); }, 60000);
  app.on('will-quit', () => clearTimeout(watchdog));
  try {
    win = new BrowserWindow({ width: 1420, height: 1000, show: false, webPreferences: { preload: path.resolve('src/main/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
    await win.loadFile(path.resolve('src/renderer/index.html'));
    await until("document.getElementById('geminiToggle') !== null");
    assert.equal(await js("document.querySelectorAll('.office-station').length"), 3);
    assert.equal(await js("document.getElementById('room-gemini').dataset.status"), 'disabled');
    await js("document.getElementById('toggleRoomBtn').click()");
    assert.equal(await js("getComputedStyle(document.getElementById('roomBody')).display"), 'none');
    await js("document.getElementById('toggleRoomBtn').click(); document.querySelector('#room-gemini .office-details').click()");
    assert.equal(await js("document.getElementById('agentCardsDetails').open"), true);
    await js("document.getElementById('settingsBtn').click()");
    await until("document.getElementById('settingsDialog').open");
    assert.equal(await js("document.getElementById('notificationsInput').checked"), true);
    await js("document.getElementById('notificationsInput').checked=false; document.getElementById('notificationsInput').dispatchEvent(new Event('change'))");
    for (let i=0;i<50 && store.getSettings().notificationsEnabled;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(store.getSettings().notificationsEnabled, false);
    assert.equal(await js("document.querySelectorAll('#modelsTableBody tr').length >= 1"), true);
    await js("document.getElementById('addModelRowBtn').click()");
    assert.equal(await js("document.querySelectorAll('#modelsTableBody tr').length >= 2"), true);
    // Test validation failure with invalid model name
    await js("document.querySelector('#modelsTableBody tr:last-child .model-name-input').value = 'invalid name with spaces'; document.getElementById('saveModelsBtn').click()");
    assert.equal(await js("document.querySelector('#modelsTableBody tr:last-child').classList.contains('row-error')"), true);
    assert.equal(await js("document.getElementById('modelsTableError').hidden"), false);
    // Fix the error and save
    await js("document.querySelector('#modelsTableBody tr:last-child .model-name-input').value = 'valid-name'; document.getElementById('saveModelsBtn').click()");
    await until("document.getElementById('notice').textContent.includes('kaydedildi')");
    assert.equal(await js("document.getElementById('modelsTableError').hidden"), true);
    await js("document.getElementById('closeSettingsBtn').click()");
    assert.equal(await js("document.getElementById('projectName').textContent"), path.basename(process.cwd()));
    assert.equal(await js("document.getElementById('cwdInput').type"), 'hidden');
    assert.equal(await js("document.getElementById('agent-gemini').classList.contains('agent-disabled')"), true);
    await js("window.confirm = () => false; document.getElementById('geminiToggle').click()");
    assert.equal(state.agents.gemini.enabled, false);
    await js("window.confirm = () => true; document.getElementById('geminiToggle').click()");
    await until("!document.getElementById('agent-gemini').classList.contains('agent-disabled')");
    assert.equal(store.getSettings().geminiRiskAccepted, true);
    await js("document.getElementById('geminiToggle').click()");
    await until("document.getElementById('agent-gemini').classList.contains('agent-disabled')");
    await js("document.getElementById('runAllHealthBtn').click()");
    await until("document.getElementById('claude-badge').textContent === 'Hazır'");
    await until("!document.getElementById('systemHealthBadge').textContent.includes('çalışıyor')");
    assert.equal(await js("document.getElementById('codex-badge').textContent"), 'Giriş gerekli');
    await js("document.querySelector('[data-tab=terminalLogTab]').click(); window.quotalalaAPI.onLog; appendLog({level:'warning', agent:'codex', text:'Fallback mock'}); appendLog({level:'error',agent:'gemini',errorType:'not_found',text:'Missing CLI',raw:'spawn agy ENOENT'});");
    await js("document.querySelector('[data-level=error]').click(); document.getElementById('agentFilter').value='codex'; document.getElementById('agentFilter').dispatchEvent(new Event('change'))");
    assert.equal(await js("document.querySelectorAll('.terminal-line').length"), 1);
    assert.equal(await js("document.querySelectorAll('.error-card').length"), 1);
    assert.match(await js("document.querySelector('.error-card').textContent"), /Terminalde `codex`/);
    await js("document.querySelector('.copy-raw').click()"); await until("document.getElementById('notice').textContent === 'Kopyalandı.'");
    assert.equal(await clipboard.readText(), 'login required');
    await js("document.getElementById('copyAllBtn').click()"); await until("true");
    await new Promise(resolve => setTimeout(resolve, 50)); assert.match(await clipboard.readText(), /\[codex\].*login required/);
    await js("document.querySelector('.copy-row').click()"); await new Promise(resolve => setTimeout(resolve, 50)); assert.match(await clipboard.readText(), /login required/);
    assert.equal(await js("getComputedStyle(document.querySelector('.log-text')).userSelect"), 'text');
    await js("document.getElementById('terminalWindow').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
    await until("window.getSelection().toString().includes('login required')"); assert.equal(selectMenuRequested, true);
    await js("document.querySelector('[data-level=all]').click(); document.getElementById('agentFilter').value='all'; document.getElementById('agentFilter').dispatchEvent(new Event('change'))");
    await js(`document.getElementById('cwdInput').value=${JSON.stringify(process.cwd())}; document.getElementById('promptInput').value='OK'; void perform(runSession)`);
    await until("document.querySelector('.history-open') !== null && document.getElementById('notice').textContent.includes('kaydedildi')");
    await until("!busy && document.getElementById('planAndExecuteBtn').textContent.includes('Ekle')");
    assert.equal(store.list().length, 1); assert.match(store.memory(process.cwd()).summary, /Recent work/);
    await js("document.querySelector('[data-tab=liveStreamTab]').click()");
    assert.equal(await js("document.querySelectorAll('#streamContainer img, #streamContainer script').length"), 0);
    assert.equal(await js("getComputedStyle(document.querySelector('.output-text')).userSelect"), 'text');
    await js("document.getElementById('streamContainer').focus(); document.getElementById('streamContainer').dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true,cancelable:true}))");
    assert.match(await js("window.getSelection().toString()"), /Second line/);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'C', modifiers: ['control'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'C', modifiers: ['control'] });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.match(await clipboard.readText(), /Second line/);
    await js("document.querySelector('.copy-output-all').click()"); await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(await clipboard.readText(), 'OK');
    await js("document.querySelector('[data-tab=timelineTab]').click()");
    assert.match(await js("document.getElementById('timelineContainer').textContent"), /Claude işi 1 parçaya böldü/);
    assert.match(await js("document.getElementById('timelineContainer').textContent"), /API routes \(Hafif\)/);
    await js("document.querySelector('.timeline-task_assigned summary').click()");
    await until("document.querySelector('.timeline-task_assigned').textContent.includes('Mock task input')");
    assert.match(await js("document.querySelector('.timeline-task_assigned').textContent"), /Second line/);
    assert.match(await js("document.querySelector('.timeline-task_assigned').textContent"), /mock-light/);
    assert.match(await js("document.querySelector('.timeline-task_assigned').textContent"), /Small task/);
    await js("renderTurns(viewedTurns)");
    assert.equal(await js("document.querySelector('.timeline-task_assigned').open"), true);
    await js("document.querySelector('.timeline-task_completed summary').click()");
    await until("document.querySelector('.timeline-task_completed').textContent.includes('Mock task input')");
    await js("document.querySelector('.history-open').click()");
    await until("document.querySelectorAll('.timeline-event').length === 8");
    assert.equal(store.open(store.list()[0].id).turns[0].activities.length, 8);
    await js("document.getElementById('langEn').click()"); await until("document.getElementById('copyAllBtn').textContent === 'Copy All'");
    assert.equal(await js("document.getElementById('codex-badge').textContent"), 'Sign-in required');
    assert.equal(await js("document.getElementById('roomTitle').textContent"), 'Our little team room');
    assert.match(await js("document.getElementById('timelineContainer').textContent"), /Activity timeline/);
    assert.match(await js("document.getElementById('timelineContainer').textContent"), /Claude split the work into 1 tasks/);
    await js("document.getElementById('langTr').click()"); await until("document.getElementById('copyAllBtn').textContent === 'Tümünü Kopyala'");
    const otherProject = path.join(root, 'Second project'); fs.mkdirSync(otherProject, { recursive: true });
    const otherSession = store.create(otherProject, 'Other conversation'); otherSession.status = 'completed'; store.save(otherSession); store.saveMemory(otherProject, 'Second project memory');
    await js(`openProject(${JSON.stringify(otherProject)})`);
    await until("document.getElementById('projectName').textContent === 'Second project' && document.querySelector('.history-open').textContent === 'Other conversation'");
    assert.equal(await js("document.querySelectorAll('.history-open').length"), 1);
    assert.equal(await js("document.getElementById('memoryInput').value"), 'Second project memory');
    await js(`openProject(${JSON.stringify(process.cwd())})`);
    await until(`document.getElementById('projectName').textContent === ${JSON.stringify(path.basename(process.cwd()))} && document.querySelector('.history-open').textContent === 'OK'`);
    await js("newSession(); document.querySelector('[data-tab=liveStreamTab]').click(); window.getSelection().removeAllRanges(); window.scrollTo(0,0); document.getElementById('notice').textContent=''");
    await new Promise(resolve => setTimeout(resolve, 200));
    const beforeApproval = workerCalls;
    await js("newSession(); document.getElementById('previewPlan').checked=true; document.getElementById('promptInput').value='approval fixture'; void perform(runSession)");
    await until("document.getElementById('planDialog').open"); assert.equal(workerCalls, beforeApproval);
    await js("document.querySelector('.plan-prompt').value='Edited in UI'; document.getElementById('approvePlanBtn').click()");
    await until("!busy && !document.getElementById('planDialog').open && !document.getElementById('planAndExecuteBtn').disabled"); assert.equal(workerCalls, beforeApproval + 1);
    assert.equal(store.open(store.list()[0].id).turns[0].plan.subtasks[0].prompt, 'Edited in UI');
    await js("newSession(); document.getElementById('previewPlan').checked=false; document.getElementById('promptInput').value='cancel fixture'; void perform(runSession)");
    await until("document.getElementById('streamContainer').textContent.includes('LIVE PARTIAL')");
    assert.equal(await js("document.getElementById('stopBtn').disabled"), false);
    await js("document.getElementById('stopBtn').click()");
    await until("!busy && document.getElementById('notice').textContent.includes('İptal edildi')");
    assert.equal(await js("document.getElementById('planAndExecuteBtn').disabled"), false);
    assert.equal(await js("document.getElementById('stopBtn').disabled"), true);
    assert.match(await js("document.getElementById('streamContainer').textContent"), /LIVE PARTIAL/);
    await js("newSession(); document.getElementById('runMode').value='economic'; document.getElementById('runMode').dispatchEvent(new Event('change'))");
    assert.equal(await js("document.getElementById('previewPlan').disabled && document.getElementById('verifyRun').disabled"), true);
    assert.equal(await js("document.querySelector('#directAgent option[value=gemini]').disabled"), true);
    await js("document.getElementById('runMode').value='coordinated'; renderState()");
    await js("document.querySelector('[data-tab=boardTab]').click()");
    await until("document.getElementById('board-task-task-mock-1') !== null");
    assert.equal(await js("document.getElementById('board-task-task-mock-1').querySelector('.board-card-title').textContent"), 'Mock Task 1');

    // Test detail view layout: title once, subline with status, request, and collapsed worker prompt
    await js("boardTasks = [{ id: 'task-detail-1', title: 'Detail Test Task', request: 'Original user request', workerPrompt: 'Claude worker instruction', status: 'running', agent: 'claude', level: 'hafif', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [] }]; renderBoard(); document.getElementById('board-task-task-detail-1').click()");
    await until("!document.getElementById('boardDetailModal').hidden");
    assert.equal(await js("document.getElementById('boardDetailTitle').textContent"), 'Detail Test Task');
    assert.equal(await js("document.querySelector('.board-detail-subline').textContent.includes('CLAUDE • hafif')"), true);
    assert.equal(await js("document.querySelector('.board-detail-section details') !== null"), true);
    assert.equal(await js("document.querySelector('.board-detail-section details').open"), false);
    assert.match(await js("document.querySelector('.board-detail-section details summary').textContent"), /Göster/);

    // Failed board output remains expanded after reopening; live snapshots replace
    // previous snapshots, and the room reflects the failure instead of idling.
    await js("boardTasks[0].status='failed'; boardTasks[0].liveOutput='[process] PID 12345\\n[tool] Read: README.md\\nTimeout: fixture'; boardTasks[0].history=[{at:new Date().toISOString(),type:'status',text:'Timeout: fixture'}]; renderBoard(); renderRoom()");
    assert.match(await js("document.getElementById('boardDetailBody').textContent"), /Read: README/);
    assert.equal(await js("[...document.querySelectorAll('#boardDetailBody details')].find(node=>node.textContent.includes('PID 12345')).open"), true);
    assert.equal(await js("document.getElementById('room-claude').dataset.status"), 'blocked');
    emit('board:stream', { taskId: 'task-detail-1', chunk: { text: 'snapshot one', replace: true } });
    emit('board:stream', { taskId: 'task-detail-1', chunk: { text: 'snapshot two', replace: true } });
    await until("document.getElementById('boardDetailBody').textContent.includes('snapshot two')");
    assert.equal(await js("document.getElementById('boardDetailBody').textContent.includes('snapshot one')"), false);

    // Test unified entry via promptInput + planAndExecuteBtn
    await js("document.getElementById('promptInput').value = 'New Unified Task'; document.getElementById('planAndExecuteBtn').click()");
    await until("document.getElementById('promptInput').value === ''");

    // Test quota warning when selected agent is limited
    await js("document.getElementById('runMode').value='economic'; document.getElementById('directAgent').value='codex'; state.agents.codex.status = 'limited'; renderState()");
    assert.equal(await js("document.getElementById('agentQuotaWarning').hidden"), false);
    await js("state.agents.codex.status = 'idle'; renderState()");
    assert.equal(await js("document.getElementById('agentQuotaWarning').hidden"), true);

    const image = await win.webContents.capturePage(); fs.writeFileSync(path.join(root, 'ui.png'), image.toPNG());
    win.setSize(1050, 900);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await js("document.documentElement.scrollWidth <= window.innerWidth"), true);
    const narrow = await win.webContents.capturePage(); fs.writeFileSync(path.join(root, 'ui-narrow.png'), narrow.toPNG());
    console.log('PASS: active workspace, hidden project path, health state/spinner, disabled Gemini, mock E2E/history/memory, combined filters, error cards, raw/row/all copy, selection/context menu, safe output rendering, activity timeline details/persistence, TR/EN, unified task entry, task details, quota warning.');
    console.log('Screenshot: ' + path.join(root, 'ui.png')); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});

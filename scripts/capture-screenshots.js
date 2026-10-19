// Render the production UI with synthetic data only. Never load CLI adapters.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const data = path.join(root, '.test-artifacts', 'screenshots-' + randomUUID());
fs.mkdirSync(data, { recursive: true });
app.setPath('userData', path.join(data, 'electron'));
app.setPath('sessionData', path.join(data, 'electron-session'));
const output = path.join(root, 'assets', 'screenshots');
fs.mkdirSync(output, { recursive: true });
const project = { cwd: 'C:\\projects\\demo-app', name: 'demo-app', recentProjects: [] };
const agents = Object.fromEntries(['claude', 'codex', 'gemini'].map(id => [id, {
  id, name: id === 'claude' ? 'Claude Code' : id === 'codex' ? 'ChatGPT / Codex' : 'Google Gemini',
  enabled: id !== 'gemini', status: 'idle', jobsCompleted: 0
}]));
const settings = { saveHistory: true, notificationsEnabled: true, mode: 'coordinated', timeout: 180000, previewPlan: true };
const boardTask = {
  id: 'board-demo-1',
  title: 'Add status filters to the task tracker',
  request: 'Add status filters to the task tracker and review the changed files.',
  workerPrompt: 'Add status filters using the existing SQLite adapter. Keep the current project architecture and commit the change.',
  status: 'awaiting_approval',
  agent: 'codex',
  level: 'orta',
  createdAt: '2026-10-19T09:12:00.000Z',
  updatedAt: '2026-10-19T09:12:41.000Z',
  history: [
    { at: '2026-10-19T09:12:00.000Z', type: 'status', text: 'Task queued' },
    { at: '2026-10-19T09:12:41.000Z', type: 'status', text: 'Plan ready, waiting for your approval' }
  ]
};
const handlers = {
  'state:get': () => ({ agents, healthRunning: false }), 'models:get': () => [],
  'settings:get': () => settings, 'workspace:get': () => project, 'sessions:list': () => [],
  'board:list': () => [boardTask],
  'memory:get': () => ({ summary: 'Demo project: a local task tracker. Keep the existing SQLite adapter. Next: add task filters.' }),
  'language:set': () => {}
};
for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
const plan = { summary: 'Add filters to the task tracker and review the changes.', subtasks: [
  { step: 1, title: 'Implement task filters', agent: 'codex', level: 'orta', prompt: 'Add status filters using the existing SQLite adapter.', rationale: 'Focused implementation using project context.' },
  { step: 2, title: 'Review changed files', agent: 'claude', level: 'hafif', prompt: 'Review the changed files and provide file/line evidence.', rationale: 'Small review after implementation.' }
] };
app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ width: 1440, height: 1040, show: true, webPreferences: {
      preload: path.join(root, 'src/main/preload.js'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, backgroundThrottling: false
    } });
    await win.loadFile(path.join(root, 'src/renderer/index.html'));
    const js = code => win.webContents.executeJavaScript(code);
    for (let i = 0; i < 100 && !await js("document.getElementById('projectName').textContent === 'demo-app'"); i++) await new Promise(resolve => setTimeout(resolve, 30));
    await js("setLanguage('en')");
    await js(`busy = true; renderState(); renderTurns([${JSON.stringify({
      id: 'demo-turn', prompt: 'Add task filters to our tracker. Keep the current architecture and review the changed files.',
      status: 'running', options: { mode: 'coordinated' }, outputs: [], logs: [], plan,
      activities: [
        { id: 'start', type: 'session_started' },
        { id: 'question', type: 'agent_question', agent: 'codex', toAgent: 'claude', taskTitle: 'Task filters', output: 'Which database adapter should I use?' },
        { id: 'reply', type: 'coordinator_reply', agent: 'claude', fromAgent: 'claude', toAgent: 'codex', taskTitle: 'Task filters', output: 'Use SQLite and keep the existing project adapter.' },
        { id: 'work', type: 'task_assigned', agent: 'codex', taskTitle: 'Implement task filters', level: 'orta' }
      ]
    })}]);`);
    assert.equal(await js("document.getElementById('room-codex').dataset.status"), 'working');
    assert.equal(await js("document.getElementById('room-gemini').dataset.status"), 'disabled');
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.writeFileSync(path.join(output, 'workspace-en.png'), (await win.webContents.capturePage()).toPNG());
    await js("setLanguage('tr')");
    const bounds = await js("(() => { const r=document.getElementById('teamRoom').getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}; })()");
    fs.writeFileSync(path.join(output, 'team-room-tr.png'), (await win.webContents.capturePage(bounds)).toPNG());
    await js("setLanguage('en')");
    // Board plan approval: the planned card waits for the user before the worker starts.
    await js("document.querySelector('[data-tab=boardTab]').click()");
    for (let i = 0; i < 100 && !await js("document.getElementById('board-task-board-demo-1') !== null"); i++) await new Promise(resolve => setTimeout(resolve, 30));
    await js("document.getElementById('board-task-board-demo-1').click()");
    for (let i = 0; i < 100 && !await js("document.querySelector('.board-plan-prompt') !== null"); i++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(await js("document.querySelectorAll('.board-plan-field select').length"), 2);
    await js("document.querySelector('.board-container').scrollIntoView({ block: 'center' })");
    await new Promise(resolve => setTimeout(resolve, 250));
    const boardBounds = await js("(() => { const r = document.querySelector('.board-container').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()");
    assert.ok(boardBounds.y >= 0 && boardBounds.height > 200, 'Board panel is not visible for the screenshot');
    fs.writeFileSync(path.join(output, 'plan-approval-en.png'), (await win.webContents.capturePage(boardBounds)).toPNG());
    console.log('PASS: 3 production UI screenshots, synthetic project, messages and board task, zero CLI calls.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});

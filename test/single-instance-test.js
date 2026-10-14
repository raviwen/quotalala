// Two real Electron instances, mocked agents, and storage confined to the repository.
const { app, BrowserWindow, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const root = process.env.QUOTALALA_INSTANCE_FIXTURE || path.resolve('.test-artifacts', 'instance-' + require('crypto').randomUUID());
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'electron'));
app.setPath('sessionData', path.join(root, 'session'));
process.env.QUOTALALA_DATA_DIR = root;
let teamWorkers = 0, teamDecisions = 0, releaseWorker, releaseManager, releaseSecondWorker;
const workerPause = new Promise(resolve => { releaseWorker = resolve; });
const secondWorkerPause = new Promise(resolve => { releaseSecondWorker = resolve; });
const managerPause = new Promise(resolve => { releaseManager = resolve; });
const peer = !!process.env.QUOTALALA_INSTANCE_FIXTURE;
const a = path.join(root, 'Project A'), b = path.join(root, 'Project B');
if (!peer) {
  fs.mkdirSync(a); fs.mkdirSync(b);
  process.argv.push('--project', a);
  const { HistoryStore } = require('../src/main/storage');
  const store = new HistoryStore(root);
  store.saveSettings({ previewPlan: true, notificationsEnabled: false });
  const session = store.create(a, 'Interrupted fixture');
  session.turns.push({ status: 'running', prompt: 'Old work', outputs: [] }); store.save(session);
  for (const agent of require('../src/main/agents').getAllAgents()) {
    agent.capabilities = { resume: false, noTools: true };
    agent.execute = async () => { throw new Error('Live CLI must not be used'); };
    agent.runPrompt = async (prompt, options) => {
      let value;
      if (options.reason === 'Planlama') value = { subtasks: [{ agent: 'codex', level: 'hafif', title: 'Mock work', prompt: 'Mock work' }] };
      else if (options.reason === 'Proje hafızasını güncelleme') return { code: 0, stdout: 'Project B memory', stderr: '', durationMs: 1 };
      else if (options.phase === 'coordination') {
        teamDecisions++; if (teamDecisions === 1) await managerPause;
        value = teamWorkers === 1 ? { action: 'continue', reason: 'Answer the adapter question', messages: [{ step: 1, toAgent: 'codex', content: 'SQLite kullan; projedeki mevcut adaptörü koru.' }] } : { action: 'finish', reason: 'Assigned work finished', result: 'Implemented; synthesis is not an independent test.' };
      } else {
        teamWorkers++; if (teamWorkers === 1) await workerPause; else if (teamWorkers === 2) await secondWorkerPause;
        value = teamWorkers === 1 ? { protocol: 'worker-v1', status: 'needs_input', message: 'Hangi adaptörü kullanmalıyım? Projenin mevcut veri yapısıyla uyumlu ilerlemek için kısa bir yönlendirmene ihtiyacım var. <img src=x onerror=alert(1)>', toAgent: 'claude' } : { protocol: 'worker-v1', status: 'completed', message: 'SQLite adapter implemented.' };
      }
      return { code: 0, stdout: JSON.stringify(value), stderr: '', durationMs: 1 };
    };
  }
  app.on('browser-window-created', (event, win) => { win.hide(); win.webContents.setBackgroundThrottling(false); });
}
require('../src/main/main');
if (!peer) app.whenReady().then(async () => {
  const timer = setTimeout(() => { console.error('Single-instance fixture timed out'); app.exit(1); }, 20000);
  try {
    const win = BrowserWindow.getAllWindows()[0];
    const js = code => win.webContents.executeJavaScript(code);
    const until = async expression => {
      for (let i = 0; i < 150; i++) { if (await js(expression)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
      console.error(await js("JSON.stringify({busy, project, deferredWorkspace, notice:document.getElementById('notice').textContent, logs})"));
      throw new Error('Condition timed out: ' + expression);
    };
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await until("document.querySelector('.history-open') !== null");
    assert.match(await js("document.getElementById('historyList').textContent"), /Beklenmedik kapanma/);
    await js("document.getElementById('promptInput').value='Mock task'; document.getElementById('planAndExecuteBtn').click()");
    await until("document.getElementById('planDialog').open");
    let secondEvent = false; app.once('second-instance', () => { secondEvent = true; });
    const child = spawn(process.execPath, [__filename, '--project', b], { env: { ...process.env, QUOTALALA_INSTANCE_FIXTURE: root }, windowsHide: true, stdio: 'ignore' });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    assert.equal(code, 0); assert.equal(secondEvent, true); assert.equal(BrowserWindow.getAllWindows().length, 1);
    assert.equal((await js('api.getWorkspace()')).cwd, fs.realpathSync(a));
    await js("document.getElementById('cancelPlanBtn').click()");
    await until("!busy && document.getElementById('projectName').textContent === 'Project B'");
    assert.equal((await js('api.getWorkspace()')).cwd, fs.realpathSync(b));
    const store = new (require('../src/main/storage').HistoryStore)(root);
    const cancelled = store.list(a).find(session => session.status === 'cancelled');
    assert.ok(cancelled); assert.equal(store.open(cancelled.id).cwd, fs.realpathSync(a));
    await js("document.getElementById('previewPlan').checked=false; document.getElementById('promptInput').value='Team UI fixture'; document.getElementById('planAndExecuteBtn').click()");
    await until("document.getElementById('room-codex').dataset.status === 'working'");
    assert.equal(await js("document.getElementById('room-gemini').dataset.status"), 'disabled');
    assert.equal(await js("document.querySelector('#room-codex .person-head') && getComputedStyle(document.querySelector('#room-codex .person-head')).animationName"), 'office-work-bob');
    win.webContents.send('session:focus', { sessionId: 'another-session', turnId: 'another-turn', kind: 'completed' });
    await until("document.getElementById('notice').textContent.includes('başka bir oturuma')");
    assert.equal((await js('api.getWorkspace()')).cwd, fs.realpathSync(b));
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await js("getComputedStyle(document.querySelector('#room-codex .person-head')).animationName"), 'none');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    win.webContents.debugger.detach();
    releaseWorker();
    await until("document.getElementById('room-codex').dataset.status === 'waiting' && document.getElementById('room-claude').dataset.status === 'coordinating'");
    await js("document.querySelector('#room-codex .office-bubble').click()");
    assert.equal(await js("document.getElementById('roomMessageDetails').hidden"), false);
    assert.match(await js("document.getElementById('roomMessageBody').textContent"), /Hangi adaptörü/);
    assert.equal(await js("document.querySelectorAll('#teamRoom img, #teamRoom script').length"), 0);
    await js("document.querySelector('#roomMessageBody .copy-output-all').click()");
    await until("document.getElementById('notice').textContent === 'Kopyalandı.'");
    assert.match(await clipboard.readText(), /Hangi adaptörü/);
    await js("document.getElementById('closeRoomMessageBtn').click(); document.getElementById('teamRoom').scrollIntoView({block:'center'})");
    const bounds = await js("(() => { const r=document.getElementById('teamRoom').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()");
    await new Promise(resolve => setTimeout(resolve, 100));
    const roomImage = await win.webContents.capturePage(bounds); fs.writeFileSync(path.join(root, 'team-room.png'), roomImage.toPNG());
    releaseManager();
    await until("document.getElementById('room-codex').dataset.status === 'working' && document.getElementById('roomRouteText').textContent.includes('Claude → Codex')");
    await new Promise(resolve => setTimeout(resolve, 80));
    const replyImage = await win.webContents.capturePage(bounds); fs.writeFileSync(path.join(root, 'team-room-reply.png'), replyImage.toPNG());
    releaseSecondWorker();
    await until("!busy && document.getElementById('streamContainer').textContent.includes('SQLite adapter implemented.')");
    assert.equal(teamWorkers, 2); assert.equal(teamDecisions, 2);
    assert.equal(await js("document.getElementById('room-codex').dataset.status"), 'completed');
    assert.equal(await js("document.querySelectorAll('#roomScene .is-working').length"), 0);
    assert.match(await js("document.querySelector('.team-conversation').textContent"), /SQLite kullan/);
    assert.equal(await js("document.querySelectorAll('.team-conversation img, .team-conversation script').length"), 0);
    await js("document.querySelector('.team-conversation .copy-output-all').click()");
    await until("document.getElementById('notice').textContent === 'Kopyalandı.'");
    assert.match(await clipboard.readText(), /Hangi adaptörü/);
    await js("document.getElementById('langEn').click()");
    await until("document.querySelector('.team-conversation h3').textContent === 'Team conversation'");
    const completed = store.list(b).find(item => item.status === 'completed');
    const recordedTurn = store.open(completed.id).turns.at(-1);
    win.webContents.send('session:focus', { sessionId: completed.id, turnId: recordedTurn.id, kind: 'completed' });
    await until("document.getElementById('roomScene').dataset.mode === 'archive'");
    assert.equal(teamWorkers, 2); assert.equal(teamDecisions, 2);
    await js('api.getMemory(project.cwd)');
    console.log('Screenshot: ' + path.join(root, 'team-room-reply.png'));
    console.log('PASS: event-driven office, working/question/reply/completed states, reduced motion, notification focus without rerunning work; actual coordinator team UI, questions/replies, safe selectable and copyable conversation, TR/EN; single Electron instance, second project request queued during active work, immutable task folder, interrupted startup recovery, cancel approval and idle UI.');
    clearTimeout(timer); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
});

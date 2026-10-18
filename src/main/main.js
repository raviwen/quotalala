const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, clipboard, dialog } = require('electron');
app.name = 'Quotalala';
if (process.platform === 'win32') {
  app.setAppUserModelId('com.quotalala.app');
}
if (!app.requestSingleInstanceLock({ argv: process.argv, cwd: process.cwd() })) { app.quit(); } else {
const path = require('path');
const fs = require('fs');
const { getAllAgents } = require('./agents');
const quota = require('./quota');
const models = require('./models');
const coordinator = require('./coordinator');
const { HistoryStore } = require('./storage');
const { HealthService } = require('./health');
const { SessionRunner } = require('./session-runner');
const { failure } = require('./events');
const { TaskNotifications, showNotification } = require('./task-notifications');
const { launchProject, WorkspaceManager } = require('./workspace');
const { TaskBoard } = require('./task-board');
const { BoardRunner } = require('./board-runner');
const { mergeBranch, removeWorktree } = require('./worktree');
const store = new HistoryStore();
const workspace = new WorkspaceManager();
let mainWindow, tray, reminderTimer, taskNotifications;
let pendingProject = null;
const boardRunners = new Map(); // cwd -> BoardRunner

function getBoardRunner(cwd) {
  const resolved = path.resolve(cwd);
  if (!boardRunners.has(resolved)) {
    const board = new TaskBoard(resolved, store.root);
    const runner = new BoardRunner({
      cwd: resolved,
      root: store.root,
      board,
      emit: (ch, data) => emit(ch, data),
      store
    });
    runner.start();
    boardRunners.set(resolved, runner);
  }
  return boardRunners.get(resolved);
}
function flushProject() {
  if (!pendingProject || runner.busy || health.running) return;
  const cwd = pendingProject; pendingProject = null;
  try { emit('workspace:changed', workspace.open(cwd)); } catch (error) { emit('stream:log', failure(null, error.message)); }
}
app.on('second-instance', (event, argv, workingDirectory, request) => {
  // Chromium may reorder switches in commandLine; additionalData preserves argv adjacency.
  if (Array.isArray(request?.argv) && request.argv.every(item => typeof item === 'string')) argv = request.argv;
  if (typeof request?.cwd === 'string') workingDirectory = request.cwd;
  mainWindow?.show(); mainWindow?.focus();
  try { pendingProject = launchProject(argv, { packaged: app.isPackaged, cwd: workingDirectory }); flushProject(); }
  catch (error) { emit('stream:log', failure(null, error.message)); }
});
let isQuitting = false;
let language = 'tr';
const iconPath = path.join(__dirname, '../../assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const appIcon = nativeImage.createFromPath(iconPath);
function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  taskNotifications?.consume(channel, payload);
  if (channel === 'board:changed' && payload.taskId) {
    const task = payload.tasks?.find(t => t.id === payload.taskId);
    if (task && (task.status === 'needs_user' || task.status === 'ready_to_merge')) {
      const isTR = language === 'tr';
      const title = task.status === 'needs_user'
        ? (isTR ? 'Senden cevap bekleniyor' : 'Your answer is needed')
        : (isTR ? 'Birleştirmeye hazır' : 'Ready to merge');
      const body = task.title || task.request?.slice(0, 50) || '';
      notify(title, body, () => {
        mainWindow?.show();
        mainWindow?.focus();
      });
    }
  }
}
const health = new HealthService({ agents: getAllAgents(), quota, models, emit });
const runner = new SessionRunner({ store, coordinator, emit, publish: () => { health.publish(); updateTray(); } });
function updateTray() { tray?.setToolTip(quota.getTraySummary()); }
function notify(title, body, click = () => { mainWindow?.show(); mainWindow?.focus(); }) {
  try { return showNotification(Notification, { title, body, icon: appIcon.isEmpty() ? iconPath : appIcon, click }); } catch { return false; }
}
taskNotifications = new TaskNotifications({
  send: notify, getSettings: () => store.getSettings(), getLanguage: () => language,
  isForeground: () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused(),
  focus: target => { mainWindow?.show(); mainWindow?.focus(); emit('session:focus', target); }
});
function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Quotalala',
    width: 1420,
    height: 950,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0b0f19',
    icon: appIcon.isEmpty() ? iconPath : appIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (!appIcon.isEmpty()) {
    try { mainWindow.setIcon(appIcon); } catch {}
  }
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.on('close', event => { if (!isQuitting) { event.preventDefault(); mainWindow.hide(); } });
  mainWindow.on('closed', () => { mainWindow = null; });
}
function createTray() {
  tray = new Tray(appIcon.isEmpty() ? iconPath : appIcon); updateTray();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Quotalala', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: language === 'tr' ? 'Etkin ajanları test et' : 'Test enabled agents', click: async () => {
      mainWindow?.show(); if (runner.busy || health.running) return;
      try { await health.run(); } catch (error) { emit('stream:log', failure(null, error.message)); } finally { updateTray(); }
    } },
    { type: 'separator' }, { label: language === 'tr' ? 'Çıkış' : 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => mainWindow?.show());
}
function ensureIdle() {
  if (runner.busy || health.running) throw new Error('An operation is already running.');
  const curProject = workspace.get().cwd;
  if (curProject && boardRunners.has(path.resolve(curProject))) {
    if (boardRunners.get(path.resolve(curProject)).hasActiveTasks()) {
      throw new Error('A board task is currently running.');
    }
  }
}
function register(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Untrusted IPC sender.');
    return handler(...args);
  });
}
register('state:get', () => health.snapshot());
register('health:run', async id => {
  ensureIdle(); if (id && !['claude', 'codex', 'gemini'].includes(id)) throw new Error('Unknown agent.');
  try { return await health.run(id); } finally { updateTray(); flushProject(); }
});
register('settings:get', () => store.getSettings());
register('settings:save', changes => {
  ensureIdle(); const settings = store.saveSettings(changes);
  quota.setEnabled('gemini', settings.geminiEnabled); health.publish(); updateTray(); return settings;
});
register('models:get', () => models.getModels());
register('models:save', list => { ensureIdle(); return models.saveModels(list); });
register('session:run', async data => { ensureIdle(); try { return await runner.run({ ...data, cwd: workspace.requireProject() }); } finally { setImmediate(flushProject); } });
register('session:cancel', () => runner.cancel());
register('session:approve', data => runner.approvePlan(data));
register('sessions:list', () => workspace.get().cwd ? store.list(workspace.get().cwd) : []);
register('sessions:open', id => store.open(id));
register('sessions:rename', ({ id, title }) => { ensureIdle(); return store.rename(id, title); });
register('sessions:delete', id => { ensureIdle(); store.delete(id); });
register('sessions:clear', () => { ensureIdle(); store.clear(); });
register('memory:get', cwd => store.memory(cwd || process.cwd()));
register('memory:save', ({ cwd, summary }) => { ensureIdle(); if (typeof summary !== 'string') throw new Error('Invalid summary.'); return store.saveMemory(cwd || process.cwd(), summary, true); });
register('memory:reset', cwd => { ensureIdle(); return store.resetMemory(cwd || process.cwd()); });
register('folder:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
register('workspace:get', () => workspace.get());
register('workspace:open', async cwd => {
  ensureIdle();
  if (!cwd) {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (result.canceled) return workspace.get();
    cwd = result.filePaths[0];
  }
  return workspace.open(cwd);
});
register('clipboard:copy', text => { if (typeof text !== 'string' || text.length > 10000000) throw new Error('Invalid clipboard text.'); return clipboard.writeText(text); });
register('text:menu', ({ selection, all }) => {
  if (typeof selection !== 'string' || typeof all !== 'string') throw new Error('Invalid selection.');
  Menu.buildFromTemplate([
    { label: language === 'tr' ? 'Kopyala' : 'Copy', enabled: !!selection, click: () => clipboard.writeText(selection) },
    { label: language === 'tr' ? 'Tümünü Seç' : 'Select All', click: () => emit('text:select-all', {}) }
  ]).popup({ window: mainWindow });
});
register('language:set', value => { language = value === 'en' ? 'en' : 'tr'; if (tray) { tray.destroy(); createTray(); } });
register('board:list', () => {
  const curProject = workspace.get().cwd;
  if (!curProject) return [];
  const br = getBoardRunner(curProject);
  return br.board.list();
});
register('board:add', async ({ request }) => {
  const curProject = workspace.requireProject();
  if (runner.busy) throw new Error('Session is busy.');
  const br = getBoardRunner(curProject);
  const task = br.board.add(request);
  br.emitChanged(task.id);
  br.tick().catch(() => {});
  return task;
});
register('board:answer', async ({ taskId, text }) => {
  const curProject = workspace.requireProject();
  const br = getBoardRunner(curProject);
  await br.answer(taskId, text);
  return br.board.get(taskId);
});
register('board:cancel', ({ taskId }) => {
  const curProject = workspace.requireProject();
  const br = getBoardRunner(curProject);
  br.cancel(taskId);
  return br.board.get(taskId);
});
register('board:retry', ({ taskId }) => {
  const curProject = workspace.requireProject();
  if (runner.busy) throw new Error('Session is busy.');
  const br = getBoardRunner(curProject);
  br.retry(taskId);
  return br.board.get(taskId);
});
register('board:merge', async ({ taskId }) => {
  const curProject = workspace.requireProject();
  const br = getBoardRunner(curProject);
  const task = br.board.get(taskId);
  if (!task || task.status !== 'ready_to_merge') {
    throw new Error('Task is not ready to merge.');
  }
  if (!task.branch) {
    br.board.setStatus(taskId, 'merged', 'Git branch bulunamadı, birleştirildi olarak işaretlendi');
    br.emitChanged(taskId);
    return { ok: true };
  }
  const mergeRes = await mergeBranch(curProject, task.branch);
  if (mergeRes.ok) {
    br.board.setStatus(taskId, 'merged', 'Değişiklikler başarıyla birleştirildi');
    if (task.worktreePath) {
      await removeWorktree(curProject, task.worktreePath);
    }
    br.emitChanged(taskId);
    return { ok: true };
  }
  if (mergeRes.reason === 'dirty') {
    return { ok: false, reason: 'dirty', files: mergeRes.files || [] };
  }
  if (mergeRes.reason === 'conflict') {
    const conflictMsg = `Çakışan dosyalar: ${(mergeRes.files || []).join(', ')}`;
    br.board.update(taskId, {
      question: conflictMsg,
      status: 'needs_user'
    });
    br.board.addHistory(taskId, 'status', `Birleştirme çakışması: ${conflictMsg}`);
    br.emitChanged(taskId);
    return { ok: false, reason: 'conflict', files: mergeRes.files };
  }
  return { ok: false, reason: 'unknown' };
});
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.quotalala.app');
  store.recoverInterrupted();
  workspace.initialize(process.argv, { packaged: app.isPackaged, cwd: process.cwd() });
  quota.setEnabled('gemini', store.getSettings().geminiEnabled);
  createWindow(); createTray();
  const reminded = new Set();
  reminderTimer = setInterval(() => {
    updateTray();
    for (const agent of Object.values(quota.getState().agents)) {
      if (!agent.enabled || !agent.rateLimitedUntil) continue;
      const remaining = new Date(agent.rateLimitedUntil).getTime() - Date.now();
      const key = `${agent.id}:${agent.rateLimitedUntil}`;
      if (remaining > 0 && remaining < 300000 && !reminded.has(key)) {
        reminded.add(key); notify(language === 'tr' ? 'Kota yenilenmesi yaklaşıyor' : 'Quota renewal approaching', `${agent.name}: < 5 min`);
      }
    }
  }, 60000);
  app.on('activate', () => { if (!mainWindow) createWindow(); else mainWindow.show(); });
});
app.on('before-quit', () => { isQuitting = true; clearInterval(reminderTimer); runner.cancel(); });
app.on('window-all-closed', () => { if (isQuitting) app.quit(); });

}

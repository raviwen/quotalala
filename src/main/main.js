const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, clipboard, dialog } = require('electron');
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
const { WorkspaceManager } = require('./workspace');
const store = new HistoryStore();
const workspace = new WorkspaceManager();
let mainWindow, tray, reminderTimer;
let isQuitting = false;
let language = 'tr';
const iconPath = path.join(__dirname, '../../assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
function emit(channel, payload) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); }
const health = new HealthService({ agents: getAllAgents(), quota, models, emit });
const runner = new SessionRunner({ store, coordinator, emit, publish: () => { health.publish(); updateTray(); } });
function updateTray() { tray?.setToolTip(quota.getTraySummary()); }
function notify(title, body) { if (Notification.isSupported()) new Notification({ title, body, icon: iconPath }).show(); }
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1420, height: 950, minWidth: 1000, minHeight: 700, backgroundColor: '#0b0f19', icon: iconPath,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.on('close', event => { if (!isQuitting) { event.preventDefault(); mainWindow.hide(); } });
  mainWindow.on('closed', () => { mainWindow = null; });
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath)); updateTray();
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
function ensureIdle() { if (runner.busy || health.running) throw new Error('An operation is already running.'); }
function register(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Untrusted IPC sender.');
    return handler(...args);
  });
}
register('state:get', () => health.snapshot());
register('health:run', async id => {
  ensureIdle(); if (id && !['claude', 'codex', 'gemini'].includes(id)) throw new Error('Unknown agent.');
  try { return await health.run(id); } finally { updateTray(); }
});
register('settings:get', () => store.getSettings());
register('settings:save', changes => {
  ensureIdle(); const settings = store.saveSettings(changes);
  quota.setEnabled('gemini', settings.geminiEnabled); health.publish(); updateTray(); return settings;
});
register('models:get', () => models.getModels());
register('models:save', list => { ensureIdle(); return models.saveModels(list); });
register('session:run', data => { ensureIdle(); return runner.run({ ...data, cwd: workspace.requireProject() }); });
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
app.whenReady().then(() => {
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
app.on('before-quit', () => { isQuitting = true; clearInterval(reminderTimer); });
app.on('window-all-closed', () => { if (isQuitting) app.quit(); });

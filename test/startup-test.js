// Production IPC smoke check with local fixtures; never invokes real CLIs.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const root = path.resolve('.test-artifacts', 'startup-' + require('crypto').randomUUID());
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'electron'));
app.setPath('sessionData', path.join(root, 'session'));
process.env.QUOTALALA_DATA_DIR = root;
const { HistoryStore } = require('../src/main/storage');
const store = new HistoryStore(root), fixture = store.create(process.cwd(), 'OK');
store.saveSettings({ notificationsEnabled: false });
fixture.status = 'completed'; fixture.turns = [{ prompt: 'OK', outputs: [], result: { finalResult: 'OK' } }]; store.save(fixture); store.saveMemory(process.cwd(), 'Fixture project memory');
app.on('browser-window-created', (event, win) => { win.hide(); win.webContents.setBackgroundThrottling(false); });
require(path.join(process.env.QUOTALALA_TEST_APP_DIR || path.resolve(__dirname, '..'), 'src/main/main.js'));
async function until(win, expression) {
  for (let i = 0; i < 100; i++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Startup check timed out: ' + expression);
}
app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await until(win, "document.getElementById('geminiToggle') !== null && document.querySelector('.history-open') !== null");
    assert.equal(await win.webContents.executeJavaScript("window.quotalalaAPI !== undefined && !state.healthRunning"), true);
    assert.equal(await win.webContents.executeJavaScript("document.getElementById('cwdInput').type"), 'hidden');
    assert.equal((await win.webContents.executeJavaScript("window.quotalalaAPI.getWorkspace()")).cwd, fs.realpathSync(process.cwd()));
    await win.webContents.executeJavaScript("document.querySelector('.history-open').click()");
    await until(win, "document.getElementById('streamContainer').textContent.includes('OK') && document.getElementById('memoryInput').value.length > 0");
    const info = await win.webContents.executeJavaScript("({turns:viewedTurns.length, memoryLength:document.getElementById('memoryInput').value.length, historyCount:sessions.length, bridgeReady:!!window.quotalalaAPI})");
    console.log('PASS: production startup/IPC, active project, fixture history visible and opens with output + project memory. ' + JSON.stringify(info));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});

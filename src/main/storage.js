const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID, createHash } = require('crypto');
const { sanitize, redact } = require('./privacy');
const { forSession } = require('../shared/activity');
const DATA_DIR = process.env.QUOTALALA_DATA_DIR || path.join(os.homedir(), '.quotalala');
const MEMORY_LIMIT = 2000;

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return fallback; throw error; }
}
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(sanitize(value), null, 2), 'utf8');
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(tmp, file); break; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error.code) || attempt >= 3) throw error;
      // Brief Windows file locks can occur between frequent activity saves.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
    }
  }
}
function projectKey(cwd) {
  const normalized = path.resolve(cwd);
  return createHash('sha256').update(process.platform === 'win32' ? normalized.toLowerCase() : normalized).digest('hex');
}
class HistoryStore {
  constructor(root = DATA_DIR) { this.root = root; }
  getSettings() {
    const saved = readJSON(path.join(this.root, 'settings.json'), {}) || {};
    return { saveHistory: saved.saveHistory !== false, geminiEnabled: saved.geminiEnabled === true && saved.geminiRiskAccepted === true, geminiRiskAccepted: saved.geminiRiskAccepted === true };
  }
  saveSettings(changes) {
    const settings = { ...this.getSettings() };
    if (typeof changes.saveHistory === 'boolean') settings.saveHistory = changes.saveHistory;
    if (typeof changes.geminiEnabled === 'boolean') {
      if (changes.geminiEnabled && changes.geminiRiskAccepted !== true) throw new Error('Gemini risk acceptance is required.');
      settings.geminiEnabled = changes.geminiEnabled;
      settings.geminiRiskAccepted = changes.geminiEnabled;
    }
    writeJSON(path.join(this.root, 'settings.json'), settings);
    return settings;
  }
  sessionPath(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid session ID.');
    return path.join(this.root, 'sessions', `${id}.json`);
  }
  list(cwd = null) {
    const dir = path.join(this.root, 'sessions');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(name => /^[0-9a-f-]{36}\.json$/i.test(name))
      .map(name => readJSON(path.join(dir, name), null))
      .filter(item => item && typeof item.id === 'string' && /^[0-9a-f-]{36}$/i.test(item.id) && typeof item.cwd === 'string' && path.isAbsolute(item.cwd) && typeof item.updatedAt === 'string' && Array.isArray(item.turns))
      .map(({ id, cwd, title, createdAt, updatedAt, agents, status }) => ({ id, cwd, title, createdAt, updatedAt, agents, status }))
      .filter(item => !cwd || projectKey(item.cwd) === projectKey(cwd))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  open(id) {
    const session = readJSON(this.sessionPath(id), null);
    if (!session || session.id !== id || typeof session.cwd !== 'string' || !path.isAbsolute(session.cwd) || !Array.isArray(session.turns)) throw new Error('Session not found or corrupted.');
    return session;
  }
  recentActivities(cwd, limit = 20, excludeSessionId = null) {
    if (limit <= 0) return [];
    const events = [];
    for (const session of this.list().filter(item => item.id !== excludeSessionId && projectKey(item.cwd) === projectKey(cwd)).reverse()) {
      events.push(...forSession(this.open(session.id)));
    }
    // Stable chronological order also preserves event order for identical timestamps.
    return events.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).slice(-Math.min(20, limit));
  }
  create(cwd, prompt) {
    const now = new Date().toISOString();
    return { id: randomUUID(), cwd: path.resolve(cwd), title: redact(prompt).slice(0, 80), createdAt: now, updatedAt: now, status: 'running', agents: [], turns: [], cliSessions: {} };
  }
  save(session) {
    session.updatedAt = new Date().toISOString();
    if (this.getSettings().saveHistory) writeJSON(this.sessionPath(session.id), session);
    return sanitize(session);
  }
  rename(id, title) { const session = this.open(id); session.title = String(title).trim().slice(0, 120); if (!session.title) throw new Error('A title is required.'); writeJSON(this.sessionPath(id), session); return session; }
  delete(id) { fs.unlinkSync(this.sessionPath(id)); }
  clear() {
    // Only delete known JSON records in Quotalala's own directories.
    for (const session of this.list()) this.delete(session.id);
    const dir = path.join(this.root, 'memory');
    if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) if (/^[a-f0-9]{64}\.json$/.test(name)) fs.unlinkSync(path.join(dir, name));
  }
  memory(cwd) {
    const record = readJSON(path.join(this.root, 'memory', `${projectKey(cwd)}.json`), null);
    return { cwd: path.resolve(cwd), summary: typeof record?.summary === 'string' ? redact(record.summary).slice(0, MEMORY_LIMIT) : '', updatedAt: typeof record?.updatedAt === 'string' ? record.updatedAt : null };
  }
  saveMemory(cwd, summary, force = false) {
    const record = { cwd: path.resolve(cwd), summary: redact(summary).slice(0, MEMORY_LIMIT), updatedAt: new Date().toISOString() };
    if (force || this.getSettings().saveHistory) writeJSON(path.join(this.root, 'memory', `${projectKey(cwd)}.json`), record);
    return record;
  }
  resetMemory(cwd) {
    const file = path.join(this.root, 'memory', `${projectKey(cwd)}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { cwd: path.resolve(cwd), summary: '', updatedAt: null };
  }
}
module.exports = { HistoryStore, DATA_DIR, MEMORY_LIMIT, readJSON, writeJSON, projectKey };

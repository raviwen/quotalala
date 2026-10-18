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
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
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
    const { runOptions } = require('./run-options');
    let options;
    try { options = runOptions(saved); } catch { options = runOptions(); }
    return {
      ...options,
      notificationsEnabled: saved.notificationsEnabled !== false,
      saveHistory: saved.saveHistory !== false,
      geminiEnabled: saved.geminiEnabled === true && saved.geminiRiskAccepted === true,
      geminiRiskAccepted: saved.geminiRiskAccepted === true,
      coordinatorModel: saved.coordinatorModel || 'opus',
      autoMerge: saved.autoMerge === true
    };
  }
  saveSettings(changes) {
    const settings = { ...this.getSettings(), ...require('./run-options').runOptions({ ...this.getSettings(), ...changes }) };
    if (typeof changes.saveHistory === 'boolean') settings.saveHistory = changes.saveHistory;
    if (typeof changes.notificationsEnabled === 'boolean') settings.notificationsEnabled = changes.notificationsEnabled;
    if (typeof changes.coordinatorModel === 'string') settings.coordinatorModel = changes.coordinatorModel;
    if (typeof changes.autoMerge === 'boolean') settings.autoMerge = changes.autoMerge;
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
  metadataPath(id) { this.sessionPath(id); return path.join(this.root, 'session-summaries', id + '.json'); }
  recordVersion(id) { const stat = fs.statSync(this.sessionPath(id)); return `${stat.size}:${stat.mtimeMs}`; }
  summary(session) {
    const { id, cwd, title, createdAt, updatedAt, agents, status } = session;
    const { headlines } = require('../shared/activity');
    return { id, cwd, title, createdAt, updatedAt, agents, status, recordVersion: this.recordVersion(id), recentEvents: forSession(session).slice(-20).map(event => ({ timestamp: event.timestamp, title: headlines([event])[0] })) };
  }
  list(cwd = null) {
    const dir = path.join(this.root, 'sessions');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(name => /^[0-9a-f-]{36}\.json$/i.test(name))
      .map(name => {
        const id = name.slice(0, -5), file = this.metadataPath(id);
        let summary = readJSON(file, null);
        // One-time migration: subsequent listings never load full outputs.
        if (!summary || summary.recordVersion !== this.recordVersion(id)) {
          try { summary = this.summary(this.open(id)); writeJSON(file, summary); } catch { return null; }
        }
        return summary;
      })
      .filter(item => item && typeof item.cwd === 'string' && typeof item.updatedAt === 'string' && (!cwd || projectKey(item.cwd) === projectKey(cwd)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  recoverInterrupted() {
    for (const summary of this.list()) if (['running', 'awaiting_approval'].includes(summary.status)) {
      const session = this.open(summary.id); session.status = 'interrupted';
      for (const turn of session.turns) if (['running', 'awaiting_approval'].includes(turn.status)) turn.status = 'interrupted';
      writeJSON(this.sessionPath(session.id), session); writeJSON(this.metadataPath(session.id), this.summary(session));
    }
  }
  open(id) {
    const session = readJSON(this.sessionPath(id), null);
    if (!session || session.id !== id || typeof session.cwd !== 'string' || !path.isAbsolute(session.cwd) || !Array.isArray(session.turns)) throw new Error('Session not found or corrupted.');
    return session;
  }
  recentActivities(cwd, limit = 20, excludeSessionId = null) {
    if (limit <= 0) return [];
    const events = [];
    for (const session of this.list().filter(item => item.id !== excludeSessionId && projectKey(item.cwd) === projectKey(cwd))) {
      events.unshift(...(session.recentEvents || []));
      if (events.length >= limit) break;
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
    if (this.getSettings().saveHistory) { writeJSON(this.sessionPath(session.id), session); writeJSON(this.metadataPath(session.id), this.summary(session)); }
    return sanitize(session);
  }
  rename(id, title) { const session = this.open(id); session.title = String(title).trim().slice(0, 120); if (!session.title) throw new Error('A title is required.'); writeJSON(this.sessionPath(id), session); writeJSON(this.metadataPath(id), this.summary(session)); return session; }
  delete(id) { fs.unlinkSync(this.sessionPath(id)); if (fs.existsSync(this.metadataPath(id))) fs.unlinkSync(this.metadataPath(id)); }
  clear() {
    // Only delete known JSON records in Quotalala's own directories.
    for (const session of this.list()) this.delete(session.id);
    const dir = path.join(this.root, 'memory');
    if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) if (/^[a-f0-9]{64}\.json$/.test(name)) fs.unlinkSync(path.join(dir, name));
  }
  memory(cwd) {
    const record = readJSON(path.join(this.root, 'memory', `${projectKey(cwd)}.json`), null);
    return { resultDigests: Array.isArray(record?.resultDigests) ? record.resultDigests.filter(item => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item)).slice(-256) : [], cwd: path.resolve(cwd), summary: typeof record?.summary === 'string' ? redact(record.summary).slice(0, MEMORY_LIMIT) : '', updatedAt: typeof record?.updatedAt === 'string' ? record.updatedAt : null };
  }
  saveMemory(cwd, summary, force = false, resultDigests = null) {
    const record = { resultDigests: (resultDigests || this.memory(cwd).resultDigests).slice(-256), cwd: path.resolve(cwd), summary: redact(summary).slice(0, MEMORY_LIMIT), updatedAt: new Date().toISOString() };
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

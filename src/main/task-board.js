const path = require('path');
const { randomUUID } = require('crypto');
const { DATA_DIR, projectKey, readJSON, writeJSON } = require('./storage');

const ALLOWED_STATUSES = new Set([
  'queued',
  'planning',
  'running',
  'waiting_quota',
  'needs_user',
  'review',
  'ready_to_merge',
  'merged',
  'failed',
  'cancelled'
]);

const ALLOWED_UPDATE_FIELDS = new Set([
  'title',
  'request',
  'status',
  'agent',
  'level',
  'workerPrompt',
  'cliSessionId',
  'branch',
  'worktreePath',
  'resumeAt',
  'question',
  'result',
  'liveOutput',
  'history'
]);

class TaskBoard {
  constructor(cwd, root = DATA_DIR) {
    if (!cwd) throw new Error('Working directory (cwd) is required for TaskBoard.');
    this.cwd = path.resolve(cwd);
    this.root = root;
    this.key = projectKey(this.cwd);
    this.file = path.join(this.root, 'boards', `${this.key}.json`);
    this._recoverOnStartup();
  }

  _readBoard() {
    return readJSON(this.file, { version: 1, cwd: this.cwd, tasks: [] }) || { version: 1, cwd: this.cwd, tasks: [] };
  }

  _writeBoard(board) {
    writeJSON(this.file, {
      version: 1,
      cwd: this.cwd,
      tasks: board.tasks || []
    });
  }

  _recoverOnStartup() {
    const board = this._readBoard();
    let modified = false;
    const now = new Date().toISOString();

    for (const task of (board.tasks || [])) {
      if (task.status === 'running' || task.status === 'planning') {
        task.status = 'queued';
        task.updatedAt = now;
        task.history = Array.isArray(task.history) ? task.history : [];
        task.history.push({
          at: now,
          type: 'status',
          text: 'Uygulama kapandı, görev yeniden kuyruğa alındı'
        });
        if (task.history.length > 200) {
          task.history = task.history.slice(task.history.length - 200);
        }
        modified = true;
      }
    }

    if (modified) {
      this._writeBoard(board);
    }
  }

  list() {
    const board = this._readBoard();
    return (board.tasks || []).map(t => ({ ...t }));
  }

  get(id) {
    const board = this._readBoard();
    const task = (board.tasks || []).find(t => t.id === id);
    return task ? { ...task } : null;
  }

  add(request) {
    if (!request || typeof request !== 'string') {
      throw new Error('Task request must be a non-empty string.');
    }
    const board = this._readBoard();
    const now = new Date().toISOString();
    const trimmed = request.trim();
    const title = trimmed.split('\n')[0].slice(0, 80) || 'Yeni Görev';

    const newTask = {
      id: randomUUID(),
      title,
      request: trimmed,
      status: 'queued',
      agent: null,
      level: null,
      workerPrompt: null,
      cliSessionId: null,
      branch: null,
      worktreePath: null,
      resumeAt: null,
      question: null,
      result: null,
      liveOutput: '',
      createdAt: now,
      updatedAt: now,
      history: [
        {
          at: now,
          type: 'status',
          text: 'Görev kuyruğa eklendi'
        }
      ]
    };

    board.tasks = board.tasks || [];
    board.tasks.unshift(newTask);
    this._writeBoard(board);
    return { ...newTask };
  }

  update(id, changes = {}) {
    const board = this._readBoard();
    const task = (board.tasks || []).find(t => t.id === id);
    if (!task) {
      throw new Error(`Task ${id} not found.`);
    }

    if (changes.status && !ALLOWED_STATUSES.has(changes.status)) {
      throw new Error(`Invalid status: ${changes.status}`);
    }

    for (const [key, val] of Object.entries(changes)) {
      if (ALLOWED_UPDATE_FIELDS.has(key)) {
        task[key] = val;
      }
    }

    task.updatedAt = new Date().toISOString();
    this._writeBoard(board);
    return { ...task };
  }

  setStatus(id, status, note) {
    if (!ALLOWED_STATUSES.has(status)) {
      throw new Error(`Invalid status: ${status}`);
    }
    const board = this._readBoard();
    const task = (board.tasks || []).find(t => t.id === id);
    if (!task) {
      throw new Error(`Task ${id} not found.`);
    }

    const now = new Date().toISOString();
    task.status = status;
    task.updatedAt = now;

    task.history = Array.isArray(task.history) ? task.history : [];
    task.history.push({
      at: now,
      type: 'status',
      text: note || `Durum: ${status}`
    });

    if (task.history.length > 200) {
      task.history = task.history.slice(task.history.length - 200);
    }

    this._writeBoard(board);
    return { ...task };
  }

  addHistory(id, type, text) {
    const board = this._readBoard();
    const task = (board.tasks || []).find(t => t.id === id);
    if (!task) {
      throw new Error(`Task ${id} not found.`);
    }

    const now = new Date().toISOString();
    task.history = Array.isArray(task.history) ? task.history : [];
    task.history.push({
      at: now,
      type: type || 'note',
      text: String(text || '')
    });

    if (task.history.length > 200) {
      task.history = task.history.slice(task.history.length - 200);
    }

    task.updatedAt = now;
    this._writeBoard(board);
    return { ...task };
  }
}

module.exports = {
  TaskBoard,
  ALLOWED_STATUSES
};

const path = require('path');
const { getAgent } = require('./agents');
const { discover } = require('./capabilities');
const { errorType } = require('./events');
const quota = require('./quota');
const models = require('./models');
const { jsonObject } = require('./team-protocol');
const { isGitRepo, createWorktree, diffSummary, mergeBranch, removeWorktree } = require('./worktree');
const { HistoryStore, DATA_DIR } = require('./storage');
const { TaskBoard } = require('./task-board');
const { redact } = require('./privacy');

const SESSION_NOT_FOUND_REGEX = /session.*(?:not found|does not exist)|no.*session|conversation.*not found/i;

class BoardRunner {
  constructor({ cwd, root = DATA_DIR, board, emit = () => {}, store, timeout = null }) {
    this.cwd = path.resolve(cwd);
    this.root = root;
    this.board = board || new TaskBoard(this.cwd, this.root);
    this.emit = emit;
    this.store = store || new HistoryStore(this.root);
    this.timeout = timeout;
    this.activeTaskControllers = new Map(); // taskId -> AbortController
    this.taskRevisionCounts = new Map(); // taskId -> count
    this._timer = null;
    this._quotaTimer = null;
    this._isProcessing = false;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      this.tick().catch(() => {});
    }, 5000);

    this._quotaTimer = setInterval(() => {
      this.checkWaitingQuotaTasks().catch(() => {});
    }, 60000);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._quotaTimer) {
      clearInterval(this._quotaTimer);
      this._quotaTimer = null;
    }
    for (const [id, ctrl] of this.activeTaskControllers.entries()) {
      try { ctrl.abort(); } catch {}
    }
    this.activeTaskControllers.clear();
  }

  hasActiveTasks() {
    const tasks = this.board.list();
    return tasks.some(t => t.status === 'planning' || t.status === 'running');
  }

  emitChanged(taskId = null) {
    try {
      this.emit('board:changed', { cwd: this.cwd, taskId, tasks: this.board.list() });
    } catch {}
  }

  emitStream(taskId, chunk) {
    try {
      this.emit('board:stream', { cwd: this.cwd, taskId, chunk });
    } catch {}
  }

  async _runAgent(taskId, agent, prompt, options) {
    let output = this.board.get(taskId)?.liveOutput || '', saved = 0;
    const raw = new Map();
    const safe = value => redact(value)
      .replace(/\b(?:sk-(?:proj-|ant-)?|AIza|gh[pousr]_|github_pat_|eyJ)[A-Za-z0-9_.-]*/g, '[REDACTED]')
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*/g, '[REDACTED PRIVATE KEY]');
    const prefix = `${output}\n[${agent.id.toUpperCase()}] ${options.reason || 'Worker'} • ${options.model || 'default'} • ${options.cwd || this.cwd}\n`;
    const publish = () => {
      output = safe(prefix + [...raw.values()].join('')).slice(-20000);
      this.emitStream(taskId, { stream: 'stdout', text: output, replace: true });
      if (Date.now() - saved > 1000) { this.board.update(taskId, { liveOutput: output }); saved = Date.now(); }
    };
    publish();
    try {
      const response = await agent.runPrompt(prompt, {
        ...options,
        timeout: this.timeout ?? this.store.getSettings().timeout ?? 180000,
        onStart: process => {
          raw.set('process', `[process] PID ${process.pid} • ${process.executable}\n`); publish();
        },
        onSession: id => {
          if (options.reason || typeof id !== 'string' || id.length > 200) return;
          if (this.board.get(taskId)?.cliSessionId !== id) this.board.update(taskId, { cliSessionId: id });
        },
        onChunk: chunk => {
          const stream = chunk.stream || 'stdout';
          raw.set(stream, ((raw.get(stream) || '') + (chunk.text || '')).slice(-40000)); publish();
        }
      });
      if (response.stdout) raw.set('final', `\n[result]\n${response.stdout}`);
      if (response.stderr) raw.set('error', `\n[stderr]\n${response.stderr}`);
      publish();
      return response;
    } finally {
      this.board.update(taskId, { liveOutput: output });
    }
  }

  async tick() {
    if (this._isProcessing) return;
    this._isProcessing = true;
    try {
      const git = await isGitRepo(this.cwd);
      const concurrencyLimit = git ? 2 : 1;

      const tasks = this.board.list();
      const activeCount = tasks.filter(t => t.status === 'planning' || t.status === 'running').length;
      const availableSlots = concurrencyLimit - activeCount;

      if (availableSlots <= 0) return;

      const queuedTasks = tasks
        .filter(t => t.status === 'queued')
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      const promises = [];
      for (let i = 0; i < Math.min(availableSlots, queuedTasks.length); i++) {
        const nextTask = queuedTasks[i];
        promises.push(this.runTaskPipeline(nextTask.id).catch(() => {}));
      }
      await Promise.all(promises);
    } finally {
      this._isProcessing = false;
    }
  }

  async runTaskPipeline(taskId) {
    const task = this.board.get(taskId);
    if (!task) return;

    const controller = new AbortController();
    this.activeTaskControllers.set(taskId, controller);

    try {
      if (task.status === 'queued') {
        // If workerPrompt is already set (e.g., resumed or previously planned), go straight to worker
        if (task.workerPrompt && task.agent) {
          await this._executeWorker(taskId, controller.signal);
        } else {
          await this._executeIntake(taskId, controller.signal);
        }
      } else if (task.status === 'running') {
        await this._executeWorker(taskId, controller.signal);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        this.board.setStatus(taskId, 'cancelled', 'Görev iptal edildi');
        this.emitChanged(taskId);
      } else {
        this.board.setStatus(taskId, 'failed', `Beklenmeyen hata: ${err.message}`);
        this.emitChanged(taskId);
      }
    } finally {
      this.activeTaskControllers.delete(taskId);
    }
  }

  async _executeIntake(taskId, signal) {
    this.board.setStatus(taskId, 'planning', 'Claude görevi analiz ediyor');
    this.emitChanged(taskId);

    const task = this.board.get(taskId);
    const claude = getAgent('claude');
    if (!claude) {
      this.board.setStatus(taskId, 'failed', 'Claude ajanı bulunamadı.');
      this.emitChanged(taskId);
      return;
    }

    try {
      await discover(claude, { signal });
    } catch {}

    const memorySummary = this.store.memory(this.cwd).summary || '';
    const otherTasks = this.board.list()
      .filter(t => t.id !== taskId)
      .slice(0, 20)
      .map(t => ({ title: t.title, status: t.status, agent: t.agent }));

    // Gemini stays out of the board unless the user explicitly enabled it (manual risk acceptance).
    const allowedAgents = ['claude', 'codex'];
    if (quota.getAgent('gemini')?.enabled) allowedAgents.push('gemini');
    const agentStatuses = Object.fromEntries(allowedAgents.map(id => {
      const state = quota.getAgent(id);
      return [id, { enabled: state?.enabled, status: state?.status }];
    }));

    const intakePrompt = [
      'Sen Quotalala Görev Panosu baş operatörü Claude\'sun.',
      `Kullanıcının görevini anla, en uygun ajanı (${allowedAgents.map(id => `"${id}"`).join(' veya ')}) ve seviyeyi ("hafif"|"orta"|"güçlü") seç.`,
      'SADECE ve SADECE şu JSON yapısını döndür, başka hiçbir metin veya markdown ekleme:',
      `{"title":"kısa başlık","agent":"${allowedAgents.join('|')}","level":"hafif|orta|güçlü","workerPrompt":"ajana verilecek net talimat","question":null}`,
      'Eğer kullanıcıya soru sormadan işe başlanamıyorsa: question alanına soruyu yaz, agent ve workerPrompt null olabilir.',
      '',
      `KULLANICI İSTEĞİ: ${task.request}`,
      `PROJE HAFIZASI: ${memorySummary}`,
      `DİĞER GÖREVLER: ${JSON.stringify(otherTasks)}`,
      `AJAN DURUMLARI: ${JSON.stringify(agentStatuses)}`
    ].join('\n');

    quota.recordJobStart('claude');
    const coordinatorModel = this.store.getSettings().coordinatorModel || 'opus';
    let res;
    try {
      res = await this._runAgent(taskId, claude, intakePrompt, {
        cwd: this.cwd,
        model: coordinatorModel,
        level: 'hafif',
        noTools: true,
        timeout: this.timeout,
        signal,
        reason: 'Pano görev planlama'
      });
    } catch (err) {
      quota.recordJobError('claude', err.message);
      this.board.setStatus(taskId, 'failed', `Intake çağrısı başarısız: ${err.message}`);
      this.emitChanged(taskId);
      return;
    }

    if (signal.aborted) return;

    if (res.code !== 0) {
      if (errorType(res.stderr + res.stdout) === 'quota') {
        this._handleQuotaError(taskId, 'claude', res.stderr + res.stdout);
        return;
      }
      this.board.setStatus(taskId, 'failed', `Claude hata döndürdü: ${res.stderr || res.stdout}`);
      this.emitChanged(taskId);
      return;
    }

    quota.recordJobSuccess('claude', res.durationMs || 100);

    let planData;
    try {
      planData = jsonObject(res.stdout);
    } catch {
      this.board.setStatus(taskId, 'failed', 'Claude geçersiz JSON formatı döndürdü.');
      this.emitChanged(taskId);
      return;
    }

    if (planData.question && typeof planData.question === 'string' && planData.question.trim()) {
      this.board.update(taskId, {
        title: planData.title || task.title,
        question: planData.question,
        status: 'needs_user'
      });
      this.board.addHistory(taskId, 'status', `Kullanıcıdan cevap bekleniyor: ${planData.question}`);
      this.emitChanged(taskId);
      return;
    }

    const validAgents = allowedAgents;
    const validLevels = ['hafif', 'orta', 'güçlü'];
    if (!validAgents.includes(planData.agent) || !validLevels.includes(planData.level) || !planData.workerPrompt) {
      this.board.setStatus(taskId, 'failed', 'Plan verisinde geçersiz ajan, seviye veya boş workerPrompt.');
      this.emitChanged(taskId);
      return;
    }

    this.board.update(taskId, {
      title: planData.title || task.title,
      agent: planData.agent,
      level: planData.level,
      workerPrompt: planData.workerPrompt
    });

    await this._executeWorker(taskId, signal);
  }

  async _executeWorker(taskId, signal) {
    const task = this.board.get(taskId);
    if (!task || signal.aborted) return;

    const agentId = task.agent;
    const agentState = quota.getAgent(agentId);
    // A quota limit is transient and worth waiting for; a missing CLI, a signed-out
    // account or a hard error will not fix itself by parking the task for 30 minutes.
    if (agentState?.enabled && agentState?.status === 'limited') {
      this._handleQuotaError(taskId, agentId, agentState?.lastError || 'Ajan kotası dolu');
      return;
    }
    if (!agentState?.enabled || ['missing', 'unauthenticated', 'error'].includes(agentState?.status)) {
      const reason = !agentState?.enabled ? 'kapalı'
        : agentState.status === 'missing' ? 'kurulu değil'
          : agentState.status === 'unauthenticated' ? 'giriş yapılmamış' : 'hata durumunda';
      this.board.setStatus(taskId, 'failed', `Ajan kullanılamıyor (${reason}): ${agentState?.lastError || agentId}`);
      this.emitChanged(taskId);
      return;
    }

    const agent = getAgent(agentId);
    if (!agent) {
      this.board.setStatus(taskId, 'failed', `Ajan bulunamadı: ${agentId}`);
      this.emitChanged(taskId);
      return;
    }

    try {
      await discover(agent, { signal });
    } catch {}

    let worktreePath = task.worktreePath;
    let branch = task.branch;

    const git = await isGitRepo(this.cwd);
    if (git && (!worktreePath || !branch)) {
      try {
        const wt = await createWorktree(this.cwd, taskId, this.root);
        branch = wt.branch;
        worktreePath = wt.worktreePath;
        this.board.update(taskId, { branch, worktreePath });
      } catch (err) {
        this.board.setStatus(taskId, 'failed', `Worktree oluşturulamadı: ${err.message}`);
        this.emitChanged(taskId);
        return;
      }
    }

    const execCwd = worktreePath || this.cwd;
    const workerInstruction = `${task.workerPrompt}\n\nSadece bu görevi yap. İş bitince değişikliklerini bu branch'e commit et. Sonunda kısa bir özet yaz: ne yaptın, hangi dosyalar değişti, neyi test edemedin.`;

    this.board.setStatus(taskId, 'running', `${agentId.toUpperCase()} işe başladı`);
    this.emitChanged(taskId);

    quota.recordJobStart(agentId);

    const modelOption = models.getModelByLevel(agentId, task.level);
    const runOpts = {
      model: modelOption?.name,
      thinking: modelOption?.params?.thinking,
      level: modelOption?.level || task.level,
      cwd: execCwd,
      timeout: this.timeout,
      signal,
      resumeId: task.cliSessionId || undefined,
      onChunk: chunk => {
        this.emitStream(taskId, chunk);
      }
    };

    let res;
    try {
      res = await this._runAgent(taskId, agent, workerInstruction, runOpts);
    } catch (err) {
      quota.recordJobError(agentId, err.message);
      this.board.setStatus(taskId, 'failed', `Ajan çalıştırma hatası: ${err.message}`);
      this.emitChanged(taskId);
      return;
    }

    if (signal.aborted) return;

    if (res.sessionId) {
      this.board.update(taskId, { cliSessionId: res.sessionId });
    }

    const output = (res.stdout || '') + '\n' + (res.stderr || '');
    if (SESSION_NOT_FOUND_REGEX.test(output) && task.cliSessionId) {
      this.board.update(taskId, { cliSessionId: null });
      this.board.addHistory(taskId, 'note', 'Önceki oturum bulunamadı. Worktree incelenerek devam edilecek.');
      const fallbackPrompt = `${task.workerPrompt}\n\nÖnceki oturum bulunamadı. Worktree'deki mevcut değişikliklere bak ve kaldığın yerden devam et. İş bitince değişikliklerini bu branch'e commit et. Sonunda kısa bir özet yaz: ne yaptın, hangi dosyalar değişti, neyi test edemedin.`;
      try {
        res = await this._runAgent(taskId, agent, fallbackPrompt, {
          ...runOpts,
          resumeId: undefined
        });
        if (res.sessionId) this.board.update(taskId, { cliSessionId: res.sessionId });
      } catch (err) {
        quota.recordJobError(agentId, err.message);
        this.board.setStatus(taskId, 'failed', `Yeniden çalıştırma hatası: ${err.message}`);
        this.emitChanged(taskId);
        return;
      }
    }

    if (res.code !== 0) {
      if (errorType(res.stderr + res.stdout) === 'quota') {
        this._handleQuotaError(taskId, agentId, res.stderr + res.stdout);
        return;
      }
      this.board.setStatus(taskId, 'failed', `Ajan hata kodu ile bitti: ${res.stderr || res.stdout}`);
      this.emitChanged(taskId);
      return;
    }

    quota.recordJobSuccess(agentId, res.durationMs || 100);

    const summaryText = (res.stdout || '').slice(0, 8000);
    this.board.update(taskId, { result: summaryText });

    await this._executeReview(taskId, signal);
  }

  async _executeReview(taskId, signal) {
    this.board.setStatus(taskId, 'review', 'Claude sonucu kontrol ediyor');
    this.emitChanged(taskId);

    const task = this.board.get(taskId);
    const claude = getAgent('claude');
    if (!claude) {
      this.board.setStatus(taskId, 'failed', 'Review için Claude ajanı bulunamadı.');
      this.emitChanged(taskId);
      return;
    }

    try {
      await discover(claude, { signal });
    } catch {}

    let diff = '';
    if (task.branch) {
      diff = await diffSummary(this.cwd, task.branch);
    }

    const reviewPrompt = [
      'Sen Quotalala Görev Panosu baş operatörü Claude\'sun.',
      'Ajanın tamamladığı işi ve diff çıktısını incele.',
      'SADECE ve SADECE şu JSON yapısını döndür, başka hiçbir metin veya markdown ekleme:',
      '{"decision":"approve|revise|ask_user","message":"..."}',
      '',
      `KULLANICI İSTEĞİ: ${task.request}`,
      `AJAN TALİMATI: ${task.workerPrompt}`,
      `AJAN ÖZETİ: ${(task.result || '').slice(0, 4000)}`,
      `GIT DIFF ÖZETİ: ${diff}`
    ].join('\n');

    quota.recordJobStart('claude');
    const coordinatorModel = this.store.getSettings().coordinatorModel || 'opus';
    let res;
    try {
      res = await this._runAgent(taskId, claude, reviewPrompt, {
        cwd: this.cwd,
        model: coordinatorModel,
        level: 'hafif',
        noTools: true,
        timeout: this.timeout,
        signal,
        reason: 'Pano görev inceleme'
      });
    } catch (err) {
      quota.recordJobError('claude', err.message);
      this.board.setStatus(taskId, 'failed', `Review çağrısı başarısız: ${err.message}`);
      this.emitChanged(taskId);
      return;
    }

    if (signal.aborted) return;

    if (res.code !== 0) {
      if (errorType(res.stderr + res.stdout) === 'quota') {
        this._handleQuotaError(taskId, 'claude', res.stderr + res.stdout);
        return;
      }
      this.board.setStatus(taskId, 'failed', `Claude review hata verdi: ${res.stderr || res.stdout}`);
      this.emitChanged(taskId);
      return;
    }

    quota.recordJobSuccess('claude', res.durationMs || 100);

    let reviewData;
    try {
      reviewData = jsonObject(res.stdout);
    } catch {
      this.board.setStatus(taskId, 'failed', 'Claude review için geçersiz JSON formatı döndürdü.');
      this.emitChanged(taskId);
      return;
    }

    if (reviewData.decision === 'approve') {
      const approveNote = reviewData.message || 'Claude görevi onayladı.';
      const shouldAutoMerge = this.store?.getSettings()?.autoMerge === true;

      if (!task.branch) {
        this.board.setStatus(taskId, 'merged', `${approveNote} (Git branch yok, tamamlandı)`);
        this.emitChanged(taskId);
        return;
      }

      if (!shouldAutoMerge) {
        this.board.setStatus(taskId, 'ready_to_merge', approveNote);
        this.emitChanged(taskId);
        return;
      }

      // Try automatic merge when enabled in settings
      const mergeRes = await mergeBranch(this.cwd, task.branch);
      if (mergeRes.ok) {
        this.board.setStatus(taskId, 'merged', `${approveNote} • Değişiklikler otomatik birleştirildi`);
        if (task.worktreePath) {
          await removeWorktree(this.cwd, task.worktreePath).catch(() => {});
        }
        this.emitChanged(taskId);
      } else if (mergeRes.reason === 'dirty') {
        this.board.setStatus(taskId, 'ready_to_merge', `${approveNote} • Ana klasörde kaydedilmemiş değişiklikler var, manuel birleştirme bekleniyor`);
        this.emitChanged(taskId);
      } else if (mergeRes.reason === 'conflict') {
        const conflictMsg = `Çakışan dosyalar: ${(mergeRes.files || []).join(', ')}`;
        this.board.update(taskId, {
          question: conflictMsg,
          status: 'needs_user'
        });
        this.board.addHistory(taskId, 'status', `Otomatik birleştirme çakışması: ${conflictMsg}`);
        this.emitChanged(taskId);
      } else {
        this.board.setStatus(taskId, 'ready_to_merge', `${approveNote} • Birleştirmeye hazır`);
        this.emitChanged(taskId);
      }
    } else if (reviewData.decision === 'revise') {
      const currentRevisions = this.taskRevisionCounts.get(taskId) || 0;
      if (currentRevisions >= 2) {
        this.board.update(taskId, {
          question: `3. revize isteği geldi. Kontrol etmen gerekiyor: ${reviewData.message}`,
          status: 'needs_user'
        });
        this.board.addHistory(taskId, 'status', 'En fazla 2 revize sınırına ulaşıldı, kullanıcı müdahalesi bekleniyor.');
        this.emitChanged(taskId);
      } else {
        this.taskRevisionCounts.set(taskId, currentRevisions + 1);
        this.board.addHistory(taskId, 'note', `Claude revize istedi (${currentRevisions + 1}/2): ${reviewData.message}`);
        this.board.update(taskId, { workerPrompt: reviewData.message });
        await this._executeWorker(taskId, signal);
      }
    } else if (reviewData.decision === 'ask_user') {
      this.board.update(taskId, {
        question: reviewData.message,
        status: 'needs_user'
      });
      this.board.addHistory(taskId, 'status', `Kullanıcıya soru: ${reviewData.message}`);
      this.emitChanged(taskId);
    } else {
      this.board.setStatus(taskId, 'failed', `Bilinmeyen review kararı: ${reviewData.decision}`);
      this.emitChanged(taskId);
    }
  }

  _handleQuotaError(taskId, agentId, rawError) {
    const agentBefore = quota.getAgent(agentId);
    const existingRateLimitedUntil = agentBefore?.rateLimitedUntil;

    quota.recordJobError(agentId, rawError);

    const now = Date.now();
    let resumeAt = existingRateLimitedUntil;
    if (!resumeAt || new Date(resumeAt).getTime() <= now) {
      resumeAt = new Date(now + 30 * 60 * 1000).toISOString();
    }

    this.board.update(taskId, { resumeAt, status: 'waiting_quota' });
    const timeStr = new Date(resumeAt).toLocaleTimeString();
    this.board.addHistory(taskId, 'status', `Kota doldu, ${timeStr} civarında devam edilecek`);
    this.emitChanged(taskId);
  }

  async checkWaitingQuotaTasks(now = Date.now()) {
    const tasks = this.board.list();
    const waiting = tasks.filter(t => t.status === 'waiting_quota');
    for (const task of waiting) {
      const dueTime = task.resumeAt ? new Date(task.resumeAt).getTime() : 0;
      if (now >= dueTime) {
        // Keep the original workerPrompt: the CLI session resumes with its own
        // context, and the "session not found" fallback already re-sends it.
        this.board.addHistory(task.id, 'note', 'Kota yenilendi; kaldığı yerden devam edecek.');
        if (task.cliSessionId) {
          this.board.setStatus(task.id, 'queued', 'Kota yenilendi, aynı oturumda sıraya alındı');
        } else {
          this.board.setStatus(task.id, 'queued', 'Kota yenilendi, görev sıraya alındı');
        }
        this.emitChanged(task.id);
      }
    }
  }

  async answer(taskId, text) {
    const task = this.board.get(taskId);
    if (!task || task.status !== 'needs_user') {
      throw new Error(`Task ${taskId} is not awaiting user response.`);
    }

    this.board.addHistory(taskId, 'note', `Kullanıcı cevabı: ${text}`);

    if (task.cliSessionId && task.agent) {
      // Appended, never overwritten: the fallback path (session not found) still
      // needs the original instruction and the worktree context.
      this.board.update(taskId, {
        workerPrompt: `${task.workerPrompt || task.request}\n\nKULLANICI CEVABI: ${text}`,
        question: null,
        status: 'queued'
      });
    } else {
      const updatedRequest = `${task.request}\n\n[Kullanıcı Cevabı]: ${text}`;
      this.board.update(taskId, {
        request: updatedRequest,
        question: null,
        status: 'queued'
      });
    }
    this.emitChanged(taskId);
    await this.tick();
  }

  cancel(taskId) {
    const ctrl = this.activeTaskControllers.get(taskId);
    if (ctrl) {
      ctrl.abort();
      this.activeTaskControllers.delete(taskId);
    }
    this.board.setStatus(taskId, 'cancelled', 'Görev iptal edildi');
    this.emitChanged(taskId);
  }

  retry(taskId) {
    const task = this.board.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);
    this.board.setStatus(taskId, 'queued', 'Görev tekrar sıraya alındı');
    this.emitChanged(taskId);
    this.tick().catch(() => {});
  }
}

module.exports = {
  BoardRunner,
  SESSION_NOT_FOUND_REGEX
};

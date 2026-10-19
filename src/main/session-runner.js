const { runOptions, checkCancelled, cancelled } = require('./run-options');
const evidence = require('./evidence');
const fs = require('fs');
const path = require('path');
const { randomUUID, createHash } = require('crypto');
const { failure, logEntry, activityEntry } = require('./events');
const { sanitize } = require('./privacy');
const { forSession, headlines } = require('../shared/activity');
const { projectKey } = require('./storage');
class SessionRunner {
  constructor({ store, coordinator, emit, publish }) { Object.assign(this, { store, coordinator, emit, publish }); this.busy = false; }
  cancel() { if (!this.busy) return false; this.controller?.abort(); this.pendingPlan?.reject(cancelled()); this.pendingPlan = null; return true; }
  approvePlan({ runId, plan }) {
    if (!this.pendingPlan || this.pendingPlan.runId !== runId) throw new Error('No matching pending plan.');
    const validated = this.coordinator.validatePlan(plan);
    if (this.pendingPlan.allowedIds && (validated.subtasks.some(task => !this.pendingPlan.allowedIds.includes(task.id)) || new Set(validated.subtasks.map(task => task.id)).size !== validated.subtasks.length)) throw new Error('Unknown or duplicate task in approval.');
    this.pendingPlan.resolve(validated); this.pendingPlan = null; return true;
  }
  async run({ prompt, cwd, sessionId, options: inputOptions, resume = false }) {
    if (this.busy) throw new Error('A session is already running.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000) throw new Error('Invalid prompt.');
    cwd = path.resolve(cwd || process.cwd());
    if (!fs.statSync(cwd).isDirectory()) throw new Error('Working directory not found.');
    const options = runOptions(inputOptions || this.store.getSettings());
    const session = sessionId ? this.store.open(sessionId) : this.store.create(cwd, prompt);
    if (projectKey(session.cwd) !== projectKey(cwd)) throw new Error('Session belongs to another project.');
    const resumeEvents = sessionId ? forSession(session).slice(-20) : [];
    const recentEvents = this.store.recentActivities(cwd, 20 - resumeEvents.length, sessionId);
    const memoryRecord = this.store.memory(cwd), memory = memoryRecord.summary;
    const settings = this.store.getSettings();
    session.cliSessions ||= {};
    session.agents ||= [];
    const previous = resume ? session.turns.at(-1) : null;
    if (previous?.options) Object.assign(options, runOptions(previous.options));
    this.busy = true; this.controller = new AbortController();
    const turn = { id: randomUUID(), prompt, startedAt: new Date().toISOString(), status: 'running', options, logs: [], outputs: [], activities: [], stream: [] };
    session.turns.push(turn); session.status = 'running';
    let persistenceError = null;
    const persist = () => {
      try { return this.store.save(session); }
      catch (error) { persistenceError = error; throw error; }
    };
    // Batch frequent activity/output/team-state writes into ~250ms windows;
    // critical transitions (plan approval, turn end) still save immediately.
    const runSave = () => { try { persist(); } catch {} };
    let pendingSave = null;
    const scheduleSave = () => { if (pendingSave) return; pendingSave = setTimeout(() => { pendingSave = null; runSave(); }, 250); };
    const flushSave = () => { clearTimeout(pendingSave); pendingSave = null; runSave(); };
    let lastStreamSave = 0, streamTimer;
    const pendingChunks = new Map(), streamIndexes = new Map();
    const sendChunk = chunk => {
      const safe = sanitize(chunk);
      // Also mask recognizable incomplete values while a key is arriving in pieces.
      safe.text = safe.text.replace(/\b(?:sk-(?:proj-|ant-)?|AIza|gh[pousr]_|github_pat_|eyJ)[A-Za-z0-9_.-]*/g, '[REDACTED]')
        .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*/g, '[REDACTED PRIVATE KEY]');
      const key = chunk.streamId + ':' + chunk.stream;
      if (streamIndexes.has(key)) turn.stream[streamIndexes.get(key)] = safe;
      else { streamIndexes.set(key, turn.stream.length); turn.stream.push(safe); }
      this.emit('session:stream', { sessionId: session.id, turnId: turn.id, ...safe });
      if (Date.now() - lastStreamSave > 1000) { try { persist(); } catch { this.controller.abort(); } lastStreamSave = Date.now(); }
    };
    const publishStream = () => { streamTimer = null; for (const chunk of pendingChunks.values()) sendChunk(chunk); };
    const flushStream = () => { clearTimeout(streamTimer); publishStream(); pendingChunks.clear(); };
    const waitForApproval = async (plan, allowedIds = null) => {
      checkCancelled({ signal: this.controller.signal });
      turn.status = 'awaiting_approval'; turn.pendingPlan = plan; persist();
      const approved = await new Promise((resolve, reject) => {
        const runId = randomUUID();
        this.pendingPlan = { runId, resolve, reject, allowedIds };
        this.emit('session:approval', { runId, sessionId: session.id, turnId: turn.id, plan: sanitize(plan) });
      });
      checkCancelled({ signal: this.controller.signal });
      turn.status = 'running'; turn.pendingPlan = null; persist(); return approved;
    };
    const context = {
      options, approvedPlan: previous?.planApproved === true, signal: this.controller.signal, cancel: () => this.cancel(),
      previousOutputs: previous?.plan ? previous.plan.workflow === 'managed-v1' ? previous.outputs || [] : (previous.outputs || []).filter(o => o.success) : [],
      previousTeamState: previous?.teamState,
      onTeamState: value => { turn.teamState = value; scheduleSave(); },
      onPlanChanged: plan => { turn.plan = plan; this.emit('session:plan', { sessionId: session.id, plan: sanitize(plan) }); },
      reviewBatch: options.previewPlan ? plan => waitForApproval(plan, plan.subtasks.map(task => task.id)) : undefined,
      flushStream,
      onChunk: chunk => {
        const key = chunk.streamId + ':' + chunk.stream;
        const pending = pendingChunks.get(key) || { ...chunk, snapshot: true, text: '' }; pending.text += chunk.text;
        pendingChunks.set(key, pending);
        if (!streamTimer) streamTimer = setTimeout(publishStream, 50);
      },
      cwd, prompt, memory, recentActivity: sanitize(headlines(recentEvents)), resumeTimeline: sanitize(headlines(resumeEvents)),
      cliSessions: settings.saveHistory ? session.cliSessions : {},
      publish: this.publish,
      activity: value => {
        const activity = activityEntry({ ...value, turnId: turn.id });
        turn.activities.push(activity);
        for (const id of [activity.agent, activity.fromAgent, activity.toAgent]) if (id && !session.agents.includes(id)) session.agents.push(id);
        scheduleSave();
        this.emit('session:activity', { sessionId: session.id, turnId: turn.id, activity });
        return activity;
      },
      log: value => {
        const entry = logEntry(value); turn.logs.push(entry);
        if (entry.agent && !session.agents.includes(entry.agent)) session.agents.push(entry.agent);
        this.emit('stream:log', { ...entry, sessionId: session.id });
      },
      onOutput: output => { const old = turn.outputs.findIndex(o => o.step === output.step); if (old >= 0) turn.outputs.splice(old, 1); turn.outputs.push(output); scheduleSave(); this.emit('session:output', { sessionId: session.id, output: sanitize(output) }); }
    };
    try {
      persist();
      context.log({ text: 'Oturum başladı.' });
      context.activity({ type: 'session_started', input: prompt });
      const before = await evidence.snapshot(cwd);
      context.evidenceBefore = before;
      checkCancelled(context);
      if (previous?.plan) {
        turn.plan = structuredClone(previous.plan); turn.planApproved = previous.planApproved === true;
        turn.outputs = structuredClone(context.previousOutputs);
      } else if (options.mode === 'economic') {
        turn.plan = this.coordinator.validatePlan({ summary: 'Direct task', subtasks: [{ title: prompt.slice(0, 100), prompt, agent: options.agent, level: options.level, rationale: 'Direct selection' }] });
      } else turn.plan = await this.coordinator.planSubtasks(prompt, context);
      checkCancelled(context);
      context.activity({ type: options.mode === 'economic' ? 'direct_task_selected' : 'plan_created', agent: options.mode === 'economic' ? options.agent : 'claude', count: turn.plan.subtasks.length, model: options.mode === 'economic' ? turn.plan.subtasks[0].model || null : turn.plan.coordinator?.model || null, level: options.mode === 'economic' ? options.level : turn.plan.coordinator?.level || 'hafif', input: prompt, output: JSON.stringify(turn.plan, null, 2) });
      persist(); this.emit('session:plan', { sessionId: session.id, plan: sanitize(turn.plan) });
      if (options.previewPlan && !turn.planApproved && options.mode !== 'economic') {
        turn.plan = await waitForApproval(turn.plan);
        context.approvedPlan = true; turn.planApproved = true; persist();
        this.emit('session:plan', { sessionId: session.id, plan: sanitize(turn.plan) });
      }
      turn.result = await this.coordinator.executePlan(turn.plan, context);
      checkCancelled(context);
      turn.status = turn.result.status || (turn.result.success === false ? 'partial' : 'completed');
    } catch (error) {
      turn.status = error.cancelled || context.signal.aborted ? 'cancelled' : 'failed'; turn.error = error.message;
      if (!turn.plan && !persistenceError && turn.status !== 'cancelled') context.activity({ type: 'planning_failed', agent: error.agent || 'claude', input: prompt, output: error.message });
      if (!error.logged && turn.status !== 'cancelled') context.log(failure(error.agent || 'claude', error.message));
    } finally {
      flushStream();
      flushSave();
      turn.evidence = evidence.compare(context.evidenceBefore, await evidence.snapshot(cwd));
      const resultDigests = [...new Set(turn.outputs.filter(o => o.success && o.output?.trim()).map(o => createHash('sha256').update(sanitize(o.output).trim()).digest('hex')))];
      const hasNewInformation = resultDigests.some(digest => !memoryRecord.resultDigests.includes(digest));
      try {
        if (hasNewInformation && !context.signal.aborted && options.mode !== 'economic' && ['completed', 'partial'].includes(turn.status) && turn.outputs.some(o => o.success && o.output?.trim() && !session.turns.slice(0, -1).some(old => old.outputs?.some(prior => prior.success && prior.output === o.output))) && !persistenceError && this.store.getSettings().saveHistory) {
          const summary = await this.coordinator.updateMemory(context, turn);
          if (!summary.trim()) throw new Error('Memory update returned no summary.');
          checkCancelled(context);
          this.store.saveMemory(cwd, summary, false, [...memoryRecord.resultDigests, ...resultDigests]);
          context.log({ level: 'success', agent: 'claude', text: 'Proje hafızası güncellendi.' });
        }
      } catch (error) {
        turn.memoryError = error.message;
        context.log({ level: 'warning', agent: 'claude', text: 'Proje hafızası güncellenemedi; önceki özet korundu.', raw: error.message });
      }
      if (context.signal.aborted) turn.status = 'cancelled';
      turn.finishedAt = new Date().toISOString(); session.status = turn.status;
      try {
        if (!persistenceError) { context.activity({ type: 'session_finished', status: turn.status, output: turn.result?.finalResult || turn.error || '' }); persist(); }
      } finally { this.pendingPlan = null; this.controller = null; this.busy = false; this.publish?.(); }
    }
    if (persistenceError) throw new Error(`Local history could not be saved: ${persistenceError.message}`);
    return { session: sanitize(session), memory: this.store.memory(cwd), saved: this.store.getSettings().saveHistory };
  }
}
module.exports = { SessionRunner };

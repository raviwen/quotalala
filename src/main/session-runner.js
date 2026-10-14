const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { failure, logEntry, activityEntry } = require('./events');
const { sanitize } = require('./privacy');
const { forSession, headlines } = require('../shared/activity');
const { projectKey } = require('./storage');
class SessionRunner {
  constructor({ store, coordinator, emit, publish }) { Object.assign(this, { store, coordinator, emit, publish }); this.busy = false; }
  async run({ prompt, cwd, sessionId }) {
    if (this.busy) throw new Error('A session is already running.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000) throw new Error('Invalid prompt.');
    cwd = path.resolve(cwd || process.cwd());
    if (!fs.statSync(cwd).isDirectory()) throw new Error('Working directory not found.');
    const session = sessionId ? this.store.open(sessionId) : this.store.create(cwd, prompt);
    if (projectKey(session.cwd) !== projectKey(cwd)) throw new Error('Session belongs to another project.');
    const resumeEvents = sessionId ? forSession(session).slice(-20) : [];
    const recentEvents = this.store.recentActivities(cwd, 20 - resumeEvents.length, sessionId);
    const memory = this.store.memory(cwd).summary;
    const settings = this.store.getSettings();
    session.cliSessions ||= {};
    session.agents ||= [];
    this.busy = true;
    const turn = { id: randomUUID(), prompt, startedAt: new Date().toISOString(), status: 'running', logs: [], outputs: [], activities: [] };
    session.turns.push(turn); session.status = 'running';
    let persistenceError = null;
    const persist = () => {
      try { return this.store.save(session); }
      catch (error) { persistenceError = error; throw error; }
    };
    const context = {
      cwd, prompt, memory, recentActivity: sanitize(headlines(recentEvents)), resumeTimeline: sanitize(headlines(resumeEvents)),
      cliSessions: settings.saveHistory ? session.cliSessions : {},
      publish: this.publish,
      activity: value => {
        const activity = activityEntry({ ...value, turnId: turn.id });
        turn.activities.push(activity);
        for (const id of [activity.agent, activity.fromAgent, activity.toAgent]) if (id && !session.agents.includes(id)) session.agents.push(id);
        persist();
        this.emit('session:activity', { sessionId: session.id, turnId: turn.id, activity });
        return activity;
      },
      log: value => {
        const entry = logEntry(value); turn.logs.push(entry);
        if (entry.agent && !session.agents.includes(entry.agent)) session.agents.push(entry.agent);
        this.emit('stream:log', { ...entry, sessionId: session.id });
      },
      onOutput: output => { turn.outputs.push(output); persist(); this.emit('session:output', { sessionId: session.id, output: sanitize(output) }); }
    };
    try {
      persist();
      context.log({ text: 'Oturum başladı.' });
      context.activity({ type: 'session_started', input: prompt });
      turn.plan = await this.coordinator.planSubtasks(prompt, context);
      context.activity({ type: 'plan_created', agent: 'claude', count: turn.plan.subtasks.length, model: turn.plan.coordinator?.model || null, level: turn.plan.coordinator?.level || 'hafif', input: prompt, output: JSON.stringify(turn.plan, null, 2) });
      persist(); this.emit('session:plan', { sessionId: session.id, plan: sanitize(turn.plan) });
      turn.result = await this.coordinator.executePlan(turn.plan, context);
      turn.status = turn.result.status || (turn.result.success === false ? 'partial' : 'completed');
    } catch (error) {
      turn.status = 'failed'; turn.error = error.message;
      if (!turn.plan && !persistenceError) context.activity({ type: 'planning_failed', agent: error.agent || 'claude', input: prompt, output: error.message });
      if (!error.logged) context.log(failure(error.agent || 'claude', error.message));
    } finally {
      try {
        if (!persistenceError && this.store.getSettings().saveHistory) {
          const summary = await this.coordinator.updateMemory(context, turn);
          if (!summary.trim()) throw new Error('Memory update returned no summary.');
          this.store.saveMemory(cwd, summary);
          context.log({ level: 'success', agent: 'claude', text: 'Proje hafızası güncellendi.' });
        }
      } catch (error) {
        turn.memoryError = error.message;
        context.log({ level: 'warning', agent: 'claude', text: 'Proje hafızası güncellenemedi; önceki özet korundu.', raw: error.message });
      }
      turn.finishedAt = new Date().toISOString(); session.status = turn.status;
      try {
        if (!persistenceError) { context.activity({ type: 'session_finished', status: turn.status, output: turn.result?.finalResult || turn.error || '' }); persist(); }
      } finally { this.busy = false; this.publish?.(); }
    }
    if (persistenceError) throw new Error(`Local history could not be saved: ${persistenceError.message}`);
    return { session: sanitize(session), memory: this.store.memory(cwd), saved: this.store.getSettings().saveHistory };
  }
}
module.exports = { SessionRunner };

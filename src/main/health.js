const { failure, logEntry } = require('./events');
const { discover } = require('./capabilities');
class HealthService {
  constructor({ agents, quota, models, emit }) {
    Object.assign(this, { agents, quota, models, emit });
    this.running = false;
  }
  snapshot() { return { ...this.quota.getState(), healthRunning: this.running }; }
  publish() { const state = this.snapshot(); this.emit('state:update', state); return state; }
  async test(agent) {
    if (!this.quota.getAgent(agent.id)?.enabled) return;
    this.quota.setAgentStatus(agent.id, 'testing'); this.publish();
    let result;
    try {
      if (agent.id === 'gemini') await discover(agent);
      const model = this.models.getModelByLevel(agent.id, 'hafif');
      result = await agent.runHealthTest(() => {}, { model: model?.name, thinking: model?.params?.thinking });
    } catch (error) {
      result = { id: agent.id, healthy: false, status: 'error', message: error.message, rawStderr: error.message, timestamp: new Date().toISOString() };
    }
    const raw = [result.rawStdout, result.rawStderr].filter(Boolean).join('\n') || result.message || '';
    const entry = result.healthy ? logEntry({ agent: agent.id, level: 'success', text: result.message }) : failure(agent.id, raw, result.message);
    const status = result.healthy ? 'idle' : ({ auth: 'unauthenticated', quota: 'limited', not_found: 'missing', other: 'error' }[entry.errorType]);
    this.quota.setAgentStatus(agent.id, status, {
      error: result.healthy ? null : raw, health: result,
      ...(result.healthy ? { rateLimitedUntil: null } : entry.errorType === 'quota' && this.quota.extractRenewalTime ? { rateLimitedUntil: this.quota.extractRenewalTime(raw).toISOString() } : {})
    });
    // Both views receive the very same committed state and result.
    this.emit('stream:log', { ...entry, state: this.snapshot() });
    if (result.modelFallback) this.emit('stream:log', logEntry({ level: 'warning', agent: agent.id, text: 'Test modeli kullanılamadı; CLI varsayılanıyla test edildi.' }));
    this.publish();
    return result;
  }
  async run(id) {
    if (this.running) throw new Error('Health check already running.');
    this.running = true; this.publish();
    try {
      for (const agent of this.agents.filter(a => !id || a.id === id)) await this.test(agent);
    } finally { this.running = false; this.publish(); }
    return this.snapshot();
  }
}
module.exports = { HealthService };

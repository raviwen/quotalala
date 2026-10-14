const fs = require('fs');
const path = require('path');
const os = require('os');
const { sanitize } = require('./privacy');
const { errorType } = require('./events');

const DATA_DIR = process.env.QUOTALALA_DATA_DIR || path.join(os.homedir(), '.quotalala');
const STORE_PATH = path.join(DATA_DIR, 'quota-state.json');

const INITIAL_STATE = {
  agents: {
    claude: {
      id: 'claude',
      name: 'Claude Code',
      provider: 'Anthropic',
      role: 'Koordinatör & Planlayıcı',
      enabled: true,
      status: 'idle', // 'idle' | 'running' | 'limited' | 'unauthenticated' | 'missing'
      jobsCompleted: 0,
      lastUsed: null,
      lastError: null,
      rateLimitedUntil: null,
      totalDurationMs: 0
    },
    codex: {
      id: 'codex',
      name: 'ChatGPT / Codex',
      provider: 'OpenAI',
      role: 'Kodlama ve Görev Yürütme',
      enabled: true,
      status: 'idle',
      jobsCompleted: 0,
      lastUsed: null,
      lastError: null,
      rateLimitedUntil: null,
      totalDurationMs: 0
    },
    gemini: {
      id: 'gemini',
      name: 'Google Gemini',
      provider: 'Google',
      role: 'Hızlı Yanıt & Araştırma',
      command: 'agy',
      enabled: false,
      warning: "Google, Antigravity CLI'ın otomatik kullanımına karşı bazı hesapları kısıtladığı rapor edildi. Bu ajanı açarak Google hesabınla ilgili riski kabul etmiş olursun.",
      status: 'idle',
      jobsCompleted: 0,
      lastUsed: null,
      lastError: null,
      rateLimitedUntil: null,
      totalDurationMs: 0
    }
  },
  history: []
};

class QuotaManager {
  constructor() {
    this.ensureDirectory();
    this.loadState();
  }

  ensureDirectory() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch (e) {
      console.error('Data directory creation error:', e.message);
    }
  }

  loadState() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        this.state = {
          agents: Object.fromEntries(Object.entries(INITIAL_STATE.agents).map(([id, initial]) => [id, { ...initial, ...parsed.agents?.[id], enabled: id !== 'gemini' }])),
          history: Array.isArray(parsed.history) ? parsed.history : []
        };
        for (const agent of Object.values(this.state.agents)) {
          if (['running', 'testing'].includes(agent.status)) agent.status = 'idle';
        }
        return;
      }
    } catch (e) {
      console.warn('Quota store loading error, resetting to initial state:', e.message);
    }
    this.state = JSON.parse(JSON.stringify(INITIAL_STATE));
    this.saveState();
  }

  saveState() {
    try {
      this.ensureDirectory();
      fs.writeFileSync(STORE_PATH, JSON.stringify(sanitize(this.state), null, 2), 'utf8');
    } catch (e) {
      console.error('Quota store save error:', e.message);
    }
  }

  getState() {
    const now = Date.now();
    for (const key of Object.keys(this.state.agents)) {
      const agent = this.state.agents[key];
      if (agent.rateLimitedUntil) {
        const limitTime = new Date(agent.rateLimitedUntil).getTime();
        if (now >= limitTime) {
          agent.status = 'idle';
          agent.rateLimitedUntil = null;
        }
      }
    }
    return this.state;
  }

  getAgent(agentId) {
    const key = agentId.toLowerCase();
    return this.state.agents[key];
  }

  setAgentStatus(agentId, status, details = {}) {
    const key = agentId.toLowerCase();
    if (!this.state.agents[key]) return;

    this.state.agents[key].status = status;
    if (details.error !== undefined) this.state.agents[key].lastError = details.error;
    if (details.rateLimitedUntil !== undefined) this.state.agents[key].rateLimitedUntil = details.rateLimitedUntil;
    if (details.health !== undefined) this.state.agents[key].health = sanitize(details.health);
    this.saveState();
  }

  setEnabled(agentId, enabled) {
    if (this.state.agents[agentId]) this.state.agents[agentId].enabled = enabled;
    this.saveState();
  }

  recordJobStart(agentId) {
    const key = agentId.toLowerCase();
    if (!this.state.agents[key]) return;
    this.state.agents[key].status = 'running';
    this.state.agents[key].lastUsed = new Date().toISOString();
    this.saveState();
  }

  recordJobSuccess(agentId, durationMs = 0) {
    const key = agentId.toLowerCase();
    if (!this.state.agents[key]) return;

    const agent = this.state.agents[key];
    agent.status = 'idle';
    agent.jobsCompleted = (agent.jobsCompleted || 0) + 1;
    agent.lastUsed = new Date().toISOString();
    agent.lastError = null;
    agent.totalDurationMs = (agent.totalDurationMs || 0) + durationMs;

    this.state.history.unshift({
      timestamp: new Date().toISOString(),
      agent: key,
      status: 'success',
      durationMs
    });
    if (this.state.history.length > 50) {
      this.state.history = this.state.history.slice(0, 50);
    }
    this.saveState();
  }

  recordJobError(agentId, errorMessage, durationMs = 0) {
    const key = agentId.toLowerCase();
    if (!this.state.agents[key]) return;

    const agent = this.state.agents[key];
    const isRateLimit = this.checkRateLimitError(errorMessage);

    agent.lastError = errorMessage;
    agent.lastUsed = new Date().toISOString();

    if (isRateLimit) {
      agent.status = 'limited';
      const renewalDate = this.extractRenewalTime(errorMessage);
      agent.rateLimitedUntil = renewalDate.toISOString();
    } else {
      agent.status = { auth: 'unauthenticated', not_found: 'missing', other: 'error' }[errorType(errorMessage)] || 'error';
    }

    this.state.history.unshift({
      timestamp: new Date().toISOString(),
      agent: key,
      status: isRateLimit ? 'rate_limited' : 'error',
      error: sanitize(errorMessage).slice(0, 200),
      durationMs
    });
    if (this.state.history.length > 50) {
      this.state.history = this.state.history.slice(0, 50);
    }
    this.saveState();
  }

  recordJobIncomplete(agentId, status, message, durationMs = 0) {
    const agent = this.getAgent(agentId);
    if (!agent) return;
    agent.status = 'idle';
    agent.lastError = sanitize(message);
    agent.lastUsed = new Date().toISOString();
    agent.totalDurationMs = (agent.totalDurationMs || 0) + durationMs;
    this.state.history.unshift({ timestamp: agent.lastUsed, agent: agentId, status, error: sanitize(message).slice(0, 200), durationMs });
    this.state.history = this.state.history.slice(0, 50);
    this.saveState();
  }

  checkRateLimitError(msg) {
    if (!msg) return false;
    const lower = msg.toLowerCase();
    return (
      lower.includes('rate limit') ||
      lower.includes('quota') ||
      lower.includes('usage limit') ||
      lower.includes('too many requests') ||
      lower.includes('429') ||
      lower.includes('exhausted') ||
      lower.includes('capacity') ||
      lower.includes('overloaded')
    );
  }

  extractRenewalTime(msg) {
    let minutes = 15;
    const regex = /(\d+)\s*(minute|min|hour|hr|second|sec)/i;
    const match = msg.match(regex);
    if (match) {
      const val = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();
      if (unit.startsWith('h')) minutes = val * 60;
      else if (unit.startsWith('s')) minutes = Math.max(1, Math.round(val / 60));
      else minutes = val;
    }
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  getTraySummary() {
    const s = this.getState();
    const c = s.agents.claude;
    const x = s.agents.codex;
    const g = s.agents.gemini;

    const statusText = (a) => {
      if (!a.enabled) return 'Kapalı';
      if (!a.health && a.status === 'idle') return 'Test edilmedi';
      if (a.status === 'error' || a.status === 'missing') return 'Hata';
      if (a.status === 'limited') return 'Dolu/Limitli';
      if (a.status === 'unauthenticated') return 'Giriş Yok';
      if (a.status === 'running') return 'Çalışıyor';
      return 'Hazır';
    };

    return `Quotalala AI Durumu:\n• Claude: ${statusText(c)} (${c.jobsCompleted} iş)\n• Codex: ${statusText(x)} (${x.jobsCompleted} iş)\n• Gemini: ${statusText(g)} (${g.jobsCompleted} iş)`;
  }
}

module.exports = new QuotaManager();

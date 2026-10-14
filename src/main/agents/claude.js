const BaseAgent = require('./base-agent');

class ClaudeAgent extends BaseAgent {
  constructor() {
    super({
      id: 'claude',
      name: 'Claude Code',
      provider: 'Anthropic',
      role: 'Koordinatör & Planlayıcı',
      command: 'claude'
    });
  }

  getRunArgs(prompt, options = {}) {
    const args = ['-p', '--output-format', options.healthTest ? 'text' : 'json'];
    if (options.model) args.push('--model', options.model);
    if (options.thinking) args.push('--effort', options.thinking);
    if (options.resumeId && this.capabilities?.resume) args.push('--resume', options.resumeId);
    if (options.noTools && this.capabilities?.noTools) args.push('--tools', '');
    return args;
  }

  async runPrompt(prompt, options = {}) {
    const res = await super.runPrompt(prompt, options);
    if (!options.healthTest && res.code === 0) {
      try {
        const data = JSON.parse(res.stdout);
        res.stdout = data.result || '';
        res.sessionId = data.session_id;
        if (data.is_error) { res.code = 1; res.stderr = res.stdout; }
      } catch { res.code = 1; res.stderr = 'Invalid Claude JSON response: ' + res.stdout; }
    }
    return res;
  }

  async checkAuth() {
    try {
      const res = await this.execute(['auth', 'status'], '', { timeout: 10000 });
      const parsed = JSON.parse(res.stdout.trim());
      return {
        loggedIn: !!parsed.loggedIn,
        subscription: parsed.subscriptionType || 'Pro',
        email: parsed.email || null,
        details: parsed.subscriptionType ? `${parsed.subscriptionType.toUpperCase()} Abonelik` : 'Giriş Yapıldı'
      };
    } catch {
      return { loggedIn: false };
    }
  }
}

module.exports = new ClaudeAgent();

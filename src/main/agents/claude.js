const BaseAgent = require('./base-agent');
const { createClaudeStream } = require('../claude-stream');

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
    const args = ['-p', '--output-format', options.healthTest ? 'text' : 'stream-json'];
    if (!options.healthTest) args.push('--verbose', '--include-partial-messages');
    if (options.model) args.push('--model', options.model);
    if (options.thinking) args.push('--effort', options.thinking);
    if (options.resumeId && this.capabilities?.resume) args.push('--resume', options.resumeId);
    if (options.noTools && this.capabilities?.noTools) args.push('--tools', '');
    return args;
  }

  async runPrompt(prompt, options = {}) {
    if (options.healthTest) return super.runPrompt(prompt, options);
    const stream = createClaudeStream(options);
    let received = false;
    const res = await super.runPrompt(prompt, { ...options, onChunk: chunk => { received = true; stream.push(chunk); } });
    // Also support execute implementations that return buffered output only.
    if (!received && res.stdout) stream.push({ stream: 'stdout', text: res.stdout });
    return stream.finish(res);
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

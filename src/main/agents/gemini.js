const BaseAgent = require('./base-agent');

class GeminiAgent extends BaseAgent {
  constructor() {
    super({
      id: 'gemini',
      name: 'Google Gemini',
      provider: 'Google',
      role: 'Hızlı Yanıt & Araştırma',
      command: 'agy',
      enabled: false,
      warning: "Google, Antigravity CLI'ın otomatik kullanımına karşı bazı hesapları kısıtladığı rapor edildi. Bu ajanı açarak Google hesabınla ilgili riski kabul etmiş olursun."
    });
  }

  getRunArgs(prompt = 'Sadece tek kelime OK yaz', options = {}) {
    if (typeof prompt === 'object' && prompt !== null) {
      options = prompt;
      prompt = 'Sadece tek kelime OK yaz';
    }
    // No prompt argument and no unverified stdin/resume flags.
    if (this.capabilities && !this.capabilities.available) throw new Error(this.capabilities.error || 'agy CLI not found.');
    if (!this.capabilities?.stdin) throw new Error('agy stdin support could not be verified from --help.');
    const args = this.capabilities.print ? ['-p'] : [];
    if (options && options.model) {
      if (!this.capabilities.model) throw new Error('Model not supported by agy --help.');
      args.push('--model', options.model);
    }
    if (options && options.thinking && this.capabilities.effort) {
      args.push('--effort', options.thinking);
    }
    return args;
  }

  async checkAuth() {
    // Antigravity CLI does not have a separate auth status command.
    // Auth status is validated by executing headless prompts.
    return { loggedIn: false };
  }
}

module.exports = new GeminiAgent();

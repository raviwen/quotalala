const { runWithStdin } = require('../cli-locator');

class BaseAgent {
  constructor(options) {
    this.id = options.id;
    this.name = options.name;
    this.provider = options.provider;
    this.role = options.role;
    this.command = options.command;
  }

  getRunArgs() {
    throw new Error('getRunArgs must be implemented by subclass');
  }

  async getVersion() {
    const res = await this.execute(['--version'], '', { timeout: 10000 });
    if (res.code === 0 && res.stdout) {
      return res.stdout.split(/\r?\n/)[0].trim();
    }
    return null;
  }

  async checkAuth() {
    return { loggedIn: false };
  }

  async runHealthTest(onLog = () => {}, options = {}) {
    onLog(`[${this.id.toUpperCase()}] Sağlık testi başlatılıyor...`);

    const version = await this.getVersion();
    onLog(`[${this.id.toUpperCase()}] CLI Sürümü: ${version || 'Bulunamadı'}`);

    const authInfo = await this.checkAuth();
    if (authInfo.loggedIn) {
      onLog(`[${this.id.toUpperCase()}] Oturum: Aktif (${authInfo.details || authInfo.subscription || ''})`);
    }

    onLog(`[${this.id.toUpperCase()}] stdin üzerinden test promptu gönderiliyor: "OK yaz"`);
    let res = await this.runPrompt('Sadece tek kelime OK yaz', { ...options, timeout: 35000, healthTest: true });
    let modelFallback = false;
    if (res.code !== 0 && options.model && /model.*(?:not found|not available|not supported|access|invalid|unknown)|unknown.*model/i.test(res.stderr + res.stdout)) {
      modelFallback = true;
      res = await this.runPrompt('Sadece tek kelime OK yaz', { ...options, model: undefined, thinking: undefined, timeout: 35000, healthTest: true });
    }

    const durationSec = (res.durationMs / 1000).toFixed(2);
    const combinedOutput = (res.stdout + '\n' + res.stderr).trim();
    const containsOk = /^OK[.!]?$/i.test(res.stdout.trim());

    let status = 'error';
    let message = '';
    let solution = null;

    if (res.code === 0 && containsOk) {
      status = 'healthy';
      if (!authInfo.loggedIn) {
        authInfo.loggedIn = true;
        authInfo.details = 'Oturum açık';
      }
      message = `Başarılı ("OK" yanıtı alındı, ${durationSec}s)`;
      onLog(`[${this.id.toUpperCase()}] ✓ Başarılı! Yanıt: "${res.stdout.split('\n')[0].trim()}" (${durationSec}s)`);
    } else if (res.code === -999) {
      status = 'timeout';
      message = 'Zaman aşımı (CLI yanıt vermedi)';
      onLog(`[${this.id.toUpperCase()}] ✗ Zaman aşımı gerçekleşti.`);
    } else if (
      combinedOutput.includes('Auth method') ||
      combinedOutput.includes('GEMINI_API_KEY') ||
      combinedOutput.includes('auth.json') ||
      combinedOutput.includes('login')
    ) {
      status = 'auth_required';
      message = 'Giriş yapılmamış (Oturum açılması gerekiyor)';
      solution = this.id === 'gemini'
        ? 'Terminalde bir kez `agy` komutunu çalıştırarak Google hesabınızla giriş yapınız.'
        : 'CLI üzerinde oturum açınız.';
      onLog(`[${this.id.toUpperCase()}] ! Giriş gerekli: ${message}`);
    } else if (res.code === -1 && res.stderr.includes('spawn')) {
      status = 'missing';
      message = 'CLI kurulu değil veya PATH üzerinde bulunamadı';
      solution = this.id === 'gemini'
        ? 'Antigravity CLI (agy) kurulumunu yapınız.'
        : 'İlgili CLI aracını kurunuz.';
      onLog(`[${this.id.toUpperCase()}] ✗ CLI kurulu değil.`);
    } else {
      status = 'failed';
      message = `Hata kodu ${res.code}: ${res.stderr || res.stdout || 'Bilinmeyen hata'}`;
      onLog(`[${this.id.toUpperCase()}] ✗ Hata oluştu: ${message}`);
    }

    return {
      id: this.id,
      name: this.name,
      version,
      modelFallback,
      authInfo,
      status,
      healthy: status === 'healthy',
      message,
      solution,
      durationMs: res.durationMs,
      rawStdout: res.stdout,
      rawStderr: res.stderr,
      timestamp: new Date().toISOString()
    };
  }

  async runPrompt(prompt, options = {}) {
    return this.execute(this.getRunArgs(prompt, options), prompt + '\n', options);
  }

  execute(args, input = '', options = {}) {
    return runWithStdin(this.command, args, input, options);
  }
}

module.exports = BaseAgent;

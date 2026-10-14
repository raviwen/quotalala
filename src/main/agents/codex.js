const BaseAgent = require('./base-agent');
const { policyPattern } = require('../task-outcome');

class CodexAgent extends BaseAgent {
  constructor() {
    super({
      id: 'codex',
      name: 'ChatGPT / Codex',
      provider: 'OpenAI',
      role: 'Kodlama ve Görev Yürütme',
      command: 'codex'
    });
  }

  getRunArgs(prompt, options = {}) {
    const args = ['exec'];
    if (options.resumeId && this.capabilities?.resume) args.push('resume', options.resumeId);
    args.push('--ignore-user-config', '--skip-git-repo-check');
    if (!options.healthTest) args.push('--json');
    if (options.model) args.push('--model', options.model);
    if (options.thinking) args.push('-c', `model_reasoning_effort=${options.thinking}`);
    args.push('-');
    return args;
  }

  async runPrompt(prompt, options = {}) {
    const res = await super.runPrompt(prompt, options);
    if (!options.healthTest) {
      const messages = [];
      res.toolFailures = [];
      res.successfulFileCommands = 0;
      res.toolChecksAvailable = true;
      for (const line of res.stdout.split(/\r?\n/)) {
        try {
          const event = JSON.parse(line);
          if (event.type === 'thread.started') res.sessionId = event.thread_id;
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') messages.push(event.item.text);
          if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
            const item = event.item, output = item.aggregated_output || item.output || '';
            if (typeof item.exit_code === 'number' && item.exit_code !== 0 || item.status === 'failed' || policyPattern.test(output)) res.toolFailures.push({ command: item.command, output, exitCode: item.exit_code, policyBlocked: policyPattern.test(output) });
            else if ((item.exit_code === 0 || item.status === 'completed') && /rg|Get-Content|Get-ChildItem|\bcat\b|\bls\b|read.*file/i.test(item.command || '')) res.successfulFileCommands++;
          }
          if (event.type === 'turn.failed' || event.type === 'error') { res.code = res.code || 1; res.stderr += '\n' + (event.error?.message || event.message || line); }
        } catch { /* Ignore non-JSON diagnostics; never treat tool output as final text. */ }
      }
      res.stdout = messages.at(-1) || '';
    }
    return res;
  }

  async checkAuth() {
    try {
      const res = await this.execute(['login', 'status'], '', { timeout: 10000 });
      const text = (res.stdout + '\n' + res.stderr).trim();
      const loggedIn = text.toLowerCase().includes('logged in');
      return {
        loggedIn,
        details: text || 'ChatGPT Oturumu'
      };
    } catch {
      return { loggedIn: false };
    }
  }
}

module.exports = new CodexAgent();

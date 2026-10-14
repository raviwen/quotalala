// At most two read-only help calls per CLI, cached for this application run.
async function discover(agent) {
  if (agent.capabilities) return agent.capabilities;
  const args = agent.id === 'codex' ? ['exec', '--help'] : ['--help'];
  const res = await agent.execute(args, '', { timeout: 10000 });
  const help = res.code === 0 ? res.stdout : '';
  const capabilities = { resume: false, stdin: agent.id !== 'gemini', source: `${agent.command} ${args.join(' ')}`, available: res.code === 0, error: res.code === 0 ? null : (res.stderr || 'CLI help unavailable') };
  if (agent.id === 'claude') {
    capabilities.resume = /--resume\s/.test(help) && /--output-format/.test(help);
    capabilities.noTools = /--tools\s/.test(help);
  } else if (agent.id === 'codex' && /\bresume\s/.test(help)) {
    const resume = await agent.execute(['exec', 'resume', '--help'], '', { timeout: 10000 });
    capabilities.resume = resume.code === 0 && /SESSION_ID/.test(resume.stdout) && /stdin/.test(resume.stdout);
  } else if (agent.id === 'gemini') {
    capabilities.stdin = /stdin|standard input/i.test(help);
    capabilities.print = /-p,?\s+--print/.test(help);
    capabilities.effort = /--effort\s/.test(help);
    capabilities.model = /--model\s/.test(help);
  }
  agent.capabilities = capabilities;
  return capabilities;
}
module.exports = { discover };

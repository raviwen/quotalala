// Only explicit model option examples/choices are evidence. Never mine arbitrary
// prose, config examples, or an interactive model picker for plausible names.
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/;

function parseModelHelp(agentId, output, source = `${agentId} --help`) {
  if (!['claude', 'codex'].includes(agentId) || typeof output !== 'string') return [];
  const text = output.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = text.split(/\r?\n/);
  const found = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(?:-m,?\s+)?--model(?:\s|=)/.test(lines[i])) continue;
    const block = [lines[i]];
    while (i + 1 < lines.length && lines[i + 1].trim()
      && !/^\s*-(?:[a-zA-Z](?=[,\s]|$)|-)/.test(lines[i + 1])
      && !/^\S/.test(lines[i + 1])) block.push(lines[++i]);
    const description = block.join(' ');
    const names = [];
    for (const match of description.matchAll(/(?:choices|possible values)\s*:\s*([^\])]+)/gi)) {
      for (const value of match[1].split(',')) {
        const name = value.trim().replace(/^['"`]|['"`]$/g, '');
        if (NAME.test(name)) names.push(name);
      }
    }
    // Quoted names are accepted only after an explicit example marker.
    const example = description.match(/(?:e\.g\.|examples?\s*:)(.*?)(?:\)|$)/i);
    if (example) for (const match of example[1].matchAll(/['"`]([a-zA-Z0-9][a-zA-Z0-9_.:/-]*)['"`]/g)) names.push(match[1]);
    for (const name of names) found.set(name, {
      agent: agentId, name, source, verified: true,
      preview: /(?:^|[-_.])(?:preview|experimental|beta)(?:$|[-_.])/i.test(name)
        || /\b(?:preview|experimental|beta)\b/i.test(description)
    });
  }
  return [...found.values()];
}

async function discoverModels(agent, options = {}) {
  const defaults = structuredClone(options.defaults || require('./default-models.json'))
    .filter(model => model.agent === agent.id);
  const fallback = error => ({ agent: agent.id, discovered: [], models: defaults, requiresApproval: true, error });
  // Gemini still requires explicit risk acceptance; never probe it here.
  if (!['claude', 'codex'].includes(agent.id)) return fallback('Model discovery is not supported for this agent.');
  if (options.signal?.aborted) return fallback('Model discovery cancelled.');
  try {
    const result = await agent.execute(['--help'], '', { timeout: 10000, signal: options.signal });
    if (options.signal?.aborted || result.code !== 0) return fallback('CLI help unavailable.');
    const discovered = parseModelHelp(agent.id, result.stdout, `${agent.command || agent.id} --help`);
    // A name alone does not establish tier, cost, or reasoning support. Only
    // known catalog entries can be proposed as selectable models.
    const models = defaults.map(model => {
      const evidence = discovered.find(item => item.name === model.name);
      return evidence ? { ...model, source: evidence.source, verified: true, preview: !!model.preview || evidence.preview } : model;
    });
    return { agent: agent.id, discovered, models, requiresApproval: true, error: null };
  } catch {
    return fallback('CLI help unavailable.');
  }
}

module.exports = { parseModelHelp, discoverModels };

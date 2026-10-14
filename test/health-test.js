if (!process.argv.includes('--approved')) throw new Error('Explicit approval is required before using real CLI quota and local user storage.');
const { getAllAgents } = require('../src/main/agents');
const quotaManager = require('../src/main/quota');

async function runCliDiagnostics() {
  console.log('=== Quotalala CLI Diagnostics (Electron Main Context) ===');
  const agents = getAllAgents();

  for (const agent of agents) {
    if (!quotaManager.getAgent(agent.id)?.enabled) {
      console.log(`Skipping disabled agent: ${agent.id}`);
      continue;
    }
    console.log(`\n--- Testing ${agent.name} (${agent.id}) ---`);
    const model = require('../src/main/models').getModelByLevel(agent.id, 'hafif');
    const res = await agent.runHealthTest(console.log, { model: model?.name, thinking: model?.params?.thinking });
    console.log(`Result: ${res.status.toUpperCase()} | Healthy: ${res.healthy} | Time: ${(res.durationMs / 1000).toFixed(2)}s`);
  }

  console.log('\n--- Quota Store Summary ---');
  console.log(quotaManager.getTraySummary());
  console.log('\nDiagnostics Complete.');
}

runCliDiagnostics().catch(console.error);

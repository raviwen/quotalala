const claude = require('./claude');
const codex = require('./codex');
const gemini = require('./gemini');

const agents = {
  claude,
  codex,
  gemini
};

function getAgent(id) {
  const key = id.toLowerCase();
  return agents[key] || null;
}

function getAllAgents() {
  return Object.values(agents);
}

module.exports = {
  agents,
  getAgent,
  getAllAgents
};

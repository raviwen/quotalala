const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.QUOTALALA_DATA_DIR || path.join(os.homedir(), '.quotalala');
const USER_MODELS_PATH = path.join(DATA_DIR, 'models.json');
const DEFAULT_MODELS_PATH = path.join(__dirname, 'default-models.json');
const { writeJSON } = require('./storage');

function validateModels(models, { allowDuplicates = false } = {}) {
  if (!Array.isArray(models) || models.some(m => !m || !['claude', 'codex', 'gemini'].includes(m.agent) || typeof m.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(m.name) || typeof m.source !== 'string' || !m.source.trim()
    || (m.preview !== undefined && typeof m.preview !== 'boolean')
    || (m.verified !== undefined && typeof m.verified !== 'boolean')
    || (!m.levels && !['hafif', 'orta', 'güçlü'].includes(m.level))
    || (m.levels && (typeof m.levels !== 'object' || Array.isArray(m.levels) || !Object.keys(m.levels).length || Object.entries(m.levels).some(([level, details]) => !['hafif', 'orta', 'güçlü'].includes(level) || !details || typeof details !== 'object' || !Number.isFinite(details.cost) || details.cost <= 0 || (details.model && !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(details.model)) || (details.thinking && !['low', 'medium', 'high', 'xhigh', 'max'].includes(details.thinking)))))
    || (m.level && (!Number.isFinite(m.cost) || m.cost <= 0)))) throw new Error('Each model must have an agent, a name, a valid tier/cost and a verified source.');
  const keys = new Set();
  for (const model of models) {
    const key = `${model.agent}:${model.name}`;
    if (!allowDuplicates && keys.has(key)) throw new Error(`Duplicate model: ${key}. Combine tiers in one levels entry.`);
    keys.add(key);
  }
  return models;
}

// Read-only compatibility for existing per-tier rows. Never rewrite the user's
// catalog on load; saving the normalized result remains an explicit action.
function normalizeModels(models, defaults = require('./default-models.json')) {
  validateModels(models, { allowDuplicates: true });
  const result = new Map();
  for (const original of models) {
    const model = structuredClone(original);
    const known = defaults.find(item => item.agent === model.agent && item.name === model.name);
    if (model.verified === undefined) model.verified = !!known?.verified;
    if (known?.verified && /^(?:claude|codex) --help \(flag: --model\)$/.test(model.source)) model.source = known.source;
    if (/\b[A-Za-z]:[\\/]|\/(?:Users|home)\//.test(model.source)) {
      model.source = known?.source || 'Unverified local source (personal path omitted)';
      if (!known) model.verified = false;
    }
    const key = `${model.agent}:${model.name}`;
    const previous = result.get(key);
    if (!previous) { result.set(key, model); continue; }
    const levelsOf = item => item.levels || { [item.level]: { cost: item.cost, description: item.description || '', ...(item.thinking ? { thinking: item.thinking } : {}) } };
    const combined = { ...levelsOf(previous) };
    for (const [level, details] of Object.entries(levelsOf(model))) {
      if (combined[level] && JSON.stringify(combined[level]) !== JSON.stringify(details)) throw new Error(`Conflicting duplicate model: ${key} (${level}).`);
      combined[level] = details;
    }
    previous.levels = combined;
    delete previous.level;
    delete previous.cost;
    delete previous.thinking;
    previous.preview = !!previous.preview || !!model.preview;
    if (previous.verified === false || model.verified === false) previous.verified = false;
    if (previous.source !== model.source) previous.source += `; ${model.source}`;
  }
  return validateModels([...result.values()]);
}

class ModelsManager {
  constructor() {
    this.ensureModelsFile();
  }

  ensureModelsFile() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (!fs.existsSync(USER_MODELS_PATH)) {
        if (fs.existsSync(DEFAULT_MODELS_PATH)) {
          const defaultContent = fs.readFileSync(DEFAULT_MODELS_PATH, 'utf8');
          writeJSON(USER_MODELS_PATH, JSON.parse(defaultContent));
        }
      }
    } catch (err) {
      console.error('ModelsManager initialization error:', err.message);
    }
  }

  getModels() {
    try {
      this.ensureModelsFile();
      if (fs.existsSync(USER_MODELS_PATH)) {
        const raw = fs.readFileSync(USER_MODELS_PATH, 'utf8');
        return normalizeModels(JSON.parse(raw));
      }
    } catch (err) {
      console.error('Error reading models.json:', err.message);
    }

    try {
      if (fs.existsSync(DEFAULT_MODELS_PATH)) {
        return validateModels(JSON.parse(fs.readFileSync(DEFAULT_MODELS_PATH, 'utf8')));
      }
    } catch {}

    return [];
  }

  saveModels(models) {
    validateModels(models);
    try {
      this.ensureModelsFile();
      writeJSON(USER_MODELS_PATH, models);
      return true;
    } catch (err) {
      console.error('Error saving models.json:', err.message);
      return false;
    }
  }

  async discoverModels(agent, options = {}) {
    // Proposals only: no save, IPC mutation, or model selection side effects.
    return require('./model-discovery').discoverModels(agent, options);
  }

  getModelsForAgent(agentId) {
    const list = this.getModels();
    return list.filter(m => m.agent.toLowerCase() === agentId.toLowerCase());
  }

  getModelByLevel(agentId, level = 'orta', allowPreview = false) {
    const agentModels = this.getModelsForAgent(agentId);
    if (!agentModels.length) return null;

    const verified = agentModels.filter(m => m.verified === true);
    const eligible = allowPreview ? verified : verified.filter(m => !m.preview);
    const pool = eligible;
    if (!pool.length) return null;
    const targetLevel = (level || 'orta').toLowerCase();

    // 1. Direct match
    for (const m of pool) {
      if (m.levels && m.levels[targetLevel]) {
        const levelData = m.levels[targetLevel];
        const { cost = 1, description = '', model: specificModel, ...params } = levelData;
        return {
          name: specificModel || m.name,
          baseName: m.name,
          displayName: m.displayName || m.name,
          level: targetLevel,
          cost,
          params,
          description: description || m.description || '',
          source: m.source || '',
          preview: !!m.preview,
          toString() { return this.name; }
        };
      }
      if (m.level && m.level.toLowerCase() === targetLevel) {
        return {
          name: m.name,
          baseName: m.name,
          displayName: m.displayName || m.name,
          level: targetLevel,
          cost: m.cost || 1,
          params: {},
          description: m.description || '',
          source: m.source || '',
          preview: !!m.preview,
          toString() { return this.name; }
        };
      }
    }

    // 2. Fallback cascade: prefer the nearest cheaper tier; only fall up when no
    // cheaper tier exists, and keep the closest cost first ("hafif" is preferred
    // over "güçlü" when the requested tier is missing).
    const fallbackLevels = { 'hafif': ['orta', 'güçlü'], 'orta': ['hafif', 'güçlü'], 'güçlü': ['orta', 'hafif'] }[targetLevel] || [];
    for (const fb of fallbackLevels) {
      for (const m of pool) {
        if (m.levels && m.levels[fb]) {
          const levelData = m.levels[fb];
          const { cost = 1, description = '', model: specificModel, ...params } = levelData;
          return {
            name: specificModel || m.name,
            baseName: m.name,
            displayName: m.displayName || m.name,
            level: fb,
            cost,
            params,
            description: description || m.description || '',
            source: m.source || '',
            preview: !!m.preview,
            toString() { return this.name; }
          };
        }
        if (m.level && m.level.toLowerCase() === fb) {
          return {
            name: m.name,
            baseName: m.name,
            displayName: m.displayName || m.name,
            level: fb,
            cost: m.cost || 1,
            params: {},
            description: m.description || '',
            source: m.source || '',
            preview: !!m.preview,
            toString() { return this.name; }
          };
        }
      }
    }

    // 3. Fallback to first available
    const first = pool[0];
    const firstLevelKey = first.levels ? Object.keys(first.levels)[0] : (first.level || 'orta');
    const firstLevelData = first.levels ? first.levels[firstLevelKey] : {};
    const { cost = 1, description = '', model: specificModel, ...params } = firstLevelData;

    return {
      name: specificModel || first.name,
      baseName: first.name,
      displayName: first.displayName || first.name,
      level: firstLevelKey,
      cost: first.cost || cost,
      params,
      description: description || first.description || '',
      source: first.source || '',
      preview: !!first.preview,
      toString() { return this.name; }
    };
  }

  getModelNameByLevel(agentId, level = 'orta', allowPreview = false) {
    const res = this.getModelByLevel(agentId, level, allowPreview);
    return res ? res.name : null;
  }
}

module.exports = new ModelsManager();
module.exports.validateModels = validateModels;
module.exports.normalizeModels = normalizeModels;

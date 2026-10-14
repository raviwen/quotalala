const fs = require('fs');
const path = require('path');
const { DATA_DIR, readJSON, writeJSON, projectKey } = require('./storage');

function validateProject(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim() || !path.isAbsolute(cwd)) throw new Error('An absolute project directory is required.');
  const canonical = fs.realpathSync(cwd);
  if (!fs.statSync(canonical).isDirectory()) throw new Error('Project directory not found.');
  // Check basic filesystem access before spending CLI quota. This does not grant CLI permissions.
  fs.readdirSync(canonical);
  return canonical;
}
function launchProject(argv, { packaged = false, cwd = process.cwd() } = {}) {
  const option = argv.indexOf('--project');
  if (option !== -1) {
    if (!argv[option + 1] || argv[option + 1].startsWith('--')) throw new Error('--project requires a directory.');
    return validateProject(path.resolve(argv[option + 1]));
  }
  if (packaged && argv[1] && !argv[1].startsWith('-')) return validateProject(path.resolve(argv[1]));
  const markers = ['.git', 'AGENTS.md', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'README.md'];
  return markers.some(name => fs.existsSync(path.join(cwd, name))) ? validateProject(cwd) : null;
}
class WorkspaceManager {
  constructor(root = DATA_DIR) {
    this.file = path.join(root, 'workspace.json'); this.cwd = null; this.error = null;
    const recent = (readJSON(this.file, {}) || {}).recentProjects;
    this.recent = Array.isArray(recent) ? recent.filter(item => typeof item === 'string' && path.isAbsolute(item)) : [];
  }
  initialize(argv, options) {
    try {
      const explicit = argv.includes('--project') || options?.packaged && argv[1] && !argv[1].startsWith('-');
      const saved = (readJSON(this.file, {}) || {}).activeProject;
      const selected = explicit ? launchProject(argv, options) : launchProject(argv, options) || saved;
      if (selected) this.open(selected);
    } catch (error) { this.error = error.message; }
    return this.get();
  }
  get() { return { cwd: this.cwd, name: this.cwd ? path.basename(this.cwd) || this.cwd : null, recentProjects: this.recent, error: this.error }; }
  open(cwd) {
    const canonical = validateProject(cwd);
    const recent = [canonical, ...this.recent.filter(item => projectKey(item) !== projectKey(canonical))].slice(0, 12);
    writeJSON(this.file, { activeProject: canonical, recentProjects: recent });
    this.cwd = canonical; this.recent = recent; this.error = null; return this.get();
  }
  requireProject() { if (!this.cwd) throw new Error('Open a project folder first.'); return validateProject(this.cwd); }
}
module.exports = { WorkspaceManager, launchProject, validateProject };

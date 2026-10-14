const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
function git(cwd, args) {
  return new Promise(resolve => execFile('git', ['--no-optional-locks', ...args], { cwd, windowsHide: true, timeout: 5000, maxBuffer: 2000000 }, (error, stdout) => resolve(error ? null : stdout)));
}
async function snapshot(cwd) {
  const status = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (status === null) return null;
  const files = {};
  const entries = status.split('\0');
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i]) continue;
    const name = entries[i].slice(3);
    if (/[RC]/.test(entries[i].slice(0, 2))) i++;
    try { const stat = fs.statSync(path.resolve(cwd, name)); files[name] = `${stat.size}:${stat.mtimeMs}`; }
    catch { files[name] = 'missing'; }
  }
  return files;
}
function compare(before, after) {
  return { source: 'local_git_status_and_file_metadata', changedFiles: after ? [...new Set([...Object.keys(before || {}), ...Object.keys(after)])].filter(name => !before || before[name] !== after[name]) : [],
    preExistingChanges: Object.keys(before || {}), limitations: [before && after ? 'Metadata changes are observed locally; file contents and correctness were not independently tested.' : 'Git evidence unavailable.'] };
}
module.exports = { snapshot, compare };

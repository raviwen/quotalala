#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function launchOptions(args, { cwd = process.cwd(), env = process.env, appDir = path.resolve(__dirname, '../app') } = {}) {
  let project = cwd;
  if (args.length) {
    if (args.length === 2 && args[0] === '--project') project = path.resolve(cwd, args[1]);
    else if (args.length === 1 && !args[0].startsWith('-')) project = path.resolve(cwd, args[0]);
    else throw new Error('Usage: quotalala [folder] or quotalala --project <folder>');
  }
  project = fs.realpathSync(project);
  if (!fs.statSync(project).isDirectory()) throw new Error('The project must be a directory.');
  fs.readdirSync(project);
  const childEnv = { ...env };
  // npm/Codex hosts can set this; the child must start the desktop runtime.
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return { args: [appDir, '--project', project], options: { cwd: project, env: childEnv, detached: true, stdio: 'ignore', windowsHide: true } };
}

function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: quotalala [folder]\n       quotalala --project <folder>\n\nOpens the desktop app in the current folder by default.');
    return;
  }
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
    console.log(require('../package.json').version); return;
  }
  try {
    if (process.platform !== 'win32') throw new Error('This package currently supports Windows only.');
    const { args: childArgs, options } = launchOptions(args);
    const electron = require('electron');
    if (typeof electron !== 'string' || !fs.existsSync(electron)) throw new Error('Electron is missing. Reinstall quotalala with npm install scripts enabled.');
    const child = spawn(electron, childArgs, options);
    child.once('error', error => { console.error('Quotalala: ' + error.message); process.exitCode = 1; });
    child.unref();
  } catch (error) { console.error('Quotalala: ' + error.message); process.exitCode = 1; }
}

if (require.main === module) main();
module.exports = { launchOptions, main };

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * CLI locator and executor for Quotalala.
 * - Detects Windows .cmd/.bat/.exe and cross-platform executables.
 * - Pipes prompt via stdin to avoid command line escaping issues.
 * - Zero API keys, zero token scraping.
 */

const execCache = {};

function findExecutable(commandName) {
  if (path.isAbsolute(commandName) && fs.existsSync(commandName)) return commandName;
  // A cached path must still exist: CLIs can be installed, moved or uninstalled
  // while the app stays open.
  if (execCache[commandName] && fs.existsSync(execCache[commandName])) {
    return execCache[commandName];
  }
  delete execCache[commandName];

  const appData = process.env.APPDATA || '';
  const localAppData = process.env.LOCALAPPDATA || '';

  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(
      path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', `${commandName}.exe`),
      path.join(localAppData, 'agy', 'bin', `${commandName}.exe`),
      path.join(localAppData, 'agy', 'bin', `${commandName}.cmd`),
      path.join(appData, 'npm', `${commandName}.cmd`),
      path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', `${commandName}.exe`),
      path.join(localAppData, 'Programs', 'antigravity', `${commandName}.exe`),
      path.join(localAppData, 'Programs', 'Antigravity', `${commandName}.exe`),
      path.join(localAppData, 'Programs', commandName, `${commandName}.exe`)
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      execCache[commandName] = candidate;
      return candidate;
    }
  }

  try {
    const lookup = process.platform === 'win32' ? `where.exe ${commandName}` : `which ${commandName}`;
    const output = execSync(lookup, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (output) {
      const first = output.split(/\r?\n/)[0].trim();
      if (first && fs.existsSync(first)) {
        execCache[commandName] = first;
        return first;
      }
    }
  } catch {}

  return commandName;
}

/**
 * Spawns a CLI process, sends prompt via stdin, and collects stdout/stderr.
 */
function runWithStdin(cmd, args = [], input = '', options = {}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    if (options.signal?.aborted) return resolve({ code: -998, cancelled: true, stdout: '', stderr: '', durationMs: 0 });
    const resolvedCmd = findExecutable(cmd);
    const timeoutMs = options.timeout || 60000;

    let proc;
    try {
      const isCmd = process.platform === 'win32' && (resolvedCmd.endsWith('.cmd') || resolvedCmd.endsWith('.bat'));
      const spawnFile = isCmd ? (process.env.COMSPEC || 'cmd.exe') : resolvedCmd;
      if (isCmd && [resolvedCmd, ...args].some(arg => /["%!?^&|<>\r\n]/.test(String(arg)))) {
        throw new Error('Unsafe character in batch CLI argument.');
      }
      const commandLine = isCmd ? `"${resolvedCmd}" ${args.map(arg => `"${arg}"`).join(' ')}` : null;
      const spawnArgs = isCmd ? ['/d', '/s', '/c', `"${commandLine}"`] : args;

      proc = spawn(spawnFile, spawnArgs, {
        cwd: options.cwd || process.cwd(),
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        windowsVerbatimArguments: isCmd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...options.env }
      });
    } catch (err) {
      return resolve({
        code: -1,
        stdout: '',
        stderr: `Process spawn failed: ${err.message}`,
        durationMs: Date.now() - startTime
      });
    }

    let stdout = '';
    let stderr = '';
    let isFinished = false;
    proc.once('spawn', () => options.onStart?.({ pid: proc.pid, executable: resolvedCmd, cwd: options.cwd || process.cwd() }));

    let stopCode = null, cleanupTimer, cleanupPending = false, closed = false, cleanupUnconfirmed = false;
    let timer = null;
    // Absolute cap in case a process keeps producing output forever; it scales
    // with the configured inactivity timeout instead of always cutting long runs
    // short at 30 minutes.
    const hardTimeoutMs = options.hardTimeout || Math.max(timeoutMs, 1800000);
    let hardTimer = setTimeout(() => stop(-999), hardTimeoutMs);
    const resetTimer = () => {
      if (isFinished || stopCode !== null) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => stop(-999), timeoutMs);
    };
    resetTimer();

    const finish = code => {
      if (isFinished) return;
      isFinished = true;
      if (timer) clearTimeout(timer);
      if (hardTimer) clearTimeout(hardTimer);
      clearTimeout(cleanupTimer);
      options.signal?.removeEventListener('abort', cancel);
      resolve({ code: stopCode ?? code, cancelled: stopCode === -998, timedOut: stopCode === -999, cleanupUnconfirmed,
        stdout: stdout.trim(), stderr: stderr.trim(), durationMs: Date.now() - startTime });
    };
    const stop = code => {
      if (isFinished || stopCode !== null) return;
      stopCode = code;
      if (code === -999) stderr += `\nTimeout: ${timeoutMs}ms (inactivity)`;
      // Kill the process group/tree, including shell wrappers and grandchildren.
      try {
        if (process.platform === 'win32' && proc.pid) {
          cleanupPending = true;
          const killer = spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
          const killed = success => {
            cleanupPending = false;
            if (!success && !closed) { cleanupUnconfirmed = true; try { proc.kill(); } catch {} }
            if (closed) finish(code);
          };
          killer.on('error', () => killed(false));
          killer.on('close', status => killed(status === 0));
        } else if (proc.pid) process.kill(-proc.pid, 'SIGKILL');
      } catch { try { proc.kill('SIGKILL'); } catch {} }
      cleanupTimer = setTimeout(() => { cleanupUnconfirmed = true; stderr += '\nProcess cleanup could not be confirmed.'; finish(code); }, 5000);
    };
    const cancel = () => stop(-998);
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', d => {
      stdout += d;
      resetTimer();
      options.onChunk?.({ stream: 'stdout', text: d });
    });
    proc.stderr.on('data', d => {
      stderr += d;
      resetTimer();
      options.onChunk?.({ stream: 'stderr', text: d });
    });
    proc.stdin.on('error', () => { /* A CLI can exit before consuming stdin. */ });

    proc.on('close', (code) => {
      closed = true;
      if (!cleanupPending) finish(code);
    });

    proc.on('error', (err) => {
      stderr += '\n' + err.message; finish(-1);
    });

    if (input) {
      try {
        proc.stdin.write(input);
        proc.stdin.end();
      } catch {}
    } else {
      proc.stdin.end();
    }
  });
}

module.exports = {
  findExecutable,
  runWithStdin
};

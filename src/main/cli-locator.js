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
  if (execCache[commandName]) {
    return execCache[commandName];
  }

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

    const timer = setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        try {
          if (process.platform === 'win32' && proc.pid) {
            spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => proc.kill());
          } else proc.kill('SIGKILL');
        } catch {}
        resolve({
          code: -999,
          stdout: stdout.trim(),
          stderr: (stderr + '\n[Quotalala]: Zaman aşımı (Timeout: ' + timeoutMs + 'ms)').trim(),
          durationMs: Date.now() - startTime
        });
      }
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.stdin.on('error', () => { /* A CLI can exit before consuming stdin. */ });

    proc.on('close', (code) => {
      if (!isFinished) {
        isFinished = true;
        clearTimeout(timer);
        resolve({
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          durationMs: Date.now() - startTime
        });
      }
    });

    proc.on('error', (err) => {
      if (!isFinished) {
        isFinished = true;
        clearTimeout(timer);
        resolve({
          code: -1,
          stdout: stdout.trim(),
          stderr: (stderr + '\n' + err.message).trim(),
          durationMs: Date.now() - startTime
        });
      }
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

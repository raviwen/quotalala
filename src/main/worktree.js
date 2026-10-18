const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { projectKey, DATA_DIR } = require('./storage');

const GIT_TIMEOUT_MS = 30000;

function execGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout ? stdout.toString() : '';
        error.stderr = stderr ? stderr.toString() : '';
        return reject(error);
      }
      resolve({ stdout: stdout ? stdout.toString() : '', stderr: stderr ? stderr.toString() : '' });
    });
  });
}

async function isGitRepo(cwd) {
  try {
    const res = await execGit(['rev-parse', '--git-dir'], cwd);
    const gitDir = res.stdout.trim();
    if (!gitDir) return false;
    // If git-dir is '.git', it's directly a git repo root.
    if (gitDir === '.git') return true;
    // Check if gitDir is inside cwd
    const resolvedGitDir = path.resolve(cwd, gitDir);
    const resolvedCwd = path.resolve(cwd);
    const rel = path.relative(resolvedCwd, resolvedGitDir);
    // If relative path starts with '..' or is absolute to an outside folder, cwd is not inside this git repo's working tree root
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

async function createWorktree(cwd, taskId, root = DATA_DIR) {
  const shortId = String(taskId).slice(0, 8);
  const branch = `quotalala/${shortId}`;
  const pKey = projectKey(cwd);
  const worktreePath = path.join(root, 'worktrees', pKey, String(taskId));

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  await execGit(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], cwd);
  return { branch, worktreePath };
}

async function diffSummary(cwd, branch) {
  try {
    const res = await execGit(['diff', '--stat', `HEAD...${branch}`], cwd);
    return res.stdout.slice(0, 4000);
  } catch {
    return '';
  }
}

async function getBranchChangedFiles(cwd, branch) {
  try {
    const res = await execGit(['diff', '--name-only', `HEAD...${branch}`], cwd);
    return res.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function getDirtyFiles(cwd) {
  try {
    const res = await execGit(['status', '--porcelain'], cwd);
    return res.stdout
      .split(/\r?\n/)
      .map(line => {
        if (!line || line.length < 4) return null;
        // Format is XY <path> or XY <path1> -> <path2>
        const rest = line.slice(3).trim();
        if (rest.includes(' -> ')) {
          return rest.split(' -> ')[1].trim();
        }
        return rest;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function checkMergeTree(cwd, branch) {
  try {
    // git merge-tree --write-tree HEAD <branch>
    // Exit code 0 means clean merge in memory, exit code 1 means conflict
    const res = await execGit(['merge-tree', '--write-tree', 'HEAD', branch], cwd);
    return { ok: true, output: res.stdout };
  } catch (err) {
    const stdout = err.stdout || '';
    const stderr = err.stderr || '';
    const combined = stdout + '\n' + stderr;

    const conflictFiles = [];
    const lines = combined.split(/\r?\n/);
    for (const line of lines) {
      // Format 1: "CONFLICT (content): Merge conflict in file.txt"
      const m1 = line.match(/CONFLICT.*?:.*?\bin\s+(.+)$/i);
      if (m1 && m1[1]) {
        conflictFiles.push(m1[1].trim());
        continue;
      }
      // Format 2: "100644 <hash> 1\tfile.txt"
      const m2 = line.match(/^\d+\s+[a-f0-9]+\s+[123]\t(.+)$/);
      if (m2 && m2[1]) {
        const file = m2[1].trim();
        if (!conflictFiles.includes(file)) conflictFiles.push(file);
      }
    }

    return {
      ok: false,
      conflictFiles: conflictFiles.length > 0 ? conflictFiles : ['conflict']
    };
  }
}

async function mergeBranch(cwd, branch) {
  // Step 0: In-memory dry run with git merge-tree (does not touch disk at all)
  const treeCheck = await checkMergeTree(cwd, branch);
  if (!treeCheck.ok) {
    return {
      ok: false,
      reason: 'conflict',
      files: treeCheck.conflictFiles
    };
  }

  // Step 1: Check dirty working tree
  const dirtyFiles = await getDirtyFiles(cwd);
  const branchFiles = await getBranchChangedFiles(cwd, branch);

  if (dirtyFiles.length > 0) {
    // Step 2: Check for file collision between dirty files and agent-modified files
    const dirtySet = new Set(dirtyFiles);
    const intersectingFiles = branchFiles.filter(f => dirtySet.has(f));

    if (intersectingFiles.length > 0) {
      // Direct collision with user's uncommitted work!
      return {
        ok: false,
        reason: 'dirty',
        files: intersectingFiles
      };
    }
  }

  // Step 3: Perform merge. Since merge-tree proved in-memory clean and files do not collide,
  // git merge is safe even if user has other unrelated files open/dirty.
  try {
    await execGit(['merge', '--no-ff', branch], cwd);
    return { ok: true };
  } catch (error) {
    let conflictFiles = [];
    try {
      const diffRes = await execGit(['diff', '--name-only', '--diff-filter=U'], cwd);
      conflictFiles = diffRes.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } catch {
      // ignore diff failure
    }

    try {
      await execGit(['merge', '--abort'], cwd);
    } catch {
      // ignore abort failure
    }

    return { ok: false, reason: 'conflict', files: conflictFiles };
  }
}

async function removeWorktree(cwd, worktreePath) {
  try {
    await execGit(['worktree', 'remove', worktreePath], cwd);
    return { ok: true };
  } catch (error) {
    // If worktree folder doesn't exist or already removed, also attempt force removal or ignore
    try {
      await execGit(['worktree', 'remove', '--force', worktreePath], cwd);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = {
  isGitRepo,
  createWorktree,
  diffSummary,
  mergeBranch,
  removeWorktree,
  checkMergeTree,
  getBranchChangedFiles,
  getDirtyFiles
};

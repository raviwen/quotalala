const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const {
  isGitRepo,
  createWorktree,
  diffSummary,
  mergeBranch,
  removeWorktree
} = require('../src/main/worktree');

const root = path.resolve('.test-artifacts', 'worktree-' + randomUUID());
fs.mkdirSync(root, { recursive: true });

function git(args, cwd) {
  return execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' });
}

test('isGitRepo correctly identifies git and non-git directories', async () => {
  const nonGit = path.join(root, 'not-git');
  fs.mkdirSync(nonGit, { recursive: true });
  assert.equal(await isGitRepo(nonGit), false);

  const gitDir = path.join(root, 'is-git');
  fs.mkdirSync(gitDir, { recursive: true });
  git(['init'], gitDir);
  assert.equal(await isGitRepo(gitDir), true);
});

test('worktree creation, commit, diff, merge, and remove workflow', async () => {
  const repo = path.join(root, 'repo-merge');
  fs.mkdirSync(repo, { recursive: true });
  git(['init'], repo);
  git(['config', 'user.email', 'test@quotalala.local'], repo);
  git(['config', 'user.name', 'Quotalala Test'], repo);

  fs.writeFileSync(path.join(repo, 'file.txt'), 'initial content\n', 'utf8');
  git(['add', 'file.txt'], repo);
  git(['commit', '-m', 'Initial commit'], repo);

  const taskId = randomUUID();
  const { branch, worktreePath } = await createWorktree(repo, taskId, root);

  assert.ok(fs.existsSync(worktreePath));
  assert.match(branch, /^quotalala\//);

  // Modify in worktree and commit
  fs.writeFileSync(path.join(worktreePath, 'file.txt'), 'initial content\nworktree edit\n', 'utf8');
  git(['add', 'file.txt'], worktreePath);
  git(['commit', '-m', 'Worktree commit'], worktreePath);

  const diff = await diffSummary(repo, branch);
  assert.match(diff, /file\.txt/);

  // Merge back
  const mergeRes = await mergeBranch(repo, branch);
  assert.equal(mergeRes.ok, true);

  const mainContent = fs.readFileSync(path.join(repo, 'file.txt'), 'utf8');
  assert.match(mainContent, /worktree edit/);

  // Remove worktree
  const rmRes = await removeWorktree(repo, worktreePath);
  assert.equal(rmRes.ok, true);
  assert.equal(fs.existsSync(worktreePath), false);
});

test('dirty working directory allows merge when files do not intersect, rejects when files collide', async () => {
  const repo = path.join(root, 'repo-dirty');
  fs.mkdirSync(repo, { recursive: true });
  git(['init'], repo);
  git(['config', 'user.email', 'test@quotalala.local'], repo);
  git(['config', 'user.name', 'Quotalala Test'], repo);

  fs.writeFileSync(path.join(repo, 'main.txt'), 'main line\n', 'utf8');
  fs.writeFileSync(path.join(repo, 'other.txt'), 'other line\n', 'utf8');
  git(['add', 'main.txt', 'other.txt'], repo);
  git(['commit', '-m', 'Initial'], repo);

  const taskId = randomUUID();
  const { branch, worktreePath } = await createWorktree(repo, taskId, root);

  // Agent edits 'other.txt' in worktree
  fs.writeFileSync(path.join(worktreePath, 'other.txt'), 'other line modified by agent\n', 'utf8');
  git(['add', 'other.txt'], worktreePath);
  git(['commit', '-m', 'Agent commit'], worktreePath);

  // User has dirty uncommitted changes in 'main.txt' and an untracked file (no collision with other.txt)
  fs.writeFileSync(path.join(repo, 'main.txt'), 'main line modified by user\n', 'utf8');
  fs.writeFileSync(path.join(repo, 'untracked.txt'), 'untracked user file\n', 'utf8');

  // Case 1: Merge succeeds because agent modified 'other.txt' and user has dirty 'main.txt'/'untracked.txt'
  const mergeRes1 = await mergeBranch(repo, branch);
  assert.equal(mergeRes1.ok, true);
  assert.match(fs.readFileSync(path.join(repo, 'other.txt'), 'utf8'), /modified by agent/);
  assert.match(fs.readFileSync(path.join(repo, 'main.txt'), 'utf8'), /modified by user/);
  assert.ok(fs.existsSync(path.join(repo, 'untracked.txt')));

  // Case 2: Agent edits 'main.txt' in a second task branch, while user still has 'main.txt' uncommitted
  const taskId2 = randomUUID();
  const { branch: branch2, worktreePath: wt2 } = await createWorktree(repo, taskId2, root);
  fs.writeFileSync(path.join(wt2, 'main.txt'), 'main line agent 2\n', 'utf8');
  git(['add', 'main.txt'], wt2);
  git(['commit', '-m', 'Agent 2 commit'], wt2);

  const mergeRes2 = await mergeBranch(repo, branch2);
  assert.equal(mergeRes2.ok, false);
  assert.equal(mergeRes2.reason, 'dirty');
  assert.ok(mergeRes2.files.includes('main.txt'));
});

test('merge conflict is detected, files listed, and git merge is aborted', async () => {
  const repo = path.join(root, 'repo-conflict');
  fs.mkdirSync(repo, { recursive: true });
  git(['init'], repo);
  git(['config', 'user.email', 'test@quotalala.local'], repo);
  git(['config', 'user.name', 'Quotalala Test'], repo);

  fs.writeFileSync(path.join(repo, 'shared.txt'), 'line 1\n', 'utf8');
  git(['add', 'shared.txt'], repo);
  git(['commit', '-m', 'Base commit'], repo);

  const taskId = randomUUID();
  const { branch, worktreePath } = await createWorktree(repo, taskId, root);

  // Commit on worktree
  fs.writeFileSync(path.join(worktreePath, 'shared.txt'), 'line 1 from worktree\n', 'utf8');
  git(['add', 'shared.txt'], worktreePath);
  git(['commit', '-m', 'Worktree edit'], worktreePath);

  // Conflicting commit on main
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'line 1 from main\n', 'utf8');
  git(['add', 'shared.txt'], repo);
  git(['commit', '-m', 'Main conflicting edit'], repo);

  const mergeRes = await mergeBranch(repo, branch);
  assert.equal(mergeRes.ok, false);
  assert.equal(mergeRes.reason, 'conflict');
  assert.ok(mergeRes.files.includes('shared.txt'));

  // Verify merge was aborted and repo is clean (not in merge state)
  const status = git(['status', '--porcelain'], repo);
  assert.equal(status.trim(), '');
});

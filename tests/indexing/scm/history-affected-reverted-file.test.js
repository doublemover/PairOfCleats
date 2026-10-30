import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'history-affected-'));
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
try {
  git('init'); git('config','user.name','Test'); git('config','user.email','test@example.invalid');
  await fs.writeFile(path.join(root,'a.js'),'original'); git('add','.'); git('commit','-m','A');
  const a = git('rev-parse','HEAD');
  await fs.writeFile(path.join(root,'a.js'),'edited'); git('add','.'); git('commit','-m','B');
  await fs.writeFile(path.join(root,'a.js'),'original'); git('add','.'); git('commit','-m','C');
  const c = git('rev-parse','HEAD');
  assert.equal(git('diff','--name-only',a,c),'');
  const affected = await gitProvider.getHistoryAffectedFiles({ repoRoot: root, fromRef: a, toRef: c });
  assert.equal(affected.complete,true);
  assert.ok(affected.filesPosix.includes('a.js'));
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('history-aware metadata invalidation includes reverted files');

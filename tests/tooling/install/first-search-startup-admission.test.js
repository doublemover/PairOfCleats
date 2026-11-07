// Actual apply consumer with a controlled asynchronous startup boundary; UNRUN.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFirstSearchPlan, applyFirstSearchPlan } from '../../../tools/setup/first-search-plan.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-first-search-startup-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
try {
  for (const mutation of ['cancel', 'config', 'directory', 'none']) {
    const repo = path.join(root, mutation), moved = `${repo}-previous`;
    await fs.mkdir(repo); await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{}');
    const approved = await createFirstSearchPlan({ repoRoot: repo });
    const controller = new AbortController(), children = [];
    let retained;
    const result = await applyFirstSearchPlan(approved, { signal: controller.signal,
      resolveRuntimeEnv: async input => {
        assert.equal(input.repoRoot, repo);
        await Promise.resolve();
        if (mutation === 'cancel') controller.abort();
        if (mutation === 'config') await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{"quality":"fast"}');
        if (mutation === 'directory') {
          await fs.rename(repo, moved); await fs.mkdir(repo);
          await fs.copyFile(path.join(moved, '.pairofcleats.json'), path.join(repo, '.pairofcleats.json'));
        }
        return { ...process.env };
      }, execute: async (command, args, options) => { children.push({ command, args, options }); return { ok: true, status: 0 }; } })
      .catch(error => { if (mutation !== 'directory') throw error; retained = error; return null; });
    if (mutation === 'directory') {
      assert.equal(children.length, 0, 'identical config bytes in a replacement directory cannot inherit approval');
      assert.equal(retained?.setupCleanupError?.code, 'ERR_FILE_LOCK_RELEASE_FAILED',
        'a moved lock cannot be reported as removed from its original reviewed pathname');
      const session = retained.setupCleanupError.fileLockPublicationSession;
      assert.ok(session, 'the canonical lock owner remains available for explicit exact-identity recovery');
      const replacement = await fs.readFile(path.join(repo, '.pairofcleats.json'));
      assert.deepEqual(replacement, await fs.readFile(path.join(moved, '.pairofcleats.json')));
      // Restore the original fixture object before asking its actual owner to
      // retry cleanup. No pathname search or replacement-object deletion.
      await fs.rm(repo, { recursive: true, force: true }); await fs.rename(moved, repo);
      assert.equal((await session.releaseAfterClose()).settled, true);
      await assert.rejects(fs.stat(path.join(repo, '.pairofcleats.json.setup-lock')), { code: 'ENOENT' });
      continue;
    }
    assert.equal(result.state, mutation === 'none' ? 'complete' : mutation === 'cancel' ? 'cancelled' : 'blocked');
    assert.equal(children.length, mutation === 'none' ? approved.operations.length : 0,
      'startup completion must recheck cancellation and exact target before admitting the first child');
    if (mutation !== 'none') {
      assert.deepEqual(result.completed, ['config']); assert.equal(result.pending[0], 'index');
      assert.equal(result.failed.id, 'index');
    } else for (const child of children) {
      assert.equal(child.options.cwd, repo, 'relative child defaults use the reviewed project directory');
      assert.equal(child.args[child.args.indexOf('--repo') + 1], repo);
    }
    await assert.rejects(fs.stat(path.join(repo, '.pairofcleats.json.setup-lock')), { code: 'ENOENT' });
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('First-search rechecks target and cancellation after startup planning and uses the reviewed child cwd.');

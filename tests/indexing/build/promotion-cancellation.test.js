import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { getBuildsRoot } from '../../../tools/shared/dict-utils.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-promotion-cancel-'));
const originalOpen = fs.open, originalRename = fs.rename;
try {
  applyTestEnv({ cacheRoot: root });
  const repoRoot = path.join(root, 'repo');
  await fs.mkdir(repoRoot, { recursive: true });
  const userConfig = {}, buildsRoot = getBuildsRoot(repoRoot, userConfig), buildRoot = path.join(buildsRoot, 'new-build');
  await seedPublishedArtifacts({ buildRoot, mode: 'code', buildId: 'new-build' });
  const pointer = path.join(buildsRoot, 'current.json');
  const prior = JSON.stringify({ buildId: 'old-build', marker: 'must-remain' });
  const input = { repoRoot, userConfig, buildRoot, buildId: 'new-build', modes: ['code'] };
  await assert.rejects(validateIndexArtifacts({ root: repoRoot, abortSignal: AbortSignal.abort() }), error => error.name === 'AbortError');
  for (const boundary of ['already-aborted', 'temp-closed', 'rename-retry', 'after-commit']) {
    await fs.writeFile(pointer, prior);
    const controller = new AbortController();
    if (boundary === 'already-aborted') controller.abort();
    let intercepted = false;
    fs.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args);
      if (boundary === 'temp-closed' && String(file).includes('current.json') && args[0] === 'wx') {
        const close = handle.close.bind(handle);
        handle.close = async () => { await close(); intercepted = true; controller.abort(); };
      }
      return handle;
    };
    fs.rename = async (from, to) => {
      if (String(to) === pointer && boundary === 'rename-retry') {
        intercepted = true;
        controller.abort();
        throw Object.assign(new Error('Controlled blocked pointer commit'), { code: 'EBUSY' });
      }
      const result = await originalRename(from, to);
      if (String(to) === pointer && boundary === 'after-commit') { intercepted = true; controller.abort(); }
      return result;
    };
    try {
      if (boundary === 'after-commit') {
        const result = await promoteBuild({ ...input, abortSignal: controller.signal });
        assert.equal(result.buildId, 'new-build');
        assert.equal(JSON.parse(await fs.readFile(pointer, 'utf8')).buildId, 'new-build');
      } else {
        await assert.rejects(promoteBuild({ ...input, abortSignal: controller.signal }), error => error.name === 'AbortError');
        assert.equal(await fs.readFile(pointer, 'utf8'), prior, boundary);
        assert.ok(!(await fs.readdir(buildsRoot)).some(name => name.endsWith('.tmp')), 'cancelled publication drains staged pointer files');
      }
      if (boundary !== 'already-aborted') assert.ok(intercepted, boundary);
    } finally { fs.open = originalOpen; fs.rename = originalRename; }
  }
} finally {
  fs.open = originalOpen; fs.rename = originalRename;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Real pointer publication checks cancellation at staging/retry boundaries and preserves committed success');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { applyImportResolutionCacheFileSetDiffInvalidation } from '../../../src/index/build/import-resolution-cache.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createImportResolutionCacheStats } from '../../helpers/import-resolution-fixture.js';

const { dir: root } = await prepareIsolatedTestCacheDir('unresolved-cache-budget-correctness');
try {
  const importers = { 'first.js': ['./still-missing.js'], 'second.js': ['./new-target.js'], 'warm.js': ['./stable-target.js'] };
  const files = [...Object.keys(importers), 'stable-target.js'];
  for (const [file, imports] of Object.entries(importers)) await fs.writeFile(path.join(root, file), imports.map(spec => `import '${spec}';`).join('\n'));
  await fs.writeFile(path.join(root, 'stable-target.js'), 'export const stable = true;');
  const fileHashes = new Map(files.map(file => [file, file]));
  for (const budget of [0, 1]) {
    const cache = {};
    const resolve = entries => {
      const fileRelations = new Map(Object.entries(importers).map(([file, imports]) => [file, { imports }]));
      resolveImportLinks({ root, entries: entries.map(rel => ({ rel, abs: path.join(root, rel) })),
        importsByFile: importers, fileRelations, enableGraph: false, cache, fileHashes, mode: 'code' });
      return fileRelations;
    };
    await fs.rm(path.join(root, 'new-target.js'), { force: true });
    resolve(files);
    const warm = cache.files['warm.js'];
    assert.ok(warm, 'positive resolved-import cache witness exists');
    await fs.writeFile(path.join(root, 'new-target.js'), 'export const added = true;');
    const entries = [...files, 'new-target.js'].map(rel => ({ rel, abs: path.join(root, rel) }));
    const stats = createImportResolutionCacheStats();
    const invalidation = applyImportResolutionCacheFileSetDiffInvalidation({ cache, entries,
      maxStaleEdgeChecks: budget, cacheStats: stats });
    assert.equal(invalidation.staleEdgeBudgetExhausted, true);
    assert.equal(invalidation.staleEdgeChecks, budget, 'expensive stale-edge checks retain their original bound');
    assert.equal(Object.hasOwn(cache.files, 'second.js'), false, 'the target importer is unchecked after the budget is spent on the first importer');
    assert.equal(cache.files['warm.js'], warm, 'unrelated resolved/no-import cache entries remain warm');
    const result = resolve([...files, 'new-target.js']);
    assert.deepEqual(result.get('first.js').importLinks, []);
    assert.deepEqual(result.get('second.js').importLinks, ['new-target.js']);
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Zero/exhausted stale-edge budgets preserve import correctness without unbounded resolution checks.');

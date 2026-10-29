import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { search } from '../../../src/integrations/core/search.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { getIndexDir, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { loadFileRelations } from '../../../src/retrieval/cli/index-loader.js';
import { admitImportExtraction, canReuseImportExtraction } from '../../../src/shared/import-extraction.js';

const { dir } = await prepareIsolatedTestCacheDir('required-relations-production');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
await fs.writeFile(path.join(repo, 'main.js'), "import { target } from './dep.js';\nexport function sentinel() { return target(); }\n");
await fs.writeFile(path.join(repo, 'dep.js'), 'export function target() { return 1; }\n');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off',
  testConfig: createFastIndexingTestConfig({ threads: 1, sqlite: { use: false },
    indexing: { treeSitter: { enabled: true }, workerPool: { maxWorkers: 1 }, embeddings: { enabled: false, mode: 'off' } } }) });
try {
  const run = (query, filters) => search(repo, { query,
    args: ['--mode', 'code', '--backend', 'memory', '--no-ann', '--json', ...filters] });
  await buildIndex(repo, { mode: 'code', stage: 'stage2', threads: 1, sqlite: false,
    'scm-provider': 'none', progress: 'off' });
  const facts = await loadFileRelations(repo, loadUserConfig(repo), 'code', {
    indexDir: getIndexDir(repo, 'code', loadUserConfig(repo)), required: true });
  for (const file of ['main.js', 'dep.js']) {
    const value = facts.get(file);
    assert.ok(value, `published relation family retains ${file}`);
    const receipt = admitImportExtraction(value.importExtraction, value.imports);
    assert.equal(receipt.producer.id, 'javascript-literal-imports');
    assert.equal(receipt.reusePolicy, 'retain-qualified-static-subset');
    assert.ok(canReuseImportExtraction(receipt, value.imports));
  }
  assert.ok(facts.get('main.js').imports.some(entry => (entry.specifier ?? entry) === './dep.js'));
  assert.deepEqual(facts.get('dep.js').imports, [], 'real parser qualifies a source with no static imports');
  for (const temperature of ['cold', 'warm']) {
    const positive = await run('sentinel', ['--import', './dep.js']);
    assert.ok(positive.code.some(hit => hit.file === 'main.js'), `${temperature}: real static-import evidence stays searchable`);
    const negative = await run('sentinel', ['--import', './absent.js']);
    assert.deepEqual(negative.code, [], `${temperature}: a qualified missing import stays a definitive empty result`);
    assert.ok((await run('sentinel', [])).code.some(hit => hit.file === 'main.js'));
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Real published static import facts qualify positive/empty relation filters without requiring unrelated enrichment.');

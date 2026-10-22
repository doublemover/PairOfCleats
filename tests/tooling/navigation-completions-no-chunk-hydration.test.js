import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { queryNavigationData } from '../../tools/tooling/navigation.js';
import { getIndexDir } from '../../tools/dict-utils/paths/repo.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('navigation-no-chunk-hydration');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
await fs.mkdir(getIndexDir(dir, 'code'), { recursive: true });
const reads = [];
const symbol = { name: 'WidgetBuilder', qualifiedName: 'demo.WidgetBuilder', kind: 'FunctionDeclaration',
  chunkUid: 'uid', file: 'src/a.js', virtualPath: 'src/a.js' };
const artifactReader = async name => { reads.push(name); return name === 'symbols' ? [symbol]
  : [{ chunkUid: 'uid', startLine: 1, endLine: 2, file: 'src/a.js', virtualPath: 'src/a.js' }]; };
try {
  const result = await queryNavigationData({ repoRoot: dir, kind: 'completions', query: 'Wid', artifactReader });
  assert.equal(result.results[0].name, 'WidgetBuilder');
  assert.deepEqual(reads, ['symbols']);
  reads.length = 0;
  await queryNavigationData({ repoRoot: dir, kind: 'definitions', query: 'WidgetBuilder', artifactReader });
  assert.ok(reads.includes('chunk_meta'), 'definition projection keeps its required chunk metadata');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Indexed completions consume symbol rows without unused chunk metadata hydration.');

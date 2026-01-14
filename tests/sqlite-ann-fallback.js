#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'sqlite-ann-fallback');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const missingExtensionPath = path.join(tempRoot, 'missing', 'vec0-missing.node');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'alpha.js'),
  'export const alpha = () => "ann_fallback_token";\n'
);

const config = {
  cache: { root: cacheRoot },
  dictionary: { languages: ['en'] },
  search: { annBackend: 'sqlite-vector' },
  sqlite: {
    use: true,
    vectorExtension: {
      annMode: 'extension',
      path: missingExtensionPath
    }
  }
};
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify(config, null, 2) + '\n'
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const runNode = (label, args) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
runNode('build_sqlite', [path.join(root, 'tools', 'build-sqlite-index.js'), '--repo', repoRoot]);

const searchResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), 'ann_fallback_token', '--backend', 'sqlite', '--ann', '--json', '--repo', repoRoot],
  { env, encoding: 'utf8' }
);
if (searchResult.status !== 0) {
  console.error('sqlite ann fallback test failed: search returned error');
  if (searchResult.stderr) console.error(searchResult.stderr.trim());
  process.exit(searchResult.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(searchResult.stdout || '{}');
} catch {
  console.error('sqlite ann fallback test failed: invalid JSON output');
  process.exit(1);
}

const hits = payload?.code || [];
if (!hits.length) {
  console.error('sqlite ann fallback test failed: no results returned');
  process.exit(1);
}
if (payload?.stats?.annBackend === 'sqlite-extension') {
  console.error('sqlite ann fallback test failed: ann backend should not be sqlite-extension');
  process.exit(1);
}
if (payload?.stats?.annExtension?.available?.code) {
  console.error('sqlite ann fallback test failed: ann extension should be unavailable');
  process.exit(1);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
console.log('sqlite ann fallback test passed');

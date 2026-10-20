import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadChunkMeta } from '../../../src/shared/artifact-io.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { createStage1CodeBuildEnv } from '../../helpers/build-index-fixture.js';
import { runNode } from '../../helpers/run-node.js';

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-registry-metadata-index-'));
const repo = path.join(fixture, 'repo'), cache = path.join(fixture, 'cache');
await fs.mkdir(repo);
try {
  const python = 'def unicode(a=1, /, b=2): return "é漢😀"\nfollowing = 1\n';
  const html = '<!doctype html><html><head><title>Example</title><meta name="description" content="Demo">'
    + '<meta name="keywords" content="one,two"><script src="./app.js"></script>'
    + '<link rel="stylesheet" href="./app.css"></head><body><main><h1>Body</h1></main></body></html>';
  for (const [filename, source] of [['legacy.py', python], ['page.html', html],
    ['app.js', 'export const ready = true;\n'], ['app.css', 'body { color: blue; }\n']]) {
    await fs.writeFile(path.join(repo, filename), source);
  }
  const env = { ...createStage1CodeBuildEnv({ cacheRoot: cache }), PYTHONIOENCODING: 'cp1252' };
  const result = runNode([path.resolve('build_index.js'), '--stub-embeddings', '--stage', 'stage1', '--mode', 'code', '--repo', repo],
    'Python/HTML registry artifact build', process.cwd(), env, { stdio: 'pipe', allowFailure: true, timeoutMs: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const rows = await loadChunkMeta(getIndexDir(repo, 'code', loadUserConfig(repo)), { strict: true });
  const definition = rows.find(row => row.file === 'legacy.py' && row.name === 'unicode');
  assert.ok(definition);
  assert.equal(definition.start, 0);
  assert.equal(definition.end, python.indexOf('\n'));
  assert.equal(python.slice(definition.start, definition.end), 'def unicode(a=1, /, b=2): return "é漢😀"');
  assert.deepEqual(definition.docmeta.paramDefaults, { a: '1', b: '2' });
  assert.equal(definition.docmeta.signature, 'def unicode(a=1, /, b=2)');
  const htmlChunks = rows.filter(row => row.file === 'page.html');
  assert.ok(htmlChunks.length);
  for (const row of htmlChunks) {
    assert.equal(row.docmeta.title, 'Example');
    assert.equal(row.docmeta.description, 'Demo');
    assert.deepEqual(row.docmeta.keywords, ['one', 'two']);
    assert.deepEqual(row.docmeta.scripts, ['./app.js']);
    assert.deepEqual(row.docmeta.links, ['./app.css']);
  }
} finally { await fs.rm(fixture, { recursive: true, force: true }); }
console.log('A real index publishes exact Unicode Python bounds/defaults and HTML summary metadata under a non-UTF-8 Python locale.');

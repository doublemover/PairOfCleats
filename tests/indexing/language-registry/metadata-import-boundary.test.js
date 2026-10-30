import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/language-registry/metadata-import-boundary/')[1];
assert.ok(['extensions', 'special-files', 'filtered', 'unknown'].includes(mode));
const loaded = [];
const hook = registerHooks({ load(url, context, next) {
  assert.equal(url.includes('/src/lang/') || ['/language-registry/registry-data.js', '/language-registry/registry.js',
    '/chunking/dispatch.js'].some(suffix => url.endsWith(suffix))
    || /\/node_modules\/(?:@babel\/parser|acorn|esprima|tree-sitter)\//.test(url), false,
  `Metadata lookup must not initialize adapter/parser code: ${url}`);
  loaded.push(url); return next(url, context);
} });
try {
  const { getLanguageRouteForFile, createLanguageRouteResolver } = await import('../../../src/index/language-registry/routing.js');
  if (mode === 'extensions') {
    for (const [ext, id] of [['.js', 'javascript'], ['.tsx', 'typescript'], ['.py', 'python'], ['.rs', 'rust'], ['.jsonc', 'json']]) {
      const route = getLanguageRouteForFile(ext, 'fixture' + ext);
      assert.equal(route.id, id); assert.ok(Object.isFrozen(route)); assert.ok(Object.isFrozen(route.extensions));
      assert.equal(route.prepare, undefined, 'metadata is not a partially initialized adapter');
      assert.equal(getLanguageRouteForFile(ext, 'fixture' + ext), route, 'warm metadata lookup retains the same immutable descriptor');
    }
  } else if (mode === 'special-files') {
    assert.equal(getLanguageRouteForFile('.txt', 'CMakeLists.txt').id, 'cmake');
    assert.equal(getLanguageRouteForFile('.local', 'Dockerfile.local').id, 'dockerfile');
    assert.equal(getLanguageRouteForFile('.js', 'Dockerfile.js').id, 'javascript', 'explicit extension precedes special-prefix fallback');
    assert.equal(getLanguageRouteForFile('.py', 'Pipfile').id, 'toml', 'special exact filename precedes extension');
  } else if (mode === 'filtered') {
    const resolve = createLanguageRouteResolver(new Set(['json']));
    assert.equal(resolve('.json', 'file.json'), 'json'); assert.equal(resolve('.py', 'file.py'), null);
    assert.equal(resolve('.txt', 'CMakeLists.txt'), null);
  } else {
    assert.equal(getLanguageRouteForFile('.poc-no-language', 'file.poc-no-language'), null);
    assert.equal(getLanguageRouteForFile('', ''), null);
    assert.equal(getLanguageRouteForFile('.JS', 'UPPER.JS').id, 'javascript');
  }
  assert.ok(loaded.some(url => url.endsWith('/language-registry/descriptors.js')));
  console.log(JSON.stringify({ mode, loadedModuleCount: loaded.length, loadedModules: loaded }));
} finally { hook.deregister(); }

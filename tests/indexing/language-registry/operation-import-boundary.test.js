import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/language-registry/operation-import-boundary/')[1];
assert.ok(['cold-registry', 'prose', 'javascript', 'typescript', 'config', 'load-failure'].includes(mode));
const allowed = new Set(mode === 'javascript' || mode === 'load-failure' ? ['javascript']
  : mode === 'typescript' ? ['javascript', 'typescript'] : []);
const families = new Set(['javascript', 'typescript', 'python', 'clike', 'go', 'java', 'csharp', 'kotlin', 'ruby',
  'php', 'html', 'css', 'lua', 'sql', 'perl', 'rust', 'swift', 'shell']);
const loaded = [];
const failure = Object.assign(new Error('Fixture rejected the requested language load.'), { code: 'ERR_FIXTURE_LANGUAGE_LOAD' });
const hooks = registerHooks({ load(url, context, next) {
  const family = /\/src\/lang\/([^/.]+)(?:\/|\.js$)/u.exec(url)?.[1];
  if (family && families.has(family)) assert.ok(allowed.has(family), `Unrelated language initialized: ${url}`);
  if (!allowed.size) {
    assert.ok(!/\/node_modules\/(?:@babel\/parser|@babel\/traverse|acorn|esprima|typescript|parse5|tree-sitter)\//u.test(url),
      `Code parser initialized without a code operation: ${url}`);
    assert.ok(!/\/src\/lang\/tree-sitter\/(?:chunking|native-runtime|worker)\.js$/u.test(url),
      `Native parser lifecycle initialized without a parser operation: ${url}`);
  }
  if (mode === 'load-failure' && url.endsWith('/src/lang/javascript.js')) throw failure;
  loaded.push(url);
  return next(url, context);
} });
try {
  const registry = await import('../../../src/index/language-registry.js');
  if (mode === 'cold-registry') {
    for (const [ext, id] of [['.js', 'javascript'], ['.tsx', 'typescript'], ['.py', 'python'], ['.rs', 'rust'], ['.json', 'json']]) {
      const first = registry.getLanguageForFile(ext, `fixture${ext}`);
      assert.equal(first.id, id);
      assert.equal(registry.getLanguageForFile(ext, `fixture${ext}`), first);
      assert.equal(typeof first.prepare, 'function');
    }
    const prose = await registry.buildLanguageContext({ ext: '.js', relPath: 'example.js', mode: 'prose', text: 'documented source' });
    assert.equal(prose.lang.id, 'javascript'); assert.deepEqual(prose.context, {});
  } else if (mode === 'prose') {
    const { smartChunk, chunkMarkdown } = await import('../../../src/index/chunking.js');
    const text = '# One\nfirst paragraph\n\n# Two\nsecond paragraph\n';
    const options = { text, ext: '.md', relPath: 'guide.md', mode: 'prose', context: { treeSitter: { configChunking: false } } };
    const first = smartChunk(options);
    assert.ok(Array.isArray(first)); assert.ok(first.some(chunk => chunk.name === 'One'));
    assert.ok(first.some(chunk => chunk.name === 'Two'));
    assert.deepEqual(smartChunk(options), first);
    assert.deepEqual(chunkMarkdown(text, '.md', options.context).map(c => [c.start, c.end, c.name]), first.map(c => [c.start, c.end, c.name]));
    const body = '0123456789'.repeat(6);
    const fallback = smartChunk({ text: body, ext: '.txt', mode: 'prose', context: {
      chunking: { proseFallbackMaxChars: 10, proseFallbackChunkChars: 8 }
    } });
    assert.ok(fallback.length > 1);
    assert.equal(fallback.map(c => body.slice(c.start, c.end)).join(''), body);
    assert.ok(fallback.every(c => c.kind === 'Section'));
  } else if (mode === 'load-failure') {
    assert.equal(registry.getLanguageForFile('.js', 'fixture.js').id, 'javascript');
    for (let attempt = 0; attempt < 2; attempt++) assert.throws(() => registry.collectLanguageImportEntries({
      ext: '.js', relPath: 'fixture.js', mode: 'code', text: 'import "./dep.js";'
    }), error => error.code === 'ERR_FIXTURE_LANGUAGE_LOAD');
  } else {
    const [ext, source, expected] = mode === 'javascript' ? ['.js', 'import value from "./dep.js"; // import "./fake.js"', './dep.js']
      : mode === 'typescript' ? ['.ts', 'import type { Shape } from "./shape"; // import "./fake"', './shape']
        : ['.json', '{"$ref":"./dep.json","description":"./fake.json"}', './dep.json'];
    const input = { ext, relPath: `fixture${ext}`, mode: 'code', text: source };
    const first = registry.collectLanguageImportEntries(input);
    assert.ok(Array.isArray(first), 'the public collector remains synchronous');
    assert.deepEqual(first.map(entry => entry.specifier), [expected]);
    assert.deepEqual(registry.collectLanguageImportEntries(input), first);
    assert.deepEqual(registry.collectLanguageImports(input), [expected]);
  }
  assert.ok(loaded.length > 0);
} finally { hooks.deregister(); }
console.log(`Language operation import boundary: ${mode}`);

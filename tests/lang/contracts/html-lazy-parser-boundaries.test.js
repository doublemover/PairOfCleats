import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('lang/contracts/html-lazy-parser-boundaries/')[1];
assert.ok(['metadata-only', 'registered-plain-html', 'selected-embedded', 'failed-parser', 'cancelled-first-use'].includes(mode));
const htmlUrl = new URL('../../../src/lang/html.js', import.meta.url).href;
const treeUrl = new URL('../../../src/lang/tree-sitter.js', import.meta.url).href;
const jsUrl = new URL('../../../src/lang/javascript.js', import.meta.url).href;
const unrelated = ['python', 'go', 'rust', 'java', 'csharp', 'kotlin', 'ruby', 'php', 'lua', 'sql', 'shell']
  .map(name => new URL('../../../src/lang/' + name + '.js', import.meta.url).href);
const loaded = new Map(), primary = Object.freeze(new Error('original selected JavaScript module initialization failed'));
const hooks = registerHooks({ load(url, context, next) {
  loaded.set(url, (loaded.get(url) || 0) + 1);
  if (mode === 'failed-parser' && url === jsUrl) throw primary;
  return next(url, context);
} });
const assertUnrelatedAbsent = () => {
  for (const url of unrelated) assert.equal(loaded.has(url), false, 'unselected language implementation loaded: ' + url);
};
try {
  const html = await import(htmlUrl);
  const plain = '<!doctype html><html><head><title>Parser boundary</title></head><body><main><h1>Content</h1></main></body></html>';
  const embedded = '<script>export function answer(){ return 42; }</script>';
  if (mode === 'metadata-only') {
    const text = plain + '<script src="./client.js"></script><link href="./style.css">';
    const metadata = html.getHtmlMetadata(text);
    assert.equal(metadata.title, 'Parser boundary'); assert.deepEqual(metadata.scripts, ['./client.js']);
    assert.deepEqual(metadata.links, ['./style.css']);
    assert.deepEqual([...html.collectHtmlImports(text)], ['./client.js', './style.css']);
    for (const url of [treeUrl, jsUrl, new URL('../../../src/lang/typescript.js', import.meta.url).href]) assert.equal(loaded.has(url), false);
    assert.equal([...loaded.keys()].some(url => /\/node_modules\/(?:@babel|typescript|acorn|esprima)\//.test(url)), false,
      'metadata/import projection cannot activate code parser packages');
  } else if (mode === 'registered-plain-html') {
    const { buildLanguageContext } = await import('../../../src/index/language-registry.js');
    const { lang, context } = await buildLanguageContext({ text: plain, mode: 'code', ext: '.html', relPath: 'page.html', options: {} });
    assert.equal(lang.id, 'html'); assert.equal(context.htmlMeta.title, 'Parser boundary');
    assert.ok(context.htmlChunks.length > 0); assert.equal(context.htmlPreparation.parseCalls, 1);
    assert.equal(loaded.has(jsUrl), false, 'the real registered HTML path has no JavaScript work for a plain document');
    assert.equal(loaded.has(new URL('../../../src/lang/typescript.js', import.meta.url).href), false);
    html.releaseHtmlPreparedContext(context);
  } else if (mode === 'selected-embedded') {
    const first = html.buildHtmlChunks(embedded), second = html.buildHtmlChunks(embedded);
    assert.equal(loaded.get(jsUrl), 1, 'selected synchronous language loads once across warm calls');
    const content = chunks => chunks.map(({ name, kind, start, end }) => ({ name, kind, start, end, source: embedded.slice(start, end) }));
    assert.deepEqual(content(first), content(second));
    const selected = first.find(chunk => chunk.name === 'answer'); assert.ok(selected, 'the real selected embedded JavaScript declaration remains present');
    assert.equal(embedded.slice(selected.start, selected.end).includes('function answer'), true);
  } else if (mode === 'failed-parser') {
    assert.throws(() => html.buildHtmlChunks(embedded), error => error === primary,
      'initialization failure propagates instead of becoming empty chunks or another backend');
    assert.equal(loaded.has(jsUrl), true);
  } else {
    const controller = new AbortController(); controller.abort();
    assert.throws(() => html.buildHtmlChunks(embedded, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(loaded.has(treeUrl), false); assert.equal(loaded.has(jsUrl), false, 'an already cancelled first use cannot initialize parsers');
  }
  assertUnrelatedAbsent();
} finally {
  hooks.deregister();
  if (loaded.has(treeUrl)) await (await import(treeUrl)).shutdownTreeSitterWorkerPool();
}

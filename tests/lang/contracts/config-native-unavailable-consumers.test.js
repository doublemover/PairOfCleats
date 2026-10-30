import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const language = process.env.PAIROFCLEATS_TEST_ID?.split('lang/contracts/config-native-unavailable-consumers/')[1];
assert.ok(['xml', 'yaml'].includes(language));
const grammar = '@tree-sitter-grammars/tree-sitter-' + language;
const unavailable = Object.freeze(Object.assign(new Error('named unavailable grammar-package resolution boundary'), { code: 'MODULE_NOT_FOUND' }));
let attempts = 0;
// Fail only the original owner's exact grammar-package load. Do not replace
// parser/chunker exports, invent AST nodes or disable the requested backend.
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier === grammar) { attempts++; throw unavailable; }
  return next(specifier, context);
} });
try {
  const { getNativeTreeSitterParser, loadNativeTreeSitterGrammar, getNativeTreeSitterIdentity } = await import('../../../src/lang/tree-sitter/native-runtime.js');
  const { treeSitterState } = await import('../../../src/lang/tree-sitter/state.js');
  const { smartChunk } = await import('../../../src/index/chunking/dispatch.js');
  const { createProcessChunksFixtureContext, processFixtureChunks } = await import('../../indexing/file-processor/process-chunks-fixture.js');
  const enabled = { enabled: true, strict: false, adaptive: false, chunkCache: false, configChunking: true };
  const text = language === 'xml'
    ? '<?xml version="1.0"?>\n<!-- prologsentinel -->\n<root marker="rootmarker">before<a>alpha</a>between<![CDATA[inert <x>]]><b>beta</b>after</root><!-- trailing -->'
    : '%YAML 1.2\n---\n# leading\nfirst: alpha\n---\n- nativedocumentmarker\n---\n{last: finalflow}\n...\n';
  const chunker = language === 'xml' ? (await import('../../../src/index/chunking/formats/xml.js')).chunkXml
    : (await import('../../../src/index/chunking/formats/yaml.js')).chunkYaml;
  const call = (treeSitter, limited = false) => {
    const context = { treeSitter, yamlChunking: { mode: 'top-level' }, ...(limited ? { chunking: { maxBytes: 40, maxLines: 2 } } : {}) };
    return limited ? smartChunk({ text, ext: '.' + language, relPath: 'stream.' + language, mode: 'code', context })
      : language === 'xml' ? chunker(text, context) : chunker(text, 'stream.yaml', context);
  };
  const disabled = call({ ...enabled, enabled: false }); assert.equal(attempts, 0, 'explicitly disabled is a distinct route');
  const before = treeSitterState.metrics.fallbacks;
  const chunks = call(enabled); assert.ok(attempts > 0, 'actual native grammar load must reach the named unavailable boundary');
  assert.equal(getNativeTreeSitterParser(language, { treeSitter: enabled }), null);
  assert.equal(loadNativeTreeSitterGrammar(language).error, unavailable);
  assert.equal(getNativeTreeSitterIdentity(language), null);
  assert.ok(treeSitterState.metrics.fallbacks > before);
  const sourceCoverage = rows => {
    const coverage = new Uint8Array(text.length);
    for (const chunk of rows) {
      assert.ok(chunk.start >= 0 && chunk.end > chunk.start && chunk.end <= text.length);
      coverage.fill(1, chunk.start, chunk.end);
      assert.notEqual(chunk.meta.structuralRangeSource, 'native-node');
      assert.notEqual(chunk.meta.nativeParser, 'tree-sitter');
    }
    assert.ok(coverage.every(Boolean));
  };
  sourceCoverage(chunks); sourceCoverage(call(enabled, true)); sourceCoverage(disabled);
  if (language === 'yaml') {
    assert.equal(chunks.map(chunk => text.slice(chunk.start, chunk.end)).join(''), text);
    const marker = text.indexOf('nativedocumentmarker'), owners = chunks.filter(chunk => chunk.start <= marker && chunk.end > marker);
    assert.equal(owners.length, 1); assert.equal(owners[0].meta.documentIndex, 1);
    assert.equal(owners[0].meta.nativeRouteReason, 'native-structure-unavailable-or-unselected');
    assert.equal(chunks.at(-1).meta.documentIndex, 2);
  }
  const { context } = createProcessChunksFixtureContext({ text, ext: '.' + language, languageId: language,
    rel: 'stream.' + language, riskAnalysisEnabled: false, typeInferenceEnabled: false, overrides: { sc: chunks } });
  const indexed = await processFixtureChunks(context);
  for (const marker of language === 'xml' ? ['prologsentinel', 'rootmarker'] : ['nativedocumentmarker', 'finalflow']) {
    assert.ok(indexed.chunks.some(chunk => chunk.tokens.includes(marker)), marker + ' remains in actual indexed payload');
  }
  console.log(JSON.stringify({ language, route: 'requested-native;exact-package-resolution-unavailable', attempts,
    parser: 'application structural owner', assertions: 'source/document/limit/indexed-consumer;not-installed-positive' }));
} finally { hook.deregister(); }

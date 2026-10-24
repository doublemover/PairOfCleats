import assert from 'node:assert/strict';
import { buildLanguageContext } from '../../../src/index/language-registry.js';
import { syntaxRelationsForChunks } from '../../../src/lang/tree-sitter/call-facts.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
for (const [ext, key, text] of [
  ['.rs', 'rustChunks', 'fn target(value: i32) {} fn empty() {} fn caller() { target(7); empty(); }'],
  ['.cpp', 'clikeChunks', 'void target(int value) {} void empty() {} void caller() { target(7); empty(); }']
]) {
  const input = { text, ext, relPath: `native${ext}`, mode: 'code', options: {
    treeSitter: { enabled: true, strict: true, chunkCache: false, adaptive: false }, astDataflowEnabled: false, controlFlowEnabled: false } };
  const { context } = await buildLanguageContext(input), chunks = context[key];
  assert.ok(chunks?.length, 'actual supported native parser must activate');
  const relations = syntaxRelationsForChunks(chunks);
  const details = relations.callDetails.filter(detail => ['target', 'empty'].includes(detail.callee));
  assert.equal(details.length, 2);
  assert.ok(details.every(detail => detail.source === 'tree-sitter'));
  const sites = JSON.parse(JSON.stringify(createCallSites({ chunks: [{ file: input.relPath, lang: ext === '.rs' ? 'rust' : 'clike',
    chunkUid: 'native-caller', codeRelations: { callDetails: details.map(detail => ({ ...detail, targetChunkUid: detail.callee })) } }] })));
  assert.equal(validateArtifact('call_sites', sites).ok, true);
  assert.equal(sites.find(site => site.calleeRaw === 'target').extensions.arguments.arity.min, 1);
  assert.equal(sites.find(site => site.calleeRaw === 'empty').extensions.arguments.arity.min, 0);
  assert.ok(sites.every(site => site.args.length === 0), 'no display operands were invented');
  // Known fixture signatures isolate the actual operand handoff from native
  // formal-language parsing. Production native formal authority stays unknown.
  const symbols = [{ symbolId: 'symbol:target', chunkUid: 'target', file: 'fixture.js', signature: 'target(value)' },
    { symbolId: 'symbol:empty', chunkUid: 'empty', file: 'fixture.js', signature: 'empty()' }];
  const report = buildApiContractsReport({ symbols, callSites: sites, indexSignature: 'native-generation', indexCompatKey: 'native-compat' });
  assert.ok(!report.warnings?.length);
  const unknown = sites.map(site => ({ ...site, extensions: { ...site.extensions, arguments: undefined } }));
  const missing = buildApiContractsReport({ symbols, callSites: unknown, indexSignature: 'native-generation', indexCompatKey: 'native-compat' });
  assert.ok(missing.symbols.every(entry => entry.observedCalls.every(call => call.arity === null)));
  assert.ok(missing.warnings.every(warning => warning.code === 'CALL_ARGUMENT_AUTHORITY_UNAVAILABLE'));
}
console.log('real Rust/C++ argument-list counts survive canonical publication without invented zero operands');

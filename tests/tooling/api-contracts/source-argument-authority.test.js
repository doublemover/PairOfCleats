import assert from 'node:assert/strict';
import { parseJavaScriptAst, getJavaScriptSyntaxIdentity } from '../../../src/lang/javascript/parse.js';
import { buildCodeRelations } from '../../../src/lang/javascript/relations.js';
import { buildTypeScriptChunksFromBabel } from '../../../src/lang/typescript/chunks-babel.js';
import { buildTypeScriptRelations } from '../../../src/lang/typescript/relations.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { summarizeCallableParameters } from '../../../src/contracts/callable-parameters.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';
import { API_CONTRACT_REPORT_VERSION } from '../../../src/contracts/schemas/api-contracts.js';

const counts = [0, 5, 6, 16, 17, 300];
const text = counts.map(n => `function target${n}(${Array.from({ length: n }, (_, i) => `p${i}`).join(',')}) {}`).join('\n')
  + `\nfunction caller(items) { ${counts.map(n => `target${n}(${Array.from({ length: n }, () => '1').join(',')});`).join(' ')} target6(1); target6(...items); }`;
for (const parser of ['acorn', 'babel', 'typescript']) {
  const file = parser === 'typescript' ? 'args.ts' : 'args.js';
  let relations, contracts;
  if (parser === 'typescript') {
    const chunks = buildTypeScriptChunksFromBabel(text, { ext: '.ts' });
    relations = buildTypeScriptRelations(text, chunks, { ext: '.ts' });
    contracts = Object.fromEntries(chunks.map(chunk => [chunk.name, chunk.meta.callableParameters]));
  } else {
    const ast = parseJavaScriptAst(text, { parser }); assert.equal(getJavaScriptSyntaxIdentity(ast)?.family, parser);
    relations = buildCodeRelations(text, file, { ast });
    contracts = Object.fromEntries(Object.entries(relations.functionMeta).map(([name, meta]) => [name, meta.callableParameters]));
  }
  const symbols = counts.map(n => ({ symbolId: `symbol:${n}`, chunkUid: `target:${n}`, name: `target${n}`, file,
    signature: `target${n}(display)`, extensions: { callableParameters: summarizeCallableParameters(contracts[`target${n}`]) } }));
  // Explicit closed fixture target authority is independent of the argument test.
  const sites = JSON.parse(JSON.stringify(createCallSites({ chunks: [{ file, lang: parser === 'typescript' ? 'typescript' : 'javascript',
    chunkUid: 'caller', codeRelations: { callDetails: relations.callDetails.map(detail => ({ ...detail,
      targetChunkUid: `target:${detail.callee.slice('target'.length)}` })) } }] })));
  assert.equal(validateArtifact('call_sites', sites).ok, true);
  const input = { symbols, callSites: sites, indexSignature: 'argument-generation', indexCompatKey: 'argument-compat' };
  const report = buildApiContractsReport(input);
  assert.equal(report.version, API_CONTRACT_REPORT_VERSION);
  const mismatch = report.warnings.filter(warning => warning.code === 'ARITY_MISMATCH');
  assert.equal(mismatch.length, 1, 'only the real one-argument call to six required parameters is wrong');
  assert.equal(report.warnings.filter(warning => warning.code === 'CALL_ARGUMENT_AUTHORITY_UNAVAILABLE').length, 1);
  for (const n of counts) assert.ok(report.symbols.find(entry => entry.symbol.chunkUid === `target:${n}`)
    .observedCalls.some(call => call.arity === n));
  const six = sites.find(call => call.calleeRaw === 'target6' && call.extensions.arguments.arity.min === 6);
  assert.equal(six.args.length, 5);
  six.args = []; // Display trimming cannot change the independent count receipt.
  assert.equal(buildApiContractsReport(input).warnings.filter(warning => warning.code === 'ARITY_MISMATCH').length, 1);
  const missing = { ...six, callSiteId: 'missing-operands', extensions: { semanticRef: six.extensions.semanticRef } };
  const unknown = buildApiContractsReport({ ...input, callSites: [missing] });
  assert.equal(unknown.symbols.find(entry => entry.symbol.chunkUid === 'target:6').observedCalls[0].arity, null);
  assert.ok(unknown.warnings.some(warning => warning.code === 'CALL_ARGUMENT_AUTHORITY_UNAVAILABLE'));
  assert.ok(!unknown.warnings.some(warning => warning.code === 'ARITY_MISMATCH'));
  assert.throws(() => buildApiContractsReport({ ...input, failOnWarn: true }), error => error.code === 'ERR_API_CONTRACT_WARN');
}
console.log('qualified source arity survives bounded call previews, JSON reload, cleared display and unknown operands');

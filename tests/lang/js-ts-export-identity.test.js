import assert from 'node:assert/strict';
import { parseJavaScriptAst, buildJsChunks } from '../../src/lang/javascript.js';
import { buildTypeScriptChunksFromAst } from '../../src/lang/typescript/chunks-ast.js';
import { buildTypeScriptChunksFromBabel } from '../../src/lang/typescript/chunks-babel.js';
import { prepareTypeScriptBabelSyntax } from '../../src/lang/typescript/syntax-context.js';
import { resolveJsTsExports, MODULE_EXPORTS_VERSION } from '../../src/lang/js-ts-exports.js';
import { SEMANTIC_ANALYSIS_VERSIONS, semanticAnalysisPolicyIdentity } from '../../src/index/semantic/analysis-versions.js';
import { buildApiContractsReport as buildReport } from '../../src/integrations/tooling/api-contracts.js';
import { validateApiContracts } from '../../src/contracts/validators/analysis.js';
const buildApiContractsReport = options => buildReport({ indexCompatKey: 'export-identity-unit-fixture', ...options });

const text = `
// export function hidden() {}
function hidden(a,b) { return 'export { hidden }'; }
export function inline(a,b) { return a+b; }
export default function main(a,b) { return a+b; }
function aliased(a,b) { return a+b; }
const arrow = (a,b) => a+b;
export { aliased, aliased as renamed, arrow as arrowAlias };
export { remote as hidden } from 'other-module';
export class PublicClass { method() {} }
class InternalClass { method() {} }
`;
const expected = { inline: ['inline'], main: ['default'], aliased: ['aliased', 'renamed'],
  arrow: ['arrowAlias'], hidden: [], PublicClass: ['PublicClass'], InternalClass: [],
  'PublicClass.method': [], 'InternalClass.method': [] };
for (const parser of ['babel', 'acorn', 'esprima', 'typescript-ast', 'typescript-babel']) {
  const typescript = parser.startsWith('typescript-');
  const ast = typescript ? prepareTypeScriptBabelSyntax(text, { ext: '.ts' }) : parseJavaScriptAst(text, { parser });
  assert.ok(ast, parser);
  const chunks = parser === 'typescript-ast' ? buildTypeScriptChunksFromAst(text)
    : parser === 'typescript-babel' ? buildTypeScriptChunksFromBabel(text)
      : buildJsChunks(text, { ast });
  const kinds = chunks.map(chunk => chunk.kind);
  for (const [name, names] of Object.entries(expected)) {
    const chunk = chunks.find(entry => entry.name === name); assert.ok(chunk, `${parser}/${name}`);
    assert.deepEqual(resolveJsTsExports(ast, chunk), { exported: names.length > 0, exportNames: names }, `${parser}/${name}`);
  }
  assert.deepEqual(chunks.map(chunk => chunk.kind), kinds, 'export identity must not rewrite declaration kinds');
  const inline = chunks.find(chunk => chunk.name === 'inline');
  assert.deepEqual(resolveJsTsExports(ast, { ...inline, start: inline.end - 1 }),
    { exported: null, exportNames: [] }, 'a mismatched declaration span is not export authority');
}
for (const text of [
  'export default function(a,b) { return a+b; }',
  'export default (a,b) => a+b;'
]) {
  const ast = parseJavaScriptAst(text), chunks = buildJsChunks(text, { ast });
  assert.equal(chunks.length, 1);
  assert.deepEqual(resolveJsTsExports(ast, chunks[0]), { exported: true, exportNames: ['default'] });
  for (const build of [buildTypeScriptChunksFromAst, buildTypeScriptChunksFromBabel]) {
    const tsChunks = build(text, { ext: '.ts' });
    assert.ok(tsChunks?.length === 1, 'anonymous default APIs must also survive TypeScript chunking');
    assert.deepEqual(resolveJsTsExports(prepareTypeScriptBabelSyntax(text, { ext: '.ts' }), tsChunks[0]),
      { exported: true, exportNames: ['default'] });
  }
}
for (const build of [buildJsChunks, buildTypeScriptChunksFromAst, buildTypeScriptChunksFromBabel]) {
  const text = 'export default class { method() {} }';
  const ast = prepareTypeScriptBabelSyntax(text, { ext: '.ts' });
  const chunks = build(text);
  assert.deepEqual(chunks.map(chunk => chunk.name), ['default', 'default.method']);
  assert.deepEqual(resolveJsTsExports(ast, chunks[0]), { exported: true, exportNames: ['default'] });
  assert.deepEqual(resolveJsTsExports(ast, chunks[1]), { exported: false, exportNames: [] });
}
for (const [text, name, exported, names] of [
  ['exports.api = function(a,b) { return a+b; };', 'exports.api', true, ['api']],
  ['module.exports = function(a,b) { return a+b; };', 'module.exports', true, ['default']],
  ['const exports = {}; exports.api = function(a,b) { return a+b; };', 'exports.api', false, []],
  ["import module from 'elsewhere'; module.exports = function(a,b) { return a+b; };", 'module.exports', false, []],
  ['const object = {}; object.api = function(a,b) { return a+b; };', 'object.api', false, []]
]) {
  const ast = parseJavaScriptAst(text), chunk = buildJsChunks(text, { ast }).find(entry => entry.name === name);
  assert.ok(chunk); assert.deepEqual(resolveJsTsExports(ast, chunk), { exported, exportNames: names });
}
const malformed = parseJavaScriptAst('export const value = 1; export { value };');
assert.ok(malformed.errors.length > 0, 'recovered parser errors remain visible to export admission');
assert.deepEqual(resolveJsTsExports(malformed, { name: 'value', start: 13, end: 22 }), { exported: null, exportNames: [] });
assert.deepEqual(resolveJsTsExports(null, {}), { exported: null, exportNames: [] });
assert.equal(SEMANTIC_ANALYSIS_VERSIONS.moduleExports, MODULE_EXPORTS_VERSION);
const { moduleExports: _oldAbsent, ...oldVersions } = SEMANTIC_ANALYSIS_VERSIONS;
assert.notEqual(semanticAnalysisPolicyIdentity({ enrichment: {} }), semanticAnalysisPolicyIdentity({ enrichment: {} }, oldVersions));

const symbol = { symbolId: 'api', chunkUid: 'api-chunk', file: 'api.ts', lang: 'typescript',
  name: 'api', kind: 'FunctionDeclaration', signature: 'export function api(a,b)' };
const callSites = [{ callSiteId: 'bad', targetChunkUid: 'api-chunk', args: ['1'] }];
const report = buildApiContractsReport({ symbols: [{ ...symbol, exported: true }], callSites, onlyExports: true });
assert.equal(report.symbols.length, 1); assert.equal(report.warnings[0].code, 'ARITY_MISMATCH');
assert.equal(validateApiContracts(report).ok, true);
const internal = buildApiContractsReport({ symbols: [{ ...symbol, kind: 'ExportedFunction', exported: false }], callSites, onlyExports: true });
assert.equal(internal.symbols.length, 0); assert.equal(internal.warnings, null);
for (const legacy of [symbol, { ...symbol, kind: 'ExportedFunction' }, { ...symbol, exported: 'true' }]) {
  const unknown = buildApiContractsReport({ symbols: [legacy], callSites, onlyExports: true });
  assert.equal(unknown.symbols.length, 0); assert.equal(unknown.warnings[0].code, 'EXPORT_IDENTITY_UNAVAILABLE');
  assert.equal(validateApiContracts(unknown).ok, true);
  assert.throws(() => buildApiContractsReport({ symbols: [legacy], callSites, onlyExports: true,
    failOnWarn: true, caps: { maxWarnings: 0 } }), error => error.code === 'ERR_API_CONTRACT_WARN');
}
console.log('JS/TS module export identity, aliases, scope, parser and legacy controls passed');

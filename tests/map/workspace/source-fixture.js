import { prepareTypeScriptSyntax, getTypeScriptSyntaxIdentity } from '../../../src/lang/typescript/syntax-context.js';
import { createTypeScriptSemanticCollector, TYPESCRIPT_ADAPTER_VERSION } from '../../../src/index/semantic/typescript-collector.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { assertSemanticQuery } from '../../../src/contracts/validators/semantic-query.js';
export function sourceFixture() {
  const text = 'export function store(value: number) { const doubled = value * 2; return send(doubled); }\nexport const label = "Unicode 😀 / [literal]";';
  const source = createSemanticSourceSnapshot({ bytes: Buffer.from(text), repositoryNamespace: 'viewer-source-fixture', path: 'pipeline.ts', language: 'typescript' }).manifest;
  const syntax = prepareTypeScriptSyntax(text, { ext: '.ts' });
  const partitionId = createSyntaxPartitionId({ sourceUnitId: source.sourceUnitId, parser: getTypeScriptSyntaxIdentity(syntax.sourceFile),
    extractor: { schemaVersion: 1, version: TYPESCRIPT_ADAPTER_VERSION }, structuralPolicy: { structure: 'complete' } });
  const collector = createTypeScriptSemanticCollector({ ast: syntax.sourceFile, ts: syntax.ts, source, partitionId }, { batchRows: 32, batchBytes: 32768 });
  const rows = [...collector.batches].flatMap(batch => batch.rows);
  const family = name => rows.filter(entry => entry.family === name).map(entry => entry.row);
  const records = family('node').map(row => ({ ...row, ref: { partitionId, localId: row.id }, availableFieldGroups: ['span', 'scope', 'data'], omittedFieldGroups: [] }));
  const result = { schemaVersion: 1, generation: { baseBuildId: 'viewer-source-fixture', semanticRevision: 0 }, status: 'complete', records,
    edges: family('edge'), operands: family('operand'), ownership: family('ownership'),
    names: family('lookup').map(row => ({ partitionId, id: row.id, value: row.value })), evidenceRefs: [], frontier: [], cursor: null, warnings: [],
    coverage: { extraction: family('coverage').map(row => ({ ...row, partitionId })), analysis: [], response: { state: 'complete', returnedCount: records.length } } };
  assertSemanticQuery('detailResult', result);
  return { text, source, result };
}

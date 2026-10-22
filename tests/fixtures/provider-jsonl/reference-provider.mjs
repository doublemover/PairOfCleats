// Authored protocol producer fixture. It emits an explicitly supplied binding
// question; this is not a language analyzer or an upstream-tool qualification.
import { semanticHash, createSymbolGroupId } from '../../../src/index/semantic/identity.js';
let retained = 0;
const chunks = [];
for await (const chunk of process.stdin) {
  retained += chunk.length;
  if (retained > 1048576) throw new Error('Reference input budget exhausted.');
  chunks.push(chunk);
}
const request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
const question = request.questions[0], target = request.targets.find(value => value.sourceUnitId === question.sourceUnitId);
if (!target || request.resultKind !== 'canonical-rows-v1') throw new Error('Reference binding question is not admitted.');
const evidence = { partitionId: target.partitionId, localId: 0 }, binding = { partitionId: target.partitionId, localId: 1 };
const rows = [
  { family: 'node', row: { id: 0, kind: 'evidence', span: question.span, scope: null,
    data: { method: 'reference-fixture/binding', producerId: 'reference-fixture', producerVersion: '1',
      evidenceKind: 'authored-binding-fixture', sourceRef: target.sourceUnitId, artifactRef: null } } },
  { family: 'node', row: { id: 1, kind: 'binding', span: question.span, scope: null,
    data: { occurrence: question.occurrenceRef, contextKey: request.contextHash, status: 'resolved', signature: null,
      symbolGroupId: createSymbolGroupId({ contextKey: request.contextHash, declarations: [question.declarationRef] }), candidateCount: 1 } } },
  ...[['bindingCandidate', binding], ['references', question.occurrenceRef]].map(([kind, from], id) => ({
    family: 'edge', row: { id, kind, from, to: question.declarationRef, callSite: null, operandOrdinal: null,
      contextKey: request.contextHash, condition: null, evidence, certainty: 'exact-static' }
  }))
];
const semanticRows = { sourceUnitId: target.sourceUnitId, rows };
const output = { schemaVersion: 1, kind: 'canonical-rows-v1', batches: [semanticRows] };
for (const message of [
  { type: 'hello', protocolVersion: 1, requestId: request.requestId, requestHash: semanticHash('tooling.jsonl-request.v1', request) },
  { type: 'batch', requestId: request.requestId, sequence: 0, semanticRows },
  { type: 'final', requestId: request.requestId, complete: true, batchCount: 1, partitionCount: 1,
    outputHash: semanticHash('tooling.jsonl-rows.v1', output) }
]) process.stdout.write(JSON.stringify(message) + '\n');

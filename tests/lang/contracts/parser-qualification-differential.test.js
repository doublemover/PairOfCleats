import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeParserQualification, compareParserQualification, qualifyParserCorpus } from '../../../src/lang/parser-qualification.js';

const bytes = Buffer.from('const value = "😀";\r\nvalue();');
const result = { sourceHash: createHash('sha256').update(bytes).digest('hex'), status: 'accepted',
  parserIdentity: { family: 'authored-fixture', version: '1', grammarHash: 'a'.repeat(64) },
  nodes: [{ kind: 'Identifier', span: [6, 11] }], chunks: [{ kind: 'declaration', span: [0, 19] }],
  declarations: [{ name: 'value', span: [6, 11] }], imports: [], exports: [],
  calls: [{ kind: 'call', name: 'value', span: [21, 28] }], segments: [] };
const before = normalizeParserQualification({ bytes, result });
const different = structuredClone(result); different.parserIdentity.version = '2'; different.calls = [];
const after = normalizeParserQualification({ bytes, result: different });
const comparison = compareParserQualification({ caseId: 'unicode-crlf', before, after });
assert.equal(comparison.state, 'regression', 'clean parser success does not hide a lost consumer call');
assert.equal(comparison.differences[0].family, 'calls');
const waiver = { caseId: 'unicode-crlf', ...comparison.differences[0], reason: 'reviewed fixture-only delta' };
assert.equal(compareParserQualification({ caseId: 'unicode-crlf', before, after, intentionalDifferences: [waiver] }).state, 'intentional-difference');
assert.equal(compareParserQualification({ caseId: 'another-case', before, after, intentionalDifferences: [waiver] }).state, 'regression');
const split = structuredClone(result); split.nodes[0].span = [16, 17];
assert.throws(() => normalizeParserQualification({ bytes, result: split }), { code: 'ERR_PARSER_QUALIFICATION' });
const segments = structuredClone(result); segments.segments = [{ span: [0, 5], text: 'wrong', mappingQuality: 'exact' }];
assert.throws(() => normalizeParserQualification({ bytes, result: segments }), { code: 'ERR_PARSER_QUALIFICATION' });
let disposed = 0;
const baseline = { inspect: async () => ({ ...result, dispose: () => { disposed++; } }) };
const candidate = { inspect: async () => { throw new Error('candidate parse failed'); } };
await assert.rejects(qualifyParserCorpus({ cases: [{ id: 'partial-source', bytes }], baseline, candidate }), /candidate parse failed/u);
assert.equal(disposed, 1);
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(qualifyParserCorpus({ cases: [{ id: 'cancelled', bytes }], baseline, candidate, signal: cancelled.signal }), { name: 'AbortError' });
console.log('parser consumer differential, exact intentional deltas, Unicode mapping and disposal');

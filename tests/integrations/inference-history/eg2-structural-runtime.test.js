import { ARTIFACT_PROJECTION_VERSION } from '../../../src/integrations/inference-history/artifact-projection.js';
import { archiveStructuralSpans } from '../../../src/integrations/inference-history/archive-structure.js';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { archiveDocumentInput } from '../../../src/integrations/inference-history/document-input.js';
import { planArchiveUnitSpans, boundArchiveTokenSpans, createArchiveSourcePlan } from '../../../src/integrations/inference-history/archive-unit-spans.js';
import { createPersistentHistorySemanticIndex } from '../../../src/integrations/inference-history/persistent-semantic-index.js';

const whole = 'HTTPServer uses Unicode café identifiers and preserves comments with its function body.';
const details = { projectionVersion: ARTIFACT_PROJECTION_VERSION, sourceSha256: 'a'.repeat(64), locator: 'src/HTTPServer.js', artifactKind: 'code' };
const row = (id, start, end) => ({ id, text: whole.slice(start, end), metadata: JSON.stringify({ sourceDetails: { ...details, sanitizedStart: start, sanitizedEnd: end } }) });
const rows = [row('a', 0, 40), row('b', 40, whole.length)];
const config = { chunkChars: 1000, overlapChars: 200 };
for (const projectionVersion of [undefined, 'artifact-projection.v2']) {
  const stale = { ...rows[0], metadata: JSON.stringify({ sourceDetails: { ...details, projectionVersion, sanitizedStart: 0, sanitizedEnd: 40 } }) };
  assert.throws(() => planArchiveUnitSpans(stale, [stale, rows[1]], config), /explicit source reprojection and reimport/);
  assert.throws(() => planArchiveUnitSpans(rows[1], [stale, rows[1]], config), /explicit source reprojection and reimport/, 'older sibling cannot contaminate a current anchor');
}
const ownerRedacted = { id: 'redacted', text: 'Owner approved public remainder', metadata: JSON.stringify({ evidenceKind: 'recovered_artifact', ownerRedacted: true, sourceDetails: { projectionVersion: ARTIFACT_PROJECTION_VERSION } }) };
assert.ok(planArchiveUnitSpans(ownerRedacted, [ownerRedacted], config).every(span => span.text === ownerRedacted.text), 'current policy marker allows owner-redacted artifact without restoring original context');
const first = planArchiveUnitSpans(rows[0], rows, config), second = planArchiveUnitSpans(rows[1], rows, config);
assert.equal(first.length, 1); assert.equal(second.length, 1);
assert.equal(first[0].text, whole); assert.equal(second[0].text, whole);
assert.deepEqual([first[0].start, first[0].end], [0, 40]);
assert.deepEqual([second[0].start, second[0].end], [0, whole.length - 40]);
assert.match(first[0].title, /HTTPServer/);
assert.throws(() => planArchiveUnitSpans({ ...rows[0], metadata: JSON.stringify({ sourceDetails: details }) }, rows, config), /explicit source reimport/);
const split = await boundArchiveTokenSpans(first, async documents => documents.map(document => document.text.length + 20), 55);
assert.ok(split.length > 1);
assert.ok(split.every(span => span.text.length + 20 <= 55));
assert.equal(split.map(span => whole.slice(span.start, span.end)).join(''), whole.slice(0, 40));
assert.equal(archiveDocumentInput({ text: 'body', title: 'HTTPServer\n| café' }), 'title: HTTPServer café | text: body');
assert.notEqual(archiveDocumentInput({ text: 'body', title: 'One' }), archiveDocumentInput({ text: 'body', title: 'Two' }));

const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
db.exec(`
CREATE TABLE vault_meta(key TEXT PRIMARY KEY,value TEXT);
INSERT INTO vault_meta VALUES ('partition','test'),('reference_key','${'a'.repeat(64)}'),('generation','1'),('updated_at','2026-10-09T00:00:00Z');
CREATE TABLE records(id TEXT PRIMARY KEY,deleted INTEGER DEFAULT 0,excluded INTEGER DEFAULT 0,latest_snapshot TEXT);
CREATE TABLE units(id TEXT PRIMARY KEY,record_id TEXT REFERENCES records(id),text TEXT,metadata TEXT);
CREATE TABLE snapshot_units(unit_id TEXT,snapshot_id TEXT,path_state TEXT);
`);
for (const unit of rows) {
  db.prepare('INSERT INTO records(id,latest_snapshot) VALUES (?,?)').run(unit.id, 'snapshot');
  db.prepare('INSERT INTO units VALUES (?,?,?,?)').run(unit.id, unit.id, unit.text, unit.metadata);
  db.prepare('INSERT INTO snapshot_units VALUES (?,?,?)').run(unit.id, 'snapshot', 'present');
}
db.prepare('INSERT INTO units VALUES (?,?,?,?)').run('historical', 'a', 'OLD PRIVATE SNAPSHOT', '{}');
db.prepare('INSERT INTO snapshot_units VALUES (?,?,?)').run('historical', 'old-snapshot', 'present');
const inputs = [];
const runtime = {
  config: { ...config, documentIdentityKey: 'structural', documentIdentity: {}, fullDimensions: 4, profile: { dimensions: 4, revision: 'fixture' }, batchSize: 2 },
  effectiveInput: archiveDocumentInput,
  measureBatch: async documents => documents.map(document => archiveDocumentInput(document).length),
  prepareBatch: async documents => documents.map(document => ({ text: archiveDocumentInput(document), tokenLength: archiveDocumentInput(document).length })),
  encodePrepared: async prepared => { inputs.push(...prepared.map(row => row.text)); return prepared.map(() => [1, 1, 1, 1]); }
};
const index = createPersistentHistorySemanticIndex(db, runtime);
const indexed = await index.refresh({ maxUnits: 10 });
assert.equal(indexed.totalUnits, 2, 'historical units are preserved but never admitted to current semantic scope');
assert.equal(indexed.scope, 'latest_snapshot_visible_redacted_projected_text');
assert.equal(db.prepare('SELECT text FROM units WHERE id=?').get('historical').text, 'OLD PRIVATE SNAPSHOT');
assert.equal(indexed.sourcePreparation.siblingQueries, 1);
assert.equal(indexed.sourcePreparation.reconstructions, 1);
assert.equal(indexed.sourcePreparation.structuralParses, 1);
assert.equal(indexed.sourcePreparation.dependencyChecks, 2, 'each sibling is revalidated once per transaction, despite multiple occurrences');
assert.equal(indexed.indexedUnits, 2); assert.equal(indexed.uniqueInputs, 1);
assert.equal(indexed.sourcePreparation.siblingQueries, 1);
assert.equal(indexed.sourcePreparation.reconstructions, 1);
assert.equal(indexed.sourcePreparation.structuralParses, 1);
assert.equal(indexed.sourcePreparation.dependencyChecks, rows.length, 'shared sibling dependencies are checked once per transaction');
assert.equal(inputs.length, 1, 'full contextual input is encoded once and fanned out to exact fragment citations');
assert.ok(inputs[0].endsWith(whole));
assert.deepEqual(db.prepare('SELECT unit_id,start,end FROM history_embedding_spans_v2 ORDER BY unit_id').all(), [{ unit_id: 'a', start: 0, end: 40 }, { unit_id: 'b', start: 0, end: whole.length - 40 }]);
db.prepare('UPDATE units SET text=replace(text,?,?) WHERE id=?').run('body.', 'body!', 'b');
const originalEncode = runtime.encodePrepared; let staleEdited = false;
runtime.encodePrepared = async prepared => {
  if (!staleEdited) { staleEdited = true; db.prepare('UPDATE units SET text=replace(text,?,?) WHERE id=?').run('HTTPServer', 'HTTPClient', 'a'); }
  return originalEncode(prepared);
};
await assert.rejects(index.refresh({ maxUnits: 10 }), { code: 'ERR_INFERENCE_HISTORY_STALE' });
assert.equal(index.status().uniqueInputs, 0, 'a sibling edit during encoding cannot publish a cached source plan');
runtime.encodePrepared = originalEncode;
const refreshed = await index.refresh({ maxUnits: 10 });
assert.equal(refreshed.sourcePreparation.reconstructions, 1, 'each refresh reconstructs the current source once');
assert.equal(refreshed.sourcePreparation.structuralParses, 1);
db.prepare('UPDATE records SET excluded=1 WHERE id=?').run('b');
assert.equal(index.status().indexedUnits, 0, 'hiding one fragment invalidates sibling vectors containing that fragment');
assert.equal(index.status().uniqueInputs, 0);
await index.refresh({ maxUnits: 10 });
assert.equal(inputs.at(-1).endsWith(db.prepare('SELECT text FROM units WHERE id=?').get('a').text), true, 'hidden sibling never reaches tokenizer/model input');
db.prepare('UPDATE units SET text=text||? WHERE id=?').run('!', 'b');
assert.equal(index.status().indexedUnits, 0, 'sibling edits invalidate every cross-fragment vector');
db.close();
console.log('Contextual source reassembly, exact occurrence offsets, token fallback and duplicate cache identity passed (no model).');



// Real inventory sources reach 11.48M UTF-16 characters across ~2,871 fragments.
// The source budget applies to reconstruction; the 5,000-span budget applies per unit.
const largeText = 'HTTPServer keeps exact sanitized source offsets. '.repeat(240000).slice(0, 11480000);
assert.ok(largeText.length > 11000000);
const largeRows = [];
for (let start = 0; start < largeText.length; start += 4000) {
  const end = Math.min(largeText.length, start + 4000);
  largeRows.push({ id: String(start).padStart(12, '0'), text: largeText.slice(start, end), metadata: JSON.stringify({ sourceDetails: { ...details, locator: 'large.txt', artifactKind: 'document', sanitizedStart: start, sanitizedEnd: end } }) });
}
assert.ok(largeRows.length < 5000);
const largePlan = createArchiveSourcePlan(largeRows, config);
assert.equal(largePlan.statistics.reconstructions, 1);
assert.equal(largePlan.statistics.structuralParses, 1);
assert.ok(largePlan.statistics.spans > 5000 && largePlan.statistics.spans <= 65536);
for (const ordinal of [0, Math.floor(largeRows.length / 2), largeRows.length - 1]) {
  const unit = largeRows[ordinal], unitDetails = JSON.parse(unit.metadata).sourceDetails;
  const planned = planArchiveUnitSpans(unit, largeRows, config, largePlan);
  assert.ok(planned.length > 0 && planned.length < 12, 'output allocation is limited to this transport unit');
  const covered = new Uint8Array(unit.text.length);
  for (const span of planned) {
    assert.equal(span.text, largeText.slice(span.sourceStart, span.sourceEnd));
    assert.ok(span.start >= 0 && span.end <= unit.text.length && span.start < span.end);
    covered.fill(1, span.start, span.end);
    assert.equal(unit.text.slice(span.start, span.end), largeText.slice(unitDetails.sanitizedStart + span.start, unitDetails.sanitizedStart + span.end));
  }
  assert.ok(covered.every(value => value === 1), 'all source characters retain exact occurrence coverage');
}
const sample = '// HTTPServer context\nfunction server() {\n' + '  return café;\n'.repeat(30) + '}\n';
const all = archiveStructuralSpans(sample, { locator: 'server.js', artifactKind: 'code', chunkChars: 80, overlapChars: 20 });
assert.deepEqual(archiveStructuralSpans(sample, { locator: 'server.js', artifactKind: 'code', chunkChars: 80, overlapChars: 20, intersectStart: 121, intersectEnd: 200 }), all.filter(span => span.start < 200 && span.end > 121), 'intersection filtering preserves identical source-global fallback alignment');
assert.throws(() => archiveStructuralSpans(sample, { intersectStart: -1 }), /intersection/);
console.log('11.48M-character source planning admits bounded first/middle/final unit spans with complete exact offset coverage (no model).');



const grouped = new Database(':memory:'); grouped.pragma('foreign_keys=ON');
grouped.exec(`
CREATE TABLE vault_meta(key TEXT PRIMARY KEY,value TEXT);
INSERT INTO vault_meta VALUES ('partition','test'),('reference_key','${'a'.repeat(64)}'),('generation','1'),('updated_at','2026-10-09T00:00:00Z');
CREATE TABLE records(id TEXT PRIMARY KEY,deleted INTEGER DEFAULT 0,excluded INTEGER DEFAULT 0,latest_snapshot TEXT);
CREATE TABLE units(id TEXT PRIMARY KEY,record_id TEXT REFERENCES records(id),text TEXT,metadata TEXT);
CREATE TABLE snapshot_units(unit_id TEXT,snapshot_id TEXT,path_state TEXT);
`);
const addRecord = grouped.prepare('INSERT INTO records(id,latest_snapshot) VALUES (?,?)');
const addUnit = grouped.prepare('INSERT INTO units VALUES (?,?,?,?)');
const addSnapshot = grouped.prepare('INSERT INTO snapshot_units VALUES (?,?,?)');
grouped.transaction(() => {
  for (const row of largeRows) { addRecord.run(row.id, 'snapshot'); addUnit.run(row.id, row.id, row.text, row.metadata); addSnapshot.run(row.id, 'snapshot', 'present'); }
})();
let nativeCalls = 0;
const groupedRuntime = { ...runtime, encodePrepared: async prepared => { nativeCalls++; return prepared.map(() => [1, 1, 1, 1]); } };
const groupedIndex = createPersistentHistorySemanticIndex(grouped, groupedRuntime);
const groupedResult = await groupedIndex.refresh({ maxUnits: 3 });
assert.equal(groupedResult.indexedUnits, 3);
assert.equal(groupedResult.sourcePreparation.siblingQueries, 1);
assert.equal(groupedResult.sourcePreparation.reconstructions, 1);
assert.equal(groupedResult.sourcePreparation.structuralParses, 1, 'one full parse handles consecutive source units');
assert.ok(groupedResult.sourcePreparation.peakPlanSpans > 5000);
assert.equal(groupedResult.sourcePreparation.dependencyChecks, nativeCalls * largeRows.length, 'all siblings checked once in each native transaction');
const finalId = largeRows.at(-1).id;
grouped.prepare('UPDATE units SET text=? WHERE id=?').run('X' + largeRows.at(-1).text.slice(1), finalId);
assert.equal(groupedIndex.status().indexedUnits, 0);
const edited = await groupedIndex.refresh({ maxUnits: 1 });
assert.equal(edited.sourcePreparation.structuralParses, 1, 'a fresh refresh never reuses an edited source plan');
grouped.prepare('UPDATE records SET excluded=1 WHERE id=?').run(finalId);
assert.equal(groupedIndex.status().indexedUnits, 0);
const hidden = await groupedIndex.refresh({ maxUnits: 1 });
assert.equal(hidden.totalUnits, largeRows.length - 1);
assert.equal(hidden.sourcePreparation.structuralParses, 1, 'hiding a sibling forces a fresh authorized source plan');
grouped.close();
assert.throws(() => archiveStructuralSpans('a'.repeat(100000), { chunkChars: 80, overlapChars: 79, maxSpans: 65536, maxSpanChars: 64 * 1024 * 1024 }), { code: 'ERR_INFERENCE_HISTORY_LIMIT' });
assert.throws(() => archiveStructuralSpans('abc'.repeat(100), { maxSpans: 100, maxSpanChars: 50 }), { code: 'ERR_INFERENCE_HISTORY_LIMIT' });
console.log('Bounded source-group reuse performs one query/reconstruction/parse, rechecks every sibling once per transaction, and invalidates edited/hidden groups (no model).');
assert.throws(() => archiveStructuralSpans('x'.repeat(10000), { chunkChars: 80, overlapChars: 79, maxSpans: 32, maxSpanChars: 100000 }), { code: 'ERR_INFERENCE_HISTORY_LIMIT' }, 'pathological overlap fails before an unbounded full plan is allocated');
assert.throws(() => archiveStructuralSpans('x'.repeat(1000), { chunkChars: 80, overlapChars: 20, maxSpans: 100, maxSpanChars: 30 }), { code: 'ERR_INFERENCE_HISTORY_LIMIT' });
for (const [text, start, end, size] of [['abc\nxyz', 0, 4, 4], ['abc\nxyz', 3, 6, 3], ['no-newline', 2, 6, 4], ['\nabcdef\n', 2, 6, 4]]) {
  const oldLine = text.lastIndexOf('\n', end), boundedLine = text.slice(start, end + 1).lastIndexOf('\n');
  assert.equal(oldLine > start + size / 2 ? oldLine + 1 : end, boundedLine > size / 2 ? start + boundedLine + 1 : end, 'bounded newline search preserves the frozen fallback boundary');
}

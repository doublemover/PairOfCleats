import { ARTIFACT_PROJECTION_VERSION } from '../../../src/integrations/inference-history/artifact-projection.js';
import { archiveStructuralSpans } from '../../../src/integrations/inference-history/archive-structure.js';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { archiveDocumentInput } from '../../../src/integrations/inference-history/document-input.js';
import { planArchiveUnitSpans, boundArchiveTokenSpans } from '../../../src/integrations/inference-history/archive-unit-spans.js';
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
assert.equal(indexed.indexedUnits, 2); assert.equal(indexed.uniqueInputs, 1);
assert.equal(inputs.length, 1, 'full contextual input is encoded once and fanned out to exact fragment citations');
assert.ok(inputs[0].endsWith(whole));
assert.deepEqual(db.prepare('SELECT unit_id,start,end FROM history_embedding_spans_v2 ORDER BY unit_id').all(), [{ unit_id: 'a', start: 0, end: 40 }, { unit_id: 'b', start: 0, end: whole.length - 40 }]);
db.prepare('UPDATE records SET excluded=1 WHERE id=?').run('b');
assert.equal(index.status().indexedUnits, 0, 'hiding one fragment invalidates sibling vectors containing that fragment');
assert.equal(index.status().uniqueInputs, 0);
await index.refresh({ maxUnits: 10 });
assert.equal(inputs.at(-1).endsWith(rows[0].text), true, 'hidden sibling never reaches tokenizer/model input');
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
for (const ordinal of [0, Math.floor(largeRows.length / 2), largeRows.length - 1]) {
  const unit = largeRows[ordinal], unitDetails = JSON.parse(unit.metadata).sourceDetails;
  const planned = planArchiveUnitSpans(unit, largeRows, config);
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



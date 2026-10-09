import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { prepareFileEvidenceArtifacts } from '../../../src/integrations/inference-history/artifact-preparation.js';import assert from 'node:assert/strict';
import { archiveStructuralSpans } from '../../../src/integrations/inference-history/archive-structure.js';
import { digest, DEFAULT_LIMITS } from '../../../src/integrations/inference-history/common.js';
import { ARTIFACT_PROJECTION_VERSION, projectArtifact, sanitizeArtifactJson } from '../../../src/integrations/inference-history/artifact-projection.js';
import { normalizeHistoryRecord } from '../../../src/integrations/inference-history/records.js';
import { sanitizeEmbeddedAssetText } from '../../../src/integrations/inference-history/embedded-assets.js';
const payload = Buffer.from('binary asset bytes '.repeat(40)).toString('base64');
const audit = {};
const source = { image: 'data:image/png;base64,' + payload, nested: { image_base64: payload }, ordinary_code: payload,
  prose: 'before data:application/octet-stream;base64,' + payload + ' after', password: 'secret' };
const sanitized = sanitizeArtifactJson(source, 0, { audit });
assert.equal(sanitized.image.embedded_asset_omitted.media_type, 'image/png');
assert.equal(sanitized.image.embedded_asset_omitted.payload_sha256, digest(payload));
assert.equal(sanitized.nested.image_base64.embedded_asset_omitted.encoded_chars, payload.length);
assert.equal(sanitized.ordinary_code, payload);
assert.ok(sanitized.prose.startsWith('before ')); assert.ok(sanitized.prose.endsWith(' after'));
assert.ok(!sanitized.prose.includes(payload)); assert.equal(Object.hasOwn(sanitized, 'password'), false);
assert.equal(audit.embeddedAssetPayloads, 3); assert.equal(audit.embeddedAssetEncodedChars, payload.length * 3);
assert.deepEqual(sanitizeArtifactJson(sanitized), sanitized);
const rawCode = 'const image = "data:image/png;base64,' + payload + '";\nfunction useAsset(){return image;}';
const records = projectArtifact({ text: rawCode, sourceSha256: 'a'.repeat(64), locator: 'assets.js', kind: 'code' });
const reconstructed = records.map(row => row.body).join('');
assert.ok(!reconstructed.includes(payload)); assert.ok(reconstructed.includes('function useAsset'));
assert.ok(reconstructed.includes('";\nfunction'));
assert.equal(records[0].provenance.projection_version, ARTIFACT_PROJECTION_VERSION);
assert.equal(records[0].provenance.transformation.original_end, rawCode.length);
assert.equal(normalizeHistoryRecord(records[0], 'recovered_artifact', DEFAULT_LIMITS).nodes[0].sourceDetails.projectionVersion, ARTIFACT_PROJECTION_VERSION);
assert.equal(sanitizeEmbeddedAssetText('ordinaryBase64 = ' + payload), 'ordinaryBase64 = ' + payload);
assert.equal(sanitizeEmbeddedAssetText('data:image/png,not-base64-data'), 'data:image/png,not-base64-data');
assert.equal(source.image, 'data:image/png;base64,' + payload);
console.log('narrow embedded asset payload omission preserves surrounding source, facts, original identity and audit counts');

assert.doesNotThrow(() => new Function(reconstructed));
const codeWithFunctions = '/** first asset consumer */\nfunction first(){ const asset = "data:image/png;base64,' + payload + '"; return asset; }\n\n/** second consumer */\nfunction second(){return 2;}';
const codeRecords = projectArtifact({ text: codeWithFunctions, sourceSha256: 'a'.repeat(64), locator: 'consumers.js', kind: 'code' });
const safeCode = codeRecords.map(row => row.body).join('');
assert.doesNotThrow(() => new Function(safeCode));
const safeSpans = archiveStructuralSpans(safeCode, { locator: 'consumers.js', kind: 'code', chunkChars: 1000, overlapChars: 200 });
assert.equal(safeSpans.length, 2); assert.ok(safeSpans[0].title.includes('first')); assert.ok(safeSpans[1].title.includes('second'));
assert.ok(safeSpans[0].text.includes('first asset consumer')); assert.ok(safeSpans[1].text.includes('second consumer'));
assert.equal(safeSpans.map(row => row.text).join(''), safeCode);

// Catalog normalization happens before projection: mapping still covers the recovered source.
const originalJsonText = JSON.stringify(source);
const safeJsonText = JSON.stringify(sanitized, null, 2);
const jsonRecords = projectArtifact({ text: safeJsonText, sourceSha256: 'b'.repeat(64), locator: 'source.json',
  originalTextChars: originalJsonText.length, sourceTransformed: true });
assert.equal(jsonRecords[0].provenance.transformation.original_end, originalJsonText.length);
assert.equal(jsonRecords[0].provenance.transformation.sanitized_end, safeJsonText.length);
assert.equal(jsonRecords[0].provenance.transformation.kind, 'redacted_coarse');
normalizeHistoryRecord(jsonRecords[0], 'recovered_artifact', DEFAULT_LIMITS);
const sameLengthChange = projectArtifact({ text: 'abc', sourceSha256: 'b'.repeat(64), locator: 'fixture.txt',
  originalTextChars: 3, sourceTransformed: true });
assert.equal(sameLengthChange[0].provenance.transformation.kind, 'redacted_coarse');
assert.throws(() => projectArtifact({ text: 'safe', sourceSha256: 'b'.repeat(64), originalTextChars: -1 }));
assert.throws(() => projectArtifact({ text: 'safe', sourceSha256: 'b'.repeat(64), sourceTransformed: 'yes' }));


const fixtureBase = path.resolve('temp/tasks/archive-source-mapping');
await fs.mkdir(fixtureBase, { recursive: true });
const fixtureRoot = await fs.realpath(await fs.mkdtemp(path.join(fixtureBase, 'catalog-')));
const catalog = path.join(fixtureRoot, 'file-evidence.sqlite');
const fixtureDb = new Database(catalog);
fixtureDb.exec('CREATE TABLE meta(key TEXT,value TEXT); CREATE TABLE sources(id INTEGER,name TEXT,sha256 TEXT); CREATE TABLE documents(sha256 TEXT,format TEXT,text TEXT,status TEXT)');
fixtureDb.prepare('INSERT INTO meta VALUES(?,?)').run('format', 'private-file-evidence.v1');
fixtureDb.prepare('INSERT INTO sources VALUES(?,?,?)').run(1, 'source.json', 'b'.repeat(64));
const fixtureJsonText = JSON.stringify({ ...source, activity_messages: [{ message: { author: { role: 'assistant' }, channel: 'analysis', content: { parts: ['synthetic hidden item'] } } }] });
fixtureDb.prepare('INSERT INTO documents VALUES(?,?,?,?)').run('b'.repeat(64), 'json', fixtureJsonText, 'supported');
const html = '<html><body>retained readable label</body></html>';
fixtureDb.prepare('INSERT INTO sources VALUES(?,?,?)').run(2, 'source.html', 'c'.repeat(64));
fixtureDb.prepare('INSERT INTO documents VALUES(?,?,?,?)').run('c'.repeat(64), 'html', html, 'supported');
fixtureDb.close();
const preparedRoot = path.join(fixtureRoot, 'prepared');
const preparation = await prepareFileEvidenceArtifacts({ catalogPaths: [catalog], outputRoot: preparedRoot,
  authorizePaths: ({ catalogPaths, outputRoot }) => catalogPaths[0] === catalog && outputRoot === preparedRoot });
assert.equal(preparation.unsafeRecordsOmitted, 0);
assert.equal(preparation.hiddenActivityOmitted, 1);
assert.equal(preparation.omissionLedger[0].reason, 'hidden_activity');
assert.equal(preparation.omissionLedger[0].sourceSha256, 'b'.repeat(64));
assert.equal(preparation.omissionLedgerOverflow, 0);
assert.ok(!JSON.stringify(preparation.omissionLedger).includes('synthetic hidden item'));
const prepared = [];
for (const shard of preparation.shards) prepared.push(...JSON.parse(await fs.readFile(path.join(preparedRoot, shard.name))));
for (const row of prepared) {
  const sourceChars = row.provenance.source_sha256 === 'b'.repeat(64) ? fixtureJsonText.length : html.length;
  assert.equal(row.provenance.transformation.original_end, sourceChars);
  assert.equal(row.provenance.transformation.kind, 'redacted_coarse');
  normalizeHistoryRecord(row, 'recovered_artifact', DEFAULT_LIMITS);
}
console.log('JSON and HTML catalog preparation retain original decoded-source transformation extents');

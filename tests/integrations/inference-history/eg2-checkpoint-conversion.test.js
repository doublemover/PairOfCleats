import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { digest } from '../../../src/integrations/inference-history/common.js';
import { resolveArchiveEmbeddingOptions } from '../../../src/integrations/inference-history/embedding-runtime.js';
import { historySemanticSpans } from '../../../src/integrations/inference-history/semantic-values.js';
import { convertEg2Checkpoint, hashFile, PINNED_GRAPH_SHA256, PINNED_TOKENIZER_SHA256 } from '../../../tools/history/eg2-convert-checkpoint.js';

const base = path.resolve('temp/tasks/eg2-checkpoint-conversion-tests');
await fs.mkdir(base, { recursive: true });
const root = await fs.mkdtemp(path.join(base, 'synthetic-'));
const source = path.join(root, 'source.sqlite'), destination = path.join(root, 'converted.sqlite');
const config = resolveArchiveEmbeddingOptions({ modelsDir: path.join(root, 'models'), chunkChars: 80, overlapChars: 20 });
const identity = { schema: 'history-eg2.v1', modelId: config.modelId, profile: config.fullProfile,
  task: config.task, queryPrefix: config.queryPrefix, passagePrefix: config.passagePrefix,
  chunkChars: config.chunkChars, overlapChars: config.overlapChars, chunker: config.chunker,
  normalization: 'truncate_then_l2' };
const key = digest(JSON.stringify(identity));
const db = new Database(source);
db.exec([
  'CREATE TABLE records(id TEXT PRIMARY KEY,deleted INTEGER,excluded INTEGER,latest_snapshot TEXT);',
  'CREATE TABLE units(id TEXT PRIMARY KEY,record_id TEXT REFERENCES records(id),text TEXT,metadata TEXT);',
  'CREATE TABLE vault_meta(key TEXT PRIMARY KEY,value TEXT);',
  'CREATE TABLE snapshot_units(snapshot_id TEXT,unit_id TEXT,path_state TEXT);',
  'CREATE TABLE history_embedding_meta(singleton INTEGER PRIMARY KEY,identity TEXT,identity_key TEXT);',
  'CREATE TABLE history_embedding_units(unit_id TEXT PRIMARY KEY REFERENCES units(id),content_hash TEXT,expected_spans INTEGER,complete INTEGER);',
  'CREATE TABLE history_embedding_spans(unit_id TEXT REFERENCES history_embedding_units(unit_id),start INTEGER,end INTEGER,vector BLOB,PRIMARY KEY(unit_id,start,end));'
].join('\n'));
db.prepare('INSERT INTO history_embedding_meta VALUES (1,?,?)').run(JSON.stringify({ ...identity, identityKey: key }), key);
db.prepare('INSERT INTO vault_meta VALUES (?,?)').run('generation', '42');
const vector = Buffer.alloc(768 * 4); vector.writeFloatLE(1, 0);
for (const [unitId, text, complete] of [['a','duplicate',1], ['b','duplicate',1], ['c','partial '.repeat(30),0]]) {
  db.prepare('INSERT INTO records VALUES (?,0,0,?)').run(unitId, 'snapshot-' + unitId);
  db.prepare('INSERT INTO units VALUES (?,?,?,?)').run(unitId,unitId,text,'{"private":"synthetic"}');
  db.prepare('INSERT INTO snapshot_units VALUES (?,?,?)').run('snapshot-' + unitId,unitId,'added');
  const spans = [...historySemanticSpans(text,80,20)];
  db.prepare('INSERT INTO history_embedding_units VALUES (?,?,?,?)').run(unitId,digest(text),spans.length,complete);
  for (const span of complete ? spans : spans.slice(0,1)) {
    db.prepare('INSERT INTO history_embedding_spans VALUES (?,?,?,?)').run(unitId,span.start,span.end,vector);
  }
}
db.close();
const checkpointReceipt = path.join(root,'checkpoint-receipt.json');
const modelArtifactReceipt = path.join(root,'model-receipt.json');
await fs.writeFile(checkpointReceipt, '{"synthetic":true}');
await fs.writeFile(modelArtifactReceipt, '{"synthetic":true,"noRealModelAcquired":true}');
const evidencePath = path.join(root,'evidence.json');
const evidence = { schema: 'history-eg2-conversion-evidence.v1', writerStopped: true,
  stoppedWriterReceipt: 'Synthetic fixture closed before conversion; no live writer.',
  sourceSha256: await hashFile(source), graphSha256: PINNED_GRAPH_SHA256,
  tokenizerSha256: PINNED_TOKENIZER_SHA256, numericalRecipe: 'published-fp32',
  checkpointReceipt: { path: checkpointReceipt, sha256: await hashFile(checkpointReceipt) },
  modelArtifactReceipt: { path: modelArtifactReceipt, sha256: await hashFile(modelArtifactReceipt) } };
await fs.writeFile(evidencePath, JSON.stringify(evidence));
const args = { source,destination,evidencePath,modelsDir:config.modelsDir,writerStopped:true };
await assert.rejects(convertEg2Checkpoint({ ...args,writerStopped:false }), /stopped-writer/);
await assert.rejects(convertEg2Checkpoint({ ...args,destination:source }), /Distinct/);
const badEvidence = path.join(root,'bad-evidence.json');
await fs.writeFile(badEvidence, JSON.stringify({ ...evidence,graphSha256:'0'.repeat(64) }));
await assert.rejects(convertEg2Checkpoint({ ...args,evidencePath:badEvidence }), /attested/);
await assert.rejects(fs.stat(destination), { code:'ENOENT' });
const receipt = await convertEg2Checkpoint(args);
assert.equal(receipt.inferenceCalls,0);
assert.deepEqual(receipt.counts,{ units:3,completedUnits:2,partialUnits:1,occurrences:3,uniqueInputs:2 });
assert.equal(await hashFile(source),evidence.sourceSha256);
await assert.rejects(convertEg2Checkpoint(args), /must not be overwritten/);
const converted = new Database(destination,{ readonly:true });
assert.equal(converted.prepare('SELECT value FROM vault_meta WHERE key=?').get('generation').value,'42');
assert.equal(converted.prepare('SELECT count(*) AS n FROM snapshot_units').get().n,3);
assert.equal(converted.prepare('SELECT count(*) AS n FROM history_embedding_units_v2 WHERE complete=0').get().n,1);
assert.equal(converted.prepare('SELECT count(*) AS n FROM sqlite_master WHERE name LIKE ?').get('history_embedding_meta').n,0);
for (const row of converted.prepare('SELECT vector FROM history_embedding_inputs_v2').all()) assert.ok(row.vector.equals(vector));
converted.close();
// A duplicate effective input with different full vector cannot be collapsed losslessly.
const conflict = new Database(source);
const other = Buffer.alloc(768*4); other.writeFloatLE(1,4);
conflict.prepare('UPDATE history_embedding_spans SET vector=? WHERE unit_id=?').run(other,'b');
conflict.close();
await fs.writeFile(evidencePath,JSON.stringify({ ...evidence,sourceSha256:await hashFile(source) }));
await assert.rejects(convertEg2Checkpoint({ ...args,destination:path.join(root,'conflict.sqlite') }), /conflicting vectors/);
const conflictCopy = new Database(path.join(root,'conflict.sqlite'),{ readonly:true });
assert.equal(conflictCopy.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='history_embedding_meta'").get().n,1,'conversion transaction rolls back');
conflictCopy.close();
const beforeSidecar = await hashFile(source);
await fs.writeFile(source+'-wal','synthetic sidecar; never removed');
await assert.rejects(convertEg2Checkpoint({ ...args,destination:path.join(root,'sidecar.sqlite') }), /sidecar/);
assert.equal(await hashFile(source),beforeSidecar);
console.log('EG2 checkpoint conversion: synthetic copy, provenance gates, partial units, exact vectors and rollback passed.');

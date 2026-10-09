#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import { digest } from '../../src/integrations/inference-history/common.js';
import { resolveArchiveEmbeddingOptions, ARCHIVE_EG2_MODEL } from '../../src/integrations/inference-history/embedding-runtime.js';
import { EMBEDDING_GEMMA2_REVISION } from '../../src/shared/embedding-model-profile.js';
import { historySemanticSpans } from '../../src/integrations/inference-history/semantic-values.js';
import { createPersistentHistorySemanticIndex } from '../../src/integrations/inference-history/persistent-semantic-index.js';

export const PINNED_GRAPH_SHA256 = 'bc47de15f81208a5c99e5ab10f746d5e33b51ea228b7dc0bef9c133a94f1c1c3';
export const PINNED_TOKENIZER_SHA256 = '4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4';
const fail = message => { throw new Error(message); };
const quote = name => '"' + name.replaceAll('"', '""') + '"';
export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function noSidecars(file) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { await fs.lstat(file + suffix); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    fail('Closed checkpoint required: SQLite sidecar exists.');
  }
}
function archiveFingerprint(db) {
  const hash = createHash('sha256');
  const tables = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'history_embedding_%' ORDER BY name").all();
  for (const table of tables) {
    hash.update(JSON.stringify(table));
    // ORDER BY all columns makes row order independent of backup page layout.
    const columns = db.prepare('PRAGMA table_info(' + quote(table.name) + ')').all().map(row => quote(row.name));
    for (const row of db.prepare('SELECT * FROM ' + quote(table.name) + ' ORDER BY ' + columns.join(',')).iterate()) {
      hash.update(JSON.stringify(row));
    }
  }
  return hash.digest('hex');
}
async function verifyReference(reference) {
  if (!reference || typeof reference.path !== 'string' || !/^[a-f0-9]{64}$/.test(reference.sha256 ?? '')) fail('Hashed receipt reference required.');
  if (await hashFile(reference.path) !== reference.sha256) fail('Receipt reference hash mismatch.');
}
function validateIdentity(meta, options, evidence) {
  const identity = JSON.parse(meta.identity), { identityKey, ...base } = identity;
  if (meta.identity_key !== digest(JSON.stringify(base)) || identityKey !== meta.identity_key) fail('Invalid v1 identity hash.');
  const expected = { schema: 'history-eg2.v1', modelId: options.modelId, profile: options.fullProfile,
    task: options.task, queryPrefix: options.queryPrefix, passagePrefix: options.passagePrefix,
    chunkChars: options.chunkChars, overlapChars: options.overlapChars, chunker: options.chunker,
    normalization: 'truncate_then_l2' };
  if (JSON.stringify(base) !== JSON.stringify(expected)) fail('Unproven v1 model, prompt, dtype, dimensions or chunker identity.');
  if (options.modelId !== ARCHIVE_EG2_MODEL || options.fullProfile.revision !== EMBEDDING_GEMMA2_REVISION
    || options.fullProfile.dtype !== 'fp32' || options.profile.dimensions !== 768
    || options.documentIdentity.graphSha256 !== null || options.documentIdentity.numericalRecipe !== 'published-fp32'
    || options.documentIdentity.tokenizerIdentity !== ARCHIVE_EG2_MODEL + '@' + EMBEDDING_GEMMA2_REVISION
    || evidence.graphSha256 !== PINNED_GRAPH_SHA256 || evidence.tokenizerSha256 !== PINNED_TOKENIZER_SHA256
    || evidence.numericalRecipe !== 'published-fp32') fail('Only attested pinned published fp32/full768 checkpoints qualify.');
}

/** Offline, explicit copy conversion. Never opens a writer-owned checkpoint. */
export async function convertEg2Checkpoint({ source, destination, evidencePath, modelsDir, writerStopped = false }) {
  if (writerStopped !== true) fail('Explicit stopped-writer declaration required; timeout is not proof.');
  source = path.resolve(source); destination = path.resolve(destination);
  if (source.toLowerCase() === destination.toLowerCase()) fail('Distinct destination required.');
  if ((await fs.realpath(source)).toLowerCase() !== source.toLowerCase()) fail('Canonical source required.');
  if ((await fs.lstat(source)).isSymbolicLink()) fail('Source links are not accepted.');
  await noSidecars(source);
  await noSidecars(destination);
  if ((await fs.realpath(path.dirname(destination))).toLowerCase() !== path.dirname(destination).toLowerCase()) fail('Canonical destination directory required.');
  try { await fs.lstat(destination + '.conversion.json'); fail('Existing conversion receipt must not be overwritten.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
  if (evidence.schema !== 'history-eg2-conversion-evidence.v1' || evidence.writerStopped !== true
    || typeof evidence.stoppedWriterReceipt !== 'string' || !evidence.stoppedWriterReceipt.trim()) fail('Stopped-writer evidence required.');
  await verifyReference(evidence.checkpointReceipt);
  await verifyReference(evidence.modelArtifactReceipt);
  const before = await hashFile(source);
  if (before !== evidence.sourceSha256) fail('Source checkpoint hash mismatch.');
  const sourceDb = new Database(source, { readonly: true, fileMustExist: true });
  let targetDb;
  try {
    if (sourceDb.pragma('integrity_check', { simple: true }) !== 'ok') fail('Source checkpoint integrity failure.');
    const meta = sourceDb.prepare('SELECT identity,identity_key FROM history_embedding_meta WHERE singleton=1').get();
    if (!meta) fail('Missing v1 checkpoint identity.');
    const old = JSON.parse(meta.identity);
    const options = resolveArchiveEmbeddingOptions({ modelsDir, modelId: old.modelId,
      revision: old.profile?.revision, dtype: old.profile?.dtype, dimensions: old.profile?.dimensions,
      task: old.task, chunkChars: old.chunkChars, overlapChars: old.overlapChars });
    validateIdentity(meta, options, evidence);
    const archiveBefore = archiveFingerprint(sourceDb);
    // Reserve exclusively before backup; never overwrite an existing destination.
    const reserved = await fs.open(destination, 'wx'); await reserved.close();
    await sourceDb.backup(destination);
    await noSidecars(source);
    if (await hashFile(source) !== before) fail('Source changed during backup; destination is retained but must not be used.');
    targetDb = new Database(destination); targetDb.pragma('foreign_keys=ON');
    const counts = { units: 0, completedUnits: 0, partialUnits: 0, occurrences: 0, uniqueInputs: 0 };
    targetDb.transaction(() => {
      // Renaming retains data for validation inside this atomic transaction.
      targetDb.exec('DROP TRIGGER IF EXISTS history_embedding_unit_changed; ALTER TABLE history_embedding_meta RENAME TO conversion_v1_meta; ALTER TABLE history_embedding_units RENAME TO conversion_v1_units; ALTER TABLE history_embedding_spans RENAME TO conversion_v1_spans;');
      createPersistentHistorySemanticIndex(targetDb, { config: options });
      const putUnit = targetDb.prepare('INSERT INTO history_embedding_units_v2 VALUES (?,?,?,?,?)');
      const putInput = targetDb.prepare('INSERT INTO history_embedding_inputs_v2 VALUES (?,?,?,?)');
      const findInput = targetDb.prepare('SELECT effective_input,vector FROM history_embedding_inputs_v2 WHERE document_key=? AND input_key=?');
      const putSpan = targetDb.prepare('INSERT INTO history_embedding_spans_v2 VALUES (?,?,?,?,?)');
      const spansForUnit = sourceDb.prepare('SELECT start,end,vector FROM history_embedding_spans WHERE unit_id=? ORDER BY start,end');
      for (const unit of sourceDb.prepare('SELECT e.*,u.text FROM history_embedding_units e JOIN units u ON u.id=e.unit_id ORDER BY e.unit_id').iterate()) {
        const spans = [...historySemanticSpans(unit.text, options.chunkChars, options.overlapChars)];
        const rows = spansForUnit.all(unit.unit_id);
        if (unit.content_hash !== digest(unit.text) || unit.expected_spans !== spans.length
          || ![0,1].includes(unit.complete) || rows.length > spans.length
          || (unit.complete === 1 && rows.length !== spans.length)) fail('Checkpoint text or completeness mismatch.');
        putUnit.run(options.documentIdentityKey, unit.unit_id, unit.content_hash, unit.expected_spans, unit.complete);
        counts.units++; counts[unit.complete ? 'completedUnits' : 'partialUnits']++;
        for (const row of rows) {
          const span = spans.find(item => item.start === row.start && item.end === row.end);
          if (!span || row.vector.length !== 768 * 4) fail('Invalid checkpoint span/vector.');
          let norm = 0;
          for (let i = 0; i < 768; i++) { const value = row.vector.readFloatLE(i * 4); if (!Number.isFinite(value)) fail('Nonfinite checkpoint vector.'); norm += value * value; }
          if (Math.abs(Math.sqrt(norm) - 1) > 0.00001) fail('Checkpoint vector is not normalized full768.');
          const input = options.passagePrefix + span.text;
          const key = digest(JSON.stringify([options.documentIdentityKey, input]));
          const cached = findInput.get(options.documentIdentityKey, key);
          if (cached && (cached.effective_input !== input || !cached.vector.equals(row.vector))) fail('Duplicate effective input has conflicting vectors; conversion cannot discard either vector.');
          if (!cached) { putInput.run(options.documentIdentityKey, key, input, row.vector); counts.uniqueInputs++; }
          putSpan.run(options.documentIdentityKey, unit.unit_id, row.start, row.end, key); counts.occurrences++;
        }
      }
      const originalUnits = targetDb.prepare('SELECT count(*) AS n FROM conversion_v1_units').get().n;
      if (counts.units !== originalUnits) fail('Orphan checkpoint unit.');
      if (counts.occurrences !== targetDb.prepare('SELECT count(*) AS n FROM conversion_v1_spans').get().n) fail('Orphan checkpoint occurrence.');
      targetDb.exec('DROP TABLE conversion_v1_spans; DROP TABLE conversion_v1_units; DROP TABLE conversion_v1_meta;');
      if (archiveFingerprint(targetDb) !== archiveBefore) fail('Archive units/citations/generation changed.');
    })();
    if (targetDb.pragma('integrity_check', { simple: true }) !== 'ok'
      || targetDb.pragma('foreign_key_check').length) fail('Converted checkpoint integrity failure.');
    targetDb.close(); targetDb = null; sourceDb.close();
    await noSidecars(source);
    const after = await hashFile(source);
    if (after !== before) fail('Source changed; converted destination must not be used.');
    const receipt = { schema: 'history-eg2-checkpoint-conversion.v1', complete: true, source,
      destination, sourceSha256Before: before, sourceSha256After: after,
      destinationSha256: await hashFile(destination), archiveFingerprint: archiveBefore,
      documentIdentity: options.documentIdentity, documentIdentityKey: options.documentIdentityKey,
      evidence, counts, inferenceCalls: 0 };
    await fs.writeFile(destination + '.conversion.json', JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return receipt;
  } finally { targetDb?.close(); if (sourceDb.open) sourceDb.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, destination: { type: 'string' },
    evidence: { type: 'string' }, 'models-dir': { type: 'string' }, 'writer-stopped': { type: 'boolean' } } });
  const receipt = await convertEg2Checkpoint({ source: values.source, destination: values.destination,
    evidencePath: values.evidence, modelsDir: values['models-dir'], writerStopped: values['writer-stopped'] });
  console.log(JSON.stringify({ complete: receipt.complete, counts: receipt.counts,
    receiptPath: receipt.destination + '.conversion.json' }, null, 2));
}

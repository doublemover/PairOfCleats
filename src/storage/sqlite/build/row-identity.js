import path from 'node:path';
import { createHash } from 'node:crypto';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';

const witnesses = new WeakMap();
const fields = ['id', 'chunk_id', 'mode', 'file', 'start', 'end', 'startLine', 'endLine', 'metaV2_json'];
const normalizePath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const invalid = message => Object.assign(new Error(message), { code: 'ERR_SQLITE_ROW_IDENTITY_MISMATCH', failureClass: 'row_identity_mismatch' });

/** Ordered, length-delimited SHA256, one native row at a time. No corpus Set,
 * JSON copy of metadata, unordered accumulator or caller-supplied digest. */
const digestRows = (rows, projectRow = null) => {
  const hash = createHash('sha256').update('pairofcleats-sqlite-chunk-identity-v1\0');
  let count = 0, previous = -1, done = false, failed = false, primary, close;
  const observations = [];
  const requireSteps = () => { for (const observation of observations) observation.requireSettled(); };
  try {
    // Keep original cursor methods. A bad row must retire the native iterator,
    // preserving a failed return independently instead of hiding either cause.
    close = rows.return;
    const next = rows.next;
    if (typeof next !== 'function' || typeof close !== 'function') throw invalid('SQLite identity read has no original cursor owner.');
    while (true) {
      requireSteps();
      const step = next.call(rows);
      const observation = observeStorageResource(step, { phase: 'sqlite-identity-cursor-step' });
      if (observation.hasResourceObservation) {
        if (observations.length >= 128) throw Object.assign(invalid('SQLite identity cursor observation history exceeded its bound.'), { cacheOwnershipPending: true });
        observations.push(observation);
      }
      observation.requireSettled();
      let row;
      try {
        if (step.done === true) { done = true; requireSteps(); break; }
        row = step.value;
      } catch (inspection) { throw observation.wrap(inspection); }
      if (projectRow) row = projectRow(row, count);
      if (!Number.isSafeInteger(row.id) || row.id < 0 || row.id <= previous) throw invalid('SQLite source/target chunk IDs are invalid or duplicated.');
      previous = row.id;
      for (const field of fields) {
        const value = row[field];
        if (value === null) hash.update('N;');
        else if (typeof value === 'string') hash.update(`S${Buffer.byteLength(value)}:`).update(value).update(';');
        else if (Number.isSafeInteger(value)) hash.update(`I${value};`);
        else throw invalid(`SQLite chunk identity field ${field} is invalid or unavailable.`);
      }
      count++;
      if (!Number.isSafeInteger(count)) throw invalid('SQLite chunk identity count exceeds safe representation.');
      requireSteps();
    }
  } catch (error) { failed = true; primary = error; }
  if (!done) {
    try {
      if (typeof close !== 'function') throw invalid('SQLite identity cursor closure is unavailable.');
      const result = close.call(rows);
      observeStorageResource(result, { phase: 'sqlite-identity-cursor-return' }).requireSettled();
      if (result?.done !== true) throw Object.assign(invalid('SQLite identity cursor return did not confirm closure.'), {
        cacheOwnershipPending: true, cacheOwnershipReleased: () => false
      });
    } catch (cleanup) {
      throw failed ? addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true, forceAggregate: true }) : cleanup;
    }
  }
  if (failed) throw primary;
  return Object.freeze({ schemaVersion: 1, count, sha256: hash.update(`E${count};`).digest('hex') });
};
const sourceProjection = `SELECT c.id, c.chunk_id, c.mode, COALESCE(c.file, f.file) AS file,
  c.start, c.end, c.startLine, c.endLine, c.metaV2_json
  FROM chunks_stage c LEFT JOIN file_meta_stage f ON c.file_id = f.id`;

/** The actual artifact stage owns this immutable witness before retirement.
 * Normalized source rows are independent of the destination write statement.
 * The SQL join rejects changed/missing identities before dropping the stage. */
export const captureSqliteChunkStageIdentity = (db, mode, { outputPath = db.name } = {}) => {
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) throw invalid('SQLite identity requires its original absolute publication target.');
  const mismatches = db.prepare(`WITH expected AS (${sourceProjection})
    SELECT e.id AS expectedId, a.id AS actualId,
      substr(e.file, 1, 512) AS expectedFile, substr(a.file, 1, 512) AS actualFile,
      substr(e.chunk_id, 1, 256) AS expectedChunkId, substr(a.chunk_id, 1, 256) AS actualChunkId
    FROM expected e LEFT JOIN chunks a ON a.id = e.id
    WHERE e.mode IS NOT ? OR a.id IS NULL OR a.mode IS NOT e.mode
      OR a.chunk_id IS NOT e.chunk_id OR a.file IS NOT e.file OR a.start IS NOT e.start OR a.end IS NOT e.end
      OR a.startLine IS NOT e.startLine OR a.endLine IS NOT e.endLine OR a.metaV2_json IS NOT e.metaV2_json
    ORDER BY e.id LIMIT 17`).all(mode);
  if (mismatches.length) throw Object.assign(invalid('SQLite destination differs from its original artifact chunk identities.'), {
    rowIdentity: { phase: 'artifact-stage', samples: mismatches.slice(0, 16), sampleLimit: 16, truncated: mismatches.length > 16 }
  });
  const expected = digestRows(db.prepare(`${sourceProjection} ORDER BY c.id`).iterate());
  const witness = Object.freeze({ schemaVersion: 1, kind: 'sqlite-artifact-chunk-identity', mode,
    count: expected.count, sha256: expected.sha256, coverage: 'normalized-artifact-stage-chunks' });
  witnesses.set(witness, { target: normalizePath(outputPath), mode, expected });
  return witness;
};

/** Compaction deliberately assigns IDs in its existing file/start/old-ID order.
 * The independent original-source pass permits only that planned reassignment
 * and the existing file normalizer; all covered chunk identity fields remain.
 */
export const captureSqliteCompactionChunkIdentity = (db, mode, { outputPath = db.name, normalizeFile } = {}) => {
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || typeof normalizeFile !== 'function') {
    throw invalid('SQLite compaction identity requires its original output and file normalization owner.');
  }
  const expected = digestRows(db.prepare(`SELECT ${fields.join(', ')} FROM chunks WHERE mode = ? ORDER BY file, start, id`).iterate(mode),
    (row, ordinal) => {
      if (!Number.isSafeInteger(row.id) || row.id < 0) throw invalid('SQLite compaction source has an invalid document ID.');
      return { ...row, id: ordinal, file: normalizeFile(row.file) };
    });
  const witness = Object.freeze({ schemaVersion: 1, kind: 'sqlite-compaction-chunk-identity', mode,
    count: expected.count, sha256: expected.sha256, coverage: 'normalized-compaction-source-chunk-identities' });
  witnesses.set(witness, { target: normalizePath(outputPath), mode, expected });
  return witness;
};

export const isSqliteChunkIdentityWitness = (witness, target, mode) => {
  const original = witnesses.get(witness);
  return Boolean(original && original.target === normalizePath(target) && original.mode === mode);
};

export const readSqliteChunkIdentity = (db, mode) => digestRows(db.prepare(
  `SELECT ${fields.join(', ')} FROM chunks WHERE mode = ? ORDER BY id`).iterate(mode));

export const matchesSqliteChunkIdentity = (witness, observed, target, mode) => {
  if (!isSqliteChunkIdentityWitness(witness, target, mode)) return false;
  const expected = witnesses.get(witness).expected;
  return observed?.schemaVersion === 1 && expected.count === observed.count && expected.sha256 === observed.sha256;
};

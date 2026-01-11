import { REQUIRED_TABLES } from '../schema.js';
import { hasRequiredTables } from '../utils.js';

export function getSchemaVersion(db) {
  try {
    const value = db.pragma('user_version', { simple: true });
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function validateSqliteDatabase(db, mode, options = {}) {
  const validateMode = options.validateMode || 'off';
  if (validateMode === 'off') return;

  const errors = [];
  if (!hasRequiredTables(db, REQUIRED_TABLES)) {
    errors.push('missing required tables');
  }

  const pragmaName = validateMode === 'full' ? 'integrity_check' : 'quick_check';
  try {
    const rows = db.prepare(`PRAGMA ${pragmaName}`).all();
    const messages = [];
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (value !== 'ok') messages.push(value);
      }
    }
    if (messages.length) {
      errors.push(`${pragmaName} failed: ${messages.join('; ')}`);
    }
  } catch (err) {
    errors.push(`${pragmaName} failed: ${err?.message || err}`);
  }

  const expected = options.expected || {};
  const expectedChunks = Number.isFinite(expected.chunks) ? expected.chunks : null;
  if (expectedChunks !== null) {
    const chunkCount = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?')
      .get(mode)?.total ?? 0;
    if (chunkCount !== expectedChunks) {
      errors.push(`chunks=${chunkCount} expected=${expectedChunks}`);
    }
    const ftsCount = db.prepare('SELECT COUNT(*) AS total FROM chunks_fts WHERE mode = ?')
      .get(mode)?.total ?? 0;
    if (ftsCount !== expectedChunks) {
      errors.push(`chunks_fts=${ftsCount} expected=${expectedChunks}`);
    }
    const lengthCount = db.prepare('SELECT COUNT(*) AS total FROM doc_lengths WHERE mode = ?')
      .get(mode)?.total ?? 0;
    if (lengthCount !== expectedChunks) {
      errors.push(`doc_lengths=${lengthCount} expected=${expectedChunks}`);
    }
  }

  const expectedDense = Number.isFinite(expected.dense) ? expected.dense : null;
  if (expectedDense !== null) {
    const denseCount = db.prepare('SELECT COUNT(*) AS total FROM dense_vectors WHERE mode = ?')
      .get(mode)?.total ?? 0;
    if (denseCount !== expectedDense) {
      errors.push(`dense_vectors=${denseCount} expected=${expectedDense}`);
    }
  }

  const expectedMinhash = Number.isFinite(expected.minhash) ? expected.minhash : null;
  if (expectedMinhash !== null) {
    const minhashCount = db.prepare(
      'SELECT COUNT(*) AS total FROM minhash_signatures WHERE mode = ?'
    ).get(mode)?.total ?? 0;
    if (minhashCount !== expectedMinhash) {
      errors.push(`minhash_signatures=${minhashCount} expected=${expectedMinhash}`);
    }
  }

  if (errors.length) {
    throw new Error(`[sqlite] Validation (${validateMode}) failed for ${mode}: ${errors.join(', ')}`);
  }
  if (options.emitOutput) {
    console.log(`[sqlite] Validation (${validateMode}) ok for ${mode}.`);
  }
}

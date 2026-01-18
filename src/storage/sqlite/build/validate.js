import fsSync from 'node:fs';
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
  const logger = options.logger && typeof options.logger === 'object' ? options.logger : null;
  const emit = (message) => {
    if (!options.emitOutput || !message) return;
    if (logger && typeof logger.log === 'function') {
      logger.log(message);
      return;
    }
    console.log(message);
  };

  const errors = [];
  if (!hasRequiredTables(db, REQUIRED_TABLES)) {
    errors.push('missing required tables');
  }

  const resolveMode = () => {
    if (validateMode !== 'auto') return validateMode;
    const limit = Number.isFinite(options.fullIntegrityCheckMaxBytes)
      ? options.fullIntegrityCheckMaxBytes
      : 512 * 1024 * 1024;
    if (!options.dbPath) return 'smoke';
    try {
      const stat = fsSync.statSync(options.dbPath);
      if (Number.isFinite(stat.size) && stat.size > limit) return 'smoke';
    } catch {
      return 'smoke';
    }
    return 'full';
  };
  const resolvedMode = resolveMode();
  const pragmaName = resolvedMode === 'full' ? 'integrity_check' : 'quick_check';
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
  const annTable = options.vectorAnnTable || 'dense_vectors_ann';
  const annExists = (() => {
    try {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      ).get(annTable);
      return !!row;
    } catch {
      return false;
    }
  })();
  let denseCount = null;
  if (expectedDense !== null || annExists) {
    denseCount = db.prepare('SELECT COUNT(*) AS total FROM dense_vectors WHERE mode = ?')
      .get(mode)?.total ?? 0;
    if (expectedDense !== null && denseCount !== expectedDense) {
      errors.push(`dense_vectors=${denseCount} expected=${expectedDense}`);
    }
  }
  if (annExists && denseCount !== null) {
    const annCount = db.prepare(`SELECT COUNT(*) AS total FROM ${annTable}`).get()?.total ?? 0;
    if (annCount !== denseCount) {
      errors.push(`${annTable}=${annCount} expected=${denseCount}`);
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
    throw new Error(`[sqlite] Validation (${resolvedMode}) failed for ${mode}: ${errors.join(', ')}`);
  }
  emit(`[sqlite] Validation (${resolvedMode}) ok for ${mode}.`);
}

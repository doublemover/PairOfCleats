import { historyError, privateReference, PROJECTION_VERSION } from './common.js';
export const HISTORY_STORE_FORMAT = 'inference-history.v6';
export function historyIndexState(db) {
  if (!db) return { schema: HISTORY_STORE_FORMAT, generation: null, generationRef: null,
    state: 'missing', updatedAt: null, projection: PROJECTION_VERSION, exportFreshness: 'unknown' };
  const values = Object.fromEntries(db.prepare("SELECT key,value FROM vault_meta WHERE key IN ('partition','reference_key','generation','updated_at')").all().map(row => [row.key,row.value]));
  const generation = Number(values.generation);
  if (!Number.isSafeInteger(generation) || generation < 0 || !/^[a-f0-9]{64}$/.test(values.reference_key ?? '')
    || !/^\d+$/.test(values.generation ?? '') || !Number.isFinite(Date.parse(values.updated_at ?? ''))) {
    throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Invalid index generation metadata.');
  }
  return { schema: HISTORY_STORE_FORMAT, generation,
    generationRef: privateReference(values.reference_key, JSON.stringify([values.partition,generation])),
    state: 'ready', updatedAt: values.updated_at, projection: PROJECTION_VERSION, exportFreshness: 'unknown' };
}
export function advanceHistoryGeneration(db) {
  const current = historyIndexState(db);
  if (!Number.isSafeInteger(current.generation + 1)) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Index generation exhausted.');
  db.prepare("UPDATE vault_meta SET value=? WHERE key='generation'").run(String(current.generation + 1));
  db.prepare("UPDATE vault_meta SET value=? WHERE key='updated_at'").run(new Date().toISOString());
}

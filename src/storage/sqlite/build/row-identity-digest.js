import { createHash } from 'node:crypto';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';
const invalid = message => Object.assign(new Error(message), { code: 'ERR_SQLITE_ROW_IDENTITY_MISMATCH', failureClass: 'row_identity_mismatch' });

export const digestSqliteIdentityRows = (rows, { fields, projectRow = null, domain = 'pairofcleats-sqlite-chunk-identity-v1\0', blobFields = [], floatFields = [] } = {}) => {
  const hash = createHash('sha256').update(domain);
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
        if (blobFields.includes(field)) {
          if (!Buffer.isBuffer(value)) throw invalid(`SQLite binary identity field ${field} is not a native BLOB.`);
          hash.update(`B${value.length}:`).update(value).update(';');
        }
        else if (value === null) hash.update('N;');
        else if (typeof value === 'string') hash.update(`S${Buffer.byteLength(value)}:`).update(value).update(';');
        else if (Number.isSafeInteger(value)) hash.update(`I${value};`);
        else if (floatFields.includes(field) && typeof value === 'number' && Number.isFinite(value)) {
          const bytes = Buffer.allocUnsafe(8); bytes.writeDoubleLE(value); hash.update('F').update(bytes).update(';');
        }
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

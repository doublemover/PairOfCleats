import { throwIfAborted } from '../shared/abort.js';
import { SOURCE_ORDER_FIELD, SOURCE_ORDER_META_KEY, SOURCE_ORDER_VERSION, captureSourceEnumeration,
  sourcePathBounds, decodeSourceOrderPath, captureSourceOrderCursor } from './source-order.js';

/** The existing discovery table/index owns this derived projection. No JSON
 * payload or corpus scan is needed for source enumeration or ordered ref pages.
 */
export const createSqliteSourceOrderReader = db => {
  let plans = null;
  const prepared = () => {
    if (plans) return plans;
    if (db.prepare('SELECT value FROM index_format_meta WHERE key=?').get(SOURCE_ORDER_META_KEY)?.value !== SOURCE_ORDER_VERSION) {
      throw Object.assign(new Error('Source-order discovery unavailable; rebuild the pinned SQLite generation.'), { code: 'ERR_SEMANTIC_UNAVAILABLE' });
    }
    const qualified = 'SELECT value,partition_id,local_id FROM semantic_discovery d WHERE field=? AND value>=? AND value<?'
      + ' AND EXISTS (SELECT 1 FROM semantic_analysis a WHERE a.partition_id=d.partition_id)';
    plans = { next: db.prepare(qualified + ' ORDER BY value,partition_id,local_id LIMIT 1'),
      first: db.prepare(qualified + ' ORDER BY value,partition_id,local_id LIMIT ?'),
      after: db.prepare(qualified + ' AND (value,partition_id,local_id)>(?,?,?) ORDER BY value,partition_id,local_id LIMIT ?') };
    return plans;
  };
  const listSourcePaths = async (input, { signal = null, metrics = null } = {}) => {
    const captured = captureSourceEnumeration(input), paths = [];
    throwIfAborted(signal);
    const { next } = prepared();
    for (const range of captured.ranges) {
      if (captured.afterKey !== null && captured.afterKey >= range.upper) continue;
      let lower = captured.afterKey === null || captured.afterKey < range.lower ? range.lower : captured.afterKey;
      while (paths.length <= captured.limit) {
        throwIfAborted(signal);
        if (metrics) metrics.sourceEnumerationStatements = (metrics.sourceEnumerationStatements || 0) + 1;
        const row = next.get(SOURCE_ORDER_FIELD, lower, range.upper);
        if (!row) break;
        const sourcePath = decodeSourceOrderPath(row.value);
        paths.push(sourcePath); lower = sourcePathBounds(sourcePath).upper;
      }
      if (paths.length > captured.limit) break;
    }
    return { paths: paths.slice(0, captured.limit), after: paths.length ? paths[Math.min(paths.length, captured.limit) - 1] : captured.after,
      done: paths.length <= captured.limit };
  };
  const inSourceOrder = async (sourcePath, { after = null, limit = 128, signal = null, metrics = null } = {}) => {
    const range = sourcePathBounds(sourcePath);
    after = captureSourceOrderCursor(sourcePath, after);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new TypeError('Invalid source-order page allowance.');
    throwIfAborted(signal);
    const plan = prepared();
    if (metrics) metrics.sourceOrderStatements = (metrics.sourceOrderStatements || 0) + 1;
    const args = [SOURCE_ORDER_FIELD, range.lower, range.upper];
    const rows = after ? plan.after.all(...args, after.value, after.ref.partitionId, after.ref.localId, limit + 1)
      : plan.first.all(...args, limit + 1);
    const selected = rows.slice(0, limit), refs = selected.map(row => ({ partitionId: row.partition_id, localId: row.local_id }));
    for (const row of selected) if (decodeSourceOrderPath(row.value) !== sourcePath) throw new Error('SQLite source-order index mismatch.');
    const last = selected[selected.length - 1];
    return { refs, after: last ? { value: last.value, ref: refs[refs.length - 1] } : after, done: rows.length <= limit };
  };
  return { listOperationSourcePaths: listSourcePaths, findOperationsInSourceOrder: inSourceOrder };
};

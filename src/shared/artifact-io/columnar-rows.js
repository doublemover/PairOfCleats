import { invalidArtifactPayload } from './payload-admission.js';

const resolveColumnarRowsContext = (payload, context) => {
  const invalid = detail => { throw invalidArtifactPayload(`columnar ${detail}`, context); };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) invalid('envelope must be an object');
  if (Object.hasOwn(payload, 'format') && payload.format !== 'columnar') invalid('format must be columnar');
  const arrays = payload.arrays;
  if (!arrays || typeof arrays !== 'object' || Array.isArray(arrays)) invalid('arrays must be an object');
  // Legacy envelopes may omit columns/length. Inference is bounded by the
  // admitted arrays; a present malformed field is never an inference request.
  const columns = Object.hasOwn(payload, 'columns') ? payload.columns : Object.keys(arrays);
  if (!Array.isArray(columns)) invalid('columns must be an array');
  const seen = new Set();
  const columnPlan = [];
  const tables = payload.tables && typeof payload.tables === 'object' ? payload.tables : null;
  const length = Object.hasOwn(payload, 'length')
    ? payload.length
    : (Array.isArray(arrays[columns[0]]) ? arrays[columns[0]].length : 0);
  if (!Number.isSafeInteger(length) || length < 0) invalid('length must be a nonnegative safe integer');
  if (context?.expectedCount != null && context.expectedCount !== length) invalid('length differs from the selected manifest count');
  if (!columns.length && length !== 0) invalid('positive length requires columns');
  for (const column of columns) {
    if (typeof column !== 'string' || seen.has(column)) invalid('column names must be unique strings');
    seen.add(column);
    if (!Object.hasOwn(arrays, column) || !Array.isArray(arrays[column])) invalid(`missing array for column ${column}`);
    const values = arrays[column];
    if (values.length !== length) invalid(`extent mismatch for column ${column}`);
    columnPlan.push({ column, values, table: tables && Array.isArray(tables[column]) ? tables[column] : null });
  }
  return {
    arrays,
    columns,
    columnPlan,
    tables,
    length
  };
};

const createColumnarRow = ({
  columnPlan
}, index) => {
  const row = {};
  for (const entry of columnPlan) {
    const value = entry.values[index] ?? null;
    const table = entry.table;
    const column = entry.column;
    row[column] = table && Number.isInteger(value) ? (table[value] ?? null) : value;
  }
  return row;
};

/**
 * Materialize row-wise objects from a columnar payload.
 *
 * @param {any} payload
 * @returns {object[]}
 */
export const inflateColumnarRows = (payload, sourceContext = {}) => {
  const context = resolveColumnarRowsContext(payload, sourceContext);
  const { columns, length } = context;
  if (!columns.length) return [];
  const rows = new Array(length);
  for (let i = 0; i < length; i += 1) {
    rows[i] = createColumnarRow(context, i);
  }
  return rows;
};

/**
 * Iterate row-wise objects from a columnar payload without materializing a full array.
 *
 * @param {any} payload
 * @returns {Generator<object, void, unknown>}
 */
export const iterateColumnarRows = (payload, sourceContext = {}) => {
  const context = resolveColumnarRowsContext(payload, sourceContext);
  const { columns, length } = context;
  if (!columns.length) return (function* () {})();
  return (function* () {
    for (let i = 0; i < length; i += 1) {
      yield createColumnarRow(context, i);
    }
  })();
};

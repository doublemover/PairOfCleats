const resolveColumnarRowsContext = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const arrays = payload.arrays && typeof payload.arrays === 'object' ? payload.arrays : null;
  if (!arrays) return null;
  const columns = Array.isArray(payload.columns) ? payload.columns : Object.keys(arrays);
  const tables = payload.tables && typeof payload.tables === 'object' ? payload.tables : null;
  const length = Number.isFinite(payload.length)
    ? payload.length
    : (Array.isArray(arrays[columns[0]]) ? arrays[columns[0]].length : 0);
  return {
    arrays,
    columns,
    tables,
    length
  };
};

const createColumnarRow = ({
  arrays,
  columns,
  tables
}, index) => {
  const row = {};
  for (const column of columns) {
    const values = arrays[column];
    const value = Array.isArray(values) ? (values[index] ?? null) : null;
    const table = tables && Array.isArray(tables[column]) ? tables[column] : null;
    row[column] = table && Number.isInteger(value) ? (table[value] ?? null) : value;
  }
  return row;
};

/**
 * Materialize row-wise objects from a columnar payload.
 *
 * @param {any} payload
 * @returns {object[]|null}
 */
export const inflateColumnarRows = (payload) => {
  const context = resolveColumnarRowsContext(payload);
  if (!context) return null;
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
 * @returns {Generator<object, void, unknown>|null}
 */
export const iterateColumnarRows = (payload) => {
  const context = resolveColumnarRowsContext(payload);
  if (!context) return null;
  const { columns, length } = context;
  if (!columns.length) return (function* () {})();
  return (function* () {
    for (let i = 0; i < length; i += 1) {
      yield createColumnarRow(context, i);
    }
  })();
};

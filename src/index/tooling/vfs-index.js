/** Schema version for VFS index rows. */
export const VFS_INDEX_SCHEMA_VERSION = '1.0.0';

const stringifyField = (value) => (value == null ? '' : String(value));
const NUMERIC_SORT_WIDTH = 20;
const stringifyNumericSortField = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '';
  const normalized = Object.is(parsed, -0) ? 0 : parsed;
  const sign = normalized < 0 ? '0' : '1';
  const abs = Math.abs(Math.trunc(normalized));
  return `${sign}${String(abs).padStart(NUMERIC_SORT_WIDTH, '0')}`;
};

/**
 * Build a deterministic sort key for VFS manifest rows.
 * @param {object} [row]
 * @returns {string}
 */
export const buildVfsManifestSortKey = (row = {}) => {
  return [
    stringifyField(row.containerPath),
    stringifyNumericSortField(row.segmentStart),
    stringifyNumericSortField(row.segmentEnd),
    stringifyField(row.languageId),
    stringifyField(row.effectiveExt),
    stringifyField(row.segmentUid),
    stringifyField(row.virtualPath)
  ].join('\u0000');
};

/**
 * Build a VFS index row from a manifest row.
 * @param {{manifestRow?:object}} [input]
 * @returns {object|null}
 */
export const buildVfsIndexRow = ({ manifestRow } = {}) => {
  const row = manifestRow || null;
  if (!row || typeof row !== 'object') return null;
  return {
    schemaVersion: VFS_INDEX_SCHEMA_VERSION,
    virtualPath: row.virtualPath,
    docHash: row.docHash || null,
    containerPath: row.containerPath || null,
    manifestSortKey: buildVfsManifestSortKey(row)
  };
};

/**
 * Build VFS index rows for a list of manifest rows.
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export const buildVfsIndexRows = (rows = []) => (
  Array.isArray(rows) ? rows.map((row) => buildVfsIndexRow({ manifestRow: row })).filter(Boolean) : []
);

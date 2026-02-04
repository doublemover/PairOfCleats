/** Schema version for VFS index rows. */
export const VFS_INDEX_SCHEMA_VERSION = '1.0.0';

const stringifyField = (value) => (value == null ? '' : String(value));

/**
 * Build a deterministic sort key for VFS manifest rows.
 * @param {object} [row]
 * @returns {string}
 */
export const buildVfsManifestSortKey = (row = {}) => {
  return [
    stringifyField(row.containerPath),
    stringifyField(row.segmentStart),
    stringifyField(row.segmentEnd),
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

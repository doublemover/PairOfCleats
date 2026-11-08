import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const displayPart = value => /^[A-Za-z_][A-Za-z_0-9$]*$/u.test(value) ? value : '"' + value.replaceAll('"', '""') + '"';
export const sqlRelationDisplay = parts => parts.map(displayPart).join('.');
export const sqlRelationNameIdentity = (dialect, parts) => 'sql-name1:' + hash([dialect, parts]);
export const sqlRelationOccurrenceIdentity = (evidence, row) => 'sql-occ1:' + hash([
  evidence.textHash, evidence.dialect, row.statementScope, row.astPath, row.role, row.parts, row.alias, row.span
]);

export const sqlRelationEvidenceErrors = evidence => {
  if (evidence === undefined) return [];
  const errors = [];
  if (evidence.counts.retainedOccurrences !== evidence.occurrences.length
    || evidence.textHash === null && evidence.occurrences.length) errors.push('SQL occurrence count or admitted text identity differs.');
  const ids = new Set();
  for (const row of evidence.occurrences) {
    const named = !['query-alias', 'derived-binding'].includes(row.role);
    if (named !== (row.parts.length > 0) || named && row.alias !== null
      || row.role === 'query-alias' && !row.alias || row.role === 'derived-binding' && row.alias !== null
      || row.decodedNameId !== (named ? sqlRelationNameIdentity(evidence.dialect, row.parts) : null)
      || row.display !== (named ? sqlRelationDisplay(row.parts) : row.alias)
      || row.occurrenceId !== sqlRelationOccurrenceIdentity(evidence, row)
      || row.span && (row.span[0] > row.span[1] || row.span[1] > evidence.textLength)
      || ids.has(row.occurrenceId)) errors.push('SQL occurrence role, decoded identity, source extent or display differs.');
    ids.add(row.occurrenceId);
    if (errors.length >= 20) break;
  }
  return errors;
};

import { createHash } from 'node:crypto';
import { stableStringifyForSignature } from '../shared/stable-json.js';
import { JAVASCRIPT_RELATIONS_VERSION } from '../lang/javascript/version.js';

export const javascriptDeclarationErrors = catalog => {
  if (!catalog) return [];
  const errors = [], { source, records, rangeOwners, nameOwners } = catalog;
  if (!source || !records || !rangeOwners || !nameOwners || !catalog.coverage) return ['missing declaration catalog owners'];
  const error = message => { if (errors.length < 20) errors.push(message); };
  if (source.state === 'qualified' && (!source.textHash || !source.parser)) error('qualified declaration source requires parser/hash identity');
  if (catalog.coverage.visitedSteps > catalog.coverage.maxTraversalSteps) error('declaration traversal exceeds work admission');
  for (const [id, record] of Object.entries(records)) {
    const expected = 'jsdecl1:' + createHash('sha256').update(stableStringifyForSignature({ producer: JAVASCRIPT_RELATIONS_VERSION,
      source, range: record.range, role: record.role })).digest('hex');
    if (id !== record.id || id !== expected || record.sourceHash !== source.textHash) error('declaration identity differs from its source/range/role');
    if (!record.range || record.range.end > source.length || record.range.end <= record.range.start) error('declaration range exceeds its source');
    if (record.parentId && (!records[record.parentId] || record.parentId === id)) error('declaration lexical parent is unavailable or self-referential');
    const parent = records[record.parentId];
    if (record.kind === 'module' && record.parentId) error('module declaration cannot have a lexical parent');
    if (parent && (parent.range.start > record.range.start || parent.range.end < record.range.end
      || parent.range.start === record.range.start && parent.range.end === record.range.end && parent.kind !== 'module')) error('lexical parent does not enclose its declaration');
    const associations = record.associations || [];
    if (associations.filter(value => value.kind === 'declaration').length !== 1
      || !associations.some(value => value.kind === 'declaration' && value.range.start === record.range.start
        && value.range.end === record.range.end)) error('declaration association must equal its owner range');
    for (const association of associations) {
      if (association.range.start > record.range.start || association.range.end < record.range.end || association.range.end > source.length) error('wrapper association does not contain its declaration');
      if (!rangeOwners[`${association.range.start}:${association.range.end}`]?.includes(id)) error('declaration wrapper index is missing its occurrence');
    }
    if (record.displayName && record.displayName !== '(anonymous)' && !nameOwners[record.displayName]?.includes(id)) error('display-name index is missing its declaration');
    if (errors.length >= 20) break;
  }
  for (const [key, ids] of Object.entries(rangeOwners)) {
    if (new Set(ids).size !== ids.length) error('range index repeats a declaration');
    for (const id of ids) {
      if (!records[id]?.associations?.some(value => `${value.range.start}:${value.range.end}` === key)) error('range index points to another declaration');
    }
    if (errors.length >= 20) return errors;
  }
  for (const [name, ids] of Object.entries(nameOwners)) {
    if (new Set(ids).size !== ids.length) error('display-name index repeats a declaration');
    for (const id of ids) if (records[id]?.displayName !== name) error('display-name index points to another declaration');
    if (errors.length >= 20) return errors;
  }
  return errors;
};

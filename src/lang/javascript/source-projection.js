import { offsetToLine } from '../../shared/lines.js';

const shifted = (range, offset) => range ? { start: range.start + offset, end: range.end + offset } : null;
/** Only bounded, already plain parameter/literal DTOs enter this copier. Source
 * identities and declaration ranges stay local; explicit mappings bind them to
 * the container rather than changing an occurrence's identity after hashing. */
export const rebaseJavaScriptParameterFacts = (metadata, offset) => {
  if (!offset) return metadata;
  const visit = value => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      ['range', 'bindingRange'].includes(key) && child && Number.isSafeInteger(child.start) && Number.isSafeInteger(child.end)
        ? shifted(child, offset) : visit(child)]));
  };
  return { ...metadata,
    ...(metadata.callableParameters ? { callableParameters: visit(metadata.callableParameters) } : {}),
    ...(metadata.paramDefaultLiterals ? { paramDefaultLiterals: visit(metadata.paramDefaultLiterals) } : {}) };
};

export const rebaseJavaScriptCallDetails = (details, offset, lineIndex) => {
  if (!offset) return details;
  return details.map(detail => {
    const start = detail.start + offset, end = detail.end + offset;
    const startLine = offsetToLine(lineIndex, start), endLine = offsetToLine(lineIndex, end);
    return { ...detail, start, end, startLine, endLine,
      line: startLine, startCol: start - lineIndex[startLine - 1] + 1, endCol: end - lineIndex[endLine - 1] + 1,
      ...(detail.arguments ? { arguments: { ...detail.arguments, slots: detail.arguments.slots.map(slot => ({ ...slot, range: shifted(slot.range, offset) })) } } : {}),
      ...(detail.argLiterals ? { argLiterals: detail.argLiterals.map(value => value ? { ...value, range: shifted(value.range, offset) } : null) } : {}),
      ...(detail.returnedValue ? { returnedValue: { ...detail.returnedValue,
        ownerRanges: detail.returnedValue.ownerRanges.map(([a, b]) => [a + offset, b + offset]),
        expression: detail.returnedValue.expression.map(value => value + offset) } } : {}),
      ...(detail.evaluationOwner ? { evaluationOwner: { ...detail.evaluationOwner, sourceOffset: offset } } : {})
    };
  });
};

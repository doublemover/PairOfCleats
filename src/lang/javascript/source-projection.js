import { offsetToLine } from '../../shared/lines.js';
import { projectEmbeddedContentEnvelope, mapEmbeddedContentRange, embeddedContentIdentity } from '../../shared/embedded-content.js';

const shifted = (range, offset) => typeof offset === 'object' && offset
  ? projectEmbeddedContentEnvelope(offset, range) : range ? { start: range.start + offset, end: range.end + offset } : null;
const shiftedTuple = (range, offset) => {
  const mapped = shifted({ start: range[0], end: range[1] }, offset);
  return [mapped.start, mapped.end];
};
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
    const { start, end } = shifted(detail, offset);
    const piecewise = typeof offset === 'object';
    const ownerRange = detail.evaluationOwner?.ownerRange;
    const ownerPieces = piecewise && ownerRange ? mapEmbeddedContentRange(offset, ownerRange.start, ownerRange.end) : null;
    const evaluationOffset = !piecewise ? offset : ownerPieces?.length === 1
      && detail.start >= ownerRange.start && detail.end <= ownerRange.end ? ownerPieces[0].start - ownerRange.start : null;
    const startLine = offsetToLine(lineIndex, start), endLine = offsetToLine(lineIndex, end);
    return { ...detail, start, end, startLine, endLine,
      line: startLine, startCol: start - lineIndex[startLine - 1] + 1, endCol: end - lineIndex[endLine - 1] + 1,
      ...(detail.arguments ? { arguments: { ...detail.arguments, slots: detail.arguments.slots.map(slot => ({ ...slot, range: shifted(slot.range, offset) })) } } : {}),
      ...(detail.argLiterals ? { argLiterals: detail.argLiterals.map(value => value ? { ...value, range: shifted(value.range, offset) } : null) } : {}),
      ...(detail.returnedValue ? { returnedValue: { ...detail.returnedValue,
        ownerRanges: detail.returnedValue.ownerRanges.map(range => shiftedTuple(range, offset)),
        expression: shiftedTuple(detail.returnedValue.expression, offset) } } : {}),
      // Version-one evaluation ownership requires a constant sourceOffset.
      ...(detail.evaluationOwner ? { evaluationOwner: evaluationOffset === null ? undefined
        : { ...detail.evaluationOwner, sourceOffset: evaluationOffset } } : {}),
      ...(piecewise ? { sourceMapping: { schemaVersion: 2, kind: 'source-pieces', quality: 'exact',
        contentIdentity: embeddedContentIdentity(offset), localRange: { start: detail.start, end: detail.end },
        pieces: mapEmbeddedContentRange(offset, detail.start, detail.end) } } : {}),
      ...(piecewise && detail.evaluationOwner && evaluationOffset === null
        ? { evaluationOwnerUnavailable: 'piecewise_evaluation_mapping_unsupported' } : {})
    };
  });
};

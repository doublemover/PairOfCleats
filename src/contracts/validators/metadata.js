import { admitFlowEvidence } from '../../shared/flow-evidence.js';
import { sourceOutlineErrors } from '../../shared/source-outline.js';
import { assertEmbeddedContentView, embeddedContentIdentity, unmapEmbeddedContentRange } from '../../shared/embedded-content.js';
/** Validate relationships that JSON Schema field types cannot express. */
export const validateMetadataV2Semantics = (metadata) => {
  const errors = [];
  if (!metadata || typeof metadata !== 'object') return errors;
  if (metadata.segment?.contentView) {
    try {
      const view = assertEmbeddedContentView(metadata.segment.contentView), origin = metadata.segment.contentOrigin;
      if (metadata.segment.start !== view.sourceStart || metadata.segment.end !== view.sourceEnd
        || origin && (origin.start !== view.containerStart || origin.end !== view.containerEnd)) throw new Error('segment extent differs');
    } catch { errors.push('/segment: embedded content differs from its admitted source/container extent'); }
  } else if (metadata.segment?.contentOrigin) errors.push('/segment: content origin requires its admitted content view');
  if (metadata.sourceOutline) errors.push(...sourceOutlineErrors(metadata.sourceOutline).map(error => '/sourceOutline: ' + error));
  if (metadata.javascriptDeclaration) {
    const value = metadata.javascriptDeclaration, mapping = value.sourceMapping;
    if (!mapping || value.projectionRange?.start !== metadata.range?.start || value.projectionRange?.end !== metadata.range?.end) errors.push('/javascriptDeclaration: projection range differs from chunk');
    const logicalLength = mapping?.schemaVersion === 2 ? mapping.contentView?.length : mapping?.length;
    if (value.ownerRange && mapping && (value.ownerRange.start < 0 || value.ownerRange.end > logicalLength
      || value.ownerRange.end <= value.ownerRange.start)) errors.push('/javascriptDeclaration: owner range exceeds its parsed snapshot');
    const sourceLength = metadata.flowEvidence?.source?.length;
    if (mapping?.schemaVersion === 2) {
      try {
        const view = assertEmbeddedContentView(mapping.contentView);
        unmapEmbeddedContentRange(view, value.projectionRange.start, value.projectionRange.end);
        if (!metadata.segment?.contentView || embeddedContentIdentity(view) !== embeddedContentIdentity(metadata.segment.contentView)
          || metadata.segment.start !== view.sourceStart || metadata.segment.end !== view.sourceEnd
          || Number.isSafeInteger(sourceLength) && view.containerEnd > sourceLength) throw new Error('container differs');
      } catch { errors.push('/javascriptDeclaration: piecewise projection differs from its admitted container map'); }
    } else if (mapping && (value.projectionRange.start < mapping.offset || value.projectionRange.end > mapping.offset + mapping.length
      || Number.isSafeInteger(sourceLength) && mapping.offset + mapping.length > sourceLength)) errors.push('/javascriptDeclaration: projection mapping exceeds its container source');
    if (value.state === 'qualified' && (!value.occurrenceId || !value.sourceHash)) errors.push('/javascriptDeclaration: qualified join lacks source/occurrence identity');
  }
  if (metadata.flowEvidence) {
    try {
      admitFlowEvidence(metadata.flowEvidence, metadata);
      const range = metadata.flowEvidence.source.range;
      if (range && (range.start !== metadata.range?.start || range.end !== metadata.range?.end)) errors.push('/flowEvidence/source/range differs from chunk range');
    } catch (error) { errors.push('/flowEvidence: ' + error.message); }
  }
  const ordered = (value, start, end, label) => {
    if (Number.isFinite(value?.[start]) && Number.isFinite(value?.[end])
      && value[start] > value[end]) {
      errors.push(`${label}/${end} must not precede ${start}`);
    }
  };
  for (const key of ['range', 'segment']) {
    ordered(metadata[key], 'start', 'end', `/${key}`);
    ordered(metadata[key], 'startLine', 'endLine', `/${key}`);
  }
  ordered(metadata.segment, 'pageStart', 'pageEnd', '/segment');
  ordered(metadata.segment, 'paragraphStart', 'paragraphEnd', '/segment');
  for (const [start, end] of [['start', 'end'], ['startLine', 'endLine']]) {
    const range = metadata.range;
    const segment = metadata.segment;
    if (Number.isFinite(range?.[start]) && Number.isFinite(segment?.[start])
      && range[start] < segment[start]) {
      errors.push(`/range/${start} must be within segment`);
    }
    if (Number.isFinite(range?.[end]) && Number.isFinite(segment?.[end])
      && range[end] > segment[end]) {
      errors.push(`/range/${end} must be within segment`);
    }
  }
  return errors;
};

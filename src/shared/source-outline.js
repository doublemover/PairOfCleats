import { createHash } from 'node:crypto';
import { stableStringifyForSignature } from './stable-json.js';

export const SOURCE_OUTLINE_VERSION = '1';
export const sourceHeadingIdentity = ({ format, source, start, end, titleStart, titleEnd, style }) => 'heading1:'
  + createHash('sha256').update(stableStringifyForSignature({ format, source, start, end, titleStart, titleEnd, style })).digest('hex');

export const sourceOutlineErrors = ({ coverage, heading = null } = {}) => {
  const errors = [];
  if (!coverage?.source || !coverage.limits || !coverage.observed || !coverage.reasonCounts
    || !['source-outline:rst', 'source-outline:asciidoc'].includes(coverage.producer)) return ['missing outline source qualification'];
  const source = coverage.source;
  if (source.admittedLength > source.length || coverage.scannedLength > source.admittedLength) errors.push('outline extent exceeds source admission');
  if (coverage.observed.work > coverage.limits.maxWork || coverage.observed.headings > coverage.limits.maxHeadings) errors.push('outline work exceeds admitted limits');
  if (coverage.state === 'complete' && (Object.keys(coverage.reasonCounts).length || source.admittedLength !== source.length)) errors.push('complete outline has unresolved coverage');
  if (heading) {
    if (!heading.titleRange || !heading.sourceRange || typeof heading.title !== 'string') return ['missing heading source/title range'];
    if (heading.titleRange.start < heading.sourceRange.start || heading.titleRange.end > heading.sourceRange.end
      || heading.titleRange.end - heading.titleRange.start !== heading.title.length || heading.sourceRange.end > source.admittedLength) errors.push('heading/title range exceeds admitted source envelope');
    const format = coverage.producer.slice('source-outline:'.length);
    const expected = sourceHeadingIdentity({ format, source, start: heading.sourceRange.start, end: heading.sourceRange.end,
      titleStart: heading.titleRange.start, titleEnd: heading.titleRange.end, style: heading.style });
    if (heading.id !== expected) errors.push('heading occurrence identity differs from its source envelope');
    if (heading.parentId === heading.id) errors.push('heading cannot be its own parent');
  }
  return errors;
};

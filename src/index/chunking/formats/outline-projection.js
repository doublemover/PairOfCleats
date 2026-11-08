import { createHash } from 'node:crypto';
import { createBoundedLineAccessor } from '../../../shared/lines.js';
import { SOURCE_OUTLINE_VERSION, sourceHeadingIdentity } from '../../../shared/source-outline.js';

export const OUTLINE_LIMITS = Object.freeze({ maxChars: 1048576, maxLines: 20000, maxLineChars: 4096,
  maxHeadings: 4096, maxDepth: 32, maxWork: 100000 });
const hash = value => createHash('sha256').update(value).digest('hex');

/** Original UTF-16 source ranges own both outline facts and complete source
 * partitioning. A rejected/unknown heading never receives an invented identity. */
export const createOutlineProjection = (text, format, overrides = {}) => {
  const limits = { ...OUTLINE_LIMITS, ...overrides };
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 0) || limits.maxLines < 1) throw new TypeError('Invalid outline limits.');
  const lines = createBoundedLineAccessor(text, limits), reasons = Object.create(null), samples = [];
  const source = { encoding: 'utf16-js-string', length: text.length, admittedLength: lines.admittedEnd,
    textHash: text.length <= limits.maxChars ? hash(Buffer.from(text, 'utf16le')) : null };
  source.admittedTextHash = source.textHash && lines.admittedEnd === text.length ? source.textHash
    : hash(Buffer.from(text.slice(0, lines.admittedEnd), 'utf16le'));
  const headings = [], parents = [];
  let work = 0, stopped = false, scannedLength = 0, ancestryKnown = true;
  const note = (reason, line = null) => {
    if (Object.hasOwn(reasons, reason) || Object.keys(reasons).length < 16) reasons[reason] = (reasons[reason] || 0) + 1;
    if (samples.length < 8) samples.push({ reason, line });
  };
  for (const reason of lines.reasons) note(reason);
  const read = index => {
    if (index < 0 || index >= lines.length || stopped) return '';
    if (work >= limits.maxWork) { stopped = true; note('outline_work_limit', index); return ''; }
    work++;
    const line = lines.getLine(index);
    if (line.length > limits.maxLineChars) { note('outline_line_chars_limit', index); ancestryKnown = false; stopped = true; return null; }
    scannedLength = Math.max(scannedLength, lines.starts[index + 1] ?? lines.admittedEnd);
    return line;
  };
  const admit = ({ title, titleStart, titleEnd, start, end, level, style, anchor = null, levelBasis }) => {
    if (stopped) return false;
    if (headings.length >= limits.maxHeadings) { note('outline_headings_limit'); stopped = true; return false; }
    if (level >= limits.maxDepth) { note('outline_depth_limit'); ancestryKnown = false; return false; }
    while (parents.length && parents.at(-1).level >= level) parents.pop();
    const id = sourceHeadingIdentity({ format, source, start, end, titleStart, titleEnd, style });
    const parent = ancestryKnown ? parents.at(-1)?.id || null : null;
    const heading = { id, title, titleRange: { start: titleStart, end: titleEnd }, sourceRange: { start, end },
      level, levelBasis, style, parentId: parent, parentState: ancestryKnown ? 'known-within-admitted-subset' : 'unqualified-prior-candidate', anchor };
    headings.push(heading); parents.push(heading);
    return true;
  };
  return { text, format, limits, lines, read, note, admit,
    unknownAncestry: () => { ancestryKnown = false; }, stopped: () => stopped,
    finish: () => {
      const coverage = { schemaVersion: 1, producer: 'source-outline:' + format, producerVersion: SOURCE_OUTLINE_VERSION,
        scope: 'top-level-heading-syntax-subset', coordinateSystem: 'utf16-provided-source', state: Object.keys(reasons).length ? 'partial' : 'complete', source,
        scannedLength, limits, observed: { work, headings: headings.length }, omittedHeadings: null, reasonCounts: { ...reasons }, samples };
      const chunks = headings.map((heading, i) => ({ start: heading.sourceRange.start, end: headings[i + 1]?.sourceRange.start ?? text.length,
        name: heading.title, kind: 'Section', meta: { format, title: heading.title, heading, outlineCoverage: coverage } }));
      if (!chunks.length) chunks.push({ start: 0, end: text.length, name: format, kind: 'Section', meta: { format, sourceOnly: true, outlineCoverage: coverage } });
      else if (chunks[0].start > 0) chunks.unshift({ start: 0, end: chunks[0].start, name: 'preamble', kind: 'Section',
        meta: { format, title: 'preamble', preamble: true, outlineCoverage: coverage } });
      return { headings, coverage, chunks };
    }
  };
};

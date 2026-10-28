import { finalizeSegments } from './finalize.js';

/** JSX is JavaScript syntax, including its markup and expression islands.
 * Keep one canonical program so existing parser-owned chunks/caches retain
 * declarations crossing JSX boundaries. Optional overlapping detail views must
 * have their own projection/occurrence contract; HTML is not this syntax owner.
 */
export const segmentJsx = ({ text, ext, relPath, languageId }) => {
  if (!text.length) return null;
  return finalizeSegments([{ type: 'code',
    languageId: languageId || (ext === '.tsx' ? 'typescript' : 'javascript'),
    ext, start: 0, end: text.length, parentSegmentId: null, meta: {} }], relPath);
};

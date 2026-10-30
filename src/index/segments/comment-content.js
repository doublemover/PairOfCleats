import { createEmbeddedContentView } from '../../shared/embedded-content.js';

/** Config extraction has a separate policy from prose presentation. Strip the
 * actual delimiters and recognized star decoration plus one optional space.
 * Unstarred lines lose only their shared indentation margin. Preserve relative
 * indentation, blank lines, CRLF and all remaining source characters.
 */
export const createCommentContentView = (text, entry) => {
  const start = entry.start + (entry.markerStart?.length || 0);
  const end = entry.end - (entry.markerEnd && text.slice(entry.start, entry.end).endsWith(entry.markerEnd) ? entry.markerEnd.length : 0);
  const lines = [];
  let cursor = start;
  while (cursor < end) {
    const newline = text.indexOf('\n', cursor);
    const lineEnd = newline < 0 || newline >= end ? end : newline;
    const bodyEnd = lineEnd > cursor && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
    const body = text.slice(cursor, bodyEnd);
    const star = entry.stripStar ? /^[\t ]*\*(?: ?)/u.exec(body) : null;
    const indentation = /^[\t ]*/u.exec(body)[0].length;
    lines.push({ start: cursor, bodyEnd, end: lineEnd < end ? lineEnd + 1 : end,
      star: star?.[0].length || 0, indentation, blank: /^[\t ]*$/u.test(body) });
    cursor = lineEnd < end ? lineEnd + 1 : end;
  }
  const ordinary = lines.filter(line => !line.star && !line.blank);
  const margin = ordinary.length ? Math.min(...ordinary.map(line => line.indentation)) : 0;
  const ranges = [];
  for (const line of lines) {
    const prefix = line.star || Math.min(margin, line.indentation);
    if (line.start + prefix < line.bodyEnd) ranges.push({ start: line.start + prefix, end: line.bodyEnd });
    if (line.end > line.bodyEnd) ranges.push({ start: line.bodyEnd, end: line.end });
  }
  return createEmbeddedContentView(text, ranges, { containerStart: entry.start, containerEnd: entry.end,
    policy: 'comment-content-margin-v1' });
};

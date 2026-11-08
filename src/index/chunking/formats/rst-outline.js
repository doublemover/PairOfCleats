import { createOutlineProjection } from './outline-projection.js';

const adornment = line => {
  if (!line) return null;
  const code = line.charCodeAt(0);
  return code >= 33 && code <= 126 && !/[A-Za-z0-9]/u.test(line[0]) && [...line].every(char => char === line[0]) ? line[0] : null;
};
const bodyMarker = line => /^(?:\.\.(?:\s|$)|(?:[-+*]|\d+[.)])\s|[|>]|>>>|:[^:]+:\s)/u.test(line);

/** Top-level, ASCII-width-qualified heading syntax. Directive/indented/literal
 * bodies retain source but never become a second document outline. */
export const projectRstOutline = (text, limits = {}) => {
  const owner = createOutlineProjection(text, 'rst', limits), styles = new Map();
  let prior = '', literalPending = false, quotedLiteral = null, anchor = null;
  for (let i = 0; i < owner.lines.length && !owner.stopped(); i++) {
    const line = owner.read(i);
    if (line === null) { prior = ''; continue; }
    if (!line.trim()) { prior = ''; continue; }
    if (quotedLiteral) {
      if (line[0] === quotedLiteral) { prior = line; continue; }
      quotedLiteral = null;
    }
    if (literalPending) {
      literalPending = false;
      if (adornment(line[0])) { quotedLiteral = line[0]; prior = line; continue; }
    }
    if (/^[ \t]/u.test(line)) { anchor = null; prior = line; continue; }
    const target = /^\.\. _([^:]+):[ \t]*$/u.exec(line);
    if (target) { anchor = { value: target[1], range: { start: owner.lines.starts[i], end: owner.lines.starts[i] + line.length } }; prior = ''; continue; }
    if (bodyMarker(line)) {
      if (/^\.\.\s+\S+::/u.test(line)) owner.note('rst_directive_content_not_evaluated', i);
      anchor = null; prior = line; continue;
    }
    const over = adornment(line), titleLine = over ? owner.read(i + 1) : line;
    const underline = owner.read(i + (over ? 2 : 1)), under = adornment(underline);
    if (!titleLine || underline === null || !under || adornment(titleLine) || bodyMarker(titleLine.trimStart())) {
      if (line.endsWith('::')) literalPending = true;
      anchor = null; prior = line; continue;
    }
    const title = titleLine.trim(), left = titleLine.indexOf(title), titleIndex = i + (over ? 1 : 0);
    if (prior || !over && left > 0 || over && (over !== under || line.length !== underline.length)) {
      owner.note('rst_heading_block_or_adornment_mismatch', i); owner.unknownAncestry();
      if (over) i += 2;
      anchor = null; prior = line; continue;
    }
    // Font-dependent/wide/combining/control widths need a separately qualified
    // policy. Do not substitute UTF-16 length for that visual measurement.
    if (!/^[\x20-\x7e]+$/u.test(titleLine)) {
      owner.note('rst_title_visual_width_unqualified', titleIndex); owner.unknownAncestry(); i += over ? 2 : 1; prior = ''; continue;
    }
    if (underline.length < left + title.length) {
      owner.note('rst_title_adornment_too_short', i); owner.unknownAncestry(); i += over ? 2 : 1; prior = ''; continue;
    }
    const style = { character: under, overline: Boolean(over), length: underline.length }, key = under + ':' + Boolean(over);
    const level = styles.has(key) ? styles.get(key) : styles.size;
    const lastLine = i + (over ? 2 : 1), titleStart = owner.lines.starts[titleIndex] + left;
    if (owner.admit({ title, titleStart, titleEnd: titleStart + title.length, start: owner.lines.starts[i],
      end: owner.lines.starts[lastLine] + underline.length, level, style, anchor, levelBasis: 'observed-admitted-adornment-style-order' })) styles.set(key, level);
    anchor = null; i = lastLine; prior = '';
  }
  return owner.finish();
};

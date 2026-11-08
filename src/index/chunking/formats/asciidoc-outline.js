import { createOutlineProjection } from './outline-projection.js';

const delimiter = line => {
  if (line === '--') return { token: line, model: 'compound' };
  if (/^[|,:!]={3,}$/u.test(line)) return { token: line, model: 'opaque' };
  if (!/^([-./=*+_])\1{3,}$/u.test(line)) return null;
  return { token: line, model: ['-', '.', '/', '+'].includes(line[0]) ? 'opaque' : 'compound' };
};
const styles = new Set(['source', 'listing', 'literal', 'pass', 'verse', 'quote', 'example', 'sidebar', 'open', 'comment',
  'abstract', 'NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']);
const opaqueStyles = new Set(['source', 'listing', 'literal', 'pass', 'verse', 'comment']);

/** Exact delimiter ownership precedes heading admission. No preprocessing,
 * include, attribute substitution, macro or extension execution occurs. */
export const projectAsciiDocOutline = (text, limits = {}) => {
  const owner = createOutlineProjection(text, 'asciidoc', limits), stack = [];
  let priorBlank = true, anchor = null, pendingStyle = null, paragraph = false, list = false, continuation = false;
  let conditionalDepth = 0, lastLevel = -1, documentTitle = false;
  for (let i = 0; i < owner.lines.length && !owner.stopped(); i++) {
    const line = owner.read(i);
    if (line === null) { priorBlank = false; continue; }
    const fence = delimiter(line), top = stack.at(-1);
    if (top) {
      if (line === top.token) stack.pop();
      else if (top.model === 'compound' && fence) {
        if (stack.some(block => block.token === line)) owner.note('asciidoc_interleaved_delimiter', i);
        else if (stack.length >= owner.limits.maxDepth) { owner.note('asciidoc_block_depth_limit', i); break; }
        else stack.push(fence);
      }
      priorBlank = false; continue;
    }
    if (/^(?:ifdef|ifndef|ifeval)::/u.test(line)) {
      if (conditionalDepth >= owner.limits.maxDepth) { owner.note('asciidoc_conditional_depth_limit', i); break; }
      conditionalDepth++; anchor = null; owner.note('asciidoc_preprocessor_unexpanded', i); owner.unknownAncestry(); continue;
    }
    if (/^endif::/u.test(line)) { if (conditionalDepth) conditionalDepth--; else owner.note('asciidoc_unmatched_conditional', i); continue; }
    if (conditionalDepth) continue;
    if (/^include::/u.test(line)) { anchor = null; owner.note('asciidoc_include_not_expanded', i); owner.unknownAncestry(); continue; }
    if (!line.trim()) { priorBlank = true; paragraph = false; if (!continuation) list = false; continue; }
    if (fence) {
      if (owner.limits.maxDepth === 0) { owner.note('asciidoc_block_depth_limit', i); break; }
      stack.push({ ...fence, ...(opaqueStyles.has(pendingStyle) ? { model: 'opaque' } : {}) });
      pendingStyle = null; anchor = null; priorBlank = false; continue;
    }
    if (line.startsWith('//')) continue;
    const authored = /^\[\[([^,\]]+)(?:,[^\]]*)?\]\]$|^\[#([A-Za-z_][\w:.-]*)\]$/u.exec(line);
    if (authored) { anchor = { value: authored[1] || authored[2], range: { start: owner.lines.starts[i], end: owner.lines.starts[i] + line.length } }; continue; }
    const attributes = /^\[([^\]]+)\]$/u.exec(line);
    if (attributes) {
      pendingStyle = attributes[1].split(',')[0].trim();
      if (!styles.has(pendingStyle)) { owner.note('asciidoc_custom_block_style_unqualified', i); owner.unknownAncestry(); break; }
      continue;
    }
    if (/^\{[^}]+\}$/u.test(line)) { owner.note('asciidoc_substituted_block_boundary_unqualified', i); break; }
    if (/^:[^:]+:/u.test(line)) { anchor = null; owner.note('asciidoc_attributes_unexpanded', i); owner.unknownAncestry(); continue; }
    if (/^(?:\*+|\.+|\d+\.|-)\s|^\S.*::{1,2}\s/u.test(line)) list = true;
    if (line === '+' && list) { continuation = true; continue; }
    if (pendingStyle) { paragraph = true; pendingStyle = null; }
    const match = /^(={1,6}) (\S.*)$/u.exec(line);
    if (match && !paragraph && !list && priorBlank) {
      const level = match[1].length - 1, title = match[2].trimEnd(), start = owner.lines.starts[i];
      if (level === 0 && documentTitle || lastLevel < 0 && level > 1 || lastLevel >= 0 && level > lastLevel + 1) {
        owner.note('asciidoc_section_hierarchy_unqualified', i); owner.unknownAncestry();
      } else {
        if (/[{}]|\[\[/u.test(title)) owner.note('asciidoc_title_substitution_unqualified', i);
        if (owner.admit({ title, titleStart: start + match[1].length + 1, titleEnd: start + match[1].length + 1 + title.length,
          start, end: start + line.length, level, levelBasis: 'authored-equals-count', style: { marker: match[1] }, anchor })) {
          lastLevel = level; documentTitle ||= level === 0;
        }
      }
      anchor = null; priorBlank = false; continue;
    }
    if (match && !paragraph && !list) owner.note('asciidoc_heading_block_boundary_unqualified', i);
    if (list) continuation = false;
    anchor = null; priorBlank = false;
  }
  if (stack.length) owner.note('asciidoc_unclosed_delimited_block');
  if (conditionalDepth) owner.note('asciidoc_unclosed_conditional');
  return owner.finish();
};

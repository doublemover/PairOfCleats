// Source UNVALIDATED. Static local navigation evidence; never executes Markdown.
import fs from 'node:fs';
import path from 'node:path';

const normalizeReference = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
const lineAt = (text, index) => text.slice(0, index).split('\n').length;
const blank = text => text.replace(/[^\r\n]/g, ' ');

export const maskMarkdownCode = text => {
  const lines = text.split(/(?<=\n)/);
  let fence = null;
  return lines.map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n)?$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return blank(line);
    }
    if (marker) { fence = { character: marker[1][0], length: marker[1].length }; return blank(line); }
    if (/^(?: {4}|\t)/.test(line)) return blank(line);
    // Matching delimiter runs permit a literal backtick inside longer code spans.
    return line.replace(/(`+)([\s\S]*?)\1(?!`)/g, match => blank(match));
  }).join('').replace(/<!--[\s\S]*?-->/g, match => blank(match));
};

const unescape = text => text.replace(/\\([\\`*{}\[\]()#+\-.!_<>])/g, '$1');
const destinationAt = (text, start) => {
  let index = start;
  while (/\s/.test(text[index] || '') && index < text.length) index++;
  if (text[index] === '<') {
    let end = index + 1;
    for (; end < text.length && text[end] !== '>'; end++) if (text[end] === '\\') end++;
    if (end >= text.length) return null;
    return { target: unescape(text.slice(index + 1, end)), end: end + 1 };
  }
  const begin = index;
  let nested = 0;
  for (; index < text.length; index++) {
    const character = text[index];
    if (character === '\\') { index++; continue; }
    if (character === '(') nested++;
    if (character === ')') { if (!nested) break; nested--; }
    if (/\s/.test(character) && nested === 0) break;
  }
  if (nested) return null;
  return { target: unescape(text.slice(begin, index)), end: index };
};

const closingBracket = (text, start) => {
  let depth = 1;
  for (let index = start; index < text.length; index++) {
    if (text[index] === '\\') { index++; continue; }
    if (text[index] === '[') depth++;
    else if (text[index] === ']') { depth--; if (depth === 0) return index; }
  }
  return -1;
};

export const extractMarkdownLinks = text => {
  const visible = maskMarkdownCode(text);
  const references = new Map();
  const definitionRanges = [];
  const links = [];
  const diagnostics = [];
  for (const match of visible.matchAll(/^ {0,3}\[([^\]\n]+)\]:[ \t]*(.*)$/gm)) {
    const parsed = destinationAt(match[2], 0);
    const id = normalizeReference(match[1]);
    if (parsed?.target && !references.has(id)) references.set(id, parsed.target);
    else if (!parsed?.target) diagnostics.push({ code: 'reference-destination-not-parsed', line: lineAt(visible, match.index), reference: id });
    definitionRanges.push([match.index, match.index + match[0].length]);
  }
  for (let index = 0; index < visible.length; index++) {
    if (visible[index] === '\\') { index++; continue; }
    if (visible[index] !== '[' || definitionRanges.some(([start, end]) => index >= start && index < end)) continue;
    const close = closingBracket(visible, index + 1);
    if (close < 0) continue;
    const label = visible.slice(index + 1, close);
    const line = lineAt(visible, index);
    if (visible[close + 1] === '(') {
      const destination = destinationAt(visible, close + 2);
      if (!destination) { diagnostics.push({ code: 'inline-destination-not-parsed', line }); index = close; continue; }
      let after = destination.end;
      while (/\s/.test(visible[after] || '') && after < visible.length) after++;
      if (['"', "'"].includes(visible[after])) {
        const quote = visible[after++];
        while (after < visible.length && visible[after] !== quote) { if (visible[after] === '\\') after++; after++; }
        after++;
        while (/\s/.test(visible[after] || '') && after < visible.length) after++;
      }
      if (visible[after] !== ')') diagnostics.push({ code: 'inline-destination-not-parsed', line });
      else links.push({ target: destination.target, line, kind: visible[index - 1] === '!' ? 'image' : 'inline' });
      index = Math.max(close, after);
    } else if (visible[close + 1] === '[') {
      const end = visible.indexOf(']', close + 2);
      if (end < 0) continue;
      const reference = normalizeReference(visible.slice(close + 2, end) || label);
      if (references.has(reference)) links.push({ target: references.get(reference), line, kind: 'reference' });
      else diagnostics.push({ code: 'unresolved-reference', line, reference });
      index = end;
    } else {
      const reference = normalizeReference(label);
      if (references.has(reference)) links.push({ target: references.get(reference), line, kind: 'shortcut-reference' });
      index = close;
    }
  }
  for (const match of visible.matchAll(/<(?:a|img|source|video)\b[^>]*?\b(?:href|src)\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
    links.push({ target: match[2].replace(/&amp;/g, '&'), line: lineAt(visible, match.index), kind: 'html' });
  }
  return { links, diagnostics, visible };
};

const headingText = value => value.replace(/<[^>]*>/g, '').replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/(?<![\p{L}\p{N}])_(\S(?:.*?\S)?)_(?![\p{L}\p{N}])/gu, '$1').replace(/[\*~`]/g, '');
const slug = value => headingText(value).toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');

export const collectMarkdownAnchors = text => {
  // Headings keep inline-code text; only fenced/indented code must disappear.
  const visible = maskMarkdownCode(text.replace(/`([^`\n]+)`/g, '$1'));
  const anchors = new Set();
  const used = new Set();
  const headings = [];
  const lines = visible.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const atx = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(lines[index]);
    const setext = index > 0 && /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[index]) && lines[index - 1].trim()
      && !/^\s*(?:[-*+]\s|>|\|)/.test(lines[index - 1]);
    if (!atx && !setext) continue;
    const label = atx ? atx[1] : lines[index - 1].trim();
    const base = slug(label);
    let anchor = base, counter = 0;
    while (used.has(anchor)) anchor = `${base}-${++counter}`;
    used.add(anchor); anchors.add(anchor);
    headings.push({ label, anchor, line: index + (atx ? 1 : 0) });
  }
  for (const match of visible.matchAll(/<[^>]+\b(?:id|name)\s*=\s*(["'])([^"']+)\1[^>]*>/gi)) anchors.add(match[2]);
  return { anchors, headings };
};

const contained = (target, root) => { const relative = path.relative(root, target); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const exactCase = (target, root) => {
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    const entries = fs.readdirSync(current);
    if (!entries.includes(part)) return false;
    current = path.join(current, part);
  }
  return true;
};
const readMarkdown = file => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error('Markdown source is not a bounded regular file.');
  return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file));
};

export const checkMarkdownDocuments = ({ root = process.cwd(), files, anchors = true } = {}) => {
  root = fs.realpathSync(root);
  const issues = [];
  const rows = [];
  const targets = new Map();
  let externalLinks = 0;
  for (const source of files) {
    const file = path.resolve(root, source);
    const row = { source, links: 0, anchorsChecked: 0, externalLinks: 0, partial: [], issues: [] };
    rows.push(row);
    const issue = (code, line, detail = {}) => { const value = { source, code, line, ...detail }; issues.push(value); row.issues.push(value); };
    let text;
    try {
      if (!contained(file, root) || !contained(fs.realpathSync(file), root)) throw new Error('Markdown source escapes its repository.');
      text = readMarkdown(file);
    } catch (error) { issue('invalid-source-or-utf8', 1, { reason: error.code || error.message }); continue; }
    const { links, diagnostics, visible } = extractMarkdownLinks(text);
    for (const diagnostic of diagnostics) issue(diagnostic.code, diagnostic.line, diagnostic);
    for (const match of visible.matchAll(/\uFFFD|[\x00-\x08\x0b\x0c\x0e-\x1f]|(?:Ã[\u0080-\u00bf]|Â[\u0080-\u00bf]|â(?:€|†|œ)|ðŸ)/gu)) issue('suspect-text-encoding', lineAt(visible, match.index), { text: match[0], reviewRequired: true });
    row.links = links.length;
    for (const link of links) {
      const raw = link.target;
      if (!raw) continue;
      if (/^(?:https?:|mailto:|tel:|data:|\/\/)/i.test(raw)) { externalLinks++; row.externalLinks++; continue; }
      if (/^[a-z][a-z\d+.-]*:/i.test(raw)) { issue('nonportable-or-unsupported-link-scheme', link.line, { target: raw }); continue; }
      const hashAt = raw.indexOf('#');
      const beforeHash = hashAt < 0 ? raw : raw.slice(0, hashAt);
      let targetPath, fragment;
      try { targetPath = decodeURIComponent(beforeHash.split('?')[0]); fragment = hashAt < 0 ? '' : decodeURIComponent(raw.slice(hashAt + 1)); }
      catch { issue('invalid-percent-encoding', link.line, { target: raw }); continue; }
      if (/[\x00-\x1f]/.test(targetPath + fragment) || targetPath.includes('\\')) { issue('invalid-local-link-path', link.line, { target: raw }); continue; }
      let target = targetPath ? targetPath.startsWith('/') ? path.resolve(root, '.' + targetPath) : path.resolve(path.dirname(file), targetPath) : file;
      if (!contained(target, root)) { issue('local-link-escapes-repository', link.line, { target: raw }); continue; }
      if (!fs.existsSync(target)) target = [target + '.md', target + '.mdx'].find(candidate => fs.existsSync(candidate)) || target;
      if (!fs.existsSync(target)) { issue('missing-local-target', link.line, { target: raw }); continue; }
      if (!contained(fs.realpathSync(target), root)) { issue('local-link-physical-target-escapes-repository', link.line, { target: raw }); continue; }
      if (!exactCase(target, root)) issue('local-target-case-disagrees', link.line, { target: raw });
      if (fs.statSync(target).isDirectory()) target = ['README.md', 'readme.md', 'index.md'].map(name => path.join(target, name)).find(candidate => fs.existsSync(candidate)) || target;
      if (!anchors || !fragment) continue;
      if (!/\.mdx?$/i.test(target)) { row.partial.push({ line: link.line, target: raw, reason: 'non-markdown-fragment-not-evaluated' }); continue; }
      try {
        if (!targets.has(target)) targets.set(target, collectMarkdownAnchors(readMarkdown(target)).anchors);
        row.anchorsChecked++;
        if (!targets.get(target).has(fragment)) issue('missing-markdown-anchor', link.line, { target: raw });
      } catch (error) { issue('invalid-target-or-utf8', link.line, { target: raw, reason: error.code || error.message }); }
    }
  }
  return { schemaVersion: 1, kind: 'markdown-local-navigation', ok: !issues.length, sources: rows, issues,
    coverage: { documents: rows.length, localFragmentsChecked: rows.reduce((count, row) => count + row.anchorsChecked, 0), externalLinks,
      partialFragments: rows.reduce((count, row) => count + row.partial.length, 0), behaviorEvaluated: 0, remoteReachabilityEvaluated: 0 },
    limitations: ['Static conventional Markdown headings/references/HTML IDs only; renderer-specific heading extensions need separate qualification.',
      'No Markdown commands, remote URLs, services or downloads executed.'] };
};

/** Includes the real README and every docs Markdown source, including archives.
 * No symlink traversal, ignored implementation copy, generated report rewrite or
 * implicit network link check is part of this inventory.
 */
export const inventoryMarkdownDocuments = (root = process.cwd()) => {
  const files = [];
  if (fs.existsSync(path.join(root, 'README.md'))) files.push('README.md');
  const pending = ['docs'];
  let count = 0;
  while (pending.length) {
    const relative = pending.pop();
    const directory = path.join(root, relative);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Markdown inventory refuses a linked/non-directory source root.');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++count > 50000) throw new Error('Markdown inventory exceeded its explicit entry budget.');
      const child = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Markdown inventory refuses linked source entries: ' + child);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) files.push(child.replaceAll(path.sep, '/'));
    }
  }
  return files.sort();
};

import * as yaml from 'yaml';
import {
  EXTS_PROSE,
  isCLike,
  isGo,
  isJava,
  isJsLike,
  isPerl,
  isRust,
  isShell,
  isTypeScript,
  isCSharp,
  isKotlin,
  isRuby,
  isPhp,
  isLua,
  isSql
} from './constants.js';
import { buildJsChunks } from '../lang/javascript.js';
import { buildTypeScriptChunks } from '../lang/typescript.js';
import { buildCSharpChunks } from '../lang/csharp.js';
import { buildKotlinChunks } from '../lang/kotlin.js';
import { buildRubyChunks } from '../lang/ruby.js';
import { buildPhpChunks } from '../lang/php.js';
import { buildLuaChunks } from '../lang/lua.js';
import { buildSqlChunks } from '../lang/sql.js';
import { buildCLikeChunks } from '../lang/clike.js';
import { buildPythonChunksFromAst, buildPythonHeuristicChunks } from '../lang/python.js';
import { buildRustChunks } from '../lang/rust.js';
import { buildSwiftChunks } from '../lang/swift.js';
import { buildGoChunks } from '../lang/go.js';
import { buildJavaChunks } from '../lang/java.js';
import { buildPerlChunks } from '../lang/perl.js';
import { buildShellChunks } from '../lang/shell.js';
import { buildLineIndex } from '../shared/lines.js';

function buildChunksFromMatches(text, matches, titleTransform) {
  const chunks = [];
  for (let i = 0; i < matches.length; ++i) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const rawTitle = matches[i][0];
    const title = titleTransform ? titleTransform(rawTitle) : rawTitle.trim();
    chunks.push({
      start,
      end,
      name: title || 'section',
      kind: 'Section',
      meta: { title }
    });
  }
  return chunks.length ? chunks : null;
}

function buildChunksFromLineHeadings(text, headings) {
  if (!headings.length) return null;
  const lineIndex = buildLineIndex(text);
  const chunks = [];
  for (let i = 0; i < headings.length; ++i) {
    const startLine = headings[i].line;
    const endLine = i + 1 < headings.length ? headings[i + 1].line : lineIndex.length;
    const start = lineIndex[startLine] || 0;
    const end = endLine < lineIndex.length ? lineIndex[endLine] : text.length;
    const title = headings[i].title || 'section';
    chunks.push({
      start,
      end,
      name: title,
      kind: 'Section',
      meta: { title }
    });
  }
  return chunks;
}

function chunkMarkdown(text) {
  const matches = [...text.matchAll(/^#{1,6} .+$/gm)];
  return buildChunksFromMatches(text, matches, (raw) => raw.replace(/^#+ /, '').trim());
}

function chunkAsciiDoc(text) {
  const matches = [...text.matchAll(/^={1,6} .+$/gm)];
  return buildChunksFromMatches(text, matches, (raw) => raw.replace(/^=+ /, '').trim());
}

function chunkRst(text) {
  const lines = text.split('\n');
  const headings = [];
  for (let i = 1; i < lines.length; ++i) {
    const underline = lines[i].trim();
    if (!underline) continue;
    if (/^([=~^"'#*\\-])\1{2,}$/.test(underline)) {
      const title = lines[i - 1].trim();
      if (title) headings.push({ line: i - 1, title });
    }
  }
  return buildChunksFromLineHeadings(text, headings);
}

function parseJsonString(text, start) {
  let i = start + 1;
  let value = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\\\') {
      if (i + 1 < text.length) {
        value += text[i + 1];
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      return { value, end: i };
    }
    value += ch;
    i += 1;
  }
  return null;
}

function chunkJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format: 'json' } }];
  }
  const keys = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const parsedString = parseJsonString(text, i);
      if (!parsedString) break;
      const nextIdx = text.slice(parsedString.end + 1).search(/\S/);
      const nextPos = nextIdx >= 0 ? parsedString.end + 1 + nextIdx : -1;
      if (nextPos > 0 && text[nextPos] === ':' && depth === 1) {
        keys.push({ name: parsedString.value, index: i });
      }
      i = parsedString.end + 1;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    if (ch === '}' || ch === ']') depth -= 1;
    i += 1;
  }
  if (!keys.length) return [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format: 'json' } }];
  const chunks = [];
  for (let k = 0; k < keys.length; ++k) {
    const start = keys[k].index;
    const end = k + 1 < keys.length ? keys[k + 1].index : text.length;
    const title = keys[k].name || 'section';
    chunks.push({
      start,
      end,
      name: title,
      kind: 'ConfigSection',
      meta: { title, format: 'json' }
    });
  }
  return chunks;
}

function chunkIniToml(text) {
  const lines = text.split('\n');
  const headings = [];
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    const match = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/);
    if (match) {
      headings.push({ line: i, title: match[1].trim() });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  return chunks || [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format: 'ini' } }];
}

function chunkXml(text) {
  const keys = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '<') {
      i += 1;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      i = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<?', i) || text.startsWith('<!', i)) {
      const end = text.indexOf('>', i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith('</', i)) {
      depth = Math.max(0, depth - 1);
      const end = text.indexOf('>', i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    const tagMatch = text.slice(i + 1).match(/^([A-Za-z0-9:_-]+)/);
    if (!tagMatch) {
      i += 1;
      continue;
    }
    const tag = tagMatch[1];
    const closeIdx = text.indexOf('>', i + 1);
    const selfClose = closeIdx >= 0 && text[closeIdx - 1] === '/';
    if (depth === 1) {
      keys.push({ name: tag, index: i });
    }
    if (!selfClose) depth += 1;
    i = closeIdx === -1 ? text.length : closeIdx + 1;
  }
  if (!keys.length) return [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format: 'xml' } }];
  const chunks = [];
  for (let k = 0; k < keys.length; ++k) {
    const start = keys[k].index;
    const end = k + 1 < keys.length ? keys[k + 1].index : text.length;
    const title = keys[k].name || 'section';
    chunks.push({
      start,
      end,
      name: title,
      kind: 'ConfigSection',
      meta: { title, format: 'xml' }
    });
  }
  return chunks;
}

function chunkDockerfile(text) {
  const lines = text.split('\n');
  const headings = [];
  const rx = /^\s*([A-Z][A-Z0-9_-]+)\b/;
  for (let i = 0; i < lines.length; ++i) {
    const match = lines[i].match(rx);
    if (match) headings.push({ line: i, title: match[1] });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  return chunks || [{ start: 0, end: text.length, name: 'Dockerfile', kind: 'ConfigSection', meta: { format: 'dockerfile' } }];
}

function chunkMakefile(text) {
  const lines = text.split('\n');
  const headings = [];
  const rx = /^([A-Za-z0-9_./-]+)\s*:/;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.trim().startsWith('#') || !line.trim()) continue;
    const match = line.match(rx);
    if (match) headings.push({ line: i, title: match[1] });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  return chunks || [{ start: 0, end: text.length, name: 'Makefile', kind: 'ConfigSection', meta: { format: 'makefile' } }];
}

function chunkGitHubActions(text) {
  const lines = text.split('\n');
  const headings = [];
  let jobsLine = -1;
  for (let i = 0; i < lines.length; ++i) {
    if (/^\s*jobs:\s*$/.test(lines[i])) {
      jobsLine = i;
      break;
    }
  }
  if (jobsLine >= 0) {
    for (let i = jobsLine + 1; i < lines.length; ++i) {
      const match = lines[i].match(/^\s{2}([A-Za-z0-9_-]+):\s*$/);
      if (match) headings.push({ line: i, title: match[1] });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  return chunks || [{ start: 0, end: text.length, name: 'workflow', kind: 'ConfigSection', meta: { format: 'github-actions' } }];
}

function chunkYaml(text, relPath) {
  const isWorkflow = relPath ? relPath.replace(/\\\\/g, '/').includes('.github/workflows/') : false;
  if (isWorkflow) return chunkGitHubActions(text);
  try {
    const doc = yaml.parse(text);
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
      const keys = Object.keys(doc);
      return keys.map((key) => ({
        start: text.indexOf(key),
        end: text.length,
        name: key,
        kind: 'ConfigSection',
        meta: { title: key, format: 'yaml' }
      }));
    }
  } catch {}
  return null;
}

/**
 * Build chunks for a single file using language-aware heuristics.
 * Falls back to generic fixed-size chunks when no parser matches.
 * @param {object} params
 * @param {string} params.text
 * @param {string} params.ext
 * @param {string|null} [params.relPath]
 * @param {'code'|'prose'} params.mode
 * @param {object|null} [params.pythonAst]
 * @param {Array|null} [params.swiftChunks]
 * @param {Array|null} [params.clikeChunks]
 * @param {Array|null} [params.rustChunks]
 * @param {Array|null} [params.goChunks]
 * @param {Array|null} [params.javaChunks]
 * @param {Array|null} [params.perlChunks]
 * @param {Array|null} [params.shellChunks]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>}
 */
export function smartChunk({
  text,
  ext,
  relPath = null,
  mode,
  pythonAst = null,
  swiftChunks = null,
  clikeChunks = null,
  rustChunks = null,
  goChunks = null,
  javaChunks = null,
  perlChunks = null,
  shellChunks = null,
  tsChunks = null,
  csharpChunks = null,
  kotlinChunks = null,
  rubyChunks = null,
  phpChunks = null,
  luaChunks = null,
  sqlChunks = null
}) {
  if (mode === 'prose') {
    if (ext === '.md') {
      const chunks = chunkMarkdown(text);
      if (chunks) return chunks;
    }
    if (ext === '.rst') {
      const chunks = chunkRst(text);
      if (chunks) return chunks;
    }
    if (ext === '.adoc' || ext === '.asciidoc') {
      const chunks = chunkAsciiDoc(text);
      if (chunks) return chunks;
    }
  }
  if (mode === 'code' && isJsLike(ext)) {
    const chunks = buildJsChunks(text);
    if (chunks && chunks.length) return chunks;
  }
  if (mode === 'code' && isTypeScript(ext)) {
    const chunkList = tsChunks || buildTypeScriptChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && ext === '.py') {
    const astChunks = buildPythonChunksFromAst(text, pythonAst);
    if (astChunks && astChunks.length) return astChunks;
    const fallback = buildPythonHeuristicChunks(text);
    if (fallback && fallback.length) return fallback;
  }
  if (mode === 'code' && ext === '.swift') {
    const chunkList = swiftChunks || buildSwiftChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isCLike(ext)) {
    const chunkList = clikeChunks || buildCLikeChunks(text, ext);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isRust(ext)) {
    const chunkList = rustChunks || buildRustChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isGo(ext)) {
    const chunkList = goChunks || buildGoChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isJava(ext)) {
    const chunkList = javaChunks || buildJavaChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isPerl(ext)) {
    const chunkList = perlChunks || buildPerlChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isShell(ext)) {
    const chunkList = shellChunks || buildShellChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isCSharp(ext)) {
    const chunkList = csharpChunks || buildCSharpChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isKotlin(ext)) {
    const chunkList = kotlinChunks || buildKotlinChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isRuby(ext)) {
    const chunkList = rubyChunks || buildRubyChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isPhp(ext)) {
    const chunkList = phpChunks || buildPhpChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isLua(ext)) {
    const chunkList = luaChunks || buildLuaChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isSql(ext)) {
    const chunkList = sqlChunks || buildSqlChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code') {
    if (ext === '.json') {
      const chunks = chunkJson(text);
      if (chunks) return chunks;
    }
    if (ext === '.toml' || ext === '.ini' || ext === '.cfg' || ext === '.conf') {
      const chunks = chunkIniToml(text);
      if (chunks) return chunks;
    }
    if (ext === '.xml') {
      const chunks = chunkXml(text);
      if (chunks) return chunks;
    }
    if (ext === '.dockerfile') {
      const chunks = chunkDockerfile(text);
      if (chunks) return chunks;
    }
    if (ext === '.makefile') {
      const chunks = chunkMakefile(text);
      if (chunks) return chunks;
    }
    if (ext === '.yaml' || ext === '.yml') {
      const chunks = chunkYaml(text, relPath);
      if (chunks) return chunks;
    }
  }
  if (mode === 'prose' && EXTS_PROSE.has(ext)) {
    return [{ start: 0, end: text.length, name: 'root', kind: 'Section', meta: {} }];
  }
  const fallbackChunkSize = 800;
  const out = [];
  for (let off = 0; off < text.length; off += fallbackChunkSize) {
    out.push({
      start: off,
      end: Math.min(text.length, off + fallbackChunkSize),
      name: 'blob',
      kind: 'Blob',
      meta: {}
    });
  }
  return out;
}

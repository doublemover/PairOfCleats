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

export function chunkMarkdown(text) {
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

export function chunkJson(text) {
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

export function chunkIniToml(text) {
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

export function chunkXml(text) {
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

function parseYamlTopLevelKey(line) {
  const quoted = line.match(/^(['"])(.+?)\1\s*:/);
  if (quoted) return quoted[2].trim();
  const unquoted = line.match(/^([A-Za-z0-9_.-]+)\s*:/);
  if (unquoted) return unquoted[1].trim();
  return null;
}

function chunkYamlTopLevel(text) {
  const lines = text.split('\n');
  const headings = [];
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;
    if (line.startsWith(' ') || line.startsWith('\t')) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '---' || trimmed === '...') continue;
    if (trimmed.startsWith('-')) continue;
    const key = parseYamlTopLevelKey(line);
    if (key) headings.push({ line: i, title: key });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  return chunks && chunks.length
    ? chunks.map((chunk) => ({
      ...chunk,
      kind: 'ConfigSection',
      meta: { ...(chunk.meta || {}), format: 'yaml', title: chunk.name }
    }))
    : null;
}

function resolveYamlChunkMode(text, context) {
  const config = context?.yamlChunking || {};
  const modeRaw = typeof config.mode === 'string' ? config.mode.toLowerCase() : '';
  const mode = ['auto', 'root', 'top-level'].includes(modeRaw) ? modeRaw : 'root';
  const maxBytesRaw = Number(config.maxBytes);
  const maxBytes = Number.isFinite(maxBytesRaw) ? Math.max(0, Math.floor(maxBytesRaw)) : 200 * 1024;
  if (mode === 'auto') {
    return text.length <= maxBytes ? 'top-level' : 'root';
  }
  return mode;
}

export function chunkYaml(text, relPath, context) {
  const isWorkflow = relPath ? relPath.replace(/\\\\/g, '/').includes('.github/workflows/') : false;
  if (isWorkflow) return chunkGitHubActions(text);
  const mode = resolveYamlChunkMode(text, context);
  if (mode === 'top-level') {
    const chunks = chunkYamlTopLevel(text);
    if (chunks && chunks.length) return chunks;
  }
  return [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format: 'yaml' } }];
}

const getTreeSitterOptions = (context) => (
  context?.treeSitter
    ? { treeSitter: context.treeSitter, log: context.log }
    : {}
);

const CODE_CHUNKERS = [
  { id: 'javascript', match: (ext) => isJsLike(ext), chunk: ({ text, ext, context }) =>
    buildJsChunks(text, {
      ext,
      ast: context?.jsAst,
      javascript: context?.javascript,
      flowMode: context?.javascript?.flow
    }) },
  { id: 'typescript', match: (ext) => isTypeScript(ext), chunk: ({ text, ext, relPath, context }) =>
    context?.tsChunks || buildTypeScriptChunks(text, { ext, relPath, parser: context?.typescript?.parser }) },
  { id: 'python', match: (ext) => ext === '.py', chunk: ({ text, context }) => {
    const astChunks = buildPythonChunksFromAst(text, context?.pythonAst || null);
    return (astChunks && astChunks.length) ? astChunks : buildPythonHeuristicChunks(text);
  } },
  { id: 'swift', match: (ext) => ext === '.swift', chunk: ({ text, context }) => context?.swiftChunks || buildSwiftChunks(text, getTreeSitterOptions(context)) },
  { id: 'clike', match: (ext) => isCLike(ext), chunk: ({ text, ext, context }) => context?.clikeChunks || buildCLikeChunks(text, ext, getTreeSitterOptions(context)) },
  { id: 'rust', match: (ext) => isRust(ext), chunk: ({ text, context }) => context?.rustChunks || buildRustChunks(text, getTreeSitterOptions(context)) },
  { id: 'go', match: (ext) => isGo(ext), chunk: ({ text, context }) => context?.goChunks || buildGoChunks(text, getTreeSitterOptions(context)) },
  { id: 'java', match: (ext) => isJava(ext), chunk: ({ text, context }) => context?.javaChunks || buildJavaChunks(text, getTreeSitterOptions(context)) },
  { id: 'perl', match: (ext) => isPerl(ext), chunk: ({ text, context }) => context?.perlChunks || buildPerlChunks(text) },
  { id: 'shell', match: (ext) => isShell(ext), chunk: ({ text, context }) => context?.shellChunks || buildShellChunks(text) },
  { id: 'csharp', match: (ext) => isCSharp(ext), chunk: ({ text, context }) => context?.csharpChunks || buildCSharpChunks(text, getTreeSitterOptions(context)) },
  { id: 'kotlin', match: (ext) => isKotlin(ext), chunk: ({ text, context }) => context?.kotlinChunks || buildKotlinChunks(text, getTreeSitterOptions(context)) },
  { id: 'ruby', match: (ext) => isRuby(ext), chunk: ({ text, context }) => context?.rubyChunks || buildRubyChunks(text) },
  { id: 'php', match: (ext) => isPhp(ext), chunk: ({ text, context }) => context?.phpChunks || buildPhpChunks(text) },
  { id: 'lua', match: (ext) => isLua(ext), chunk: ({ text, context }) => context?.luaChunks || buildLuaChunks(text) },
  { id: 'sql', match: (ext) => isSql(ext), chunk: ({ text, context }) => context?.sqlChunks || buildSqlChunks(text) }
];

const CODE_FORMAT_CHUNKERS = [
  { id: 'json', match: (ext) => ext === '.json', chunk: ({ text }) => chunkJson(text) },
  { id: 'ini', match: (ext) => ['.toml', '.ini', '.cfg', '.conf'].includes(ext), chunk: ({ text }) => chunkIniToml(text) },
  { id: 'xml', match: (ext) => ext === '.xml', chunk: ({ text }) => chunkXml(text) },
  { id: 'dockerfile', match: (ext) => ext === '.dockerfile', chunk: ({ text }) => chunkDockerfile(text) },
  { id: 'makefile', match: (ext) => ext === '.makefile', chunk: ({ text }) => chunkMakefile(text) },
  { id: 'yaml', match: (ext) => ext === '.yaml' || ext === '.yml', chunk: ({ text, relPath, context }) => chunkYaml(text, relPath, context) }
];

const PROSE_CHUNKERS = [
  { id: 'markdown', match: (ext) => ext === '.md', chunk: ({ text }) => chunkMarkdown(text) },
  { id: 'rst', match: (ext) => ext === '.rst', chunk: ({ text }) => chunkRst(text) },
  { id: 'asciidoc', match: (ext) => ext === '.adoc' || ext === '.asciidoc', chunk: ({ text }) => chunkAsciiDoc(text) }
];

const resolveChunker = (chunkers, ext, relPath) => (
  chunkers.find((entry) => entry.match(ext, relPath)) || null
);

/**
 * Build chunks for a single file using language-aware heuristics.
 * Falls back to generic fixed-size chunks when no parser matches.
 * @param {object} params
 * @param {string} params.text
 * @param {string} params.ext
 * @param {string|null} [params.relPath]
 * @param {'code'|'prose'} params.mode
 * @param {object} [params.context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>}
 */
export function smartChunk({
  text,
  ext,
  relPath = null,
  mode,
  context = {}
}) {
  if (mode === 'prose') {
    const chunker = resolveChunker(PROSE_CHUNKERS, ext, relPath);
    if (chunker) {
      const chunks = chunker.chunk({ text, ext, relPath, context });
      if (chunks && chunks.length) return chunks;
    }
  }
  if (mode === 'code') {
    const codeChunker = resolveChunker(CODE_CHUNKERS, ext, relPath);
    if (codeChunker) {
      const chunks = codeChunker.chunk({ text, ext, relPath, context });
      if (chunks && chunks.length) return chunks;
    }
    const formatChunker = resolveChunker(CODE_FORMAT_CHUNKERS, ext, relPath);
    if (formatChunker) {
      const chunks = formatChunker.chunk({ text, ext, relPath, context });
      if (chunks && chunks.length) return chunks;
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

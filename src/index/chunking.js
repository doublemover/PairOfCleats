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
  isHtml,
  isCss,
  isLua,
  isSql,
  CMAKE_EXTS,
  STARLARK_EXTS,
  NIX_EXTS,
  DART_EXTS,
  SCALA_EXTS,
  GROOVY_EXTS,
  R_EXTS,
  JULIA_EXTS,
  HANDLEBARS_EXTS,
  MUSTACHE_EXTS,
  JINJA_EXTS,
  RAZOR_EXTS
} from './constants.js';
import { buildJsChunks } from '../lang/javascript.js';
import { buildTypeScriptChunks } from '../lang/typescript.js';
import { buildCSharpChunks } from '../lang/csharp.js';
import { buildKotlinChunks } from '../lang/kotlin.js';
import { buildRubyChunks } from '../lang/ruby.js';
import { buildPhpChunks } from '../lang/php.js';
import { buildHtmlChunks } from '../lang/html.js';
import { buildCssChunks } from '../lang/css.js';
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
import { buildTreeSitterChunks } from '../lang/tree-sitter.js';

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

function applyFormatMeta(chunks, format, kind) {
  if (!chunks) return null;
  return chunks.map((chunk) => ({
    ...chunk,
    kind: kind || chunk.kind,
    meta: format ? { ...(chunk.meta || {}), format } : chunk.meta
  }));
}

function chunkByLineRegex(text, matcher, options = {}) {
  const lines = text.split('\n');
  const headings = [];
  const skipLine = typeof options.skipLine === 'function' ? options.skipLine : null;
  const titleFor = typeof options.title === 'function' ? options.title : null;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (skipLine && skipLine(line)) continue;
    const match = line.match(matcher);
    if (!match) continue;
    const title = titleFor ? titleFor(match, line) : (match[1] || '').trim();
    if (!title) continue;
    headings.push({ line: i, title });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) {
    return applyFormatMeta(chunks, options.format || null, options.kind || null);
  }
  return [{
    start: 0,
    end: text.length,
    name: options.defaultName || 'section',
    kind: options.kind || 'Section',
    meta: options.format ? { format: options.format } : {}
  }];
}

export function chunkMarkdown(text, ext, context) {
  if (context?.treeSitter?.configChunking === true) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: 'markdown',
      ext: ext || '.md',
      options: getTreeSitterOptions(context)
    });
    if (treeChunks && treeChunks.length) return treeChunks;
  }
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

export function chunkJson(text, context) {
  if (context?.treeSitter?.configChunking === true) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: 'json',
      ext: '.json',
      options: getTreeSitterOptions(context)
    });
    if (treeChunks && treeChunks.length) return treeChunks;
  }
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

export function chunkIniToml(text, format = 'ini', context) {
  if (format === 'toml' && context?.treeSitter?.configChunking === true) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: 'toml',
      ext: '.toml',
      options: getTreeSitterOptions(context)
    });
    if (treeChunks && treeChunks.length) return treeChunks;
  }
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
  if (chunks) {
    return chunks.map((chunk) => ({
      ...chunk,
      kind: 'ConfigSection',
      meta: { ...chunk.meta, format }
    }));
  }
  return [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format } }];
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

function chunkProto(text) {
  const lines = text.split('\n');
  const headings = [];
  const rx = /^\s*(message|enum|service|extend|oneof)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  for (let i = 0; i < lines.length; ++i) {
    const match = lines[i].match(rx);
    if (match) {
      const kind = match[1];
      const name = match[2];
      headings.push({ line: i, title: `${kind} ${name}`.trim() });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  return chunks || [{ start: 0, end: text.length, name: 'proto', kind: 'Section', meta: { format: 'proto' } }];
}

function chunkGraphql(text) {
  const lines = text.split('\n');
  const headings = [];
  const rx = /^\s*(schema|type|interface|enum|union|input|scalar|directive|fragment)\b\s*([A-Za-z_][A-Za-z0-9_]*)?/;
  for (let i = 0; i < lines.length; ++i) {
    const match = lines[i].match(rx);
    if (match) {
      const kind = match[1];
      const name = match[2] || '';
      const title = name ? `${kind} ${name}` : kind;
      headings.push({ line: i, title });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  return chunks || [{ start: 0, end: text.length, name: 'graphql', kind: 'Section', meta: { format: 'graphql' } }];
}

function chunkCmake(text) {
  return chunkByLineRegex(text, /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/, {
    format: 'cmake',
    kind: 'ConfigSection',
    defaultName: 'cmake',
    skipLine: (line) => line.trim().startsWith('#')
  });
}

function chunkStarlark(text) {
  const lines = text.split('\n');
  const headings = [];
  const defRx = /^\s*(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)\b/;
  const callRx = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.trim().startsWith('#')) continue;
    const defMatch = line.match(defRx);
    if (defMatch) {
      headings.push({ line: i, title: `${defMatch[1]} ${defMatch[2]}` });
      continue;
    }
    const callMatch = line.match(callRx);
    if (callMatch) headings.push({ line: i, title: callMatch[1] });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'starlark', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'starlark',
    kind: 'Section',
    meta: { format: 'starlark' }
  }];
}

function chunkNix(text) {
  const skipLine = (line) => {
    const trimmed = line.trim();
    return !trimmed || trimmed.startsWith('#') || trimmed === 'in' || trimmed === 'let';
  };
  return chunkByLineRegex(text, /^\s*([A-Za-z0-9_.-]+)\s*=/, {
    format: 'nix',
    kind: 'Section',
    defaultName: 'nix',
    skipLine
  });
}

function chunkDart(text) {
  const lines = text.split('\n');
  const headings = [];
  const typeRx = /^\s*(class|mixin|enum|extension|typedef)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const funcRx = /^\s*(?:[A-Za-z_][A-Za-z0-9_<>]*\s+)+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
  const skipNames = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new']);
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.trim().startsWith('//')) continue;
    const typeMatch = line.match(typeRx);
    if (typeMatch) {
      headings.push({ line: i, title: typeMatch[2] });
      continue;
    }
    const funcMatch = line.match(funcRx);
    if (funcMatch && !skipNames.has(funcMatch[1])) {
      headings.push({ line: i, title: funcMatch[1] });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'dart', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'dart',
    kind: 'Section',
    meta: { format: 'dart' }
  }];
}

function chunkScala(text) {
  const lines = text.split('\n');
  const headings = [];
  const typeRx = /^\s*(?:case\s+class|class|object|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const defRx = /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)/;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.trim().startsWith('//')) continue;
    const typeMatch = line.match(typeRx);
    if (typeMatch) {
      headings.push({ line: i, title: typeMatch[1] });
      continue;
    }
    const defMatch = line.match(defRx);
    if (defMatch) headings.push({ line: i, title: defMatch[1] });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'scala', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'scala',
    kind: 'Section',
    meta: { format: 'scala' }
  }];
}

function chunkGroovy(text) {
  const lines = text.split('\n');
  const headings = [];
  const typeRx = /^\s*(class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const defRx = /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)/;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.trim().startsWith('//')) continue;
    const typeMatch = line.match(typeRx);
    if (typeMatch) {
      headings.push({ line: i, title: typeMatch[2] });
      continue;
    }
    const defMatch = line.match(defRx);
    if (defMatch) headings.push({ line: i, title: defMatch[1] });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'groovy', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'groovy',
    kind: 'Section',
    meta: { format: 'groovy' }
  }];
}

function chunkR(text) {
  return chunkByLineRegex(text, /^\s*([A-Za-z.][A-Za-z0-9_.]*)\s*(?:<-|=)\s*function\b/, {
    format: 'r',
    kind: 'Section',
    defaultName: 'r'
  });
}

function chunkJulia(text) {
  const lines = text.split('\n');
  const headings = [];
  const rx = /^\s*(module|function|macro)\s+([A-Za-z_][A-Za-z0-9_!.]*)/;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.trim().startsWith('#')) continue;
    const match = line.match(rx);
    if (match) {
      headings.push({ line: i, title: match[2] });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'julia', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'julia',
    kind: 'Section',
    meta: { format: 'julia' }
  }];
}

function chunkHandlebars(text) {
  return chunkByLineRegex(text, /{{[#^]\s*([A-Za-z0-9_.-]+)\b/, {
    format: 'handlebars',
    kind: 'Section',
    defaultName: 'handlebars'
  });
}

function chunkMustache(text) {
  return chunkByLineRegex(text, /{{[#^]\s*([A-Za-z0-9_.-]+)\b/, {
    format: 'mustache',
    kind: 'Section',
    defaultName: 'mustache'
  });
}

function chunkJinja(text) {
  return chunkByLineRegex(text, /{%\s*(block|macro|for|if|set|include|extends)\s+([^%]+)%}/, {
    format: 'jinja',
    kind: 'Section',
    defaultName: 'jinja',
    title: (match) => {
      const name = String(match[2] || '').trim().split(/\s+/)[0];
      return name ? `${match[1]} ${name}` : match[1];
    }
  });
}

function chunkRazor(text) {
  const lines = text.split('\n');
  const headings = [];
  const rx = /^\s*@\s*(page|model|inherits|functions|code|section)\b\s*([A-Za-z_][A-Za-z0-9_]*)?/i;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    const match = line.match(rx);
    if (!match) continue;
    const name = match[2] ? `${match[1]} ${match[2]}` : match[1];
    headings.push({ line: i, title: name });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'razor', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'razor',
    kind: 'Section',
    meta: { format: 'razor' }
  }];
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
  const textBytes = Buffer.byteLength(text, 'utf8');
  if (mode === 'top-level' && textBytes > maxBytes) return 'root';
  if (mode === 'auto') {
    return textBytes <= maxBytes ? 'top-level' : 'root';
  }
  return mode;
}

export function chunkYaml(text, relPath, context) {
  const isWorkflow = relPath ? relPath.replace(/\\\\/g, '/').includes('.github/workflows/') : false;
  if (isWorkflow) return chunkGitHubActions(text);
  if (context?.treeSitter?.configChunking === true) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: 'yaml',
      ext: '.yaml',
      options: getTreeSitterOptions(context)
    });
    if (treeChunks && treeChunks.length) return treeChunks;
  }
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
  { id: 'javascript', match: (ext) => isJsLike(ext), chunk: ({ text, ext, context }) => {
    if (context?.jsChunks) return context.jsChunks;
    return buildJsChunks(text, {
      ext,
      ast: context?.jsAst,
      javascript: context?.javascript,
      flowMode: context?.javascript?.flow,
      treeSitter: context?.treeSitter,
      log: context?.log
    });
  } },
  { id: 'typescript', match: (ext) => isTypeScript(ext), chunk: ({ text, ext, relPath, context }) => {
    if (context?.tsChunks) return context.tsChunks;
    const parser = context?.typescript?.importsOnly ? 'heuristic' : context?.typescript?.parser;
    return buildTypeScriptChunks(text, {
      ext,
      relPath,
      parser,
      treeSitter: context?.treeSitter,
      log: context?.log
    });
  } },
  { id: 'html', match: (ext) => isHtml(ext), chunk: ({ text, context }) =>
    context?.htmlChunks || buildHtmlChunks(text, getTreeSitterOptions(context)) },
  { id: 'css', match: (ext) => isCss(ext), chunk: ({ text, context }) =>
    context?.cssChunks || buildCssChunks(text) },
  { id: 'python', match: (ext) => ext === '.py', chunk: ({ text, context }) => {
    const astChunks = buildPythonChunksFromAst(text, context?.pythonAst || null);
    if (astChunks && astChunks.length) return astChunks;
    if (context?.pythonTreeChunks && context.pythonTreeChunks.length) {
      return context.pythonTreeChunks;
    }
    return buildPythonHeuristicChunks(text);
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
  { id: 'sql', match: (ext) => isSql(ext), chunk: ({ text, context }) => context?.sqlChunks || buildSqlChunks(text) },
  { id: 'cmake', match: (ext) => CMAKE_EXTS.has(ext), chunk: ({ text }) => chunkCmake(text) },
  { id: 'starlark', match: (ext) => STARLARK_EXTS.has(ext), chunk: ({ text }) => chunkStarlark(text) },
  { id: 'nix', match: (ext) => NIX_EXTS.has(ext), chunk: ({ text }) => chunkNix(text) },
  { id: 'dart', match: (ext) => DART_EXTS.has(ext), chunk: ({ text }) => chunkDart(text) },
  { id: 'scala', match: (ext) => SCALA_EXTS.has(ext), chunk: ({ text }) => chunkScala(text) },
  { id: 'groovy', match: (ext) => GROOVY_EXTS.has(ext), chunk: ({ text }) => chunkGroovy(text) },
  { id: 'r', match: (ext) => R_EXTS.has(ext), chunk: ({ text }) => chunkR(text) },
  { id: 'julia', match: (ext) => JULIA_EXTS.has(ext), chunk: ({ text }) => chunkJulia(text) },
  { id: 'handlebars', match: (ext) => HANDLEBARS_EXTS.has(ext), chunk: ({ text }) => chunkHandlebars(text) },
  { id: 'mustache', match: (ext) => MUSTACHE_EXTS.has(ext), chunk: ({ text }) => chunkMustache(text) },
  { id: 'jinja', match: (ext) => JINJA_EXTS.has(ext), chunk: ({ text }) => chunkJinja(text) },
  { id: 'razor', match: (ext) => RAZOR_EXTS.has(ext), chunk: ({ text }) => chunkRazor(text) }
];

const CODE_FORMAT_CHUNKERS = [
  { id: 'json', match: (ext) => ext === '.json', chunk: ({ text, context }) => chunkJson(text, context) },
  {
    id: 'ini',
    match: (ext) => ['.toml', '.ini', '.cfg', '.conf'].includes(ext),
    chunk: ({ text, ext, context }) => chunkIniToml(text, ext === '.toml' ? 'toml' : 'ini', context)
  },
  { id: 'xml', match: (ext) => ext === '.xml', chunk: ({ text }) => chunkXml(text) },
  { id: 'dockerfile', match: (ext) => ext === '.dockerfile', chunk: ({ text }) => chunkDockerfile(text) },
  { id: 'makefile', match: (ext) => ext === '.makefile', chunk: ({ text }) => chunkMakefile(text) },
  { id: 'protobuf', match: (ext) => ext === '.proto', chunk: ({ text }) => chunkProto(text) },
  { id: 'graphql', match: (ext) => ext === '.graphql' || ext === '.gql', chunk: ({ text }) => chunkGraphql(text) },
  { id: 'yaml', match: (ext) => ext === '.yaml' || ext === '.yml', chunk: ({ text, relPath, context }) => chunkYaml(text, relPath, context) }
];

const PROSE_CHUNKERS = [
  { id: 'markdown', match: (ext) => ext === '.md' || ext === '.mdx', chunk: ({ text, ext, context }) => chunkMarkdown(text, ext, context) },
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

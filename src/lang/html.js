import { parse as parseHtml } from 'parse5';
import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { buildTreeSitterChunks } from './tree-sitter.js';
import { buildJsChunks } from './javascript.js';
import { buildTypeScriptChunks } from './typescript.js';
import { buildPythonHeuristicChunks } from './python.js';
import { buildGoChunks } from './go.js';
import { buildRustChunks } from './rust.js';
import { buildJavaChunks } from './java.js';
import { buildCLikeChunks } from './clike.js';
import { buildCSharpChunks } from './csharp.js';
import { buildKotlinChunks } from './kotlin.js';
import { buildRubyChunks } from './ruby.js';
import { buildPhpChunks } from './php.js';
import { buildLuaChunks } from './lua.js';
import { buildSqlChunks } from './sql.js';
import { buildShellChunks } from './shell.js';
import { buildCssChunks } from './css.js';
import { chunkIniToml, chunkJson, chunkMarkdown, chunkXml, chunkYaml } from '../index/chunking.js';

const IMPORTANT_TAGS = new Set([
  'html',
  'head',
  'body',
  'main',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'aside',
  'form',
  'template',
  'script',
  'style'
]);

const LANGUAGE_ALIASES = new Map([
  ['js', 'javascript'],
  ['javascript', 'javascript'],
  ['ecmascript', 'javascript'],
  ['mjs', 'javascript'],
  ['module', 'javascript'],
  ['ts', 'typescript'],
  ['typescript', 'typescript'],
  ['tsx', 'typescript'],
  ['jsx', 'javascript'],
  ['c', 'c'],
  ['c++', 'cpp'],
  ['cpp', 'cpp'],
  ['cxx', 'cpp'],
  ['objc', 'objc'],
  ['objective-c', 'objc'],
  ['c#', 'csharp'],
  ['csharp', 'csharp'],
  ['cs', 'csharp'],
  ['golang', 'go'],
  ['go', 'go'],
  ['java', 'java'],
  ['rust', 'rust'],
  ['rb', 'ruby'],
  ['ruby', 'ruby'],
  ['php', 'php'],
  ['lua', 'lua'],
  ['sql', 'sql'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['sass', 'sass'],
  ['less', 'less'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['xml', 'xml'],
  ['json', 'json'],
  ['toml', 'toml'],
  ['ini', 'ini'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['html', 'html'],
  ['bash', 'shell'],
  ['sh', 'shell'],
  ['shell', 'shell'],
  ['zsh', 'shell'],
  ['python', 'python'],
  ['py', 'python']
]);

const SCRIPT_TYPE_ALIASES = new Map([
  ['text/javascript', 'javascript'],
  ['application/javascript', 'javascript'],
  ['text/ecmascript', 'javascript'],
  ['application/ecmascript', 'javascript'],
  ['text/typescript', 'typescript'],
  ['application/typescript', 'typescript'],
  ['text/css', 'css'],
  ['text/yaml', 'yaml'],
  ['application/yaml', 'yaml'],
  ['text/xml', 'xml'],
  ['application/xml', 'xml'],
  ['application/json', 'json'],
  ['application/ld+json', 'json'],
  ['application/schema+json', 'json'],
  ['text/json', 'json'],
  ['text/markdown', 'markdown'],
  ['text/toml', 'toml'],
  ['application/toml', 'toml'],
  ['text/plain', 'text'],
  ['module', 'javascript']
]);

function extractTagSignature(text, start, end) {
  const limit = Math.min(end, start + 400);
  const slice = text.slice(start, limit);
  const close = slice.indexOf('>');
  if (close < 0) return slice.trim();
  return slice.slice(0, close + 1).replace(/\s+/g, ' ').trim();
}

function walkHtml(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  const children = node.childNodes || node.content?.childNodes || [];
  if (!Array.isArray(children)) return;
  for (const child of children) walkHtml(child, visitor);
}

function extractHtmlMetadata(text) {
  let document = null;
  try {
    document = parseHtml(text, { sourceCodeLocationInfo: true });
  } catch {
    return { imports: [], title: null, description: null, keywords: [], scripts: [], links: [] };
  }
  const imports = new Set();
  const scripts = [];
  const links = [];
  let title = null;
  let description = null;
  const keywords = new Set();
  walkHtml(document, (node) => {
    if (!node || typeof node.nodeName !== 'string') return;
    const tag = node.nodeName.toLowerCase();
    if (tag === 'title' && Array.isArray(node.childNodes)) {
      const textNode = node.childNodes.find((child) => child.nodeName === '#text');
      if (textNode?.value) title = textNode.value.trim();
    }
    if (!Array.isArray(node.attrs)) return;
    const attrs = Object.fromEntries(node.attrs.map((attr) => [attr.name.toLowerCase(), attr.value]));
    if (tag === 'meta') {
      const name = attrs.name || attrs.property || '';
      const content = attrs.content || '';
      if (name === 'description' && content) description = content;
      if (name === 'keywords' && content) {
        content.split(',').map((entry) => entry.trim()).filter(Boolean).forEach((entry) => keywords.add(entry));
      }
    }
    if (tag === 'script') {
      const src = attrs.src || '';
      if (src) {
        imports.add(src);
        scripts.push(src);
      }
    }
    if (tag === 'link') {
      const href = attrs.href || '';
      if (href) {
        imports.add(href);
        links.push(href);
      }
    }
  });
  return {
    imports: Array.from(imports),
    title,
    description,
    keywords: Array.from(keywords),
    scripts,
    links
  };
}

export function getHtmlMetadata(text) {
  return extractHtmlMetadata(text);
}

export function collectHtmlImports(text) {
  return extractHtmlMetadata(text).imports;
}

function normalizeLang(raw) {
  if (!raw) return null;
  const normalized = String(raw).trim().toLowerCase();
  return LANGUAGE_ALIASES.get(normalized) || normalized;
}

function extractLangFromAttrs(attrs) {
  if (!attrs) return null;
  const type = attrs.type && SCRIPT_TYPE_ALIASES.get(String(attrs.type).trim().toLowerCase());
  if (type) return type;
  const direct = normalizeLang(attrs.lang || attrs['data-lang']);
  if (direct) return direct;
  const classes = String(attrs.class || '')
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const cls of classes) {
    if (cls.startsWith('language-')) return normalizeLang(cls.slice('language-'.length));
    if (cls.startsWith('lang-')) return normalizeLang(cls.slice('lang-'.length));
  }
  return null;
}

const EMBEDDED_CHUNKERS = new Map([
  ['typescript', (text, options) => buildTypeScriptChunks(text, options)],
  ['javascript', (text, options) => buildJsChunks(text, options)],
  ['python', (text) => buildPythonHeuristicChunks(text)],
  ['go', (text, options) => buildGoChunks(text, options)],
  ['rust', (text, options) => buildRustChunks(text, options)],
  ['java', (text, options) => buildJavaChunks(text, options)],
  ['csharp', (text, options) => buildCSharpChunks(text, options)],
  ['kotlin', (text, options) => buildKotlinChunks(text, options)],
  ['ruby', (text) => buildRubyChunks(text)],
  ['php', (text) => buildPhpChunks(text)],
  ['lua', (text) => buildLuaChunks(text)],
  ['sql', (text) => buildSqlChunks(text, { dialect: 'generic' })],
  ['json', (text) => chunkJson(text)],
  ['xml', (text) => chunkXml(text)],
  ['yaml', (text, options) => chunkYaml(text, null, { yamlChunking: options?.yamlChunking })],
  ['toml', (text) => chunkIniToml(text, 'toml')],
  ['ini', (text) => chunkIniToml(text, 'ini')],
  ['markdown', (text) => chunkMarkdown(text)],
  ['css', (text, options) => buildCssChunks(text, options) || null],
  ['scss', (text, options) => buildCssChunks(text, options) || null],
  ['sass', (text, options) => buildCssChunks(text, options) || null],
  ['less', (text, options) => buildCssChunks(text, options) || null],
  ['shell', (text) => buildShellChunks(text)],
  ['c', (text, options) => buildCLikeChunks(text, '.c', options)],
  ['cpp', (text, options) => buildCLikeChunks(text, '.cpp', options)],
  ['objc', (text, options) => buildCLikeChunks(text, '.m', options)]
]);

function resolveEmbeddedChunks(language, text, options) {
  if (!language) return null;
  const handler = EMBEDDED_CHUNKERS.get(language);
  if (!handler) return null;
  return handler(text, options);
}

function buildEmbeddedChunks(text, blocks, options = {}) {
  const chunks = [];
  for (const block of blocks) {
    if (!block || block.start == null || block.end == null || block.end <= block.start) continue;
    const slice = text.slice(block.start, block.end);
    const embedded = resolveEmbeddedChunks(block.language, slice, options);
    if (Array.isArray(embedded) && embedded.length) {
      for (const chunk of embedded) {
        if (!chunk) continue;
        chunks.push({
          ...chunk,
          start: chunk.start + block.start,
          end: chunk.end + block.start,
          meta: { ...chunk.meta, embeddedLanguage: block.language, embeddedTag: block.tag }
        });
      }
      continue;
    }
    chunks.push({
      start: block.start,
      end: block.end,
      name: block.name,
      kind: block.kind,
      meta: {
        embeddedLanguage: block.language,
        embeddedTag: block.tag
      }
    });
  }
  return chunks;
}

export function buildHtmlChunks(text, options = {}) {
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'html', options });
  const filteredTree = Array.isArray(treeChunks)
    ? treeChunks.filter((chunk) => IMPORTANT_TAGS.has(String(chunk.name || '').toLowerCase()))
    : null;
  let document = null;
  try {
    document = parseHtml(text, { sourceCodeLocationInfo: true });
  } catch {
    return null;
  }
  const lineIndex = buildLineIndex(text);
  const chunks = [];
  const embeddedBlocks = [];
  walkHtml(document, (node) => {
    if (!node || typeof node.nodeName !== 'string') return;
    const tag = node.nodeName.toLowerCase();
    if (tag.startsWith('#')) return;
    const loc = node.sourceCodeLocation;
    const start = loc?.startOffset;
    const end = loc?.endOffset;
    const hasRange = Number.isFinite(start) && Number.isFinite(end) && end > start;
    if (IMPORTANT_TAGS.has(tag) && hasRange) {
      const startLine = offsetToLine(lineIndex, start);
      const endLine = offsetToLine(lineIndex, Math.max(start, end - 1));
      chunks.push({
        start,
        end,
        name: tag,
        kind: 'ElementDeclaration',
        meta: {
          tag,
          startLine,
          endLine,
          signature: extractTagSignature(text, start, end)
        }
      });
    }
    if (!hasRange) return;
    if (tag === 'script' || tag === 'style') {
      const innerStart = loc?.startTag?.endOffset;
      const innerEnd = loc?.endTag?.startOffset;
      if (Number.isFinite(innerStart) && Number.isFinite(innerEnd) && innerEnd > innerStart) {
        const attrs = Array.isArray(node.attrs)
          ? Object.fromEntries(node.attrs.map((attr) => [attr.name.toLowerCase(), attr.value]))
          : {};
        const language = tag === 'style' ? 'css' : (extractLangFromAttrs(attrs) || 'javascript');
        embeddedBlocks.push({
          start: innerStart,
          end: innerEnd,
          language,
          tag,
          kind: tag === 'style' ? 'StyleBlock' : 'ScriptBlock',
          name: tag
        });
      }
    }
    if (tag === 'code' || tag === 'pre') {
      const innerStart = loc?.startTag?.endOffset;
      const innerEnd = loc?.endTag?.startOffset;
      if (Number.isFinite(innerStart) && Number.isFinite(innerEnd) && innerEnd > innerStart) {
        const attrs = Array.isArray(node.attrs)
          ? Object.fromEntries(node.attrs.map((attr) => [attr.name.toLowerCase(), attr.value]))
          : {};
        const language = extractLangFromAttrs(attrs);
        embeddedBlocks.push({
          start: innerStart,
          end: innerEnd,
          language: language || 'text',
          tag,
          kind: 'CodeBlock',
          name: language ? `code:${language}` : 'code'
        });
      }
    }
  });
  const embeddedChunks = buildEmbeddedChunks(text, embeddedBlocks, options);
  const baseChunks = filteredTree && filteredTree.length ? filteredTree : chunks;
  const merged = baseChunks.concat(embeddedChunks);
  if (!merged.length) return null;
  merged.sort((a, b) => a.start - b.start);
  return merged;
}

export function buildHtmlRelations(text, htmlChunks, htmlMeta) {
  const imports = Array.isArray(htmlMeta?.imports) ? htmlMeta.imports : [];
  return { imports, exports: [], calls: [], usages: [], importLinks: [], functionMeta: {}, classMeta: {} };
}

export function extractHtmlDocMeta(chunk, htmlMeta) {
  const meta = chunk?.meta || {};
  const summary = htmlMeta && typeof htmlMeta === 'object' ? htmlMeta : {};
  return {
    tag: meta.tag || chunk?.name || 'element',
    signature: meta.signature || null,
    embeddedLanguage: meta.embeddedLanguage || null,
    embeddedTag: meta.embeddedTag || null,
    title: summary.title || null,
    description: summary.description || null,
    keywords: Array.isArray(summary.keywords) ? summary.keywords : [],
    scripts: Array.isArray(summary.scripts) ? summary.scripts : [],
    links: Array.isArray(summary.links) ? summary.links : []
  };
}

export function computeHtmlFlow() {
  return null;
}

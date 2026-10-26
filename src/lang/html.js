import { prepareHtmlDocument, releaseHtmlDocument, getHtmlPreparationDiagnostics, withHtmlDocument, htmlPreparationProfileKey } from './html-prepared-document.js';
import { throwIfAborted } from '../shared/abort.js';
import { installedPackageVersion } from '../shared/installed-package-version.js';
import { attachImportExtraction, createImportExtraction, getImportExtraction, toParsedLiteralImportEntries } from '../shared/import-extraction.js';
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

export const HTML_RESERVED_WORDS = new Set([
  'a',
  'abbr',
  'address',
  'area',
  'article',
  'aside',
  'audio',
  'b',
  'base',
  'bdi',
  'bdo',
  'blockquote',
  'body',
  'br',
  'button',
  'canvas',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'data',
  'datalist',
  'dd',
  'del',
  'details',
  'dfn',
  'dialog',
  'div',
  'dl',
  'doctype',
  'dt',
  'em',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'i',
  'iframe',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'link',
  'main',
  'map',
  'mark',
  'math',
  'menu',
  'meta',
  'meter',
  'nav',
  'noscript',
  'object',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'param',
  'picture',
  'portal',
  'pre',
  'progress',
  'q',
  'rb',
  'rp',
  'rt',
  'rtc',
  'ruby',
  's',
  'samp',
  'script',
  'section',
  'select',
  'slot',
  'small',
  'source',
  'span',
  'strong',
  'style',
  'sub',
  'summary',
  'sup',
  'svg',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'title',
  'tr',
  'track',
  'u',
  'ul',
  'var',
  'video',
  'wbr'
]);

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

const HTML_IMPORT_TAG_HINT = /<(?:script|link)\b/i;
const HTML_IMPORT_ATTR_HINT = /\b(?:src|href)\s*=/i;

function extractTagSignature(text, start, end) {
  const limit = Math.min(end, start + 400);
  const slice = text.slice(start, limit);
  const close = slice.indexOf('>');
  if (close < 0) return slice.trim();
  return slice.slice(0, close + 1).replace(/\s+/g, ' ').trim();
}

function walkHtml(node, visitor, recordVisit = null) {
  if (!node || typeof node !== 'object') return;
  if (recordVisit) recordVisit();
  visitor(node);
  const children = node.tagName === 'template' && node.content
    ? node.content.childNodes : node.childNodes;
  if (!Array.isArray(children)) return;
  for (const child of children) walkHtml(child, visitor, recordVisit);
}

function addKeywordEntries(content, keywords) {
  let start = 0;
  for (let i = 0; i <= content.length; i += 1) {
    if (i === content.length || content[i] === ',') {
      const entry = content.slice(start, i).trim();
      if (entry) keywords.add(entry);
      start = i + 1;
    }
  }
}

function extractHtmlMetadata(text, options = {}, prepared = null) {
  return withHtmlDocument(text, options, prepared, ({ document, status, recordVisit }) => {
    const qualifyImports = (imports, occurrences, reason = null) => {
      Object.defineProperty(imports, 'occurrences', { value: occurrences });
      return attachImportExtraction(imports, createImportExtraction({ entries: imports, text: typeof text === 'string' ? text : null,
        producerId: 'html-parsed-attributes', parser: { id: 'parse5', version: installedPackageVersion('parse5'), available: true },
        parserCoverage: reason ? 'unavailable' : 'complete', parserReason: reason,
        scope: 'parse5-recovered-dom-script-src-link-href', observedEntries: occurrences.length }));
    };
    if (status !== 'parsed') {
      return { imports: qualifyImports([], [], 'parse-failed'), title: null, description: null, keywords: [], scripts: [], links: [] };
    }
    const imports = new Set();
    const occurrences = [];
    const scripts = [];
    const links = [];
    let title = null;
    let description = null;
    const keywords = new Set();
    const recordImport = (node, attribute, specifier) => {
      imports.add(specifier);
      const location = node.sourceCodeLocation?.attrs?.[attribute];
      occurrences.push({ specifier, attribute, rawAttribute: location ? text.slice(location.startOffset, location.endOffset) : null,
        source: location ? { start: location.startOffset, end: location.endOffset, encoding: 'utf16le-js-string' } : null });
    };
    walkHtml(document, (node) => {
      if (!node || typeof node.nodeName !== 'string') return;
      const tag = node.nodeName.toLowerCase();
      if (tag === 'title' && Array.isArray(node.childNodes)) {
        const textNode = node.childNodes.find((child) => child.nodeName === '#text');
        if (textNode?.value) title = textNode.value.trim();
      }
      if (!Array.isArray(node.attrs)) return;
      let attrName = '';
      let attrProperty = '';
      let attrContent = '';
      let attrSrc = '';
      let attrHref = '';
      for (const attr of node.attrs) {
        const key = String(attr?.name || '').toLowerCase();
        if (!key) continue;
        const value = attr?.value || '';
        if (key === 'name') attrName = value;
        else if (key === 'property') attrProperty = value;
        else if (key === 'content') attrContent = value;
        else if (key === 'src') attrSrc = value;
        else if (key === 'href') attrHref = value;
      }
      if (tag === 'meta') {
        const name = attrName || attrProperty || '';
        const content = attrContent || '';
        if (name === 'description' && content) description = content;
        if (name === 'keywords' && content) {
          addKeywordEntries(content, keywords);
        }
      }
      if (tag === 'script') {
        const src = attrSrc || '';
        if (src) {
          recordImport(node, 'src', src);
          scripts.push(src);
        }
      }
      if (tag === 'link') {
        const href = attrHref || '';
        if (href) {
          recordImport(node, 'href', href);
          links.push(href);
        }
      }
    }, () => recordVisit('metadata'));
    return {
      imports: qualifyImports(Array.from(imports), occurrences),
      title,
      description,
      keywords: Array.from(keywords),
      scripts,
      links
    };
  });
}

const preparedContexts = new WeakMap();
const cloneHtmlMetadata = metadata => {
  const imports = [...metadata.imports], receipt = getImportExtraction(metadata.imports);
  Object.defineProperty(imports, 'occurrences', { value: (metadata.imports.occurrences || []).map(value => ({
    ...value, source: value.source ? { ...value.source } : null
  })) });
  if (receipt) attachImportExtraction(imports, receipt);
  return { ...metadata, imports, keywords: [...metadata.keywords], scripts: [...metadata.scripts], links: [...metadata.links] };
};
const readPreparedMetadata = (text, options) => {
  const entry = preparedContexts.get(options?.context);
  return entry && entry.text === text && entry.profile === htmlPreparationProfileKey(options)
    ? cloneHtmlMetadata(entry.metadata) : null;
};

export function getHtmlMetadata(text, options = {}, prepared = null) {
  throwIfAborted(options?.signal || options?.abortSignal);
  return readPreparedMetadata(text, options) || extractHtmlMetadata(text, options, prepared);
}

function collectHtmlImportsFast(text, options) {
  const prepared = readPreparedMetadata(text, options);
  if (prepared) return prepared.imports;
  if (!text || !HTML_IMPORT_TAG_HINT.test(text) || !HTML_IMPORT_ATTR_HINT.test(text)) return [];
  return extractHtmlMetadata(text, options).imports;
}

export function collectHtmlImports(text, options = {}) {
  throwIfAborted(options?.signal || options?.abortSignal);
  return collectHtmlImportsFast(text, options);
}

export const collectHtmlImportEntries = (text, options) => toParsedLiteralImportEntries(collectHtmlImports(text, options));

export const releaseHtmlPreparedContext = context => preparedContexts.delete(context);

export const prepareHtmlChunkContext = (text, options = {}) => {
  const prepared = prepareHtmlDocument(text, { forceParseError: options?.html?.forceParseError === true,
    signal: options?.signal || options?.abortSignal });
  let context;
  try {
    const htmlChunks = buildHtmlChunks(text, options, prepared), metadata = extractHtmlMetadata(text, options, prepared);
    throwIfAborted(options?.signal || options?.abortSignal);
    context = { htmlChunks, htmlMeta: cloneHtmlMetadata(metadata) };
    // Only compact facts survive tree projection; the weak context lifetime is
    // the owning file attempt. Returned arrays cannot mutate private reuse facts.
    preparedContexts.set(context, { text, profile: htmlPreparationProfileKey(options), metadata });
  } finally { releaseHtmlDocument(prepared); }
  context.htmlPreparation = getHtmlPreparationDiagnostics(prepared);
  return context;
};

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

function collectLangAttrs(attrs) {
  const result = {};
  if (!Array.isArray(attrs)) return result;
  for (const attr of attrs) {
    const key = String(attr?.name || '').toLowerCase();
    if (!key) continue;
    if (key === 'type' || key === 'lang' || key === 'data-lang' || key === 'class') {
      result[key] = attr?.value || '';
    }
  }
  return result;
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
  ['sql', (text, options) => buildSqlChunks(text, { ...(options || {}), dialect: 'generic' })],
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
  const lines = buildLineIndex(text);
  for (const block of blocks) {
    if (!block || block.start == null || block.end == null || block.end <= block.start) continue;
    const slice = text.slice(block.start, block.end);
    const embedded = resolveEmbeddedChunks(block.language, slice, options);
    if (Array.isArray(embedded) && embedded.length) {
      for (const chunk of embedded) {
        if (!chunk) continue;
        const start = chunk.start + block.start, end = chunk.end + block.start;
        chunks.push({
          ...chunk,
          start,
          end,
          meta: { ...chunk.meta, startLine: offsetToLine(lines, start),
            endLine: offsetToLine(lines, end > start ? end - 1 : start),
            embeddedLanguage: block.language, embeddedTag: block.tag }
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

export function buildHtmlChunks(text, options = {}, prepared = null) {
  throwIfAborted(options?.signal || options?.abortSignal);
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'html', options });
  const filteredTree = Array.isArray(treeChunks)
    ? treeChunks.filter((chunk) => IMPORTANT_TAGS.has(String(chunk.name || '').toLowerCase()))
    : null;
  return withHtmlDocument(text, options, prepared, ({ document, status, recordVisit }) => {
    if (status !== 'parsed') {
      if (filteredTree && filteredTree.length) return filteredTree;
      if (Array.isArray(treeChunks) && treeChunks.length) return treeChunks;
      if (!text) return null;
      return [{
        start: 0,
        end: text.length,
        name: 'html',
        kind: 'Document',
        meta: { fallback: 'parse5-error' }
      }];
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
          const attrs = collectLangAttrs(node.attrs);
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
          const attrs = collectLangAttrs(node.attrs);
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
    }, () => recordVisit('chunks'));
    const embeddedChunks = buildEmbeddedChunks(text, embeddedBlocks, options);
    const baseChunks = filteredTree && filteredTree.length ? filteredTree : chunks;
    const merged = baseChunks.concat(embeddedChunks);
    if (!merged.length) return null;
    merged.sort((a, b) => a.start - b.start);
    return merged;
  });
}

export function buildHtmlRelations(text, htmlChunks, htmlMeta) {
  const imports = Array.isArray(htmlMeta?.imports) ? htmlMeta.imports : [];
  return { imports, ...(getImportExtraction(imports) ? { importExtraction: getImportExtraction(imports) } : {}),
    exports: [], calls: [], usages: [], importLinks: [], functionMeta: {}, classMeta: {} };
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

import path from 'node:path';
import * as linguistLanguages from 'linguist-languages';
import { LANGUAGE_REGISTRY } from './registry-data.js';
import { LANGUAGE_ROUTE_DESCRIPTORS } from './descriptors.js';
const LANGUAGE_BY_ID = new Map(LANGUAGE_REGISTRY.map((lang) => [lang.id, lang]));
const normalizeLinguistName = (value) => String(value || '').trim().toLowerCase();
const LINGUIST_NAME_TO_ID = new Map([
  ['c', 'clike'],
  ['c++', 'clike'],
  ['objective-c', 'clike'],
  ['objective-c++', 'clike'],
  ['c#', 'csharp'],
  ['csharp', 'csharp'],
  ['go', 'go'],
  ['java', 'java'],
  ['javascript', 'javascript'],
  ['typescript', 'typescript'],
  ['tsx', 'typescript'],
  ['python', 'python'],
  ['ruby', 'ruby'],
  ['php', 'php'],
  ['html', 'html'],
  ['css', 'css'],
  ['lua', 'lua'],
  ['sql', 'sql'],
  ['shell', 'shell'],
  ['bash', 'shell'],
  ['zsh', 'shell'],
  ['makefile', 'makefile'],
  ['dockerfile', 'dockerfile'],
  ['cmake', 'cmake'],
  ['starlark', 'starlark'],
  ['bazel', 'starlark'],
  ['nix', 'nix'],
  ['dart', 'dart'],
  ['scala', 'scala'],
  ['groovy', 'groovy'],
  ['r', 'r'],
  ['julia', 'julia'],
  ['handlebars', 'handlebars'],
  ['mustache', 'mustache'],
  ['jinja', 'jinja'],
  ['jinja2', 'jinja'],
  ['django', 'jinja'],
  ['razor', 'razor'],
  ['protobuf', 'proto'],
  ['protocol buffer', 'proto'],
  ['protocol buffers', 'proto'],
  ['proto', 'proto'],
  ['graphql', 'graphql'],
  ['kotlin', 'kotlin'],
  ['swift', 'swift'],
  ['rust', 'rust'],
  ['perl', 'perl']
]);

const resolveLinguistId = (name, entry) => {
  const candidates = [name, ...(entry?.aliases || [])];
  for (const candidate of candidates) {
    const normalized = normalizeLinguistName(candidate);
    if (LINGUIST_NAME_TO_ID.has(normalized)) return LINGUIST_NAME_TO_ID.get(normalized);
  }
  return null;
};

const LINGUIST_EXTENSION_MAP = new Map();
const LINGUIST_FILENAME_MAP = new Map();
const DESCRIPTOR_EXTENSION_MAP = new Map();
const DESCRIPTOR_FILENAME_MAP = new Map();
const DESCRIPTOR_PREFIX_MAP = [];

for (const descriptor of LANGUAGE_ROUTE_DESCRIPTORS) {
  const languageId = descriptor?.id;
  if (!languageId || !LANGUAGE_BY_ID.has(languageId)) continue;
  for (const ext of descriptor?.extensions || []) {
    const key = String(ext || '').toLowerCase();
    if (key && !DESCRIPTOR_EXTENSION_MAP.has(key)) {
      DESCRIPTOR_EXTENSION_MAP.set(key, languageId);
    }
  }
  for (const filename of descriptor?.specialFilenames || []) {
    const key = String(filename || '').toLowerCase();
    if (key && !DESCRIPTOR_FILENAME_MAP.has(key)) {
      DESCRIPTOR_FILENAME_MAP.set(key, languageId);
    }
  }
  for (const prefix of descriptor?.specialPrefixes || []) {
    const key = String(prefix || '').toLowerCase();
    if (key) {
      DESCRIPTOR_PREFIX_MAP.push({ prefix: key, languageId });
    }
  }
}

for (const [name, entry] of Object.entries(linguistLanguages || {})) {
  const languageId = resolveLinguistId(name, entry);
  if (!languageId || !LANGUAGE_BY_ID.has(languageId)) continue;
  for (const ext of entry?.extensions || []) {
    const key = String(ext || '').toLowerCase();
    if (key && !LINGUIST_EXTENSION_MAP.has(key)) {
      LINGUIST_EXTENSION_MAP.set(key, languageId);
    }
  }
  for (const filename of entry?.filenames || []) {
    const key = String(filename || '').toLowerCase();
    if (key && !LINGUIST_FILENAME_MAP.has(key)) {
      LINGUIST_FILENAME_MAP.set(key, languageId);
    }
  }
}

const resolveLinguistLanguage = (ext, relPath) => {
  const baseName = normalizeLinguistName(path.basename(relPath || ''));
  if (baseName && LINGUIST_FILENAME_MAP.has(baseName)) {
    return LANGUAGE_BY_ID.get(LINGUIST_FILENAME_MAP.get(baseName)) || null;
  }
  const extKey = normalizeLinguistName(ext);
  if (extKey && LINGUIST_EXTENSION_MAP.has(extKey)) {
    return LANGUAGE_BY_ID.get(LINGUIST_EXTENSION_MAP.get(extKey)) || null;
  }
  return null;
};

const resolveDescriptorLanguage = (ext, relPath) => {
  const baseName = normalizeLinguistName(path.basename(relPath || ''));
  if (baseName && DESCRIPTOR_FILENAME_MAP.has(baseName)) {
    return LANGUAGE_BY_ID.get(DESCRIPTOR_FILENAME_MAP.get(baseName)) || null;
  }
  const extKey = normalizeLinguistName(ext);
  if (extKey && DESCRIPTOR_EXTENSION_MAP.has(extKey)) {
    return LANGUAGE_BY_ID.get(DESCRIPTOR_EXTENSION_MAP.get(extKey)) || null;
  }
  if (baseName) {
    for (const entry of DESCRIPTOR_PREFIX_MAP) {
      if (!(baseName === entry.prefix || baseName.startsWith(`${entry.prefix}.`))) continue;
      return LANGUAGE_BY_ID.get(entry.languageId) || null;
    }
  }
  return null;
};

export function getLanguageForFile(ext, relPath) {
  const normalized = relPath || '';
  const descriptorMatch = resolveDescriptorLanguage(ext, normalized);
  if (descriptorMatch) return descriptorMatch;
  return resolveLinguistLanguage(ext, normalized);
}

export function collectLanguageImports(input = {}) {
  const {
    ext,
    relPath,
    text,
    mode,
    options,
    root,
    filePath,
    ...rest
  } = input;
  const lang = getLanguageForFile(ext, relPath);
  if (!lang || typeof lang.collectImports !== 'function') return [];
  const forwarded = {
    ...(options && typeof options === 'object' ? options : {}),
    ...rest
  };
  const merged = {
    ...forwarded,
    ext,
    relPath,
    mode
  };
  if (root) merged.root = root;
  if (filePath) merged.filePath = filePath;
  const imports = lang.collectImports(text, merged);
  return Array.isArray(imports) ? imports : [];
}

export async function buildLanguageContext({ ext, relPath, mode, text, options }) {
  const lang = getLanguageForFile(ext, relPath);
  const preparedOptions = options && typeof options === 'object'
    ? { ...options, relPath }
    : { relPath };
  // Prose/extracted-prose paths do not require language prepare passes and can
  // hit expensive parser work (for example large HTML docs) with no downstream use.
  const shouldPrepare = (mode === 'code' || preparedOptions?.forcePrepare === true)
    && preparedOptions?.skipPrepare !== true;
  const context = shouldPrepare && lang && typeof lang.prepare === 'function'
    ? await lang.prepare({ ext, relPath, mode, text, options: preparedOptions })
    : {};
  return { lang, context };
}

export function buildChunkRelations({ lang, chunk, fileRelations, callIndex = null, chunkIndex = null }) {
  if (!fileRelations) return {};
  const output = {};
  if (chunk?.name) {
    const callsForChunk = callIndex?.callsByCaller
      ? (callIndex.callsByCaller.get(chunk.name) || [])
      : (Array.isArray(fileRelations.calls)
        ? fileRelations.calls.filter(([caller]) => caller && caller === chunk.name)
        : []);
    if (callsForChunk.length) output.calls = callsForChunk;
    let detailsForChunk = [];
    if (callIndex?.callDetailsByChunkIndex && Number.isFinite(chunkIndex)) {
      detailsForChunk = callIndex.callDetailsByChunkIndex.get(chunkIndex) || [];
    } else if (callIndex?.callDetailsByCaller) {
      detailsForChunk = callIndex.callDetailsByCaller.get(chunk.name) || [];
    } else if (Array.isArray(fileRelations.callDetails)) {
      detailsForChunk = fileRelations.callDetails.filter((detail) => detail?.caller === chunk.name);
    }
    if (detailsForChunk.length) output.callDetails = detailsForChunk;
  }
  if (lang?.attachName && chunk?.name) output.name = chunk.name;
  return output;
}

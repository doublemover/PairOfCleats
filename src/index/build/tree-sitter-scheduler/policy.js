import { toPosix } from '../../../shared/files.js';
import { isDocsPath, isInfraConfigPath } from '../mode-routing.js';

const DOC_TREE_SITTER_SKIP_LANGUAGES = new Set([
  'yaml',
  'json',
  'toml',
  'markdown',
  'html',
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'css'
]);

const HEAVY_TREE_SITTER_PATH_PARTS = [
  '/3rdparty/',
  '/include/fmt/',
  '/include/spdlog/fmt/',
  '/include/nlohmann/',
  '/single_include/nlohmann/',
  '/modules/core/include/opencv2/core/hal/',
  '/modules/core/src/',
  '/modules/dnn/',
  '/modules/js/perf/',
  '/sources/cniollhttp/',
  '/sources/nio/',
  '/sources/niocore/',
  '/sources/nioposix/',
  '/tests/nio/',
  '/tests/abi/',
  '/test/api-digester/inputs/',
  '/test/remote-run/',
  '/test/stdlib/inputs/',
  '/test/gtest/',
  '/contrib/minizip/',
  '/utils/unicodedata/',
  '/utils/gen-unicode-data/',
  '/samples/',
  '/docs/mkdocs/'
];

const HEAVY_TREE_SITTER_LANGUAGES = new Set([
  'clike',
  'cpp',
  'objc',
  'swift',
  'cmake',
  'javascript',
  'typescript',
  'jsx',
  'tsx'
]);

export const isGeneratedTreeSitterPath = (relKey) => {
  if (!relKey) return false;
  const normalized = toPosix(String(relKey)).toLowerCase();
  const bounded = `/${normalized.replace(/^\/+|\/+$/g, '')}/`;
  if (bounded.includes('/.docset/contents/resources/documents/')) return true;
  if (bounded.includes('/docsets/') && bounded.includes('/contents/resources/documents/')) return true;
  if (bounded.includes('/docs/docset/contents/resources/documents/')) return true;
  return false;
};

export const shouldSkipTreeSitterPlanningForPath = ({ relKey, languageId }) => {
  if (!relKey) return false;
  const normalizedLanguageId = languageId || '';
  if (isGeneratedTreeSitterPath(relKey)) return true;
  if (isInfraConfigPath(relKey)) return true;
  if (isDocsPath(relKey) && DOC_TREE_SITTER_SKIP_LANGUAGES.has(normalizedLanguageId)) return true;
  if (!HEAVY_TREE_SITTER_LANGUAGES.has(normalizedLanguageId)) return false;
  const normalized = toPosix(String(relKey)).toLowerCase();
  const bounded = `/${normalized.replace(/^\/+|\/+$/g, '')}/`;
  for (const part of HEAVY_TREE_SITTER_PATH_PARTS) {
    if (bounded.includes(part)) return true;
  }
  return false;
};

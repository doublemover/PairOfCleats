import path from 'node:path';
import {
  isCLike,
  isGo,
  isJava,
  isJsLike,
  isPerl,
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
} from '../constants.js';
import { buildCLikeChunks, buildCLikeRelations, collectCLikeImports, computeCLikeFlow, extractCLikeDocMeta } from '../../lang/clike.js';
import { buildGoChunks, buildGoRelations, collectGoImports, computeGoFlow, extractGoDocMeta } from '../../lang/go.js';
import { buildJavaChunks, buildJavaRelations, collectJavaImports, computeJavaFlow, extractJavaDocMeta } from '../../lang/java.js';
import { buildCodeRelations, collectImports, extractDocMeta, parseJavaScriptAst } from '../../lang/javascript.js';
import { buildTypeScriptChunks, buildTypeScriptRelations, collectTypeScriptImports, computeTypeScriptFlow, extractTypeScriptDocMeta } from '../../lang/typescript.js';
import { buildCSharpChunks, buildCSharpRelations, collectCSharpImports, computeCSharpFlow, extractCSharpDocMeta } from '../../lang/csharp.js';
import * as kotlinLang from '../../lang/kotlin.js';
import { buildRubyChunks, buildRubyRelations, collectRubyImports, computeRubyFlow, extractRubyDocMeta } from '../../lang/ruby.js';
import { buildPhpChunks, buildPhpRelations, collectPhpImports, computePhpFlow, extractPhpDocMeta } from '../../lang/php.js';
import { buildHtmlChunks, buildHtmlRelations, collectHtmlImports, computeHtmlFlow, extractHtmlDocMeta, getHtmlMetadata } from '../../lang/html.js';
import { buildCssChunks, buildCssRelations, collectCssImports, computeCssFlow, extractCssDocMeta } from '../../lang/css.js';
import { buildLuaChunks, buildLuaRelations, collectLuaImports, computeLuaFlow, extractLuaDocMeta } from '../../lang/lua.js';
import { buildSqlChunks, buildSqlRelations, collectSqlImports, computeSqlFlow, extractSqlDocMeta } from '../../lang/sql.js';
import { buildPerlChunks, buildPerlRelations, collectPerlImports, computePerlFlow, extractPerlDocMeta } from '../../lang/perl.js';
import {
  getPythonAst,
  collectPythonImports,
  buildPythonRelations,
  extractPythonDocMeta,
  buildPythonChunksFromAst,
  buildPythonHeuristicChunks
} from '../../lang/python.js';
import { buildRustChunks, buildRustRelations, collectRustImports, computeRustFlow, extractRustDocMeta } from '../../lang/rust.js';
import { buildSwiftChunks, buildSwiftRelations, collectSwiftImports, computeSwiftFlow, extractSwiftDocMeta } from '../../lang/swift.js';
import { buildShellChunks, buildShellRelations, collectShellImports, computeShellFlow, extractShellDocMeta } from '../../lang/shell.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from '../../lang/flow.js';
import { buildTreeSitterChunksAsync } from '../../lang/tree-sitter.js';
import { buildControlFlowOnly, JS_CONTROL_FLOW, PY_CONTROL_FLOW } from './control-flow.js';
import { buildSimpleRelations } from './simple-relations.js';
import { collectCmakeImports } from './import-collectors/cmake.js';
import { collectDartImports } from './import-collectors/dart.js';
import { collectDockerfileImports } from './import-collectors/dockerfile.js';
import { collectGraphqlImports } from './import-collectors/graphql.js';
import { collectGroovyImports } from './import-collectors/groovy.js';
import { collectHandlebarsImports } from './import-collectors/handlebars.js';
import { collectIniImports } from './import-collectors/ini.js';
import { collectJsonImports } from './import-collectors/json.js';
import { collectJinjaImports } from './import-collectors/jinja.js';
import { collectJuliaImports } from './import-collectors/julia.js';
import { collectMakefileImports } from './import-collectors/makefile.js';
import { collectMustacheImports } from './import-collectors/mustache.js';
import { collectNixImports } from './import-collectors/nix.js';
import { collectProtoImports } from './import-collectors/proto.js';
import { collectRazorImports } from './import-collectors/razor.js';
import { collectRImports } from './import-collectors/r.js';
import { collectScalaImports } from './import-collectors/scala.js';
import { collectStarlarkImports } from './import-collectors/starlark.js';
import { collectTomlImports } from './import-collectors/toml.js';
import { collectYamlImports } from './import-collectors/yaml.js';

const {
  buildKotlinChunks,
  buildKotlinRelations,
  collectKotlinImports,
  computeKotlinFlow,
  extractKotlinDocMeta,
  getKotlinFileStats
} = kotlinLang;

const flowOptions = (options = {}) => ({
  dataflow: options.astDataflowEnabled,
  controlFlow: options.controlFlowEnabled
});

const normalizeRelPath = (relPath) => String(relPath || '').replace(/\\/g, '/');
const normalizeRelPathLower = (relPath) => normalizeRelPath(relPath).toLowerCase();
const countTextLines = (text) => {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
};
const PYTHON_AST_SKIP_HEAVY_DEFAULT_BYTES = 192 * 1024;
const PYTHON_AST_SKIP_HEAVY_DEFAULT_LINES = 3000;
const PYTHON_AST_SKIP_PATH_PARTS = ['pygments/lexers/'];
const PYTHON_AST_SKIP_PATH_SUFFIXES = ['_builtins.py', '/_mapping.py'];
const shouldSkipPythonAstForFile = ({ text, relPath, options }) => {
  if (options?.pythonAst?.allowHeavyFiles === true) {
    return { skip: false, reason: null };
  }
  const normalizedPath = normalizeRelPathLower(options?.filePath || relPath || '');
  for (const pathPart of PYTHON_AST_SKIP_PATH_PARTS) {
    if (!normalizedPath.includes(pathPart)) continue;
    for (const suffix of PYTHON_AST_SKIP_PATH_SUFFIXES) {
      if (normalizedPath.endsWith(suffix)) {
        return { skip: true, reason: 'generated-path' };
      }
    }
  }
  const maxBytesRaw = Number(options?.pythonAst?.skipHeavyBytes);
  const maxBytes = Number.isFinite(maxBytesRaw) && maxBytesRaw > 0
    ? Math.floor(maxBytesRaw)
    : PYTHON_AST_SKIP_HEAVY_DEFAULT_BYTES;
  const fileSizeRaw = Number(options?.fileSizeBytes);
  const fileSize = Number.isFinite(fileSizeRaw) && fileSizeRaw >= 0
    ? Math.floor(fileSizeRaw)
    : Buffer.byteLength(String(text || ''), 'utf8');
  if (maxBytes > 0 && fileSize > maxBytes) {
    return { skip: true, reason: 'max-bytes' };
  }
  const maxLinesRaw = Number(options?.pythonAst?.skipHeavyLines);
  const maxLines = Number.isFinite(maxLinesRaw) && maxLinesRaw > 0
    ? Math.floor(maxLinesRaw)
    : PYTHON_AST_SKIP_HEAVY_DEFAULT_LINES;
  const lineHintRaw = Number(options?.fileLineCountHint);
  const fileLines = Number.isFinite(lineHintRaw) && lineHintRaw >= 0
    ? Math.floor(lineHintRaw)
    : countTextLines(text);
  if (maxLines > 0 && fileLines > maxLines) {
    return { skip: true, reason: 'max-lines' };
  }
  return { skip: false, reason: null };
};

const getPathBasename = (relPath) => path.posix.basename(normalizeRelPath(relPath)).toLowerCase();

const MAKEFILE_BASENAMES = new Set(['makefile', 'gnumakefile', 'bsdmakefile']);
const INI_EXTS = new Set(['.ini', '.cfg', '.conf']);
const JSON_EXTS = new Set(['.json']);
const TOML_EXTS = new Set(['.toml']);
const XML_EXTS = new Set(['.xml']);
const YAML_EXTS = new Set(['.yaml', '.yml']);

const isMakefilePath = (relPath) => MAKEFILE_BASENAMES.has(getPathBasename(relPath));

const isDockerfilePath = (relPath) => getPathBasename(relPath).startsWith('dockerfile');

const isProtoConfigPath = (relPath) => {
  const name = getPathBasename(relPath);
  return name === 'buf.yaml' || name === 'buf.gen.yaml';
};

const IMPORT_COLLECTOR_CAPABILITY_PROFILE = Object.freeze({
  state: 'partial',
  diagnostics: Object.freeze([
    Object.freeze({
      code: 'USR-W-CAPABILITY-DOWNGRADED',
      reasonCode: 'USR-R-HEURISTIC-ONLY',
      detail: 'import-collector-adapter'
    })
  ])
});

const HEURISTIC_CALL_SKIP = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'throw',
  'new',
  'super',
  'this',
  'assert',
  'try',
  'class',
  'interface',
  'trait',
  'enum',
  'def',
  'object',
  'fun',
  'when',
  'library',
  'require',
  'using',
  'import'
]);

const HEURISTIC_CONTROL_FLOW_OPTIONS = Object.freeze({
  branchKeywords: ['if', 'else', 'switch', 'case', 'match', 'when', 'catch', 'try'],
  loopKeywords: ['for', 'while', 'do']
});

const DART_SYMBOL_PATTERNS = Object.freeze([
  /\b(?:class|mixin|enum|extension)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  /\b(?:void|Future(?:<[^>]+>)?|Stream(?:<[^>]+>)?|[A-Za-z_][A-Za-z0-9_<>\[\]?]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
  /\b(?:get|set)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g
]);

const GROOVY_SYMBOL_PATTERNS = Object.freeze([
  /\b(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bdef\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
  /\b(?:public|private|protected|static|final|synchronized|abstract|\s)+[A-Za-z_][A-Za-z0-9_<>\[\]?]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
]);

const SCALA_SYMBOL_PATTERNS = Object.freeze([
  /\b(?:class|object|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bdef\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]+\])?\s*\(/g
]);

const JULIA_SYMBOL_PATTERNS = Object.freeze([
  /\b(?:module|struct|mutable\s+struct|abstract\s+type)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  /\b(?:function|macro)\s+([A-Za-z_][A-Za-z0-9_!]*)\s*(?:\(|$)/g,
  /\b([A-Za-z_][A-Za-z0-9_!]*)\s*\([^)]*\)\s*=/g
]);

const R_SYMBOL_PATTERNS = Object.freeze([
  /\b([A-Za-z_][A-Za-z0-9_.]*)\s*(?:<-|=)\s*function\s*\(/g,
  /\bsetMethod\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_.]*)['"]/g
]);

const HANDLEBARS_SYMBOL_PATTERNS = Object.freeze([
  /\{\{#\*inline\s+["']([^"']+)["']/g
]);

const MUSTACHE_SYMBOL_PATTERNS = Object.freeze([
  /\{\{#\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g
]);

const JINJA_SYMBOL_PATTERNS = Object.freeze([
  /\{%\s*(?:block|macro)\s+([A-Za-z_][A-Za-z0-9_]*)/g
]);

const RAZOR_SYMBOL_PATTERNS = Object.freeze([
  /@section\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  /@helper\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
]);

const GRAPHQL_SYMBOL_PATTERNS = Object.freeze([
  /\b(?:type|interface|enum|union|input|scalar)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bfragment\s+([A-Za-z_][A-Za-z0-9_]*)\s+on\s+[A-Za-z_][A-Za-z0-9_]*/g
]);

const PROTO_SYMBOL_PATTERNS = Object.freeze([
  /\b(?:message|enum|service)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  /\brpc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
]);

const CMAKE_SYMBOL_PATTERNS = Object.freeze([
  /\b(?:function|macro)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g
]);

const STARLARK_SYMBOL_PATTERNS = Object.freeze([
  /\bdef\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
]);

const NIX_SYMBOL_PATTERNS = Object.freeze([
  /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=/gm
]);

const MAKEFILE_SYMBOL_PATTERNS = Object.freeze([
  /^([A-Za-z0-9_.-]+)\s*:/gm
]);

const DOCKERFILE_SYMBOL_PATTERNS = Object.freeze([
  /^\s*FROM\s+[^\n]+?\s+AS\s+([A-Za-z_][A-Za-z0-9_-]*)/gim
]);

const TEMPLATE_USAGE_SKIP = new Set([
  'if',
  'else',
  'elif',
  'for',
  'each',
  'with',
  'unless',
  'end',
  'endif',
  'endfor',
  'block',
  'endblock',
  'macro',
  'endmacro',
  'import',
  'include',
  'extends',
  'using',
  'section'
]);

const GRAPHQL_USAGE_SKIP = new Set([
  'query',
  'mutation',
  'subscription',
  'fragment',
  'on',
  'schema',
  'type',
  'interface',
  'enum',
  'union',
  'input',
  'scalar',
  'implements'
]);

const PROTO_USAGE_SKIP = new Set([
  'double',
  'float',
  'int32',
  'int64',
  'uint32',
  'uint64',
  'sint32',
  'sint64',
  'fixed32',
  'fixed64',
  'sfixed32',
  'sfixed64',
  'bool',
  'string',
  'bytes',
  'map',
  'oneof',
  'optional',
  'required',
  'repeated',
  'returns',
  'rpc'
]);

const BUILD_DSL_USAGE_SKIP = new Set([
  'if',
  'elseif',
  'else',
  'endif',
  'foreach',
  'endforeach',
  'while',
  'endwhile',
  'function',
  'endfunction',
  'macro',
  'endmacro'
]);

const sortUnique = (values) => Array.from(new Set(values.filter(Boolean))).sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));

const collectPatternNames = (text, patterns) => {
  const names = [];
  const source = String(text || '');
  for (const pattern of patterns || []) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const matcher = new RegExp(pattern.source, flags);
    let match;
    while ((match = matcher.exec(source)) !== null) {
      const name = String(match[1] || '').trim();
      if (name) names.push(name);
      if (!match[0]) matcher.lastIndex += 1;
    }
  }
  return sortUnique(names);
};

const collectHeuristicCallees = (text) => {
  const source = String(text || '');
  const out = [];
  const callRe = /\b([A-Za-z_][A-Za-z0-9_!.]*)\s*\(/g;
  let match;
  while ((match = callRe.exec(source)) !== null) {
    const callee = String(match[1] || '').trim();
    if (callee && !HEURISTIC_CALL_SKIP.has(callee)) out.push(callee);
    if (!match[0]) callRe.lastIndex += 1;
  }
  return sortUnique(out);
};

const collectTemplateUsages = (text) => {
  const source = String(text || '');
  const matches = [];
  const moustacheRef = /\{\{\s*[#/>]?\s*([A-Za-z_][A-Za-z0-9_.-]*)/g;
  const jinjaRef = /\{%\s*(?:include|extends|import|from|call|macro|block)\s+['"]?([A-Za-z_][A-Za-z0-9_.-]*)/g;
  const razorPartialRef = /@(?:Html\.)?Partial(?:Async)?\s*\(\s*["']([^"']+)["']/g;
  const razorCallRef = /@([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const matcher of [moustacheRef, jinjaRef, razorPartialRef, razorCallRef]) {
    let match;
    while ((match = matcher.exec(source)) !== null) {
      const name = String(match[1] || '').trim();
      if (name && !TEMPLATE_USAGE_SKIP.has(name)) matches.push(name);
      if (!match[0]) matcher.lastIndex += 1;
    }
  }
  return sortUnique(matches);
};

const collectGraphqlUsages = (text) => {
  const source = String(text || '');
  const values = [];
  const typeRef = /:\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  const fragmentRef = /\.\.\.\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  const implRef = /\b(?:on|implements)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const matcher of [typeRef, fragmentRef, implRef]) {
    let match;
    while ((match = matcher.exec(source)) !== null) {
      const name = String(match[1] || '').trim();
      if (name && !GRAPHQL_USAGE_SKIP.has(name)) values.push(name);
      if (!match[0]) matcher.lastIndex += 1;
    }
  }
  return sortUnique(values);
};

const collectProtoUsages = (text) => {
  const source = String(text || '');
  const values = [];
  const rpcTypes = /\brpc\s+[A-Za-z_][A-Za-z0-9_]*\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)\s+returns\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/g;
  const fieldTypes = /\b(?:optional|required|repeated)?\s*([A-Za-z_][A-Za-z0-9_.]*)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*\d+/g;
  for (const matcher of [rpcTypes, fieldTypes]) {
    let match;
    while ((match = matcher.exec(source)) !== null) {
      const candidates = matcher === rpcTypes ? [match[1], match[2]] : [match[1]];
      for (const candidate of candidates) {
        const name = String(candidate || '').trim();
        if (name && !PROTO_USAGE_SKIP.has(name)) values.push(name);
      }
      if (!match[0]) matcher.lastIndex += 1;
    }
  }
  return sortUnique(values);
};

const collectBuildDslUsages = (text) => {
  const source = String(text || '');
  const values = [];
  const cmakeCalls = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
  const starlarkCalls = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  const makeDeps = /^[A-Za-z0-9_.-]+\s*:\s*([^\n#]+)/gm;
  const dockerFrom = /^\s*FROM\s+([^\s]+)(?:\s+AS\s+[A-Za-z_][A-Za-z0-9_-]*)?/gim;
  const dockerCopyFrom = /--from=([A-Za-z_][A-Za-z0-9_-]*)/g;
  const nixOps = /\b(import|callPackage)\b/g;
  const matchers = [cmakeCalls, starlarkCalls, dockerFrom, dockerCopyFrom, nixOps];
  for (const matcher of matchers) {
    let match;
    while ((match = matcher.exec(source)) !== null) {
      const name = String(match[1] || '').trim();
      if (name && !BUILD_DSL_USAGE_SKIP.has(name)) values.push(name);
      if (!match[0]) matcher.lastIndex += 1;
    }
  }
  let depMatch;
  while ((depMatch = makeDeps.exec(source)) !== null) {
    const depBlock = String(depMatch[1] || '');
    const deps = depBlock.split(/\s+/).map((entry) => entry.trim()).filter(Boolean);
    for (const dep of deps) {
      if (!BUILD_DSL_USAGE_SKIP.has(dep)) values.push(dep);
    }
    if (!depMatch[0]) makeDeps.lastIndex += 1;
  }
  return sortUnique(values);
};

const buildHeuristicManagedRelations = ({ text, options, collectImports, symbolPatterns, usageCollector }) => {
  const base = buildSimpleRelations({ imports: collectImports(text, options) });
  const symbols = collectPatternNames(text, symbolPatterns);
  const callees = typeof usageCollector === 'function'
    ? usageCollector(text)
    : collectHeuristicCallees(text);
  const calls = [];
  const callers = symbols.length ? symbols : ['<module>'];
  for (const caller of callers) {
    for (const callee of callees) {
      if (!callee || callee === caller) continue;
      calls.push([caller, callee]);
      if (calls.length >= 96) break;
    }
    if (calls.length >= 96) break;
  }
  return {
    ...base,
    exports: symbols,
    calls,
    usages: callees
  };
};

const extractHeuristicManagedDocMeta = (chunk) => {
  const symbol = typeof chunk?.name === 'string' ? chunk.name.trim() : '';
  if (!symbol) return {};
  return {
    symbol,
    source: 'managed-heuristic-adapter'
  };
};

const buildHeuristicManagedFlow = (text, chunk, options = {}) => {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const source = String(text || '');
  const start = Math.max(0, chunk.start);
  const end = Math.min(source.length, chunk.end);
  if (end <= start) return null;
  const scope = source.slice(start, end);
  const dataflowEnabled = options.dataflow !== false;
  const controlFlowEnabled = options.controlFlow !== false;
  const out = {
    dataflow: null,
    controlFlow: null,
    throws: [],
    awaits: [],
    yields: false,
    returnsValue: false
  };
  if (dataflowEnabled) {
    out.dataflow = buildHeuristicDataflow(scope, { skip: HEURISTIC_CALL_SKIP, memberOperators: ['.'] });
    out.returnsValue = hasReturnValue(scope);
    out.throws = /\bthrow\b/.test(scope) ? ['throw'] : [];
    out.awaits = /\bawait\b/.test(scope) ? ['await'] : [];
    out.yields = /\byield\b/.test(scope);
  }
  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(scope, HEURISTIC_CONTROL_FLOW_OPTIONS);
  }
  return out;
};

const createHeuristicManagedAdapter = ({
  id,
  match,
  collectImports,
  symbolPatterns,
  usageCollector = null,
  capabilityProfile = null
}) => {
  const adapter = {
    id,
    match,
    collectImports: (text, options) => collectImports(text, options),
    prepare: async () => ({}),
    buildRelations: ({ text, options }) => buildHeuristicManagedRelations({
      text,
      options,
      collectImports,
      symbolPatterns,
      usageCollector
    }),
    extractDocMeta: ({ chunk }) => extractHeuristicManagedDocMeta(chunk),
    flow: ({ text, chunk, options }) => buildHeuristicManagedFlow(text, chunk, flowOptions(options)),
    attachName: true
  };
  if (capabilityProfile) adapter.capabilityProfile = capabilityProfile;
  return adapter;
};

const createConfigDataAdapter = ({ id, match, collectImports = () => [] }) => ({
  id,
  match,
  collectImports: (text, options) => collectImports(text, options),
  prepare: async () => ({}),
  buildRelations: ({ text, options }) => buildSimpleRelations({ imports: collectImports(text, options) }),
  extractDocMeta: () => ({}),
  flow: () => null,
  attachName: false
});

export const LANGUAGE_REGISTRY = [
  {
    id: 'javascript',
    match: (ext) => isJsLike(ext),
    collectImports: (text, options) => collectImports(text, options),
    prepare: async ({ text, mode, ext, options }) => {
      if (mode !== 'code') return {};
      const context = {};
      const treeChunks = await buildTreeSitterChunksAsync({
        text,
        languageId: null,
        ext,
        options
      });
      if (treeChunks && treeChunks.length) context.jsChunks = treeChunks;
      if (options?.relationsEnabled !== false) {
        context.jsAst = parseJavaScriptAst(text, { ...options, ext });
      }
      return context;
    },
    buildRelations: ({ text, relPath, context, options, ext }) =>
      buildCodeRelations(text, relPath, {
        ...options,
        ext,
        ast: context?.jsAst,
        dataflow: options.astDataflowEnabled,
        controlFlow: options.controlFlowEnabled
      }),
    extractDocMeta: ({ text, chunk, fileRelations }) => extractDocMeta(text, chunk, fileRelations),
    flow: ({ text, chunk, options }) => buildControlFlowOnly(text, chunk, options, JS_CONTROL_FLOW),
    attachName: false
  },
  {
    id: 'typescript',
    match: (ext) => isTypeScript(ext),
    collectImports: (text, options) => collectTypeScriptImports(text, options),
    prepare: async ({ text, mode, ext, relPath, options }) => {
      if (mode !== 'code') return {};
      if (options?.typescript?.importsOnly === true) return {};
      let tsChunks = await buildTreeSitterChunksAsync({
        text,
        languageId: ext === '.tsx' ? 'tsx' : 'typescript',
        ext,
        options
      });
      if (!tsChunks || !tsChunks.length) {
        tsChunks = buildTypeScriptChunks(text, {
          ...(options && typeof options === 'object' ? options : {}),
          ext,
          relPath,
          parser: options?.typescript?.parser
        });
      }
      return { tsChunks };
    },
    buildRelations: ({ text, context, options, ext }) => {
      if (options?.typescript?.importsOnly === true) {
        const imports = collectTypeScriptImports(text, { ...options, ext });
        return {
          imports,
          exports: [],
          calls: [],
          usages: []
        };
      }
      return buildTypeScriptRelations(text, context.tsChunks, { ...options, ext });
    },
    extractDocMeta: ({ chunk }) => extractTypeScriptDocMeta(chunk),
    flow: ({ text, chunk, options }) => (options?.typescript?.importsOnly === true
      ? null
      : computeTypeScriptFlow(text, chunk, flowOptions(options))),
    attachName: true
  },
  {
    id: 'python',
    match: (ext) => ext === '.py',
    collectImports: (text) => collectPythonImports(text).imports,
    prepare: async ({ text, mode, relPath, options }) => {
      if (mode !== 'code') return {};
      let pythonAst = null;
      let pythonAstMetrics = null;
      let pythonChunks = null;
      const pythonAstEnabled = options?.pythonAst?.enabled !== false;
      const pythonAstSkip = shouldSkipPythonAstForFile({ text, relPath, options });
      const runPythonAst = pythonAstEnabled && !pythonAstSkip.skip;
      if (runPythonAst) {
        const python = await getPythonAst(text, options?.log, {
          ...options,
          dataflow: options?.astDataflowEnabled,
          controlFlow: options?.controlFlowEnabled,
          path: options?.filePath || relPath || null
        });
        if (python?.ast) pythonAst = python.ast;
        if (python?.metrics) pythonAstMetrics = python.metrics;
      } else if (pythonAstEnabled && pythonAstSkip.skip && typeof options?.log === 'function') {
        options.log(
          `[python-ast] skip ${normalizeRelPath(relPath || options?.filePath || '')} `
          + `(${pythonAstSkip.reason || 'policy'}).`
        );
      }
      if (pythonAst) {
        pythonChunks = buildPythonChunksFromAst(text, pythonAst);
      }
      if (!pythonChunks || !pythonChunks.length) {
        pythonChunks = buildPythonHeuristicChunks(text);
      }
      return { pythonAst, pythonAstMetrics, pythonChunks };
    },
    buildRelations: ({ text, relPath, context, options }) =>
      buildPythonRelations(text, relPath, context.pythonAst, options),
    extractDocMeta: ({ chunk, fileRelations, context }) =>
      extractPythonDocMeta(chunk, fileRelations, context),
    flow: ({ text, chunk, options }) => buildControlFlowOnly(text, chunk, options, PY_CONTROL_FLOW),
    attachName: false
  },
  {
    id: 'clike',
    match: (ext) => isCLike(ext),
    collectImports: (text, options) => collectCLikeImports(text, options),
    buildRelations: ({ text, relPath, options }) => buildCLikeRelations(text, relPath, options),
    extractDocMeta: ({ text, chunk, fileRelations }) => extractCLikeDocMeta(text, chunk, fileRelations),
    flow: ({ text, chunk, options }) => computeCLikeFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'go',
    match: (ext) => isGo(ext),
    collectImports: (text, options) => collectGoImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const goChunks = buildGoChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.go?.parser
      });
      return { goChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildGoRelations(text, context.goChunks, { relPath, parser: options?.go?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractGoDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeGoFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'java',
    match: (ext) => isJava(ext),
    collectImports: (text, options) => collectJavaImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const javaChunks = buildJavaChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.java?.parser
      });
      return { javaChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildJavaRelations(text, context.javaChunks, { relPath, parser: options?.java?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractJavaDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeJavaFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'csharp',
    match: (ext) => isCSharp(ext),
    collectImports: (text, options) => collectCSharpImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const csChunks = buildCSharpChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.csharp?.parser
      });
      return { csChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildCSharpRelations(text, context.csChunks, { relPath, parser: options?.csharp?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractCSharpDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeCSharpFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'kotlin',
    match: (ext) => isKotlin(ext),
    collectImports: (text, options) => collectKotlinImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const kotlinChunks = buildKotlinChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.kotlin?.parser
      });
      return { kotlinChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildKotlinRelations(text, context.kotlinChunks, { relPath, parser: options?.kotlin?.parser, ...options }),
    extractDocMeta: ({ chunk, fileRelations }) => extractKotlinDocMeta(chunk, fileRelations),
    flow: ({ text, chunk, options }) => computeKotlinFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'ruby',
    match: (ext) => isRuby(ext),
    collectImports: (text, options) => collectRubyImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const rubyChunks = buildRubyChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.ruby?.parser
      });
      return { rubyChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildRubyRelations(text, context.rubyChunks, { relPath, parser: options?.ruby?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractRubyDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeRubyFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'php',
    match: (ext) => isPhp(ext),
    collectImports: (text, options) => collectPhpImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const phpChunks = buildPhpChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.php?.parser
      });
      return { phpChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildPhpRelations(text, context.phpChunks, { relPath, parser: options?.php?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractPhpDocMeta(chunk),
    flow: ({ text, chunk, options }) => computePhpFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'html',
    match: (ext) => isHtml(ext),
    collectImports: (text, options) => collectHtmlImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const htmlChunks = buildHtmlChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.html?.parser
      });
      return { htmlChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildHtmlRelations(text, context.htmlChunks, { relPath, parser: options?.html?.parser, ...options }),
    extractDocMeta: ({ chunk, fileRelations }) => extractHtmlDocMeta(chunk, fileRelations),
    flow: ({ text, chunk, options }) => computeHtmlFlow(text, chunk, flowOptions(options)),
    attachName: true,
    metadata: getHtmlMetadata
  },
  {
    id: 'css',
    match: (ext) => isCss(ext),
    collectImports: (text, options) => collectCssImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const cssChunks = buildCssChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.css?.parser
      });
      return { cssChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildCssRelations(text, context.cssChunks, { relPath, parser: options?.css?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractCssDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeCssFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'lua',
    match: (ext) => isLua(ext),
    collectImports: (text, options) => collectLuaImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const luaChunks = buildLuaChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.lua?.parser
      });
      return { luaChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildLuaRelations(text, context.luaChunks, { relPath, parser: options?.lua?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractLuaDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeLuaFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'sql',
    match: (ext) => isSql(ext),
    collectImports: (text, options) => collectSqlImports(text, options),
    prepare: async ({ text, relPath, ext, options }) => {
      const dialect = typeof options?.resolveSqlDialect === 'function'
        ? options.resolveSqlDialect(ext || path.extname(relPath || ''))
        : (options?.sql?.dialect || 'generic');
      const sqlChunks = buildSqlChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.sql?.parser,
        dialect
      });
      return { sqlChunks };
    },
    buildRelations: ({ text, context, relPath, ext, options }) => {
      const dialect = typeof options?.resolveSqlDialect === 'function'
        ? options.resolveSqlDialect(ext || path.extname(relPath || ''))
        : (options?.sql?.dialect || 'generic');
      return buildSqlRelations(text, context.sqlChunks, {
        relPath,
        parser: options?.sql?.parser,
        dialect,
        ...options
      });
    },
    extractDocMeta: ({ chunk }) => extractSqlDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeSqlFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'perl',
    match: (ext) => isPerl(ext),
    collectImports: (text, options) => collectPerlImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const perlChunks = buildPerlChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.perl?.parser
      });
      return { perlChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildPerlRelations(text, context.perlChunks, { relPath, parser: options?.perl?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractPerlDocMeta(chunk),
    flow: ({ text, chunk, options }) => computePerlFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'shell',
    match: (ext) => isShell(ext),
    collectImports: (text, options) => collectShellImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const shellChunks = buildShellChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.shell?.parser
      });
      return { shellChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildShellRelations(text, context.shellChunks, { relPath, parser: options?.shell?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractShellDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeShellFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'rust',
    match: (ext) => ext === '.rs',
    collectImports: (text, options) => collectRustImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const rustChunks = buildRustChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.rust?.parser
      });
      return { rustChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildRustRelations(text, context.rustChunks, { relPath, parser: options?.rust?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractRustDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeRustFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'swift',
    match: (ext) => ext === '.swift',
    collectImports: (text) => collectSwiftImports(text).imports,
    prepare: async ({ text, relPath, options }) => {
      const swiftChunks = buildSwiftChunks(text, {
        ...(options && typeof options === 'object' ? options : {}),
        relPath,
        parser: options?.swift?.parser
      });
      return { swiftChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildSwiftRelations(text, context.swiftChunks, { relPath, parser: options?.swift?.parser, ...options }),
    extractDocMeta: ({ chunk, context }) => extractSwiftDocMeta(chunk, context),
    flow: ({ text, chunk, options }) => computeSwiftFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  createHeuristicManagedAdapter({
    id: 'cmake',
    match: (ext) => CMAKE_EXTS.has(ext),
    collectImports: collectCmakeImports,
    symbolPatterns: CMAKE_SYMBOL_PATTERNS,
    usageCollector: collectBuildDslUsages,
    capabilityProfile: IMPORT_COLLECTOR_CAPABILITY_PROFILE
  }),
  createHeuristicManagedAdapter({
    id: 'starlark',
    match: (ext) => STARLARK_EXTS.has(ext),
    collectImports: collectStarlarkImports,
    symbolPatterns: STARLARK_SYMBOL_PATTERNS,
    usageCollector: collectBuildDslUsages,
    capabilityProfile: IMPORT_COLLECTOR_CAPABILITY_PROFILE
  }),
  createHeuristicManagedAdapter({
    id: 'nix',
    match: (ext) => NIX_EXTS.has(ext),
    collectImports: collectNixImports,
    symbolPatterns: NIX_SYMBOL_PATTERNS,
    usageCollector: collectBuildDslUsages,
    capabilityProfile: IMPORT_COLLECTOR_CAPABILITY_PROFILE
  }),
  createHeuristicManagedAdapter({
    id: 'dart',
    match: (ext) => DART_EXTS.has(ext),
    collectImports: collectDartImports,
    symbolPatterns: DART_SYMBOL_PATTERNS
  }),
  createHeuristicManagedAdapter({
    id: 'scala',
    match: (ext) => SCALA_EXTS.has(ext),
    collectImports: collectScalaImports,
    symbolPatterns: SCALA_SYMBOL_PATTERNS
  }),
  createHeuristicManagedAdapter({
    id: 'groovy',
    match: (ext) => GROOVY_EXTS.has(ext),
    collectImports: collectGroovyImports,
    symbolPatterns: GROOVY_SYMBOL_PATTERNS
  }),
  createHeuristicManagedAdapter({
    id: 'r',
    match: (ext) => R_EXTS.has(ext),
    collectImports: collectRImports,
    symbolPatterns: R_SYMBOL_PATTERNS
  }),
  createHeuristicManagedAdapter({
    id: 'julia',
    match: (ext) => JULIA_EXTS.has(ext),
    collectImports: collectJuliaImports,
    symbolPatterns: JULIA_SYMBOL_PATTERNS
  }),
  createHeuristicManagedAdapter({
    id: 'handlebars',
    match: (ext) => HANDLEBARS_EXTS.has(ext),
    collectImports: collectHandlebarsImports,
    symbolPatterns: HANDLEBARS_SYMBOL_PATTERNS,
    usageCollector: collectTemplateUsages
  }),
  createHeuristicManagedAdapter({
    id: 'mustache',
    match: (ext) => MUSTACHE_EXTS.has(ext),
    collectImports: collectMustacheImports,
    symbolPatterns: MUSTACHE_SYMBOL_PATTERNS,
    usageCollector: collectTemplateUsages
  }),
  createHeuristicManagedAdapter({
    id: 'jinja',
    match: (ext) => JINJA_EXTS.has(ext),
    collectImports: collectJinjaImports,
    symbolPatterns: JINJA_SYMBOL_PATTERNS,
    usageCollector: collectTemplateUsages
  }),
  createHeuristicManagedAdapter({
    id: 'razor',
    match: (ext) => RAZOR_EXTS.has(ext),
    collectImports: collectRazorImports,
    symbolPatterns: RAZOR_SYMBOL_PATTERNS,
    usageCollector: collectTemplateUsages
  }),
  createHeuristicManagedAdapter({
    id: 'proto',
    match: (ext, relPath) => ext === '.proto' || isProtoConfigPath(relPath),
    collectImports: collectProtoImports,
    symbolPatterns: PROTO_SYMBOL_PATTERNS,
    usageCollector: collectProtoUsages
  }),
  createHeuristicManagedAdapter({
    id: 'makefile',
    match: (_ext, relPath) => isMakefilePath(relPath),
    collectImports: collectMakefileImports,
    symbolPatterns: MAKEFILE_SYMBOL_PATTERNS,
    usageCollector: collectBuildDslUsages,
    capabilityProfile: IMPORT_COLLECTOR_CAPABILITY_PROFILE
  }),
  createHeuristicManagedAdapter({
    id: 'dockerfile',
    match: (_ext, relPath) => isDockerfilePath(relPath),
    collectImports: collectDockerfileImports,
    symbolPatterns: DOCKERFILE_SYMBOL_PATTERNS,
    usageCollector: collectBuildDslUsages,
    capabilityProfile: IMPORT_COLLECTOR_CAPABILITY_PROFILE
  }),
  createHeuristicManagedAdapter({
    id: 'graphql',
    match: (ext) => ext === '.graphql' || ext === '.gql',
    collectImports: collectGraphqlImports,
    symbolPatterns: GRAPHQL_SYMBOL_PATTERNS,
    usageCollector: collectGraphqlUsages
  }),
  createConfigDataAdapter({
    id: 'ini',
    match: (ext) => INI_EXTS.has(ext),
    collectImports: collectIniImports
  }),
  createConfigDataAdapter({
    id: 'json',
    match: (ext) => JSON_EXTS.has(ext),
    collectImports: collectJsonImports
  }),
  createConfigDataAdapter({
    id: 'toml',
    match: (ext) => TOML_EXTS.has(ext),
    collectImports: collectTomlImports
  }),
  createConfigDataAdapter({
    id: 'xml',
    match: (ext) => XML_EXTS.has(ext)
  }),
  createConfigDataAdapter({
    id: 'yaml',
    match: (ext) => YAML_EXTS.has(ext),
    collectImports: collectYamlImports
  })
];

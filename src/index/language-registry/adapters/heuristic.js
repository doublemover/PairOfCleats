import path from 'node:path';

import {
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
} from '../../constants.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from '../../../lang/flow.js';
import { buildSimpleRelations } from '../simple-relations.js';
import { collectCmakeImports } from '../import-collectors/cmake.js';
import { collectDartImports } from '../import-collectors/dart.js';
import { collectDockerfileImports } from '../import-collectors/dockerfile.js';
import { collectGraphqlImports } from '../import-collectors/graphql.js';
import { collectGroovyImports } from '../import-collectors/groovy.js';
import { collectHandlebarsImports } from '../import-collectors/handlebars.js';
import { collectJinjaImports } from '../import-collectors/jinja.js';
import { collectJuliaImports } from '../import-collectors/julia.js';
import { collectMakefileImports } from '../import-collectors/makefile.js';
import { collectMustacheImports } from '../import-collectors/mustache.js';
import { collectNixImports } from '../import-collectors/nix.js';
import { collectProtoImports } from '../import-collectors/proto.js';
import { collectRazorImports } from '../import-collectors/razor.js';
import { collectRImports } from '../import-collectors/r.js';
import { collectScalaImports } from '../import-collectors/scala.js';
import { collectStarlarkImports } from '../import-collectors/starlark.js';
import { flowOptions, normalizeRelPath } from './managed.js';

const createExtensionMatcher = (extensions) => (ext) => extensions.has(ext);

const getPathBasename = (relPath) => path.posix.basename(normalizeRelPath(relPath)).toLowerCase();

const MAKEFILE_BASENAMES = new Set(['makefile', 'gnumakefile', 'bsdmakefile']);
const GRAPHQL_EXTS = new Set(['.graphql', '.gql']);
const PROTO_EXTS = new Set(['.proto']);

const isMakefilePath = (relPath) => MAKEFILE_BASENAMES.has(getPathBasename(relPath));

const isDockerfilePath = (relPath) => {
  const baseName = getPathBasename(relPath);
  return baseName === 'dockerfile'
    || baseName.startsWith('dockerfile.')
    || baseName === 'containerfile'
    || baseName.startsWith('containerfile.');
};

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

export const createHeuristicManagedAdapter = ({
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

const matchByExtension = {
  cmake: createExtensionMatcher(CMAKE_EXTS),
  starlark: createExtensionMatcher(STARLARK_EXTS),
  nix: createExtensionMatcher(NIX_EXTS),
  dart: createExtensionMatcher(DART_EXTS),
  scala: createExtensionMatcher(SCALA_EXTS),
  groovy: createExtensionMatcher(GROOVY_EXTS),
  r: createExtensionMatcher(R_EXTS),
  julia: createExtensionMatcher(JULIA_EXTS),
  handlebars: createExtensionMatcher(HANDLEBARS_EXTS),
  mustache: createExtensionMatcher(MUSTACHE_EXTS),
  jinja: createExtensionMatcher(JINJA_EXTS),
  razor: createExtensionMatcher(RAZOR_EXTS),
  graphql: createExtensionMatcher(GRAPHQL_EXTS),
  proto: createExtensionMatcher(PROTO_EXTS)
};

const matchesProtoPath = (_ext, relPath) => isProtoConfigPath(relPath);
const matchProto = (ext, relPath) => matchByExtension.proto(ext, relPath) || matchesProtoPath(ext, relPath);
const matchMakefile = (_ext, relPath) => isMakefilePath(relPath);
const matchDockerfile = (_ext, relPath) => isDockerfilePath(relPath);

export const buildHeuristicAdapters = () => [
  createHeuristicManagedAdapter({
    id: 'cmake',
    match: matchByExtension.cmake,
    collectImports: collectCmakeImports,
    symbolPatterns: CMAKE_SYMBOL_PATTERNS,
    usageCollector: collectBuildDslUsages,
    capabilityProfile: IMPORT_COLLECTOR_CAPABILITY_PROFILE
  }),
  createHeuristicManagedAdapter({
    id: 'starlark',
    match: matchByExtension.starlark,
    collectImports: collectStarlarkImports,
    symbolPatterns: STARLARK_SYMBOL_PATTERNS,
    usageCollector: collectBuildDslUsages,
    capabilityProfile: IMPORT_COLLECTOR_CAPABILITY_PROFILE
  }),
  createHeuristicManagedAdapter({
    id: 'nix',
    match: matchByExtension.nix,
    collectImports: collectNixImports,
    symbolPatterns: NIX_SYMBOL_PATTERNS,
    usageCollector: collectBuildDslUsages,
    capabilityProfile: IMPORT_COLLECTOR_CAPABILITY_PROFILE
  }),
  createHeuristicManagedAdapter({
    id: 'dart',
    match: matchByExtension.dart,
    collectImports: collectDartImports,
    symbolPatterns: DART_SYMBOL_PATTERNS
  }),
  createHeuristicManagedAdapter({
    id: 'scala',
    match: matchByExtension.scala,
    collectImports: collectScalaImports,
    symbolPatterns: SCALA_SYMBOL_PATTERNS
  }),
  createHeuristicManagedAdapter({
    id: 'groovy',
    match: matchByExtension.groovy,
    collectImports: collectGroovyImports,
    symbolPatterns: GROOVY_SYMBOL_PATTERNS
  }),
  createHeuristicManagedAdapter({
    id: 'r',
    match: matchByExtension.r,
    collectImports: collectRImports,
    symbolPatterns: R_SYMBOL_PATTERNS
  }),
  createHeuristicManagedAdapter({
    id: 'julia',
    match: matchByExtension.julia,
    collectImports: collectJuliaImports,
    symbolPatterns: JULIA_SYMBOL_PATTERNS
  }),
  createHeuristicManagedAdapter({
    id: 'handlebars',
    match: matchByExtension.handlebars,
    collectImports: collectHandlebarsImports,
    symbolPatterns: HANDLEBARS_SYMBOL_PATTERNS,
    usageCollector: collectTemplateUsages
  }),
  createHeuristicManagedAdapter({
    id: 'mustache',
    match: matchByExtension.mustache,
    collectImports: collectMustacheImports,
    symbolPatterns: MUSTACHE_SYMBOL_PATTERNS,
    usageCollector: collectTemplateUsages
  }),
  createHeuristicManagedAdapter({
    id: 'jinja',
    match: matchByExtension.jinja,
    collectImports: collectJinjaImports,
    symbolPatterns: JINJA_SYMBOL_PATTERNS,
    usageCollector: collectTemplateUsages
  }),
  createHeuristicManagedAdapter({
    id: 'razor',
    match: matchByExtension.razor,
    collectImports: collectRazorImports,
    symbolPatterns: RAZOR_SYMBOL_PATTERNS,
    usageCollector: collectTemplateUsages
  }),
  createHeuristicManagedAdapter({
    id: 'proto',
    match: matchProto,
    collectImports: collectProtoImports,
    symbolPatterns: PROTO_SYMBOL_PATTERNS,
    usageCollector: collectProtoUsages
  }),
  createHeuristicManagedAdapter({
    id: 'makefile',
    match: matchMakefile,
    collectImports: collectMakefileImports,
    symbolPatterns: MAKEFILE_SYMBOL_PATTERNS,
    usageCollector: collectBuildDslUsages,
    capabilityProfile: IMPORT_COLLECTOR_CAPABILITY_PROFILE
  }),
  createHeuristicManagedAdapter({
    id: 'dockerfile',
    match: matchDockerfile,
    collectImports: collectDockerfileImports,
    symbolPatterns: DOCKERFILE_SYMBOL_PATTERNS,
    usageCollector: collectBuildDslUsages,
    capabilityProfile: IMPORT_COLLECTOR_CAPABILITY_PROFILE
  }),
  createHeuristicManagedAdapter({
    id: 'graphql',
    match: matchByExtension.graphql,
    collectImports: collectGraphqlImports,
    symbolPatterns: GRAPHQL_SYMBOL_PATTERNS,
    usageCollector: collectGraphqlUsages
  })
];

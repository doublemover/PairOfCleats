import { resolveCallArguments, exactCallArity } from '../../contracts/call-arguments.js';
import { API_CONTRACT_REPORT_VERSION } from '../../contracts/schemas/api-contracts.js';
import { CALLABLE_PARAMETERS_VERSION, isQualifiedCallableSummary, unavailableCallableParameters } from '../../contracts/callable-parameters.js';
import path from 'node:path';
import { createCli } from '../../shared/cli.js';
import { isDirectExecution } from '../../shared/direct-execution.js';
import { toPosix } from '../../shared/file-paths.js';
import { normalizeOptionalNumber } from '../../shared/limits.js';
import { resolveProvenance } from '../../shared/provenance.js';
import { validateApiContracts } from '../../contracts/validators/analysis.js';
import { MAX_JSON_BYTES } from '../../shared/artifact-io/constants.js';
import {
  loadPiecesManifest,
  readCompatibilityKey,
  resolveManifestArtifactSources
} from '../../shared/artifact-io/manifest.js';
import { loadJsonArrayArtifactRows } from '../../shared/artifact-io/loaders.js';
import { readJsonlRows } from '../../shared/merge.js';
import { buildIndexSignature } from '../../retrieval/index-cache.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import { renderApiContracts } from '../../retrieval/output/api-contracts.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { writeJsonLinesFile } from '../../shared/json-stream/jsonl-write.js';
import { apiContractSymbolIdentity, buildApiContractTargetJoins, createApiContractCallTargetIndex } from './api-contract-targets.js';
import { emitReportOutcome } from './report-outcome.js';

/**
 * Build non-null API contract cap payload used in report metadata.
 *
 * @param {{maxSymbols?:number,maxCallsPerSymbol?:number,maxWarnings?:number}} input
 * @returns {object}
 */
const buildCapsPayload = ({ maxSymbols, maxCallsPerSymbol, maxWarnings }) => {
  const caps = {};
  if (Number.isFinite(maxSymbols)) caps.maxSymbols = maxSymbols;
  if (Number.isFinite(maxCallsPerSymbol)) caps.maxCallsPerSymbol = maxCallsPerSymbol;
  if (Number.isFinite(maxWarnings)) caps.maxWarnings = maxWarnings;
  return caps;
};

/**
 * Resolve manifest-backed JSONL paths for an artifact or return `null`.
 *
 * Rejects mixed or non-JSONL source formats to keep streaming readers on a
 * deterministic path.
 *
 * @param {string} indexDir
 * @param {object} manifest
 * @param {string} name
 * @returns {string[]|null}
 */
const resolveJsonlSources = (indexDir, manifest, name) => {
  const sources = resolveManifestArtifactSources({
    dir: indexDir,
    manifest,
    name,
    strict: true,
    maxBytes: MAX_JSON_BYTES
  });
  if (!sources?.paths?.length) return null;
  if (sources.format === 'json') return null;
  const jsonlPaths = sources.paths.filter((target) => target.endsWith('.jsonl'));
  if (!jsonlPaths.length || jsonlPaths.length !== sources.paths.length) return null;
  return jsonlPaths;
};

const loadJsonlRowsIntoArray = async (paths) => {
  const rows = [];
  for (const target of paths) {
    for await (const row of readJsonlRows(target)) {
      rows.push(row);
    }
  }
  return rows;
};

const collectRows = async (iterator) => {
  const rows = [];
  for await (const row of iterator) {
    rows.push(row);
  }
  return rows;
};

/**
 * Load call-site rows and index them by target symbol identifiers.
 *
 * @param {string} indexDir
 * @param {object} manifest
 * @returns {Promise<object|null>} Opaque captured call index.
 */
const loadCallSitesByTarget = async (indexDir, manifest) => {
  const jsonlPaths = resolveJsonlSources(indexDir, manifest, 'call_sites');
  if (!jsonlPaths) return null;
  const builder = createApiContractCallTargetIndex();
  for (const target of jsonlPaths) {
    for await (const callSite of readJsonlRows(target)) {
      builder.add(callSite);
    }
  }
  return builder.finish();
};


/**
 * Determine whether a symbol should be treated as exported.
 *
 * @param {object} symbol
 * @returns {boolean}
 */
const isExportedSymbol = (symbol) => {
  if (typeof symbol.exported === 'boolean') return symbol.exported;
  if (['javascript', 'typescript', 'jsx', 'tsx'].includes(String(symbol.lang || '').toLowerCase())
    || /\.(?:[cm]?[jt]sx?)$/i.test(symbol.file || '')) return null;
  const kind = String(symbol.kind || '').toLowerCase();
  const group = String(symbol.kindGroup || '').toLowerCase();
  if (kind.includes('export')) return true;
  if (group.includes('export')) return true;
  return false;
};

const signatureArityCache = new Map();

/**
 * Parse signature text into required/optional/variadic arity metadata.
 *
 * @param {string} signature
 * @returns {{requiredCount:number,maxCount:number|null,variadic:boolean}|null}
 */
const parseSignatureArity = (signature, language) => {
  if (!signature || typeof signature !== 'string') return null;
  const text = String(signature);
  if (text.length > 4096 || /[\u2026]|\/\*|\/\//u.test(text)) return null;
  const start = text.indexOf('(');
  if (start === -1) return null;
  const prefix = text.slice(0, start).trim();
  if (!/^(?:(?:export|default|declare|public|private|protected|static|async|abstract|override)\s+)*(?:function\s*\*?\s*)?(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)?$/u.test(prefix)) return null;
  if (language === 'javascript' && /\b(?:declare|public|private|protected|abstract|override)\b/u.test(prefix)) return null;
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inSingle) {
      if (ch === '\'') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inBacktick) {
      if (ch === '`') inBacktick = false;
      continue;
    }
    if (ch === '\'') {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inBacktick = true;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  const raw = text.slice(start + 1, end).trim();
  if (!raw) {
    return {
      requiredCount: 0,
      maxCount: 0,
      formalSlotCount: 0, runtimeSlotCount: 0,
      variadic: false
    };
  }

  const params = [];
  const delimiters = [];
  let current = '';
  depth = 0;
  inSingle = false;
  inDouble = false;
  inBacktick = false;
  escaped = false;
  let angleDepth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === '\'') inSingle = false;
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inBacktick) {
      current += ch;
      if (ch === '`') inBacktick = false;
      continue;
    }
    if (ch === '\'') {
      current += ch;
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      current += ch;
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      current += ch;
      inBacktick = true;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      delimiters.push(ch === '(' ? ')' : ch === '[' ? ']' : '}');
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (delimiters.pop() !== ch) return null;
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (ch === '<') {
      angleDepth += 1;
      current += ch;
      continue;
    }
    if (ch === '>') {
      angleDepth = Math.max(0, angleDepth - 1);
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0 && angleDepth === 0) {
      const trimmed = current.trim();
      if (!trimmed) return null;
      params.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  if (depth || angleDepth || inSingle || inDouble || inBacktick || params.length > 256) return null;
  const final = current.trim();
  if (final) params.push(final);
  if (params.length > 256 || delimiters.length) return null;

  const isTopLevelTokenMatch = (value, predicate) => {
    let level = 0;
    let angle = 0;
    let inS = false;
    let inD = false;
    let inB = false;
    let esc = false;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (inS) {
        if (ch === '\'') inS = false;
        continue;
      }
      if (inD) {
        if (ch === '"') inD = false;
        continue;
      }
      if (inB) {
        if (ch === '`') inB = false;
        continue;
      }
      if (ch === '\'') { inS = true; continue; }
      if (ch === '"') { inD = true; continue; }
      if (ch === '`') { inB = true; continue; }
      if (ch === '(' || ch === '[' || ch === '{') { level += 1; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { level = Math.max(0, level - 1); continue; }
      if (ch === '<') { angle += 1; continue; }
      if (ch === '>') { angle = Math.max(0, angle - 1); continue; }
      if (level === 0 && angle === 0 && predicate(ch, i, value)) return true;
    }
    return false;
  };

  let requiredCount = 0, runtimeSlotCount = 0, variadic = false;
  for (let index = 0; index < params.length; index++) {
    const trimmed = params[index].trim();
    if (/^this\s*:/u.test(trimmed)) {
      if (language !== 'typescript' || index !== 0) return null;
      continue;
    }
    if (!/^(?:\.\.\.)?(?:[A-Za-z_$]|[\[{])/u.test(trimmed) || /\bextends\b/u.test(trimmed)) return null;
    if (language === 'javascript' && isTopLevelTokenMatch(trimmed, ch => ch === ':' || ch === '?')) return null;
    const position = runtimeSlotCount++;
    if (trimmed.startsWith('...')) {
      if (index !== params.length - 1) return null;
      variadic = true; continue;
    }
    const hasDefault = isTopLevelTokenMatch(trimmed, (ch, index, value) => ch === '='
      && value[index + 1] !== '>' && value[index + 1] !== '=' && !/[=!<>]/u.test(value[index - 1] || ''));
    const hasOptionalMark = isTopLevelTokenMatch(trimmed, (ch, index, value) => ch === '?' && /^\s*(?::|=|$)/u.test(value.slice(index + 1)));
    if (!hasDefault && !hasOptionalMark) requiredCount = position + 1;
  }
  return { requiredCount, maxCount: variadic ? null : runtimeSlotCount, variadic, formalSlotCount: params.length, runtimeSlotCount };
};

const resolveSignatureArity = symbol => {
  const declared = typeof symbol.lang === 'string' && symbol.lang ? symbol.lang.toLowerCase() : null;
  const language = declared ? ['typescript', 'ts', 'tsx'].includes(declared) ? 'typescript'
    : ['javascript', 'js', 'jsx'].includes(declared) ? 'javascript' : null
    : /\.(?:[cm]?ts|tsx)$/iu.test(symbol.file || '') ? 'typescript'
      : /\.(?:[cm]?js|jsx)$/iu.test(symbol.file || '') ? 'javascript' : null;
  if (Object.hasOwn(symbol.extensions || {}, 'callableParameters')) {
    const summary = symbol.extensions.callableParameters;
    if (language && summary?.language !== language || declared && !language) return unavailableCallableParameters('parameter-language-mismatch', language);
    return isQualifiedCallableSummary(summary) ? structuredClone(summary) : unavailableCallableParameters(summary?.reason || 'parameter-summary-invalid', language, summary?.parser || null);
  }
  if (!language || typeof symbol.signature !== 'string' || symbol.signature.length > 4096) return unavailableCallableParameters('legacy-language-or-signature-unavailable', language);
  const key = JSON.stringify(['legacy-parameter-subset-v2', language, symbol.signature]);
  if (signatureArityCache.has(key)) return structuredClone(signatureArityCache.get(key));
  const parsed = parseSignatureArity(symbol.signature, language);
  const summary = parsed ? { schemaVersion: CALLABLE_PARAMETERS_VERSION, projection: 'arity-summary', language, parser: null,
    source: 'legacy-signature-subset', state: 'partial', reason: 'bounded-legacy-parameter-subset',
    formalSlotCount: parsed.formalSlotCount, runtimeSlotCount: parsed.runtimeSlotCount, declarationRange: null, signatureRange: null,
    arity: { state: 'complete', min: parsed.requiredCount, max: parsed.maxCount, variadic: parsed.variadic } }
    : unavailableCallableParameters('legacy-signature-unsupported', language);
  if (signatureArityCache.size >= 4096) signatureArityCache.delete(signatureArityCache.keys().next().value);
  signatureArityCache.set(key, summary);
  return structuredClone(summary);
};

/**
 * Build deterministic API contracts report from symbols and call sites.
 *
 * Applies filtering, truncation caps, and warning-policy handling.
 *
 * @param {object} [input]
 * @returns {object}
 */
export const buildApiContractsReport = ({
  symbols = [],
  callSites = [],
  callSitesByTarget = null,
  onlyExports = false,
  failOnWarn = false,
  caps = {},
  provenance = null,
  indexSignature = null,
  indexCompatKey = null,
  repo = null,
  indexDir = null,
  metrics = null,
  now = () => new Date().toISOString()
} = {}) => {
  const maxSymbols = Number.isFinite(caps.maxSymbols) ? Math.max(0, Math.floor(caps.maxSymbols)) : null;
  const maxCallsPerSymbol = Number.isFinite(caps.maxCallsPerSymbol)
    ? Math.max(0, Math.floor(caps.maxCallsPerSymbol))
    : null;
  const maxWarnings = Number.isFinite(caps.maxWarnings) ? Math.max(0, Math.floor(caps.maxWarnings)) : null;
  const capsPayload = buildCapsPayload({ maxSymbols, maxCallsPerSymbol, maxWarnings });
  const reportProvenance = resolveProvenance({ provenance, indexSignature, indexCompatKey,
    capsUsed: { apiContracts: capsPayload }, repo, indexDir, now, label: 'ApiContracts' });

  const truncation = [];
  const warnings = [];
  let detectedWarnings = 0;
  const warn = (warning) => {
    if (!warning?.code || !warning?.message) return false;
    detectedWarnings += 1;
    if (maxWarnings != null && warnings.length >= maxWarnings) return false;
    warnings.push(warning);
    return true;
  };

  const sortedSymbols = Array.isArray(symbols)
    ? [...new Map(symbols.map(symbol => [apiContractSymbolIdentity(symbol), symbol])).values()] : [];
  sortedSymbols.sort((a, b) => String(a.symbolId || a.id || '').localeCompare(String(b.symbolId || b.id || ''))
    || String(a.file || '').localeCompare(String(b.file || ''))
    || String(a.chunkUid || '').localeCompare(String(b.chunkUid || ''))
    || String(a.signature || '').localeCompare(String(b.signature || '')));
  const joinedCalls = buildApiContractTargetJoins({ symbols: sortedSymbols, callSites, callSitesByTarget,
    provenance: reportProvenance, metrics });

  let selected = sortedSymbols;
  if (onlyExports) {
    selected = selected.filter((symbol) => {
      const exported = isExportedSymbol(symbol);
      if (exported == null) warn({ code: 'EXPORT_IDENTITY_UNAVAILABLE',
        message: 'Export identity is unavailable for this symbol; export-only validation is incomplete.',
        data: { symbolId: symbol.symbolId } });
      return exported === true;
    });
  }
  if (maxSymbols != null && selected.length > maxSymbols) {
    truncation.push({
      scope: 'apiContracts',
      cap: 'maxSymbols',
      limit: maxSymbols,
      observed: selected.length,
      omitted: selected.length - maxSymbols
    });
    selected = selected.slice(0, maxSymbols);
  }

  const symbolEntries = selected.map((symbol) => {
    const symbolId = symbol.symbolId || symbol.id || null;
    const rawCalls = joinedCalls.forSymbol(symbol);

    let observedCalls = rawCalls;
    const entryTruncation = [];
    if (maxCallsPerSymbol != null && observedCalls.length > maxCallsPerSymbol) {
      entryTruncation.push({
        scope: 'apiContracts',
        cap: 'maxCallsPerSymbol',
        limit: maxCallsPerSymbol,
        observed: observedCalls.length,
        omitted: observedCalls.length - maxCallsPerSymbol
      });
      observedCalls = observedCalls.slice(0, maxCallsPerSymbol);
    }

    const signatureInfo = resolveSignatureArity(symbol);
    const entryWarnings = [];
    if (isQualifiedCallableSummary(signatureInfo)) {
      const requiredCount = signatureInfo.arity.min;
      const maxCount = signatureInfo.arity.max;
      for (const call of observedCalls) {
        const argumentsEvidence = resolveCallArguments(call), arity = exactCallArity(call);
        const belowRequired = requiredCount != null && argumentsEvidence.arity.max != null && argumentsEvidence.arity.max < requiredCount;
        const aboveMax = maxCount != null && argumentsEvidence.arity.min != null && argumentsEvidence.arity.min > maxCount;
        if (belowRequired || aboveMax) {
          let expected = '';
          if (requiredCount != null && maxCount != null) {
            expected = requiredCount === maxCount
              ? `Expected ${requiredCount}.`
              : `Expected ${requiredCount}-${maxCount}.`;
          } else if (requiredCount != null && maxCount == null && signatureInfo.arity.variadic) {
            expected = `Expected ${requiredCount}+ (variadic).`;
          } else if (requiredCount != null) {
            expected = `Expected >= ${requiredCount}.`;
          }
          const warning = {
            code: 'ARITY_MISMATCH',
            message: `Observed arity ${arity ?? `${argumentsEvidence.arity.min}+`} differs from signature arity. ${expected}`.trim(),
            data: { symbolId, callSiteId: call.callSiteId, targetChunkUid: call.targetChunkUid,
              indexSignature: call.join.indexSignature }
          };
          if (warn(warning)) {
            entryWarnings.push(warning);
          }
        }
      }
    }

    for (const call of observedCalls) {
      const argumentsEvidence = resolveCallArguments(call);
      if (argumentsEvidence.arity.state === 'exact') continue;
      const warning = { code: 'CALL_ARGUMENT_AUTHORITY_UNAVAILABLE',
        message: 'Exact runtime argument count is unavailable; validation uses only justified bounds.',
        data: { symbolId, callSiteId: call.callSiteId, targetChunkUid: call.targetChunkUid,
          indexSignature: call.join.indexSignature, arityState: argumentsEvidence.arity.state } };
      if (warn(warning)) entryWarnings.push(warning);
    }

    if (!isQualifiedCallableSummary(signatureInfo) && observedCalls.length) {
      const warning = { code: 'CALLABLE_PARAMETER_AUTHORITY_UNAVAILABLE',
        message: 'Callable parameter authority is unavailable; exact argument-count validation is incomplete.',
        data: { symbolId, reason: signatureInfo.reason, indexSignature: reportProvenance.indexSignature || null } };
      if (warn(warning)) entryWarnings.push(warning);
    }
    return {
      symbol: {
        symbolId: symbolId || 'unknown',
        chunkUid: symbol.chunkUid || null,
        file: symbol.file || null,
        name: symbol.name || null,
        kind: symbol.kind || null
      },
      signature: {
        declared: symbol.signature || null,
        tooling: null,
        parameters: signatureInfo
      },
      observedCalls: observedCalls.map((call) => ({
        arity: exactCallArity(call),
        arguments: structuredClone(resolveCallArguments(call)),
        args: Array.isArray(call.args) ? [...call.args] : null,
        callSiteId: call.callSiteId || null,
        file: call.file || null,
        startLine: Number.isFinite(call.startLine) ? call.startLine : null,
        start: Number.isFinite(call.start) ? call.start : null,
        end: Number.isFinite(call.end) ? call.end : null,
        startCol: Number.isFinite(call.startCol) ? call.startCol : null,
        endLine: Number.isFinite(call.endLine) ? call.endLine : null,
        endCol: Number.isFinite(call.endCol) ? call.endCol : null,
        confidence: Number.isFinite(call.confidence) ? call.confidence : null,
        callerChunkUid: call.callerChunkUid,
        calleeNormalized: call.calleeNormalized,
        targetChunkUid: call.targetChunkUid,
        semanticRef: call.semanticRef ? structuredClone(call.semanticRef) : null,
        join: call.join
      })),
      warnings: entryWarnings.length ? entryWarnings : null,
      truncation: entryTruncation.length ? entryTruncation : null
    };
  });
  joinedCalls.evidence.reportedCallCount = symbolEntries.reduce((sum, entry) => sum + entry.observedCalls.length, 0);
  joinedCalls.evidence.omittedQualifiedCallCount = joinedCalls.evidence.qualifiedCallCount - joinedCalls.evidence.reportedCallCount;

  const omittedWarnings = detectedWarnings - warnings.length;
  if (omittedWarnings > 0) {
    truncation.push({
      scope: 'apiContracts',
      cap: 'maxWarnings',
      limit: maxWarnings,
      observed: detectedWarnings,
      omitted: omittedWarnings
    });
  }

  const report = {
    version: API_CONTRACT_REPORT_VERSION,
    provenance: reportProvenance,
    options: {
      onlyExports,
      failOnWarn,
      caps: capsPayload
    },
    symbols: symbolEntries,
    callEvidence: joinedCalls.evidence,
    truncation: truncation.length ? truncation : null,
    warnings: warnings.length ? warnings : null
  };

  if (failOnWarn && detectedWarnings > 0) {
    const error = new Error('API contracts warnings detected.');
    error.code = 'ERR_API_CONTRACT_WARN';
    error.report = report;
    throw error;
  }

  return report;
};

/**
 * CLI entrypoint for API contracts report generation.
 *
 * @param {string[]} [rawArgs]
 * @returns {Promise<object>}
 */
export async function runApiContractsCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'api-contracts',
    argv: ['node', 'api-contracts', ...rawArgs],
    options: {
      repo: { type: 'string' },
      onlyExports: { type: 'boolean', default: false },
      failOnWarn: { type: 'boolean', default: false },
      format: { type: 'string' },
      json: { type: 'boolean', default: false },
      maxSymbols: { type: 'number' },
      maxCallsPerSymbol: { type: 'number' },
      maxCalls: { type: 'number' },
      maxWarnings: { type: 'number' },
      emitArtifact: { type: 'boolean', default: false },
      artifactDir: { type: 'string' }
    }
  });
  const argv = cli.parse();

  const repoRoot = getRepoRoot(argv.repo || null, process.cwd());
  const indexDir = resolveIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  if (!hasIndexMeta(indexDir)) {
    throw new Error(`Code index not found at ${indexDir}.`);
  }

  const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  const symbolJsonlPaths = resolveJsonlSources(indexDir, manifest, 'symbols');
  const symbols = symbolJsonlPaths
    ? await loadJsonlRowsIntoArray(symbolJsonlPaths)
    : await collectRows(loadJsonArrayArtifactRows(indexDir, 'symbols', { manifest, strict: true }));
  const callSitesByTarget = await loadCallSitesByTarget(indexDir, manifest);
  const callSites = callSitesByTarget
    ? []
    : await collectRows(loadJsonArrayArtifactRows(indexDir, 'call_sites', { manifest, strict: true }));

  const { key: indexCompatKey } = readCompatibilityKey(indexDir, {
    maxBytes: MAX_JSON_BYTES,
    strict: true
  });
  const indexSignature = await buildIndexSignature(indexDir);

  const caps = {
    maxSymbols: normalizeOptionalNumber(argv.maxSymbols),
    maxCallsPerSymbol: normalizeOptionalNumber(
      argv.maxCallsPerSymbol !== undefined ? argv.maxCallsPerSymbol : argv.maxCalls
    ),
    maxWarnings: normalizeOptionalNumber(argv.maxWarnings)
  };

  const format = String(argv.format || 'json').toLowerCase();
  return emitReportOutcome({ label: 'ApiContracts', validate: validateApiContracts, policyCodes: ['ERR_API_CONTRACT_WARN'],
    build: () => buildApiContractsReport({
      symbols,
      callSites,
      callSitesByTarget,
      onlyExports: argv.onlyExports === true,
      failOnWarn: argv.failOnWarn === true,
      caps,
      indexCompatKey: indexCompatKey || null,
      indexSignature: indexSignature || null,
      repo: toPosix(path.relative(process.cwd(), repoRoot) || '.'),
      indexDir: toPosix(path.relative(process.cwd(), indexDir) || '.')
    }),
    emit: report => {
      if (format === 'md' || format === 'markdown') console.log(renderApiContracts(report));
      else console.log(JSON.stringify(report, null, 2));
    },
    emitArtifact: argv.emitArtifact ? async report => {
      const targetDir = argv.artifactDir ? path.resolve(argv.artifactDir) : indexDir;
      await writeJsonLinesFile(path.join(targetDir, 'api_contracts.jsonl'), report.symbols, { atomic: true });
    } : null
  });
}

if (isDirectExecution(import.meta.url)) {
  runApiContractsCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(err?.code === 'ERR_API_CONTRACT_WARN' ? 2 : 1);
  });
}

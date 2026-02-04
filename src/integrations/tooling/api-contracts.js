import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../shared/cli.js';
import { toPosix } from '../../shared/files.js';
import { normalizeOptionalNumber } from '../../shared/limits.js';
import { resolveProvenance } from '../../shared/provenance.js';
import { validateApiContracts } from '../../contracts/validators/analysis.js';
import {
  MAX_JSON_BYTES,
  loadJsonArrayArtifact,
  loadPiecesManifest,
  readCompatibilityKey
} from '../../shared/artifact-io.js';
import { resolveManifestArtifactSources } from '../../shared/artifact-io/manifest.js';
import { readJsonlRows } from '../../index/build/artifacts/helpers.js';
import { buildIndexSignature } from '../../retrieval/index-cache.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import { renderApiContracts } from '../../retrieval/output/api-contracts.js';
import { loadUserConfig, resolveRepoRoot } from '../../../tools/shared/dict-utils.js';
import { writeJsonLinesFile } from '../../shared/json-stream.js';

const buildCapsPayload = ({ maxSymbols, maxCallsPerSymbol, maxWarnings }) => {
  const caps = {};
  if (Number.isFinite(maxSymbols)) caps.maxSymbols = maxSymbols;
  if (Number.isFinite(maxCallsPerSymbol)) caps.maxCallsPerSymbol = maxCallsPerSymbol;
  if (Number.isFinite(maxWarnings)) caps.maxWarnings = maxWarnings;
  return caps;
};

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

const loadCallSitesByTarget = async (indexDir, manifest) => {
  const jsonlPaths = resolveJsonlSources(indexDir, manifest, 'call_sites');
  if (!jsonlPaths) return null;
  const map = new Map();
  for (const target of jsonlPaths) {
    for await (const callSite of readJsonlRows(target)) {
      if (!callSite) continue;
      const keys = new Set();
      if (callSite.targetChunkUid) keys.add(callSite.targetChunkUid);
      if (callSite.calleeNormalized) keys.add(callSite.calleeNormalized);
      for (const key of keys) {
        if (!key) continue;
        const list = map.get(key) || [];
        list.push(callSite);
        map.set(key, list);
      }
    }
  }
  return map;
};


const isExportedSymbol = (symbol) => {
  const kind = String(symbol.kind || '').toLowerCase();
  const group = String(symbol.kindGroup || '').toLowerCase();
  if (kind.includes('export')) return true;
  if (group.includes('export')) return true;
  return false;
};

const signatureArityCache = new Map();

const parseSignatureArity = (signature) => {
  if (!signature || typeof signature !== 'string') return null;
  const text = String(signature);
  const start = text.indexOf('(');
  if (start === -1) return null;
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
      variadic: false
    };
  }

  const params = [];
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
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
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
      if (trimmed) params.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const final = current.trim();
  if (final) params.push(final);

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

  let requiredCount = 0;
  let optionalCount = 0;
  let variadic = false;

  for (const param of params) {
    const trimmed = param.trim();
    if (!trimmed) continue;
    if (trimmed === '*') continue;
    if (trimmed.startsWith('...') || trimmed.startsWith('*')) {
      variadic = true;
      continue;
    }
    const hasDefault = isTopLevelTokenMatch(trimmed, (ch) => ch === '=');
    const hasOptionalMark = isTopLevelTokenMatch(trimmed, (ch, idx, value) => {
      if (ch !== '?') return false;
      const rest = value.slice(idx + 1);
      return !rest || rest.startsWith(':') || rest.startsWith(' =') || rest.startsWith('=');
    });
    if (hasDefault || hasOptionalMark) {
      optionalCount += 1;
    } else {
      requiredCount += 1;
    }
  }

  const maxCount = variadic ? null : requiredCount + optionalCount;
  return {
    requiredCount,
    maxCount,
    variadic
  };
};

const resolveSignatureArity = (signature) => {
  if (!signature) return null;
  const key = String(signature);
  if (signatureArityCache.has(key)) return signatureArityCache.get(key);
  const parsed = parseSignatureArity(key);
  signatureArityCache.set(key, parsed);
  return parsed;
};

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
  now = () => new Date().toISOString()
} = {}) => {
  const maxSymbols = Number.isFinite(caps.maxSymbols) ? Math.max(0, Math.floor(caps.maxSymbols)) : null;
  const maxCallsPerSymbol = Number.isFinite(caps.maxCallsPerSymbol)
    ? Math.max(0, Math.floor(caps.maxCallsPerSymbol))
    : null;
  const maxWarnings = Number.isFinite(caps.maxWarnings) ? Math.max(0, Math.floor(caps.maxWarnings)) : null;
  const capsPayload = buildCapsPayload({ maxSymbols, maxCallsPerSymbol, maxWarnings });

  const truncation = [];
  const warnings = [];
  const warn = (warning) => {
    if (!warning?.code || !warning?.message) return;
    if (maxWarnings != null && warnings.length >= maxWarnings) return;
    warnings.push(warning);
  };

  const sortedSymbols = Array.isArray(symbols) ? [...symbols] : [];
  sortedSymbols.sort((a, b) => String(a.symbolId || '').localeCompare(String(b.symbolId || '')));

  let selected = sortedSymbols;
  if (onlyExports) {
    selected = selected.filter((symbol) => isExportedSymbol(symbol));
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

  const resolvedCallSitesByTarget = callSitesByTarget instanceof Map
    ? callSitesByTarget
    : new Map();
  if (!(callSitesByTarget instanceof Map)) {
    for (const callSite of Array.isArray(callSites) ? callSites : []) {
      if (!callSite) continue;
      const keys = new Set();
      if (callSite.targetChunkUid) keys.add(callSite.targetChunkUid);
      if (callSite.calleeNormalized) keys.add(callSite.calleeNormalized);
      for (const key of keys) {
        if (!key) continue;
        const list = resolvedCallSitesByTarget.get(key) || [];
        list.push(callSite);
        resolvedCallSitesByTarget.set(key, list);
      }
    }
  }
  const sortCallSites = (a, b) => {
    const fileCmp = String(a.file || '').localeCompare(String(b.file || ''));
    if (fileCmp) return fileCmp;
    const lineCmp = Number(a.startLine || 0) - Number(b.startLine || 0);
    if (lineCmp) return lineCmp;
    return String(a.callSiteId || '').localeCompare(String(b.callSiteId || ''));
  };
  for (const list of resolvedCallSitesByTarget.values()) {
    list.sort(sortCallSites);
  }

  const symbolEntries = selected.map((symbol) => {
    const symbolId = symbol.symbolId || symbol.id || null;
    const targetCandidates = [];
    if (symbol.chunkUid) targetCandidates.push(symbol.chunkUid);
    if (symbolId) targetCandidates.push(symbolId);
    if (symbol.name) targetCandidates.push(symbol.name);
    let rawCalls = [];
    for (const key of targetCandidates) {
      const list = resolvedCallSitesByTarget.get(key);
      if (list && list.length) {
        rawCalls = list;
        break;
      }
    }

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

    const signatureInfo = resolveSignatureArity(symbol.signature);
    const entryWarnings = [];
    if (signatureInfo) {
      const requiredCount = Number.isFinite(signatureInfo.requiredCount) ? signatureInfo.requiredCount : null;
      const maxCount = Number.isFinite(signatureInfo.maxCount) ? signatureInfo.maxCount : null;
      for (const call of observedCalls) {
        const arity = Array.isArray(call.args) ? call.args.length : null;
        const belowRequired = requiredCount != null && arity != null && arity < requiredCount;
        const aboveMax = maxCount != null && arity != null && arity > maxCount;
        if (arity != null && (belowRequired || aboveMax)) {
          let expected = '';
          if (requiredCount != null && maxCount != null) {
            expected = requiredCount === maxCount
              ? `Expected ${requiredCount}.`
              : `Expected ${requiredCount}-${maxCount}.`;
          } else if (requiredCount != null && maxCount == null && signatureInfo.variadic) {
            expected = `Expected ${requiredCount}+ (variadic).`;
          } else if (requiredCount != null) {
            expected = `Expected >= ${requiredCount}.`;
          }
          const warning = {
            code: 'ARITY_MISMATCH',
            message: `Observed arity ${arity} differs from signature arity. ${expected}`.trim(),
            data: { symbolId, callSiteId: call.callSiteId }
          };
          if (maxWarnings == null || warnings.length < maxWarnings) {
            entryWarnings.push(warning);
            warn(warning);
          }
        }
      }
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
        tooling: null
      },
      observedCalls: observedCalls.map((call) => ({
        arity: Array.isArray(call.args) ? call.args.length : null,
        args: Array.isArray(call.args) ? call.args : null,
        callSiteId: call.callSiteId || null,
        file: call.file || null,
        startLine: Number.isFinite(call.startLine) ? call.startLine : null,
        confidence: Number.isFinite(call.confidence) ? call.confidence : null
      })),
      warnings: entryWarnings.length ? entryWarnings : null,
      truncation: entryTruncation.length ? entryTruncation : null
    };
  });

  if (maxWarnings != null && warnings.length >= maxWarnings) {
    truncation.push({
      scope: 'apiContracts',
      cap: 'maxWarnings',
      limit: maxWarnings,
      observed: warnings.length,
      omitted: null
    });
  }

  const report = {
    version: '1.0.0',
    provenance: resolveProvenance({
      provenance,
      indexSignature,
      indexCompatKey,
      capsUsed: { apiContracts: capsPayload },
      repo,
      indexDir,
      now,
      label: 'ApiContracts'
    }),
    options: {
      onlyExports,
      failOnWarn,
      caps: capsPayload
    },
    symbols: symbolEntries,
    truncation: truncation.length ? truncation : null,
    warnings: warnings.length ? warnings : null
  };

  if (failOnWarn && warnings.length) {
    const error = new Error('API contracts warnings detected.');
    error.code = 'ERR_API_CONTRACT_WARN';
    error.report = report;
    throw error;
  }

  return report;
};

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

  const repoRoot = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
  const indexDir = resolveIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  if (!hasIndexMeta(indexDir)) {
    throw new Error(`Code index not found at ${indexDir}.`);
  }

  const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  const symbolJsonlPaths = resolveJsonlSources(indexDir, manifest, 'symbols');
  const symbols = symbolJsonlPaths
    ? await loadJsonlRowsIntoArray(symbolJsonlPaths)
    : await loadJsonArrayArtifact(indexDir, 'symbols', { manifest, strict: true });
  const callSitesByTarget = await loadCallSitesByTarget(indexDir, manifest);
  const callSites = callSitesByTarget
    ? []
    : await loadJsonArrayArtifact(indexDir, 'call_sites', { manifest, strict: true }).catch(() => []);

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

  const report = buildApiContractsReport({
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
  });

  const validation = validateApiContracts(report);
  if (!validation.ok) {
    throw new Error(`ApiContracts schema validation failed: ${validation.errors.join('; ')}`);
  }

  const format = String(argv.format || (argv.json ? 'json' : 'json')).toLowerCase();
  if (format === 'md' || format === 'markdown') {
    console.log(renderApiContracts(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (argv.emitArtifact) {
    const targetDir = argv.artifactDir ? path.resolve(argv.artifactDir) : indexDir;
    const outPath = path.join(targetDir, 'api_contracts.jsonl');
    await writeJsonLinesFile(outPath, report.symbols, { atomic: true });
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runApiContractsCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(err?.code === 'ERR_API_CONTRACT_WARN' ? 2 : 1);
  });
}

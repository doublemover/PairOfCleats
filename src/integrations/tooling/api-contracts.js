import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../shared/cli.js';
import { toPosix } from '../../shared/files.js';
import { validateApiContracts } from '../../contracts/validators/analysis.js';
import {
  MAX_JSON_BYTES,
  loadJsonArrayArtifact,
  loadPiecesManifest,
  readCompatibilityKey
} from '../../shared/artifact-io.js';
import { buildIndexSignature } from '../../retrieval/index-cache.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import { renderApiContracts } from '../../retrieval/output/api-contracts.js';
import { loadUserConfig, resolveRepoRoot } from '../../../tools/dict-utils.js';
import { writeJsonLinesFile } from '../../shared/json-stream.js';

const normalizeOptionalNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const resolveProvenance = ({
  provenance,
  indexSignature,
  indexCompatKey,
  capsUsed,
  repo,
  indexDir,
  now
}) => {
  const timestamp = typeof now === 'function' ? now() : new Date().toISOString();
  if (provenance && typeof provenance === 'object') {
    const merged = { ...provenance };
    if (!merged.generatedAt) merged.generatedAt = timestamp;
    if (!merged.capsUsed) merged.capsUsed = capsUsed || {};
    if (!merged.indexSignature && !merged.indexCompatKey) {
      throw new Error('Provenance must include indexSignature or indexCompatKey.');
    }
    return merged;
  }
  if (!indexSignature && !indexCompatKey) {
    throw new Error('ApiContracts requires indexSignature or indexCompatKey.');
  }
  const base = {
    generatedAt: timestamp,
    capsUsed: capsUsed || {}
  };
  if (indexSignature) base.indexSignature = indexSignature;
  if (indexCompatKey) base.indexCompatKey = indexCompatKey;
  if (repo) base.repo = repo;
  if (indexDir) base.indexDir = indexDir;
  return base;
};

const isExportedSymbol = (symbol) => {
  const kind = String(symbol.kind || '').toLowerCase();
  const group = String(symbol.kindGroup || '').toLowerCase();
  if (kind.includes('export')) return true;
  if (group.includes('export')) return true;
  return false;
};

const parseSignatureArity = (signature) => {
  if (!signature || typeof signature !== 'string') return null;
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw) return 0;
  const count = raw.split(',').map((part) => part.trim()).filter(Boolean).length;
  return count;
};

export const buildApiContractsReport = ({
  symbols = [],
  callSites = [],
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

  const callSitesByTarget = new Map();
  for (const callSite of Array.isArray(callSites) ? callSites : []) {
    if (!callSite) continue;
    const key = callSite.targetChunkUid || callSite.calleeNormalized || null;
    if (!key) continue;
    const list = callSitesByTarget.get(key) || [];
    list.push(callSite);
    callSitesByTarget.set(key, list);
  }

  const symbolEntries = selected.map((symbol) => {
    const symbolId = symbol.symbolId || symbol.id || null;
    const targetKey = symbol.chunkUid || symbolId || symbol.name || null;
    const rawCalls = targetKey ? (callSitesByTarget.get(targetKey) || []) : [];
    rawCalls.sort((a, b) => {
      const fileCmp = String(a.file || '').localeCompare(String(b.file || ''));
      if (fileCmp) return fileCmp;
      const lineCmp = Number(a.startLine || 0) - Number(b.startLine || 0);
      if (lineCmp) return lineCmp;
      return String(a.callSiteId || '').localeCompare(String(b.callSiteId || ''));
    });

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

    const signatureArity = parseSignatureArity(symbol.signature);
    const entryWarnings = [];
    if (signatureArity != null) {
      for (const call of observedCalls) {
        const arity = Array.isArray(call.args) ? call.args.length : null;
        if (arity != null && arity !== signatureArity) {
          const warning = {
            code: 'ARITY_MISMATCH',
            message: `Observed arity ${arity} differs from signature arity ${signatureArity}.`,
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
      capsUsed: { apiContracts: { maxSymbols, maxCallsPerSymbol, maxWarnings } },
      repo,
      indexDir,
      now
    }),
    options: {
      onlyExports,
      failOnWarn,
      caps: {
        maxSymbols,
        maxCallsPerSymbol,
        maxWarnings
      }
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
  const symbols = await loadJsonArrayArtifact(indexDir, 'symbols', { manifest, strict: true });
  const callSites = await loadJsonArrayArtifact(indexDir, 'call_sites', { manifest, strict: true }).catch(() => []);

  const { key: indexCompatKey } = readCompatibilityKey(indexDir, {
    maxBytes: MAX_JSON_BYTES,
    strict: true
  });
  const indexSignature = buildIndexSignature(indexDir);

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

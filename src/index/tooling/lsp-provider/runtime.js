import { collectLspTypes } from '../../../integrations/tooling/providers/lsp.js';
import { invalidateProbeCacheOnInitializeFailure } from '../command-resolver.js';
import { resolveLspRuntimeConfig } from '../lsp-runtime-config.js';
import {
  appendDiagnosticChecks,
  buildProviderFidelityContract,
  shouldCaptureDiagnosticsForRequestedKinds
} from '../provider-contract.js';
import { mergeLspWorkspacePartitionResults } from '../lsp-workspace-routing.js';
import { parseClikeSignature } from '../signature-parse/clike.js';
import { parseElixirSignature } from '../signature-parse/elixir.js';
import { parseGoSignature } from '../signature-parse/go.js';
import { parseHaskellSignature } from '../signature-parse/haskell.js';
import { parseLuaSignature } from '../signature-parse/lua.js';
import { parsePythonSignature } from '../signature-parse/python.js';
import { parseRubySignature } from '../signature-parse/ruby.js';
import { parseRustSignature } from '../signature-parse/rust.js';
import { parseSwiftSignature } from '../signature-parse/swift.js';
import { parseZigSignature } from '../signature-parse/zig.js';
import { resolveConfiguredWorkspaceRouting } from './workspace.js';

export const parseGenericSignature = (detail, languageId, symbolName) => {
  const lang = String(languageId || '').toLowerCase();
  if (lang === 'python' || lang === 'py' || lang === 'pyi') return parsePythonSignature(detail);
  if (lang === 'swift') return parseSwiftSignature(detail);
  if (lang === 'go') return parseGoSignature(detail);
  if (lang === 'haskell' || lang === 'hs') return parseHaskellSignature(detail);
  if (lang === 'rust') return parseRustSignature(detail);
  if (lang === 'elixir' || lang === 'ex' || lang === 'exs') return parseElixirSignature(detail);
  if (lang === 'lua') return parseLuaSignature(detail);
  if (lang === 'ruby' || lang === 'rb') return parseRubySignature(detail);
  if (lang === 'zig') return parseZigSignature(detail);
  if ([
    'c', 'cpp', 'objective-c', 'objective-cpp',
    'java', 'kotlin', 'csharp',
    'javascript', 'jsx', 'typescript', 'tsx',
    'php'
  ].includes(lang)) {
    return parseClikeSignature(detail, symbolName);
  }
  return parseClikeSignature(detail, symbolName)
    || parsePythonSignature(detail)
    || parseSwiftSignature(detail)
    || parseHaskellSignature(detail)
    || parseElixirSignature(detail)
    || parseRubySignature(detail);
};

const shouldSuppressRustProcMacroDiagnostic = (diag) => {
  if (!diag || typeof diag !== 'object') return false;
  const severity = Number(diag.severity);
  if (severity === 1) return false;
  const text = `${diag.message || ''} ${diag.code || ''}`.toLowerCase();
  return text.includes('proc-macro') || text.includes('procedural macro');
};

const applyRustProcMacroSuppression = (diagnosticsByChunkUid) => {
  if (!diagnosticsByChunkUid || typeof diagnosticsByChunkUid !== 'object') {
    return { diagnosticsByChunkUid: {}, diagnosticsCount: 0, suppressedCount: 0 };
  }
  const entries = diagnosticsByChunkUid instanceof Map
    ? Array.from(diagnosticsByChunkUid.entries())
    : Object.entries(diagnosticsByChunkUid);
  const next = {};
  let diagnosticsCount = 0;
  let suppressedCount = 0;
  for (const [chunkUid, diagnostics] of entries) {
    if (!Array.isArray(diagnostics) || !diagnostics.length) continue;
    const kept = [];
    for (const diag of diagnostics) {
      if (shouldSuppressRustProcMacroDiagnostic(diag)) {
        suppressedCount += 1;
        continue;
      }
      kept.push(diag);
    }
    if (!kept.length) continue;
    next[chunkUid] = kept;
    diagnosticsCount += kept.length;
  }
  return {
    diagnosticsByChunkUid: next,
    diagnosticsCount,
    suppressedCount
  };
};

const createRustAnalyzerWorkspaceStderrFilter = () => {
  const suppressedLines = new Map();
  let suppressedCount = 0;

  const classify = (line) => {
    const text = String(line || '').trim();
    if (!text) return null;
    const lower = text.toLowerCase();
    if (
      lower.includes('failed to find a workspace root')
      || lower.includes('fetchworkspaceerror')
      || lower.includes('cargo locate-project')
      || lower.includes('failed to load manifest')
      || lower.includes('cargo metadata')
    ) {
      return lower.includes('rustlib')
        || lower.includes('sysroot')
        || lower.includes('/library/')
        || lower.includes('\\library\\')
        ? 'toolchain_noise'
        : 'repo_invalidity';
    }
    return null;
  };

  return {
    filter: (line) => {
      const category = classify(line);
      if (!category) return line;
      const key = `${category}\0${String(line || '').trim()}`;
      suppressedCount += 1;
      const entry = suppressedLines.get(key) || {
        category,
        line: String(line || '').trim(),
        count: 0
      };
      entry.count += 1;
      suppressedLines.set(key, entry);
      return null;
    },
    flush: (log) => {
      if (!suppressedCount) return;
      const counts = {
        repo_invalidity: 0,
        toolchain_noise: 0
      };
      for (const entry of suppressedLines.values()) {
        counts[entry.category] += entry.count;
      }
      log(
        `[tooling] rust-analyzer suppressed ${suppressedCount} duplicate workspace stderr line(s); `
        + `repo-invalidity=${counts.repo_invalidity}, toolchain-noise=${counts.toolchain_noise}`
      );
    },
    toChecks: () => {
      if (!suppressedCount) return [];
      const counts = {
        repo_invalidity: 0,
        toolchain_noise: 0
      };
      for (const entry of suppressedLines.values()) {
        counts[entry.category] += entry.count;
      }
      const checks = [];
      if (counts.repo_invalidity > 0) {
        checks.push({
          name: 'rust_workspace_repo_invalidity',
          status: 'warn',
          message: `rust-analyzer suppressed ${counts.repo_invalidity} duplicate workspace-invalidity stderr line(s) after partition classification.`
        });
      }
      if (counts.toolchain_noise > 0) {
        checks.push({
          name: 'rust_workspace_toolchain_resolution_failed',
          status: 'warn',
          message: `rust-analyzer suppressed ${counts.toolchain_noise} duplicate toolchain or stdlib metadata stderr line(s).`
        });
      }
      return checks;
    }
  };
};

export const resolveRustRuntimeIssueClasses = ({
  providerId,
  preflightState = null,
  preflightReasonCode = null,
  checks = [],
  runtime = null,
  blockedWorkspaceKeys = [],
  blockedWorkspaceRoots = []
} = {}) => {
  const issueClasses = new Set(
    resolveGenericLspRuntimeIssueClasses({
      providerId,
      preflightState,
      preflightReasonCode,
      checks,
      runtime,
      blockedWorkspaceKeys,
      blockedWorkspaceRoots
    })
  );
  const reasonCode = String(preflightReasonCode || '').trim().toLowerCase();
  const normalizedProviderId = String(providerId || '').trim();
  const hasCheck = (name) => Array.isArray(checks) && checks.some((check) => check?.name === name);

  if (
    reasonCode === 'rust_workspace_toolchain_resolution_failed'
    || hasCheck('rust_workspace_toolchain_resolution_failed')
  ) {
    issueClasses.add('toolchain_resolution_failed');
  }
  if (
    reasonCode === 'rust_workspace_repo_invalidity'
    || hasCheck('rust_workspace_repo_invalidity')
    || hasCheck('rust_workspace_broken_manifest')
    || hasCheck('rust_workspace_invalid_root')
    || hasCheck('rust_workspace_tooling_only_root')
  ) {
    issueClasses.add('repo_workspace_invalidity');
  }
  if (
    reasonCode === 'rust_workspace_model_missing'
    || hasCheck('rust_workspace_model_missing')
  ) {
    issueClasses.add('workspace_model_missing');
  }
  if (
    reasonCode === 'rust_workspace_probe_runtime_problem'
    || hasCheck('rust_workspace_probe_runtime_problem')
  ) {
    issueClasses.add('workspace_probe_runtime_problem');
  }
  if (
    reasonCode === 'rust_workspace_partial_repo_coverage'
    || hasCheck('rust_workspace_partial_repo_coverage')
    || hasCheck(`${normalizedProviderId}_workspace_partition_partial_success`)
  ) {
    issueClasses.add('partial_workspace_coverage');
  }
  if (
    (Array.isArray(blockedWorkspaceKeys) && blockedWorkspaceKeys.length > 0)
    || (Array.isArray(blockedWorkspaceRoots) && blockedWorkspaceRoots.length > 0)
    || hasCheck(`${normalizedProviderId}_workspace_partition_blocked`)
    || hasCheck('rust_workspace_blocked_all_partitions')
  ) {
    issueClasses.add('blocked_workspace_partitions');
  }
  if (hasCheck('rust_workspace_manifest_only_preflight')) {
    issueClasses.add('manifest_only_preflight');
  }
  if (String(preflightState || '').trim().toLowerCase() === 'blocked' && issueClasses.size <= 0) {
    issueClasses.add('workspace_blocked');
  }
  return Array.from(issueClasses).sort((left, right) => left.localeCompare(right));
};

export const isRustWorkspaceProvider = ({ server, providerId }) => {
  const id = String(server?.id || providerId || '').trim().toLowerCase();
  const preset = String(server?.preset || '').trim().toLowerCase();
  const languages = Array.isArray(server?.languages)
    ? server.languages.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
  return id === 'rust-analyzer' || preset === 'rust-analyzer' || languages.includes('rust');
};

const RUNTIME_ISSUE_BY_METHOD = Object.freeze({
  'textDocument/documentSymbol': 'document_symbol_timeout',
  'textDocument/hover': 'hover_timeout',
  'textDocument/signatureHelp': 'signature_help_timeout',
  'textDocument/definition': 'definition_timeout',
  'textDocument/typeDefinition': 'type_definition_timeout',
  'textDocument/references': 'references_timeout',
  'textDocument/semanticTokens/full': 'semantic_tokens_timeout',
  'textDocument/inlayHint': 'inlay_hints_timeout'
});

export const resolveGenericLspRuntimeIssueClasses = ({
  providerId,
  preflightState = null,
  preflightReasonCode = null,
  checks = [],
  runtime = null,
  blockedWorkspaceKeys = [],
  blockedWorkspaceRoots = []
} = {}) => {
  const issueClasses = new Set();
  const normalizedProviderId = String(providerId || '').trim();
  const reasonCode = String(preflightReasonCode || '').trim().toLowerCase();
  const state = String(preflightState || '').trim().toLowerCase();
  const hasCheck = (name) => Array.isArray(checks) && checks.some((check) => check?.name === name);

  if (
    reasonCode.includes('workspace_model_missing')
    || hasCheck(`${normalizedProviderId}_workspace_model_missing`)
  ) {
    issueClasses.add('workspace_model_missing');
  }
  if (
    reasonCode.includes('partial_repo_coverage')
    || hasCheck(`${normalizedProviderId}_workspace_partition_partial_success`)
  ) {
    issueClasses.add('partial_workspace_coverage');
  }
  if (
    (Array.isArray(blockedWorkspaceKeys) && blockedWorkspaceKeys.length > 0)
    || (Array.isArray(blockedWorkspaceRoots) && blockedWorkspaceRoots.length > 0)
    || hasCheck(`${normalizedProviderId}_workspace_partition_blocked`)
    || reasonCode.includes('blocked_all_partitions')
  ) {
    issueClasses.add('blocked_workspace_partitions');
  }
  if (hasCheck('lsp_command_unavailable') || hasCheck(`${normalizedProviderId}_command_unavailable`)) {
    issueClasses.add('command_unavailable');
  }
  const requestsByMethod = runtime?.requests?.byMethod && typeof runtime.requests.byMethod === 'object'
    ? runtime.requests.byMethod
    : {};
  for (const [method, issueClass] of Object.entries(RUNTIME_ISSUE_BY_METHOD)) {
    if (Number(requestsByMethod?.[method]?.timedOut || 0) > 0) {
      issueClasses.add(issueClass);
    }
  }
  if (Number(runtime?.guard?.tripCount || 0) > 0) {
    issueClasses.add('circuit_breaker_tripped');
  }
  if (state === 'blocked' && issueClasses.size <= 0) {
    issueClasses.add('workspace_blocked');
  }
  return Array.from(issueClasses).sort((left, right) => left.localeCompare(right));
};

export const resolveConfiguredLspRuntimeIssueClasses = ({
  server,
  providerId,
  preflightState = null,
  preflightReasonCode = null,
  checks = [],
  runtime = null,
  blockedWorkspaceKeys = [],
  blockedWorkspaceRoots = []
} = {}) => (
  isRustWorkspaceProvider({ server, providerId })
    ? resolveRustRuntimeIssueClasses({
      providerId,
      preflightState,
      preflightReasonCode,
      checks,
      runtime,
      blockedWorkspaceKeys,
      blockedWorkspaceRoots
    })
    : resolveGenericLspRuntimeIssueClasses({
      providerId,
      preflightState,
      preflightReasonCode,
      checks,
      runtime,
      blockedWorkspaceKeys,
      blockedWorkspaceRoots
    })
);

export const collectConfiguredOutput = async ({
  server,
  providerId,
  ctx,
  provider,
  docs,
  targets,
  requestedKinds = null,
  log,
  preChecks,
  commandProfile,
  requestedCommand,
  preflightState = 'ready',
  preflightReasonCode = null,
  blockedWorkspaceKeys = [],
  blockedWorkspaceRoots = []
}) => {
  const resolvedCmd = String(commandProfile?.resolved?.cmd || requestedCommand?.cmd || '').trim();
  const resolvedArgs = Array.isArray(commandProfile?.resolved?.args)
    ? commandProfile.resolved.args
    : (Array.isArray(requestedCommand?.args) ? requestedCommand.args : []);
  const runtimeConfig = resolveLspRuntimeConfig({
    providerConfig: server,
    globalConfigs: [ctx?.toolingConfig?.lsp || null, ctx?.toolingConfig || null],
    defaults: {
      timeoutMs: 60000,
      retries: 2,
      breakerThreshold: 3
    }
  });
  const workspaceRouting = resolveConfiguredWorkspaceRouting({
    ctx,
    providerId,
    server,
    docs,
    targets,
    log
  });
  const blockedKeySet = new Set(
    Array.isArray(blockedWorkspaceKeys)
      ? blockedWorkspaceKeys.map((entry) => String(entry || '').trim()).filter(Boolean)
      : []
  );
  const blockedRootSet = new Set(
    Array.isArray(blockedWorkspaceRoots)
      ? blockedWorkspaceRoots.map((entry) => String(entry || '').trim()).filter(Boolean)
      : []
  );
  const skippedBlockedPartitions = [];
  const partitionResults = [];
  for (const partition of workspaceRouting.partitions) {
    if (blockedKeySet.has(String(partition.workspaceKey || '').trim()) || blockedRootSet.has(String(partition.rootRel || '').trim())) {
      skippedBlockedPartitions.push(partition);
      continue;
    }
    const rustWorkspaceStderr = String(server?.id || '').trim().toLowerCase() === 'rust-analyzer'
      ? createRustAnalyzerWorkspaceStderrFilter()
      : null;
    let partitionResult;
    try {
      partitionResult = await collectLspTypes({
        ...runtimeConfig,
        rootDir: ctx.repoRoot,
        workspaceRootDir: partition.rootDir,
        workspaceKey: partition.workspaceKey,
        documents: partition.documents,
        targets: partition.targets,
        abortSignal: ctx?.abortSignal || null,
        log,
        providerId,
        cmd: resolvedCmd,
        args: resolvedArgs,
        parseSignature: parseGenericSignature,
        strict: ctx?.strict !== false,
        vfsRoot: ctx?.buildRoot || ctx.repoRoot,
        uriScheme: server.uriScheme || 'file',
        vfsTokenMode: ctx?.toolingConfig?.vfs?.tokenMode,
        vfsIoBatching: ctx?.toolingConfig?.vfs?.ioBatching,
        vfsColdStartCache: ctx?.toolingConfig?.vfs?.coldStartCache,
        indexDir: ctx?.buildRoot || null,
        cacheRoot: ctx?.cache?.dir || null,
        documentSymbolConcurrency: server.documentSymbolConcurrency,
        hoverConcurrency: server.hoverConcurrency,
        requestCacheMaxEntries: server.requestCacheMaxEntries,
        providerVersion: server.version,
        adaptiveDocScope: server.adaptiveDocScope,
        adaptiveDegradedHint: preflightState === 'degraded' || workspaceRouting.state === 'degraded',
        adaptiveReasonHint: workspaceRouting.reasonCode || preflightReasonCode,
        ...(Array.isArray(server.hoverSymbolKinds) && server.hoverSymbolKinds.length
          ? { hoverSymbolKinds: server.hoverSymbolKinds }
          : {}),
        ...(rustWorkspaceStderr ? { stderrFilter: rustWorkspaceStderr.filter } : {}),
        initializationOptions: server.initializationOptions,
        captureDiagnostics: shouldCaptureDiagnosticsForRequestedKinds(requestedKinds)
      });
    } finally {
      if (rustWorkspaceStderr) {
        rustWorkspaceStderr.flush(log);
        preChecks.push(...rustWorkspaceStderr.toChecks());
      }
    }
    partitionResults.push(partitionResult);
  }
  const result = mergeLspWorkspacePartitionResults(partitionResults, workspaceRouting.workspaceModel);
  let diagnosticsByChunkUid = result.diagnosticsByChunkUid;
  let diagnosticsCount = result.diagnosticsCount;
  const resultChecks = [
    ...workspaceRouting.checks,
    ...(Array.isArray(result.checks) ? result.checks.slice() : [])
  ];
  if (skippedBlockedPartitions.length > 0) {
    const sample = skippedBlockedPartitions
      .map((entry) => String(entry?.rootRel || '.'))
      .filter(Boolean)
      .slice(0, 4)
      .join(', ');
    const suffix = skippedBlockedPartitions.length > 4 ? ` (+${skippedBlockedPartitions.length - 4} more)` : '';
    resultChecks.push({
      name: `${providerId}_workspace_partition_blocked`,
      status: 'warn',
      message: `${providerId} skipped ${skippedBlockedPartitions.length} blocked workspace partition(s) (${sample}${suffix}).`
    });
    if (partitionResults.length > 0) {
      resultChecks.push({
        name: `${providerId}_workspace_partition_partial_success`,
        status: 'info',
        message: `${providerId} continued with ${partitionResults.length} ready workspace partition(s) while ${skippedBlockedPartitions.length} blocked partition(s) remained excluded.`
      });
    }
  }
  invalidateProbeCacheOnInitializeFailure({
    checks: resultChecks,
    providerId: server.id || providerId,
    command: resolvedCmd,
    args: resolvedArgs,
    toolingConfig: ctx?.toolingConfig || null
  });
  if (server.rustSuppressProcMacroDiagnostics) {
    const suppression = applyRustProcMacroSuppression(diagnosticsByChunkUid);
    diagnosticsByChunkUid = suppression.diagnosticsByChunkUid;
    diagnosticsCount = suppression.diagnosticsCount;
    if (suppression.suppressedCount > 0) {
      resultChecks.push({
        name: 'tooling_rust_proc_macro_diagnostics_suppressed',
        status: 'info',
        message: `suppressed ${suppression.suppressedCount} non-fatal rust proc-macro diagnostic(s).`,
        count: suppression.suppressedCount
      });
    }
  }
  const diagnostics = appendDiagnosticChecks(
    {
      ...(diagnosticsCount
        ? { diagnosticsCount, diagnosticsByChunkUid }
        : {}),
      workspaceModel: workspaceRouting.workspaceModel,
      fidelity: buildProviderFidelityContract({
        providerId,
        preflightState,
        reasonCode: preflightReasonCode,
        preflightDetails: {
          state: preflightState
        },
        runtime: result.runtime,
        checks: [...preChecks, ...resultChecks],
        captureDiagnostics: shouldCaptureDiagnosticsForRequestedKinds(requestedKinds),
        blockedWorkspaceKeys,
        blockedWorkspaceRoots,
        runtimeIssueClasses: resolveConfiguredLspRuntimeIssueClasses({
          server,
          providerId,
          preflightState,
          preflightReasonCode,
          checks: [...preChecks, ...resultChecks],
          runtime: result.runtime,
          blockedWorkspaceKeys,
          blockedWorkspaceRoots
        }),
        byChunkUid: result.byChunkUid,
        workspaceKey: workspaceRouting.workspaceModel?.workspaceKey || null
      })
    },
    [...preChecks, ...resultChecks]
  );
  return {
    provider: { id: providerId, version: provider.version, configHash: provider.getConfigHash(ctx) },
    byChunkUid: result.byChunkUid,
    diagnostics: result.runtime
      ? { ...(diagnostics || {}), runtime: result.runtime }
      : diagnostics
  };
};

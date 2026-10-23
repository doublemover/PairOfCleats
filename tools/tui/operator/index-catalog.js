import { listCommandRegistry } from '../../../src/shared/command-registry-query.js';
import { INDEX_BUILD_OPTIONS, SERVICE_API_OPTIONS, SERVICE_INDEXER_OPTIONS, TOOLING_DETECT_OPTIONS, TOOLING_INSTALL_OPTIONS,
  CONTEXT_PACK_OPTIONS, COMPARE_MODELS_OPTIONS } from '../../../src/shared/cli-option-sets.js';
import { TOOLING_DOCTOR_OPTIONS, SETUP_OPTIONS, BOOTSTRAP_OPTIONS, CACHE_MAINTENANCE_OPTIONS,
  SQLITE_COMPACT_OPTIONS, LMDB_BUILD_OPTIONS, ARCHITECTURE_CHECK_OPTIONS, SUGGEST_TESTS_OPTIONS,
  MAP_REPORT_OPTIONS, EVAL_OPTIONS, SEMANTIC_DETAIL_OPTIONS, SEMANTIC_TRACE_OPTIONS,
  SEMANTIC_FIND_OPTIONS, SEMANTIC_EXPLAIN_OPTIONS, RUNTIME_EVIDENCE_OPTIONS,
  RISK_EXPLAIN_OPTIONS, RISK_DELTA_OPTIONS, createMicrobenchOptions } from '../../shared/operator-cli-options.js';
import { buildGraphCliOptions } from '../../../src/integrations/tooling/cli-helpers.js';
import { getIndexDir, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { PRIMARY_INDEX_MODES } from '../../../src/integrations/core/build-index/stages/modes.js';
import { SNAPSHOT_ID_SCHEMA } from '../../../src/contracts/schemas/artifacts/snapshots-diffs.js';
import { STORAGE_OPTIONS } from '../../storage/options.js';
import { INDEX_VALIDATE_OPTIONS, INDEX_REPORT_OPTIONS, INDEX_STATS_OPTIONS,
  SNAPSHOT_COMMANDS, WORKSPACE_BUILD_OPTIONS } from '../../../src/shared/index-tool-options.js';

const OWNED_FIELDS = new Set(['repo', 'workspace', 'root', 'json', 'progress', 'watch', 'config-dump', 'debug-crash', 'no-scm-annotate',
  'auth-token', 'allow-unauthenticated', 'cors-allow-any', 'allowed-repo-roots', 'cache-root', 'allow-unmarked-cache', 'non-interactive']);
const REQUEST_COMMANDS = new Set(['semantic.detail', 'semantic.trace', 'semantic.find', 'semantic.explain',
  'runtime.lookup', 'runtime.families', 'runtime.compare', 'runtime.claims']);
const TEXT_COMMANDS = new Set(['sqlite.compact', 'lmdb.build']);
// These CLI owners validate presence after parsing rather than demandOption.
// Native forms require the same inputs before offering a launch token.
const REQUIRED_INPUTS = {
  'graph-context': ['seed', 'depth', 'direction'], impact: ['depth', 'direction'],
  'context-pack': ['seed'], 'architecture-check': ['rules'], 'suggest-tests': ['max'],
  'risk.explain': ['chunk'], 'risk.delta': ['from', 'to', 'seed'], 'report.eval': ['dataset']
};
const optionSchema = spec => ({ type: spec.type,
  ...(spec.choices ? { enum: spec.choices } : {}),
  ...(spec.type === 'string' ? { maxLength: 4096, pattern: '^[^\\u0000]*$' } : {}),
  ...(spec.type === 'array' ? { maxItems: 32, items: { type: 'string', maxLength: 256, pattern: '^[^\\u0000]*$' } } : {}) });
const form = (entry, options, suffix = '', positional = {}) => {
  const managed = key => (OWNED_FIELDS.has(key) && !(entry.id === 'service.indexer' && key === 'watch'))
    || (REQUEST_COMMANDS.has(entry.id) && ['all', 'operation'].includes(key))
    || (entry.id === 'service.api' && ['host', 'allowed-hosts', 'cors-allowed-origins'].includes(key))
    || (entry.id === 'report.map' && ['serve', 'input', 'port', 'no-open', 'tls-key', 'tls-cert', 'graph-capability'].includes(key))
    || (['sqlite.compact', 'lmdb.build'].includes(entry.id) && key === 'index-root')
    || (entry.id === 'risk.explain' && key === 'index')
    || (entry.id === 'bench.micro' && ['build', 'clean', 'repo-current'].includes(key));
  const fields = [...Object.entries(positional), ...Object.entries(options).filter(([key]) => !managed(key))]
    .map(([name, spec]) => ({ name, schema: { ...optionSchema(spec),
      ...(name === 'mode' && ['index.build', 'index.watch', 'workspace.build'].includes(entry.id)
        ? { enum: ['all', 'both', ...PRIMARY_INDEX_MODES] } : {}),
      ...(entry.id === 'index.snapshot' && ['id', 'snapshotId'].includes(name)
        ? { pattern: SNAPSHOT_ID_SCHEMA.pattern, minLength: 1 } : {}),
      ...(entry.id === 'service.api' && name === 'port' ? { pattern: '^[0-9]{1,5}$' } : {}),
      ...(entry.id === 'bench.micro' && ['runs', 'warmup'].includes(name) ? { minimum: 0, maximum: 10 } : {}),
      ...(entry.id.startsWith('storage.') && name === 'max-entries' ? { type: 'integer', minimum: 1, maximum: 10000 } : {}),
      ...(entry.id.startsWith('storage.') && name === 'max-duration-ms' ? { type: 'integer', minimum: 1, maximum: 5000 } : {}),
      ...(entry.id === 'service.indexer' && name === 'command' ? { enum: ['status', 'work'] } : {}),
      ...(entry.id === 'service.indexer' && name === 'concurrency' ? { type: 'integer', minimum: 1, maximum: 4 } : {}),
      ...(entry.id === 'service.indexer' && name === 'interval' ? { type: 'integer', minimum: 100, maximum: 5000 } : {}),
      ...(['sqlite.compact', 'lmdb.build'].includes(entry.id) && name === 'mode' ? { enum: ['all', 'code', 'prose'] } : {}),
      ...(entry.id === 'bench.micro' && name === 'components' ? { enum: ['sparse', 'dense', 'hybrid', 'sparse,dense,hybrid'] } : {}) },
    description: entry.id === 'report.map' && name === 'index-root'
      ? 'Exact retained build root. Native confirmation validates its independent graph capability and preserves the original build outcome.'
      : spec.describe || spec.description || '', ...(spec.default !== undefined ? { default: spec.default } : {}),
    ...(entry.id.startsWith('storage.') && name === 'max-entries' ? { default: 10000 } : {}),
    ...(entry.id.startsWith('storage.') && name === 'max-duration-ms' ? { default: 5000 } : {}),
    ...(entry.id === 'service.indexer' && name === 'command' ? { default: 'status' } : {}),
    positional: Object.hasOwn(positional, name), required: spec.demandOption === true
      || entry.id === 'service.indexer' && name === 'config' || REQUIRED_INPUTS[entry.id]?.includes(name) === true }));
  return { id: entry.id + (suffix ? `.${suffix}` : ''), registryId: entry.id,
    commandPath: [...entry.commandPath, ...(suffix ? [suffix] : [])],
    description: suffix ? SNAPSHOT_COMMANDS[suffix].description : entry.description,
    supportTier: entry.supportTier, scopeKind: ['workspace.build', 'service.indexer'].includes(entry.id) ? 'workspace' : 'repo',
    capture: TEXT_COMMANDS.has(entry.id) ? 'text' : 'json',
    requestFile: REQUEST_COMMANDS.has(entry.id),
    managedFields: Object.keys(options).filter(managed).map(name => ({ name,
      reason: name === 'no-scm-annotate' ? 'Use scm-annotate=false; this is the negated CLI spelling.'
        : ['repo', 'workspace'].includes(name) ? 'Bound to the selected scope.'
          : ['config-dump', 'debug-crash'].includes(name) ? 'CLI-only diagnostic; this form launches an operational job.'
            : 'Owned by the canonical workflow and supervisor capture policy.' })),
    expectedArtifacts: entry.expectedArtifacts, fields,
    schema: { type: 'object', additionalProperties: false,
      properties: Object.fromEntries(fields.map(field => [field.name, field.schema])),
      required: fields.filter(field => field.required).map(field => field.name) } };
};

const OPTIONS = {
  setup: SETUP_OPTIONS, bootstrap: BOOTSTRAP_OPTIONS,
  'tooling.doctor': TOOLING_DOCTOR_OPTIONS, 'tooling.detect': TOOLING_DETECT_OPTIONS, 'tooling.install': TOOLING_INSTALL_OPTIONS,
  'service.api': SERVICE_API_OPTIONS, 'service.mcp': {}, 'cache.gc': CACHE_MAINTENANCE_OPTIONS,
  'service.indexer': Object.fromEntries(['config', 'command', 'watch', 'interval', 'concurrency'].map(key => [key, SERVICE_INDEXER_OPTIONS[key]])),
  ...Object.fromEntries(['list', 'explain', 'doctor', 'cleanup-plan', 'cleanup-apply'].map(name => [`storage.${name}`,
    Object.fromEntries(['max-entries', 'max-duration-ms'].map(key => [key, STORAGE_OPTIONS[key]]))])),
  'storage.inspect': Object.fromEntries(['exact', 'max-entries', 'max-duration-ms'].map(key => [key, STORAGE_OPTIONS[key]])),
  'sqlite.compact': SQLITE_COMPACT_OPTIONS, 'lmdb.build': LMDB_BUILD_OPTIONS,
  'context-pack': CONTEXT_PACK_OPTIONS,
  'graph-context': buildGraphCliOptions({ seed: { type: 'string' }, includePaths: { type: 'boolean', default: false } }),
  impact: buildGraphCliOptions({ seed: { type: 'string' }, changed: { type: 'array' }, changedFile: { type: 'string' } }),
  'architecture-check': ARCHITECTURE_CHECK_OPTIONS, 'suggest-tests': SUGGEST_TESTS_OPTIONS,
  'report.map': MAP_REPORT_OPTIONS, 'report.eval': EVAL_OPTIONS, 'report.compare-models': COMPARE_MODELS_OPTIONS,
  'risk.explain': RISK_EXPLAIN_OPTIONS, 'risk.delta': RISK_DELTA_OPTIONS, 'bench.micro': createMicrobenchOptions(),
  'semantic.detail': SEMANTIC_DETAIL_OPTIONS, 'semantic.trace': SEMANTIC_TRACE_OPTIONS,
  'semantic.find': SEMANTIC_FIND_OPTIONS, 'semantic.explain': SEMANTIC_EXPLAIN_OPTIONS,
  ...Object.fromEntries(['lookup', 'families', 'compare', 'claims'].map(name => [`runtime.${name}`, RUNTIME_EVIDENCE_OPTIONS]))
};

// Deliberate dispositions, not a catch-all. A new public registry command must
// receive an adapter or a reviewed concrete reason before catalog admission.
const UNSUPPORTED = {
  'graph-evidence': 'Retained graph evidence needs an exact pinned-build/family request review and native cursor owner; use the canonical graph-evidence request-file CLI. No native action/capture or graph coverage is implied.',
  'workspace.init': 'Workspace authoring needs a native membership/create-file preview; use the canonical workspace init CLI.',
  'workspace.add': 'Workspace membership changes need a native exact-membership/file revision preview; use the canonical workspace add CLI.',
  'workspace.validate': 'Workspace authoring validation is available through the canonical workspace validate CLI; this native status action observes index publication instead.',
  'tooling.lifecycle': 'Provider lifecycle verification/mutation blockers are owned by the canonical tooling lifecycle CLI; native lifecycle plan and consent adapters are not implemented.',
  'checkout.diagnose': 'Source-checkout diagnosis and opt-in prerequisite probes belong to the canonical onboarding CLI; this native session already requires a prepared installation.',
  'storage.configure-plan': 'Storage configuration planning has no native exact-root/configuration revision preview; use canonical storage configure-plan.',
  'storage.configure-apply': 'Storage configuration application needs a native retained exact-root/configuration revision plan and explicit selection receipt; use canonical storage configure-apply.',
  'storage.policy-plan': 'Machine-local probe policy needs a native immutable policy/selected-home review; use canonical storage policy-plan.',
  'storage.policy-apply': 'Machine-local probe policy application needs an exact reviewed policy identity and selection preview; use canonical storage policy-apply.',
  'storage.migration-plan': 'Storage migration planning requires native source/destination ownership and impact presentation; use canonical storage migration-plan.',
  'storage.migration-apply': 'Storage migration application needs a native retained exact source/destination plan, lease authority and pending-state recovery view; use canonical storage migration-apply.',
  'storage.migration-rollback': 'Storage migration rollback needs a native exact retained migration identity, recovery journal and source/destination ownership review; use canonical storage migration-rollback.',
  'storage.migration-status': 'Storage migration status has no native plan identity/lease adapter; use canonical storage migration-status. Native migration application remains unavailable.',
  'sqlite.compact': 'This catalog owner has no enabled native reader-drain and authenticated canonical-child bridge. SQLite maintenance requires that code-owned integration; ordinary parent exclusion is not child authority.',
  'lmdb.build': 'This catalog owner has no enabled native reader-drain and authenticated canonical-child bridge. LMDB maintenance requires that code-owned integration; ordinary parent exclusion is not child authority.',
  'cli.completions': 'Shell completion output belongs in the target shell; use the canonical CLI.',
  'cli.audit': 'Developer command-surface checks are outside native operator workflows.',
  'config.dump': 'Use Settings provenance and effective configuration.',
  'config.validate': 'Use Settings inspection, which validates the selected document.',
  'config.reset': 'Use the Settings reset preview and explicit RESET confirmation.',
  'index.diff': 'Diff requests need a typed pair of pinned generations; adapter is not implemented.',
  search: 'Use Repository Search (R), including continuation, source and diagnostics.',
  'history.local': 'Private archive read authority and its picker are not implemented natively.',
  'history.help': 'Private archive discovery is available from the canonical CLI only.',
  'workspace.manifest': 'Workspace manifest creation needs a membership/file-write preview; not implemented.',
  'workspace.status': 'Use the workspace scope status action for published index observations.',
  'workspace.catalog': 'Workspace catalog mutation/selection adapter is not implemented.',
  'ingest.ctags': 'External ingest input/provenance picker and overwrite preview are not implemented.',
  'ingest.gtags': 'External ingest input/provenance picker and overwrite preview are not implemented.',
  'ingest.lsif': 'External ingest input/provenance picker and overwrite preview are not implemented.',
  'ingest.scip': 'External ingest input/provenance picker and overwrite preview are not implemented.',
  'ingest.runtime-evidence': 'Runtime ingest requires explicit capture authority and a typed artifact inventory; not implemented natively.',
  'tui.supervisor': 'The current session already owns its supervisor; nested supervisor launch is unsupported.',
  'tui.build': 'Build/install the native host from the source-checkout onboarding recipe before launch.',
  'tui.install': 'Replacing the running native host is unsupported; use the source-checkout onboarding recipe.',
  'dispatch.list': 'This command catalog is the native discoverability surface; CLI dispatch details remain CLI-only.',
  'dispatch.describe': 'Use the typed command form and its canonical argv preview.',
  'tooling.navigate': 'Indexed navigation request adapter is not implemented; use canonical CLI or Repository Search source.',
  'tooling.uninstall': 'Uninstall can remove shared caches across repositories; native multi-root destructive authority is not implemented.',
  'cache.clear': 'Canonical clear-cache now uses reviewed category cleanup. Use native storage.cleanup-plan/storage.cleanup-apply; a separate legacy cache-root/all/force compatibility form is not admitted.',
  'report.throughput': 'Completed benchmark file selection adapter is not implemented.',
  'report.summary': 'Combined report input and output-file preview adapter is not implemented.',
  'report.parity': 'Broad parity evaluation requires an explicit backend/corpus qualification plan; not implemented natively.',
  'report.metrics': 'Metrics artifact selection/open adapter is not implemented.',
  'api-contracts': 'API-contract artifact and generation selection adapter is not implemented.',
  'semantic.enrichment': 'Enqueue/drain mutates the shared enrichment scheduler; native task consent adapter is not implemented.',
  'bench.language': 'Corpus provisioning and broad indexing need an explicit benchmark plan; native adapter is not implemented.',
  'bench.matrix': 'Backend matrix qualification needs an explicit benchmark plan; native adapter is not implemented.',
  'bench.summarize': 'Benchmark corpus/result selection adapter is not implemented.'
};

/** Registry identity/support tiers and the CLI's own option definitions own this catalog. */
export const describeIndexWorkflows = ({ includeExperimental = false, backendDelegationEnabled = false } = {}) => listCommandRegistry({
  supportTiers: ['stable', 'operator', ...(includeExperimental ? ['experimental'] : [])] }).flatMap(entry => {
  if (entry.id === 'index.snapshot') return Object.entries(SNAPSHOT_COMMANDS)
    .map(([name, spec]) => form(entry, spec.options, name, spec.positional));
  const options = { 'index.build': INDEX_BUILD_OPTIONS, 'index.watch': INDEX_BUILD_OPTIONS,
    'index.validate': INDEX_VALIDATE_OPTIONS, 'index.report': INDEX_REPORT_OPTIONS,
    'index.stats': INDEX_STATS_OPTIONS,
    'workspace.build': { ...INDEX_BUILD_OPTIONS, ...WORKSPACE_BUILD_OPTIONS }, ...OPTIONS }[entry.id];
  if (options) return [{ ...form(entry, options),
    ...(['sqlite.compact', 'lmdb.build'].includes(entry.id) && !backendDelegationEnabled ? { unsupportedReason: UNSUPPORTED[entry.id] } : {}) }];
  if (!UNSUPPORTED[entry.id]) throw Object.assign(new Error(`Native command disposition missing: ${entry.id}`), { code: 'ERR_TUI_COMMAND_COVERAGE' });
  return [{ id: entry.id, registryId: entry.id, commandPath: entry.commandPath, supportTier: entry.supportTier,
    scopeKind: 'repo', description: entry.description, unsupportedReason: UNSUPPORTED[entry.id], fields: [] }];
});

export const describeWorkflowCoverage = ({ backendDelegationEnabled = false } = {}) => describeIndexWorkflows({ includeExperimental: true, backendDelegationEnabled })
  .map(command => ({ id: command.id, registryId: command.registryId, supportTier: command.supportTier,
    disposition: command.unsupportedReason ? 'unsupported' : 'typed-adapter', reason: command.unsupportedReason || null }));

export const buildIndexWorkflowArgv = (command, values, scope, { env = process.env } = {}) => {
  const argv = [...command.commandPath];
  for (const field of command.fields.filter(field => field.positional)) {
    const value = values[field.name];
    if (typeof value !== 'string' || !field.schema.pattern || !new RegExp(field.schema.pattern).test(value)) {
      throw new TypeError(`Invalid positional ${field.name}.`);
    }
    // Snapshot identities have the canonical snap- prefix. yargs command
    // positionals must precede options; values after -- are not command args.
    argv.push(value);
  }
  for (const field of command.fields.filter(field => !field.positional)) {
    if (!Object.hasOwn(values, field.name)) continue;
    const value = values[field.name];
    // The workspace parser owns bare true flags and omits false defaults;
    // forwarded build flags use yargs' explicit values, including false and 0.
    if (command.registryId === 'workspace.build' && Object.hasOwn(WORKSPACE_BUILD_OPTIONS, field.name)
      && typeof value === 'boolean') { if (value) argv.push(`--${field.name}`); continue; }
    for (const item of Array.isArray(value) ? value : [value]) argv.push(`--${field.name}=${item}`);
  }
  if (!command.requestFile && !['risk.explain', 'service.indexer'].includes(command.registryId)) argv.push(`--${scope.kind === 'workspace' ? 'workspace' : 'repo'}=${scope.target}`);
  if (command.registryId === 'risk.explain') argv.push(`--index=${getIndexDir(scope.configRoot || scope.target, 'code', loadUserConfig(scope.configRoot || scope.target, { env }))}`);
  if (command.registryId === 'bench.micro') {
    argv.push('--build=false', '--clean=false');
    if (!Object.hasOwn(values, 'components')) argv.push('--components=sparse,dense,hybrid');
  }
  if (command.registryId === 'setup') argv.push('--non-interactive=true');
  if (command.registryId === 'service.api') argv.push('--host=127.0.0.1', '--json');
  if (command.registryId === 'service.mcp') argv.push('--mcp-mode=legacy');
  if (['index.build', 'index.watch', 'workspace.build'].includes(command.registryId)) {
    argv.push('--progress=jsonl');
  } else if (command.capture !== 'text' && !command.requestFile && !['report.eval', 'service.mcp', 'service.api'].includes(command.registryId)) argv.push('--json');
  return argv;
};

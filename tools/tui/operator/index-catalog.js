import { listCommandRegistry } from '../../../src/shared/command-registry-query.js';
import { INDEX_BUILD_OPTIONS } from '../../../src/shared/cli-option-sets.js';
import { PRIMARY_INDEX_MODES } from '../../../src/integrations/core/build-index/stages/modes.js';
import { SNAPSHOT_ID_SCHEMA } from '../../../src/contracts/schemas/artifacts/snapshots-diffs.js';
import { INDEX_VALIDATE_OPTIONS, INDEX_REPORT_OPTIONS, INDEX_STATS_OPTIONS,
  SNAPSHOT_COMMANDS, WORKSPACE_BUILD_OPTIONS } from '../../../src/shared/index-tool-options.js';

const OWNED_FIELDS = new Set(['repo', 'workspace', 'json', 'progress', 'watch', 'config-dump', 'debug-crash', 'no-scm-annotate']);
const optionSchema = spec => ({ type: spec.type,
  ...(spec.type === 'string' ? { maxLength: 4096, pattern: '^[^\\u0000]*$' } : {}),
  ...(spec.type === 'array' ? { maxItems: 32, items: { type: 'string', maxLength: 256, pattern: '^[^\\u0000]*$' } } : {}) });
const form = (entry, options, suffix = '', positional = {}) => {
  const fields = [...Object.entries(positional), ...Object.entries(options).filter(([key]) => !OWNED_FIELDS.has(key))]
    .map(([name, spec]) => ({ name, schema: { ...optionSchema(spec),
      ...(name === 'mode' && ['index.build', 'index.watch', 'workspace.build'].includes(entry.id)
        ? { enum: ['all', 'both', ...PRIMARY_INDEX_MODES] } : {}),
      ...(entry.id === 'index.snapshot' && ['id', 'snapshotId'].includes(name)
        ? { pattern: SNAPSHOT_ID_SCHEMA.pattern, minLength: 1 } : {}) },
    description: spec.describe || '', ...(spec.default !== undefined ? { default: spec.default } : {}),
    positional: Object.hasOwn(positional, name), required: spec.demandOption === true }));
  return { id: entry.id + (suffix ? `.${suffix}` : ''), registryId: entry.id,
    commandPath: [...entry.commandPath, ...(suffix ? [suffix] : [])],
    description: suffix ? SNAPSHOT_COMMANDS[suffix].description : entry.description,
    supportTier: entry.supportTier, scopeKind: entry.id === 'workspace.build' ? 'workspace' : 'repo',
    managedFields: Object.keys(options).filter(key => OWNED_FIELDS.has(key)).map(name => ({ name,
      reason: name === 'no-scm-annotate' ? 'Use scm-annotate=false; this is the negated CLI spelling.'
        : ['repo', 'workspace'].includes(name) ? 'Bound to the selected scope.'
          : ['config-dump', 'debug-crash'].includes(name) ? 'CLI-only diagnostic; this form launches an operational job.'
            : 'Owned by the canonical workflow and supervisor capture policy.' })),
    expectedArtifacts: entry.expectedArtifacts, fields,
    schema: { type: 'object', additionalProperties: false,
      properties: Object.fromEntries(fields.map(field => [field.name, field.schema])),
      required: fields.filter(field => field.required).map(field => field.name) } };
};

/** Registry identity/support tiers and the CLI's own option definitions own this catalog. */
export const describeIndexWorkflows = () => listCommandRegistry({ supportTiers: ['stable', 'operator'] }).flatMap(entry => {
  if (entry.id === 'index.snapshot') return Object.entries(SNAPSHOT_COMMANDS)
    .map(([name, spec]) => form(entry, spec.options, name, spec.positional));
  const options = { 'index.build': INDEX_BUILD_OPTIONS, 'index.watch': INDEX_BUILD_OPTIONS,
    'index.validate': INDEX_VALIDATE_OPTIONS, 'index.report': INDEX_REPORT_OPTIONS,
    'index.stats': INDEX_STATS_OPTIONS,
    'workspace.build': { ...INDEX_BUILD_OPTIONS, ...WORKSPACE_BUILD_OPTIONS } }[entry.id];
  return options ? [form(entry, options)] : [];
});

export const buildIndexWorkflowArgv = (command, values, scope) => {
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
  argv.push(`--${scope.kind === 'workspace' ? 'workspace' : 'repo'}=${scope.target}`);
  if (['index.build', 'index.watch', 'workspace.build'].includes(command.registryId)) {
    argv.push('--progress=jsonl');
  } else argv.push('--json');
  return argv;
};

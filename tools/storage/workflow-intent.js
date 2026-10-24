import path from 'node:path';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { STORAGE_ACTIONS } from './options.js';

const CONTEXT = ['json', 'repo', 'home', 'machine-config', 'cache-root'];
const LIMITS = ['max-entries', 'max-duration-ms'];
const OPTIONS = Object.freeze({
  list: ['category'], explain: ['category'],
  inspect: ['category', 'path', 'plan', 'exact', ...LIMITS],
  doctor: ['category', 'path', 'plan', ...LIMITS],
  'configure-plan': ['category', 'path'],
  'configure-apply': ['category', 'path', 'plan', 'plan-id'],
  'cleanup-plan': ['category', 'path', ...LIMITS],
  'cleanup-apply': ['category', 'path', 'plan', 'plan-id'],
  'migration-plan': ['category', 'source', 'destination', ...LIMITS],
  'migration-apply': ['category', 'source', 'destination', 'plan', 'plan-id'],
  'migration-rollback': ['category', 'source', 'destination', 'plan', 'plan-id'],
  'migration-status': ['category', 'source', 'destination', 'plan'],
  'policy-plan': ['category', 'enabled', 'entry-limit', 'hard-bytes', 'max-age-ms'],
  'policy-apply': ['category', 'plan', 'plan-id']
});
const intentError = message => Object.assign(new Error(message), { code: 'ERR_STORAGE_WORKFLOW_INTENT' });

export const sameStorageWorkflowPath = (left, right) => typeof left === 'string' && typeof right === 'string'
  && path.isAbsolute(left) && path.isAbsolute(right) && (process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right));

/** Only the selected existing owner can interpret a selector. Do not silently
 * discard a flag and turn a narrower request into a broader operation.
 */
export const validateStorageWorkflowIntent = (argv, rawArgs) => {
  const action = String(argv._[0] || 'list');
  if (!STORAGE_ACTIONS.includes(action)) throw intentError('Unknown storage action.');
  const allowed = new Set([...CONTEXT, ...OPTIONS[action], 'help', 'version']);
  const supplied = new Set(rawArgs.filter(token => token.startsWith('--') && token !== '--')
    .map(token => token.slice(2).split('=')[0].replace(/^no-/u, '')));
  for (const flag of supplied) if (!allowed.has(flag)) throw intentError(`Storage ${action} does not accept --${flag}; no selector was ignored.`);
  for (const name of ['json', 'enabled', 'exact']) {
    for (let index = 0; index < rawArgs.length; index += 1) {
      const token = rawArgs[index];
      if (token.startsWith(`--no-${name}=`)) throw intentError(`Use --no-${name} without a value.`);
      if (token === `--no-${name}`) { argv[name] = false; continue; }
      const equals = token.startsWith(`--${name}=`);
      if (token !== `--${name}` && !equals) continue;
      const value = equals ? token.slice(name.length + 3) : rawArgs[index + 1];
      if (value === 'true' || value === 'false') { argv[name] = value === 'true'; if (!equals) index += 1; }
      else if (equals || value && !value.startsWith('-')) throw intentError(`--${name} requires true or false.`);
      else argv[name] = true;
    }
  }
  for (const flag of ['repo', 'home', 'machine-config', 'cache-root', 'category', 'path', 'source', 'destination', 'plan', 'plan-id']) {
    if (argv[flag] !== undefined && (typeof argv[flag] !== 'string' || !argv[flag].trim())) throw intentError(`Storage --${flag} requires one explicit nonempty value.`);
  }
  const required = {
    'configure-plan': ['category', 'path'], 'configure-apply': ['category', 'path', 'plan', 'plan-id'],
    'cleanup-apply': ['plan', 'plan-id'], 'migration-plan': ['category', 'source', 'destination'],
    'migration-apply': ['category', 'source', 'destination', 'plan', 'plan-id'],
    'migration-rollback': ['category', 'source', 'destination', 'plan', 'plan-id'],
    'migration-status': ['plan'], 'policy-apply': ['category', 'plan', 'plan-id']
  }[action] || [];
  for (const flag of required) if (!argv[flag]) throw intentError(`Storage ${action} requires --${flag}.`);
  for (const flag of ['path', 'source', 'destination']) {
    if (argv[flag] && !path.isAbsolute(argv[flag])) throw intentError(`Storage --${flag} requires an absolute path.`);
  }
  for (const flag of LIMITS) if (!Number.isSafeInteger(argv[flag]) || argv[flag] < 1) throw intentError(`Storage --${flag} requires a positive bounded integer.`);
  if (action.startsWith('cleanup-') && argv.category && argv.category !== 'command-probes') {
    throw intentError('Storage cleanup currently admits command-probes only; other categories remain protected.');
  }
  return action;
};

/** A reviewed project context is a restriction, never fresh filesystem or
 * cleanup authority. Canonical owners still verify plan IDs and publication.
 */
export const assertStorageReviewedRepoContext = (plan, repoRoot) => {
  if (!sameStorageWorkflowPath(plan.repoRoot, repoRoot)) throw intentError('Storage plan repository context changed; review a fresh plan for this exact repository.');
};

export const assertStorageCleanupScope = ({ argv, cacheRoot, currentCache }) => {
  const probeRoot = path.join(cacheRoot, 'tooling', 'command-probes');
  if (argv.path && !sameStorageWorkflowPath(argv.path, probeRoot)) throw intentError('Cleanup --path must name the exact selected cache/tooling/command-probes directory.');
  if (!argv['cache-root'] && currentCache && !sameStorageWorkflowPath(currentCache, cacheRoot)) {
    throw intentError('Current application cache differs from the launch-authorized cache. Review it and select the exact --cache-root before cleanup planning or apply.');
  }
};

export const assertStorageMigrationScope = ({ argv, layout, repoRoot, plan = null, requireSelectors = true }) => {
  if (requireSelectors && isPathWithinRoot(layout.home.path, repoRoot)) throw intentError('Machine storage migration cannot publish its locator or recovery state inside a portable repository.');
  if (!plan) return;
  if (!sameStorageWorkflowPath(plan.home, layout.home.path)) throw intentError('Migration plan application home differs from the launch-selected home.');
  for (const key of ['category', 'source', 'destination']) {
    if (!requireSelectors && argv[key] === undefined) continue;
    const equal = key === 'category' ? argv[key] === plan[key] : sameStorageWorkflowPath(argv[key], plan[key]);
    if (!equal) throw intentError(`Migration requires the exact reviewed --${key} selector.`);
  }
};

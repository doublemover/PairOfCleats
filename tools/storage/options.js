export const STORAGE_ACTIONS = Object.freeze(['list', 'inspect', 'explain', 'doctor', 'configure-plan', 'configure-apply',
  'cleanup-plan', 'cleanup-apply', 'migration-plan', 'migration-apply', 'migration-rollback', 'migration-status']);

export const STORAGE_OPTIONS = {
  json: { type: 'boolean', default: false, describe: 'Print structured storage receipt' },
  repo: { type: 'string', describe: 'Repository context; no indexed reader lease is acquired by path-only diagnostics' },
  home: { type: 'string', describe: 'Explicit application home for this storage operation' },
  category: { type: 'string', describe: 'Logical storage category' },
  path: { type: 'string', describe: 'Explicit requested category destination for configuration preview/apply' },
  source: { type: 'string', describe: 'Known owned source for migration-plan' },
  destination: { type: 'string', describe: 'Owned destination for migration-plan' },
  'machine-config': { type: 'string', describe: 'Explicit trusted machine-local storage configuration outside the repository' },
  'cache-root': { type: 'string', describe: 'Effective cache-only category override for this operation' },
  exact: { type: 'boolean', default: false, describe: 'Bounded exact file accounting instead of root metadata only' },
  'max-entries': { type: 'number', default: 100000, describe: 'Maximum entries for bounded inventory' },
  'max-duration-ms': { type: 'number', default: 10000, describe: 'Bounded inventory time allowance' },
  plan: { type: 'string', describe: 'Reviewed plan JSON file for apply/status' },
  'plan-id': { type: 'string', describe: 'Exact reviewed storage plan ID' }
};

export { STORAGE_ACTIONS } from '../../src/shared/command-registry-data.js';

export const STORAGE_OPTIONS = {
  json: { type: 'boolean', default: false, describe: 'Print structured storage receipt' },
  repo: { type: 'string', describe: 'Repository context; no indexed reader lease is acquired by path-only diagnostics' },
  home: { type: 'string', describe: 'Explicit application home for this storage operation' },
  category: { type: 'string', describe: 'Logical storage category' },
  path: { type: 'string', describe: 'Explicit category path for read-only inspection or configuration preview/apply' },
  source: { type: 'string', describe: 'Known owned source for migration-plan' },
  destination: { type: 'string', describe: 'Owned destination for migration-plan' },
  'machine-config': { type: 'string', describe: 'Explicit trusted machine-local storage configuration outside the repository' },
  'cache-root': { type: 'string', describe: 'Effective cache-only category override for this operation' },
  exact: { type: 'boolean', default: false, describe: 'Bounded exact file accounting instead of root metadata only' },
  'max-entries': { type: 'number', default: 100000, describe: 'Maximum entries for bounded inventory' },
  'max-duration-ms': { type: 'number', default: 10000, describe: 'Bounded inventory time allowance' },
  enabled: { type: 'boolean', describe: 'Reviewed command-probe policy: false bypasses cache use and preserves bytes' },
  'entry-limit': { type: 'number', describe: 'Reviewed command-probe entry count; zero bypasses cache use' },
  'hard-bytes': { type: 'number', describe: 'Reviewed command-probe logical byte budget; zero bypasses cache use' },
  'max-age-ms': { type: 'number', describe: 'Reviewed command-probe maximum age; zero bypasses cache use' },
  plan: { type: 'string', describe: 'Reviewed storage plan or explicit read-only category request JSON' },
  'plan-id': { type: 'string', describe: 'Exact reviewed storage plan ID' }
};

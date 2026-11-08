export const CONFIG_VALIDATE_OPTIONS = {
  json: { type: 'boolean', default: false }, repo: { type: 'string' },
  config: { type: 'string' }, effective: { type: 'boolean', default: false }
};
export const CONFIG_DUMP_OPTIONS = {
  repo: { type: 'string' }, json: { type: 'boolean', default: false },
  config: { type: 'string' },
  capabilities: { type: 'boolean', default: false }
};

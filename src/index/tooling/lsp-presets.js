const normalizePresetKey = (value) => String(value || '').trim().toLowerCase();

const PRESET_DEFINITIONS = Object.freeze({
  gopls: Object.freeze({
    id: 'gopls',
    cmd: 'gopls',
    args: [],
    languages: ['go'],
    label: 'Go (gopls)',
    priority: 80
  }),
  'rust-analyzer': Object.freeze({
    id: 'rust-analyzer',
    cmd: 'rust-analyzer',
    args: [],
    languages: ['rust'],
    label: 'Rust (rust-analyzer)',
    priority: 80
  }),
  'yaml-language-server': Object.freeze({
    id: 'yaml-language-server',
    cmd: 'yaml-language-server',
    args: ['--stdio'],
    languages: ['yaml', 'yml'],
    label: 'YAML (yaml-language-server)',
    priority: 80
  }),
  'lua-language-server': Object.freeze({
    id: 'lua-language-server',
    cmd: 'lua-language-server',
    args: [],
    languages: ['lua'],
    label: 'Lua (lua-language-server)',
    priority: 80
  }),
  zls: Object.freeze({
    id: 'zls',
    cmd: 'zls',
    args: [],
    languages: ['zig'],
    label: 'Zig (zls)',
    priority: 80
  })
});

const PRESET_ALIAS_TO_KEY = Object.freeze({
  go: 'gopls',
  gopls: 'gopls',
  rust: 'rust-analyzer',
  'rust-analyzer': 'rust-analyzer',
  rust_analyzer: 'rust-analyzer',
  yaml: 'yaml-language-server',
  yamlls: 'yaml-language-server',
  'yaml-language-server': 'yaml-language-server',
  lua: 'lua-language-server',
  lua_ls: 'lua-language-server',
  'lua-language-server': 'lua-language-server',
  zig: 'zls',
  zls: 'zls'
});

const clonePreset = (preset) => ({
  ...preset,
  args: Array.isArray(preset.args) ? preset.args.slice() : [],
  languages: Array.isArray(preset.languages) ? preset.languages.slice() : []
});

const resolvePresetKey = (value) => {
  const normalized = normalizePresetKey(value);
  if (!normalized) return '';
  return PRESET_ALIAS_TO_KEY[normalized] || '';
};

export const resolveLspServerPreset = (server) => {
  if (!server || typeof server !== 'object') return null;

  const explicitPreset = resolvePresetKey(server.preset);
  if (explicitPreset) {
    return clonePreset(PRESET_DEFINITIONS[explicitPreset]);
  }

  const hasCmd = typeof server.cmd === 'string' && server.cmd.trim();
  if (hasCmd) return null;

  const implicitPreset = resolvePresetKey(server.id);
  if (!implicitPreset) return null;
  return clonePreset(PRESET_DEFINITIONS[implicitPreset]);
};


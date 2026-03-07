import { normalizeProviderId } from './provider-contract.js';

const normalizePresetKey = (value) => normalizeProviderId(value);

const PRESET_DEFINITIONS = Object.freeze({
  gopls: Object.freeze({
    id: 'gopls',
    cmd: 'gopls',
    args: [],
    languages: ['go'],
    label: 'Go (gopls)',
    priority: 80,
    requireWorkspaceModel: true,
    preflightPolicy: 'required',
    preflightRuntimeRequirements: Object.freeze([Object.freeze({
      id: 'go',
      cmd: 'go',
      args: Object.freeze(['version']),
      label: 'Go toolchain'
    })]),
    workspaceMarkerOptions: Object.freeze({
      exactNames: Object.freeze(['go.mod', 'go.work'])
    }),
    workspaceModelMissingMessage: 'gopls workspace markers (go.mod/go.work) not found near repo root.'
  }),
  'rust-analyzer': Object.freeze({
    id: 'rust-analyzer',
    cmd: 'rust-analyzer',
    args: [],
    languages: ['rust'],
    label: 'Rust (rust-analyzer)',
    priority: 80,
    requireWorkspaceModel: true,
    preflightPolicy: 'required',
    preflightRuntimeRequirements: Object.freeze([
      Object.freeze({
        id: 'cargo',
        cmd: 'cargo',
        args: Object.freeze(['--version']),
        label: 'Cargo'
      }),
      Object.freeze({
        id: 'rustc',
        cmd: 'rustc',
        args: Object.freeze(['--version']),
        label: 'Rust compiler'
      })
    ]),
    workspaceMarkerOptions: Object.freeze({
      exactNames: Object.freeze(['Cargo.toml', 'Cargo.lock'])
    }),
    workspaceModelMissingMessage: 'rust-analyzer workspace markers (Cargo.toml/Cargo.lock) not found near repo root.'
  }),
  'yaml-language-server': Object.freeze({
    id: 'yaml-language-server',
    cmd: 'yaml-language-server',
    args: ['--stdio'],
    languages: ['yaml', 'yml'],
    label: 'YAML (yaml-language-server)',
    priority: 80,
    initializationOptions: Object.freeze({
      settings: Object.freeze({
        yaml: Object.freeze({
          schemaStore: Object.freeze({
            enable: false
          })
        })
      })
    })
  }),
  'lua-language-server': Object.freeze({
    id: 'lua-language-server',
    cmd: 'lua-language-server',
    args: [],
    languages: ['lua'],
    label: 'Lua (lua-language-server)',
    priority: 80,
    preflightPolicy: 'optional'
  }),
  zls: Object.freeze({
    id: 'zls',
    cmd: 'zls',
    args: [],
    languages: ['zig'],
    label: 'Zig (zls)',
    priority: 80,
    preflightTimeoutMs: 30000,
    requireWorkspaceModel: true,
    preflightPolicy: 'required',
    preflightRuntimeRequirements: Object.freeze([Object.freeze({
      id: 'zig',
      cmd: 'zig',
      args: Object.freeze(['version']),
      label: 'Zig toolchain'
    })]),
    workspaceMarkerOptions: Object.freeze({
      exactNames: Object.freeze(['build.zig', 'build.zig.zon'])
    }),
    workspaceModelMissingMessage: 'zls workspace markers (build.zig/build.zig.zon) not found near repo root.'
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

export const listLspServerPresets = () => Object.values(PRESET_DEFINITIONS).map((preset) => clonePreset(preset));

export const resolveLspServerPresetByKey = (value) => {
  const key = resolvePresetKey(value);
  if (!key) return null;
  return clonePreset(PRESET_DEFINITIONS[key]);
};

export const resolveLspServerPreset = (server) => {
  if (!server || typeof server !== 'object') return null;

  const explicitPreset = resolveLspServerPresetByKey(server.preset);
  if (explicitPreset) return explicitPreset;

  const hasCmd = typeof server.cmd === 'string' && server.cmd.trim();
  if (hasCmd) return null;

  return resolveLspServerPresetByKey(server.id);
};

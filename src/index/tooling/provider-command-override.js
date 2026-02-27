import { normalizeProviderId } from './provider-contract.js';

const PROVIDER_CONFIG_KEY_BY_ID = Object.freeze({
  clangd: 'clangd',
  'csharp-ls': 'csharp',
  dart: 'dart',
  'elixir-ls': 'elixir',
  'haskell-language-server': 'haskell',
  jdtls: 'jdtls',
  phpactor: 'phpactor',
  pyright: 'pyright',
  solargraph: 'solargraph',
  sourcekit: 'sourcekit'
});

const resolveConfiguredCommand = (providerId, config) => {
  const normalizedProviderId = normalizeProviderId(providerId);
  if (normalizedProviderId === 'pyright') {
    if (typeof config.command === 'string' && config.command.trim()) {
      return config.command.trim();
    }
    if (typeof config.cmd === 'string' && config.cmd.trim()) {
      return config.cmd.trim();
    }
    return null;
  }
  if (typeof config.cmd === 'string' && config.cmd.trim()) {
    return config.cmd.trim();
  }
  if (typeof config.command === 'string' && config.command.trim()) {
    return config.command.trim();
  }
  return null;
};

const normalizeArgs = (value) => (
  Array.isArray(value)
    ? value.map((entry) => String(entry))
    : null
);

export const resolveProviderCommandOverride = ({ providerId, toolingConfig }) => {
  const configKey = PROVIDER_CONFIG_KEY_BY_ID[normalizeProviderId(providerId)] || null;
  if (!configKey) return { cmd: null, args: null };
  const config = toolingConfig?.[configKey];
  if (!config || typeof config !== 'object') return { cmd: null, args: null };
  return {
    cmd: resolveConfiguredCommand(providerId, config),
    args: normalizeArgs(config.args)
  };
};

export const resolveProviderRequestedCommand = ({
  providerId,
  toolingConfig,
  defaultCmd = '',
  defaultArgs = []
}) => {
  const override = resolveProviderCommandOverride({ providerId, toolingConfig });
  return {
    cmd: override.cmd || String(defaultCmd || '').trim(),
    args: Array.isArray(override.args)
      ? override.args
      : (Array.isArray(defaultArgs) ? defaultArgs.map((entry) => String(entry)) : [])
  };
};

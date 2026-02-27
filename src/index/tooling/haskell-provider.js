import { parseHaskellSignature } from './signature-parse/haskell.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { normalizeCommandArgs } from './provider-utils.js';

const HASKELL_EXTS = ['.hs', '.lhs', '.cabal'];

export const createHaskellProvider = () => createDedicatedLspProvider({
  id: 'haskell-language-server',
  label: 'haskell-language-server (dedicated)',
  priority: 87,
  languages: ['haskell'],
  configKey: 'haskell',
  docExtensions: HASKELL_EXTS,
  duplicateLabel: 'haskell-language-server',
  requires: { cmd: 'haskell-language-server' },
  workspace: {
    markerOptions: {
      exactNames: ['stack.yaml', 'cabal.project'],
      extensionNames: ['.cabal']
    },
    missingCheck: {
      name: 'haskell_workspace_model_missing',
      message: 'haskell workspace markers not found; skipping dedicated provider.'
    }
  },
  command: {
    defaultCmd: 'haskell-language-server',
    resolveArgs: (config) => normalizeCommandArgs(config?.args),
    commandUnavailableCheck: {
      name: 'haskell_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for haskell-language-server.`
    }
  },
  parseSignature: parseHaskellSignature
});

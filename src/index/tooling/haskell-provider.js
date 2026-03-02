import fsSync from 'node:fs';
import path from 'node:path';
import { parseHaskellSignature } from './signature-parse/haskell.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { normalizeCommandArgs } from './provider-utils.js';

const HASKELL_EXTS = ['.hs', '.lhs', '.cabal'];

const hasCabalFileInRoot = (repoRoot) => {
  try {
    const entries = fsSync.readdirSync(repoRoot, { withFileTypes: true });
    return entries.some((entry) => entry?.isFile?.() && String(entry.name || '').toLowerCase().endsWith('.cabal'));
  } catch {
    return false;
  }
};

const resolveHaskellWorkspaceCradlePreflight = ({ ctx }) => {
  const repoRoot = String(ctx?.repoRoot || process.cwd());
  const hasStack = fsSync.existsSync(path.join(repoRoot, 'stack.yaml'));
  const hasCabalProject = fsSync.existsSync(path.join(repoRoot, 'cabal.project'));
  const hasCabalFile = hasCabalFileInRoot(repoRoot);
  const hasHieYaml = fsSync.existsSync(path.join(repoRoot, 'hie.yaml'));
  const ambiguous = hasStack && (hasCabalProject || hasCabalFile);
  if (!ambiguous || hasHieYaml) {
    return { state: 'ready', reasonCode: null, message: '', checks: [] };
  }
  const message = (
    'haskell workspace has both Stack and Cabal markers without hie.yaml; '
    + 'cradle selection may be ambiguous.'
  );
  return {
    state: 'degraded',
    reasonCode: 'haskell_workspace_ambiguous_cradle',
    message,
    checks: [{
      name: 'haskell_workspace_ambiguous_cradle',
      status: 'warn',
      message
    }]
  };
};

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
  preflightPolicy: 'required',
  preflightRuntimeRequirements: [{
    id: 'ghc',
    cmd: 'ghc',
    args: ['--version'],
    label: 'GHC compiler'
  }],
  command: {
    defaultCmd: 'haskell-language-server',
    resolveArgs: (config) => normalizeCommandArgs(config?.args),
    commandUnavailableCheck: {
      name: 'haskell_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for haskell-language-server.`
    }
  },
  parseSignature: parseHaskellSignature,
  preflight: async ({ ctx }) => resolveHaskellWorkspaceCradlePreflight({ ctx })
});

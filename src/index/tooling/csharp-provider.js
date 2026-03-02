import fsSync from 'node:fs';
import { parseClikeSignature } from './signature-parse/clike.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';

const CSHARP_EXTS = ['.cs'];

const getWorkspaceRootFileSamples = (repoRoot, extension) => {
  try {
    const entries = fsSync.readdirSync(repoRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry?.isFile?.() && String(entry.name || '').toLowerCase().endsWith(extension))
      .map((entry) => String(entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
};

const formatSampleList = (values) => {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!items.length) return '';
  const sample = items.slice(0, 3).join(', ');
  return items.length > 3 ? `${sample} (+${items.length - 3} more)` : sample;
};

const resolveCsharpWorkspaceBootstrapPreflight = ({ ctx }) => {
  const repoRoot = String(ctx?.repoRoot || process.cwd());
  const solutionFiles = getWorkspaceRootFileSamples(repoRoot, '.sln');
  const projectFiles = getWorkspaceRootFileSamples(repoRoot, '.csproj');

  if (solutionFiles.length > 1) {
    const message = `csharp workspace has multiple solution files at repo root (${formatSampleList(solutionFiles)}); workspace bootstrap may be ambiguous.`;
    return {
      state: 'degraded',
      reasonCode: 'csharp_workspace_ambiguous_solution',
      message,
      checks: [{
        name: 'csharp_workspace_ambiguous_solution',
        status: 'warn',
        message
      }]
    };
  }

  if (!solutionFiles.length && projectFiles.length > 1) {
    const message = `csharp workspace has multiple project files at repo root without a solution file (${formatSampleList(projectFiles)}); workspace bootstrap may be ambiguous.`;
    return {
      state: 'degraded',
      reasonCode: 'csharp_workspace_ambiguous_project',
      message,
      checks: [{
        name: 'csharp_workspace_ambiguous_project',
        status: 'warn',
        message
      }]
    };
  }

  return { state: 'ready', reasonCode: null, message: '' };
};

export const createCsharpProvider = () => createDedicatedLspProvider({
  id: 'csharp-ls',
  label: 'csharp-ls (dedicated)',
  priority: 83,
  languages: ['csharp'],
  configKey: 'csharp',
  docExtensions: CSHARP_EXTS,
  duplicateLabel: 'csharp-ls',
  requires: { cmd: 'csharp-ls' },
  workspace: {
    markerOptions: {
      extensionNames: ['.sln', '.csproj']
    },
    missingCheck: {
      name: 'csharp_workspace_model_missing',
      message: 'csharp-ls workspace model markers not found; skipping dedicated provider.'
    }
  },
  preflightPolicy: 'required',
  preflightRuntimeRequirements: [{
    id: 'dotnet',
    cmd: 'dotnet',
    args: ['--list-sdks'],
    label: '.NET SDK'
  }],
  command: {
    defaultCmd: 'csharp-ls',
    resolveArgs: (config) => (Array.isArray(config?.args) ? config.args : []),
    commandUnavailableCheck: {
      name: 'csharp_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for csharp-ls.`
    }
  },
  parseSignature: (detail, _lang, symbolName) => parseClikeSignature(detail, symbolName),
  preflight: async ({ ctx }) => resolveCsharpWorkspaceBootstrapPreflight({ ctx })
});

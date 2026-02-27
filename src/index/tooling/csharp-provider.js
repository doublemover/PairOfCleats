import { parseClikeSignature } from './signature-parse/clike.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';

const CSHARP_EXTS = ['.cs'];

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
  command: {
    defaultCmd: 'csharp-ls',
    resolveArgs: (config) => (Array.isArray(config?.args) ? config.args : []),
    commandUnavailableCheck: {
      name: 'csharp_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for csharp-ls.`
    }
  },
  parseSignature: (detail, _lang, symbolName) => parseClikeSignature(detail, symbolName)
});

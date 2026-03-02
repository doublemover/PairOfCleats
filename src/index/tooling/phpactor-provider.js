import path from 'node:path';
import { parseClikeSignature } from './signature-parse/clike.js';
import { readJsonFileSafe } from '../../shared/files.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { ensureCommandArgToken, normalizeCommandArgs } from './provider-utils.js';

const PHP_EXTS = ['.php', '.phtml'];
const PHPACTOR_COMPOSER_MAX_BYTES = 2 * 1024 * 1024;

const ensureLanguageServerArg = (args) => {
  return ensureCommandArgToken(args, 'language-server', { position: 'prepend' });
};

const resolveComposerManifestPath = (ctx) => path.join(
  ctx?.repoRoot || process.cwd(),
  'composer.json'
);

const resolveComposerManifestPreflight = async ({ ctx }) => {
  const composerPath = resolveComposerManifestPath(ctx);
  let readError = null;
  const manifest = await readJsonFileSafe(composerPath, {
    fallback: null,
    maxBytes: PHPACTOR_COMPOSER_MAX_BYTES,
    onError: (info) => {
      readError = info;
    }
  });
  const code = String(readError?.error?.code || '').trim().toUpperCase();
  if (!readError) {
    if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
      return { state: 'ready', reasonCode: null, message: '', check: null };
    }
    const message = 'phpactor composer workspace manifest is not a JSON object.';
    return {
      state: 'degraded',
      reasonCode: 'phpactor_workspace_composer_invalid',
      message,
      check: {
        name: 'phpactor_workspace_composer_invalid',
        status: 'warn',
        message
      }
    };
  }
  if (code === 'ENOENT') {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  if (code === 'ERR_JSON_FILE_TOO_LARGE') {
    const message = `phpactor composer workspace manifest exceeds ${PHPACTOR_COMPOSER_MAX_BYTES} bytes.`;
    return {
      state: 'degraded',
      reasonCode: 'phpactor_workspace_composer_too_large',
      message,
      check: {
        name: 'phpactor_workspace_composer_too_large',
        status: 'warn',
        message
      }
    };
  }
  if (String(readError?.phase || '').toLowerCase() === 'parse') {
    const message = `phpactor composer workspace manifest is invalid JSON: ${readError?.error?.message || 'parse failed'}`;
    return {
      state: 'degraded',
      reasonCode: 'phpactor_workspace_composer_invalid',
      message,
      check: {
        name: 'phpactor_workspace_composer_invalid',
        status: 'warn',
        message
      }
    };
  }
  const message = `phpactor composer workspace manifest is unreadable: ${readError?.error?.message || 'read failed'}`;
  return {
    state: 'degraded',
    reasonCode: 'phpactor_workspace_composer_unreadable',
    message,
    check: {
      name: 'phpactor_workspace_composer_unreadable',
      status: 'warn',
      message
    }
  };
};

export const createPhpactorProvider = () => createDedicatedLspProvider({
  id: 'phpactor',
  preflightId: 'phpactor.workspace-model',
  label: 'phpactor (dedicated)',
  priority: 86,
  languages: ['php'],
  configKey: 'phpactor',
  docExtensions: PHP_EXTS,
  duplicateLabel: 'phpactor',
  requires: { cmd: 'phpactor', args: ['language-server'] },
  workspace: {
    markerOptions: {
      exactNames: ['composer.json']
    },
    missingCheck: {
      name: 'phpactor_workspace_model_missing',
      message: 'phpactor workspace markers not found; skipping dedicated provider.'
    }
  },
  preflightPolicy: 'required',
  preflightRuntimeRequirements: [{
    id: 'php',
    cmd: 'php',
    args: ['--version'],
    label: 'PHP runtime'
  }],
  command: {
    defaultCmd: 'phpactor',
    resolveArgs: (config) => ensureLanguageServerArg(normalizeCommandArgs(config?.args)),
    commandUnavailableCheck: {
      name: 'phpactor_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for phpactor.`
    }
  },
  parseSignature: (detail, _lang, symbolName) => parseClikeSignature(detail, symbolName),
  preflight: async ({ ctx }) => resolveComposerManifestPreflight({ ctx }),
  prepareCollect: ({ commandProfile, requested }) => ({
    args: ensureLanguageServerArg(commandProfile.resolved.args || requested.args)
  })
});

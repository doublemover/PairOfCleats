import fsSync from 'node:fs';
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

const resolveComposerLockPath = (ctx) => path.join(
  ctx?.repoRoot || process.cwd(),
  'composer.lock'
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

const resolveComposerLockPreflight = ({ ctx }) => {
  const composerPath = resolveComposerManifestPath(ctx);
  if (!fsSync.existsSync(composerPath)) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  const lockPath = resolveComposerLockPath(ctx);
  if (fsSync.existsSync(lockPath)) {
    return { state: 'ready', reasonCode: null, message: '', check: null };
  }
  const message = 'phpactor workspace is missing composer.lock; dependency graph/bootstrap state may be incomplete.';
  return {
    state: 'degraded',
    reasonCode: 'phpactor_workspace_composer_lock_missing',
    message,
    check: {
      name: 'phpactor_workspace_composer_lock_missing',
      status: 'warn',
      message
    }
  };
};

const resolveFirstNonReadyPreflight = (...entries) => {
  for (const entry of entries) {
    const state = String(entry?.state || 'ready').trim().toLowerCase();
    if (state && state !== 'ready') return entry;
  }
  return { state: 'ready', reasonCode: null, message: '', check: null };
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
  }, {
    id: 'composer',
    cmd: 'composer',
    args: ['--version'],
    label: 'Composer'
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
  preflight: async ({ ctx }) => {
    const manifestPreflight = await resolveComposerManifestPreflight({ ctx });
    const lockPreflight = resolveComposerLockPreflight({ ctx });
    const firstNonReady = resolveFirstNonReadyPreflight(manifestPreflight, lockPreflight);
    const checks = [manifestPreflight?.check, lockPreflight?.check].filter(Boolean);
    if (String(firstNonReady?.state || '').toLowerCase() === 'ready') {
      return { state: 'ready', reasonCode: null, message: '' };
    }
    return {
      state: firstNonReady.state || 'degraded',
      reasonCode: firstNonReady.reasonCode || null,
      message: firstNonReady.message || '',
      ...(checks.length ? { checks } : {})
    };
  },
  prepareCollect: ({ commandProfile, requested }) => ({
    args: ensureLanguageServerArg(commandProfile.resolved.args || requested.args)
  })
});

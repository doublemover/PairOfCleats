import path from 'node:path';
import { readVerifiedContainedFile } from '../../../shared/contained-file.js';
import { isAbortError, throwIfAborted } from '../../../shared/abort.js';
import { parseJsoncText } from '../../../shared/jsonc.js';

export const PYRIGHT_CONFIG_MAX_BYTES = 2 * 1024 * 1024;

// Pyright1.1.408 parses this named format with jsonc-parser and trailing commas.
// https://github.com/microsoft/pyright/blob/1.1.408/packages/pyright-internal/src/analyzer/service.ts#L1283
export const resolvePyrightWorkspaceConfigPreflight = async ({ ctx, abortSignal = null }) => {
  throwIfAborted(abortSignal);
  const configPath = path.join(String(ctx?.repoRoot || process.cwd()), 'pyrightconfig.json');
  let readError = null;
  let parsed = null;
  let phase = 'stat';
  try {
    phase = 'read';
    const { buffer } = await readVerifiedContainedFile(ctx?.repoRoot || process.cwd(), configPath,
      { maxBytes: PYRIGHT_CONFIG_MAX_BYTES, signal: abortSignal });
    throwIfAborted(abortSignal);
    phase = 'parse';
    parsed = parseJsoncText(buffer.toString('utf8'), configPath);
  } catch (error) {
    if (isAbortError(error) || error?.cacheOwnershipPending === true) throw error;
    readError = { error, phase };
  }
  throwIfAborted(abortSignal);
  const code = String(readError?.error?.code || '').trim().toUpperCase();
  if (!readError) {
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { state: 'ready', reasonCode: null, message: '', checks: [] };
    }
    const message = 'pyright workspace config (pyrightconfig.json) must be a JSON object.';
    return {
      state: 'degraded',
      reasonCode: 'pyright_workspace_config_invalid',
      message,
      checks: [{
        name: 'pyright_workspace_config_invalid',
        status: 'warn',
        message
      }]
    };
  }
  if (code === 'ENOENT') {
    return { state: 'ready', reasonCode: null, message: '', checks: [] };
  }
  if (['ERR_JSON_FILE_TOO_LARGE', 'ERR_FILE_TOO_LARGE'].includes(code)) {
    const message = `pyright workspace config exceeds ${PYRIGHT_CONFIG_MAX_BYTES} bytes.`;
    return {
      state: 'degraded',
      reasonCode: 'pyright_workspace_config_too_large',
      message,
      checks: [{
        name: 'pyright_workspace_config_too_large',
        status: 'warn',
        message
      }]
    };
  }
  if (String(readError?.phase || '').toLowerCase() === 'parse') {
    const message = `pyright workspace config is invalid JSONC: ${readError?.error?.message || 'parse failed'}`;
    return {
      state: 'degraded',
      reasonCode: 'pyright_workspace_config_invalid',
      message,
      checks: [{
        name: 'pyright_workspace_config_invalid',
        status: 'warn',
        message
      }]
    };
  }
  const message = `pyright workspace config is unreadable: ${readError?.error?.message || 'read failed'}`;
  return {
    state: 'degraded',
    reasonCode: 'pyright_workspace_config_unreadable',
    message,
    checks: [{
      name: 'pyright_workspace_config_unreadable',
      status: 'warn',
      message
    }]
  };
};

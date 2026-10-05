import path from 'node:path';
import { openContainedFile } from '../../../shared/contained-file.js';
import { parseJsoncText } from '../../../shared/jsonc.js';

export const PYRIGHT_CONFIG_MAX_BYTES = 2 * 1024 * 1024;

// Pyright1.1.408 parses this named format with jsonc-parser and trailing commas.
// https://github.com/microsoft/pyright/blob/1.1.408/packages/pyright-internal/src/analyzer/service.ts#L1283
export const resolvePyrightWorkspaceConfigPreflight = async ({ ctx }) => {
  const configPath = path.join(String(ctx?.repoRoot || process.cwd()), 'pyrightconfig.json');
  let readError = null;
  let parsed = null;
  let handle = null;
  let phase = 'stat';
  try {
    handle = await openContainedFile(ctx?.repoRoot || process.cwd(), configPath);
    const stat = await handle.stat();
    if (stat.size > PYRIGHT_CONFIG_MAX_BYTES) {
      throw Object.assign(new Error(`JSON config exceeds maxBytes (${stat.size} > ${PYRIGHT_CONFIG_MAX_BYTES})`),
        { code: 'ERR_JSON_FILE_TOO_LARGE' });
    }
    phase = 'read';
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
      throw Object.assign(new Error('Pyright workspace config changed during read.'), { code: 'ERR_FILE_CHANGED' });
    }
    phase = 'parse';
    parsed = parseJsoncText(buffer.subarray(0, offset).toString('utf8'), configPath);
  } catch (error) {
    readError = { error, phase };
  } finally {
    if (handle) await handle.close();
  }
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
  if (code === 'ERR_JSON_FILE_TOO_LARGE') {
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

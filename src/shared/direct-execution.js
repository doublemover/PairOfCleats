import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const realpathOrNull = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return fs.realpathSync.native(text);
  } catch {
    try {
      return fs.realpathSync(text);
    } catch {
      return null;
    }
  }
};

const normalizeForCompare = (value) => {
  if (!value) return null;
  return process.platform === 'win32'
    ? String(value).toLowerCase()
    : String(value);
};

export const isDirectExecution = (moduleUrl, executedPath = process.argv[1]) => {
  const modulePath = fileURLToPath(moduleUrl);
  const resolvedExecutedPath = executedPath ? path.resolve(executedPath) : null;
  if (!resolvedExecutedPath) return false;

  const moduleRealPath = realpathOrNull(modulePath);
  const executedRealPath = realpathOrNull(resolvedExecutedPath);
  if (moduleRealPath && executedRealPath) {
    return normalizeForCompare(moduleRealPath) === normalizeForCompare(executedRealPath);
  }

  return moduleUrl === pathToFileURL(resolvedExecutedPath).href;
};

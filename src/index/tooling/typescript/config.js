import fsSync from 'node:fs';
import path from 'node:path';
import { isAbsolutePathNative } from '../../../shared/file-paths.js';
import { findUpwards } from '../../../shared/fs/find-upwards.js';
const normalizePathKey = (value, sensitive) => sensitive ? path.resolve(value) : path.resolve(value).toLowerCase();
export const createDefaultCompilerOptions = (ts, config) => ({
  allowJs: config?.allowJs !== false,
  checkJs: config?.checkJs !== false,
  jsx: ts.JsxEmit.Preserve,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  skipLibCheck: true,
  noEmit: true,
  strict: false
});

const formatDiagnostic = (ts, diagnostic) => {
  const message = ts.flattenDiagnosticMessageText(diagnostic?.messageText || '', '\n');
  if (diagnostic?.file?.fileName) return `${diagnostic.file.fileName}: ${message}`;
  return message;
};

export const resolveTsconfigOverride = (rootDir, toolingConfig, log, system = fsSync) => {
  const override = toolingConfig?.typescript?.tsconfigPath;
  if (!override) return null;
  const resolved = isAbsolutePathNative(override) ? override : path.join(rootDir, override);
  if ((system.fileExists || system.existsSync)(resolved)) return resolved;
  log(`[index] TypeScript tsconfig not found at ${resolved}; falling back.`);
  return null;
};

const CONFIG_FILENAMES = ['tsconfig.json', 'jsconfig.json'];

export const findNearestConfig = (startDir, repoRoot, cache, useCaseSensitive, system = fsSync) => {
  if (!startDir) return null;
  const visited = [];
  let resolved = null;
  findUpwards(
    startDir,
    (candidateDir) => {
      const currentKey = normalizePathKey(candidateDir, useCaseSensitive);
      if (cache.has(currentKey)) {
        resolved = cache.get(currentKey) || null;
        return true;
      }
      visited.push(currentKey);
      for (const filename of CONFIG_FILENAMES) {
        const candidate = path.join(candidateDir, filename);
        if ((system.fileExists || system.existsSync)(candidate)) {
          resolved = candidate;
          return true;
        }
      }
      return false;
    },
    repoRoot || startDir
  );
  for (const key of visited) cache.set(key, resolved);
  return resolved;
};

export const parseTsConfig = (ts, configPath, log, system = ts.sys) => {
  if (!configPath) return null;
  const configFile = ts.readConfigFile(configPath, system.readFile);
  if (configFile?.error) {
    log(`[index] TypeScript tsconfig error: ${formatDiagnostic(ts, configFile.error)}`);
    return null;
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    system,
    path.dirname(configPath), undefined, configPath
  );
  if (parsed?.errors?.length) {
    log(`[index] TypeScript tsconfig warnings: ${formatDiagnostic(ts, parsed.errors[0])}`);
  }
  return parsed;
};

export const selectTypeScriptDocuments = (documents, config = {}) => {
  const allowed = new Set(['.ts', '.tsx', '.mts', '.cts', ...(config.allowJs !== false ? ['.js', '.mjs', '.cjs', ...(config.includeJsx !== false ? ['.jsx'] : [])] : [])]);
  return documents.filter(doc => allowed.has(String(doc.effectiveExt || '').toLowerCase()));
};

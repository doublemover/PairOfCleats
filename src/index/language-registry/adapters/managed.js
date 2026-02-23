export const flowOptions = (options = {}) => ({
  dataflow: options.astDataflowEnabled,
  controlFlow: options.controlFlowEnabled
});

export const normalizeRelPath = (relPath) => String(relPath || '').replace(/\\/g, '/');

const normalizeRelPathLower = (relPath) => normalizeRelPath(relPath).toLowerCase();

const countTextLines = (text) => {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
};

const PYTHON_AST_SKIP_HEAVY_DEFAULT_BYTES = 192 * 1024;
const PYTHON_AST_SKIP_HEAVY_DEFAULT_LINES = 3000;
const PYTHON_AST_SKIP_PATH_PARTS = ['pygments/lexers/'];
const PYTHON_AST_SKIP_PATH_SUFFIXES = ['_builtins.py', '/_mapping.py'];

export const shouldSkipPythonAstForFile = ({ text, relPath, options }) => {
  if (options?.pythonAst?.allowHeavyFiles === true) {
    return { skip: false, reason: null };
  }
  const normalizedPath = normalizeRelPathLower(options?.filePath || relPath || '');
  for (const pathPart of PYTHON_AST_SKIP_PATH_PARTS) {
    if (!normalizedPath.includes(pathPart)) continue;
    for (const suffix of PYTHON_AST_SKIP_PATH_SUFFIXES) {
      if (normalizedPath.endsWith(suffix)) {
        return { skip: true, reason: 'generated-path' };
      }
    }
  }
  const maxBytesRaw = Number(options?.pythonAst?.skipHeavyBytes);
  const maxBytes = Number.isFinite(maxBytesRaw) && maxBytesRaw > 0
    ? Math.floor(maxBytesRaw)
    : PYTHON_AST_SKIP_HEAVY_DEFAULT_BYTES;
  const fileSizeRaw = Number(options?.fileSizeBytes);
  const fileSize = Number.isFinite(fileSizeRaw) && fileSizeRaw >= 0
    ? Math.floor(fileSizeRaw)
    : Buffer.byteLength(String(text || ''), 'utf8');
  if (maxBytes > 0 && fileSize > maxBytes) {
    return { skip: true, reason: 'max-bytes' };
  }
  const maxLinesRaw = Number(options?.pythonAst?.skipHeavyLines);
  const maxLines = Number.isFinite(maxLinesRaw) && maxLinesRaw > 0
    ? Math.floor(maxLinesRaw)
    : PYTHON_AST_SKIP_HEAVY_DEFAULT_LINES;
  const lineHintRaw = Number(options?.fileLineCountHint);
  const fileLines = Number.isFinite(lineHintRaw) && lineHintRaw >= 0
    ? Math.floor(lineHintRaw)
    : countTextLines(text);
  if (maxLines > 0 && fileLines > maxLines) {
    return { skip: true, reason: 'max-lines' };
  }
  return { skip: false, reason: null };
};

export const createManagedAdapter = ({
  id,
  match,
  collectImports,
  prepare,
  buildRelations,
  extractDocMeta,
  flow,
  attachName,
  metadata = null,
  capabilityProfile = null
}) => {
  const adapter = {
    id,
    match,
    collectImports: (text, options) => collectImports(text, options)
  };
  if (typeof prepare === 'function') adapter.prepare = prepare;
  adapter.buildRelations = buildRelations;
  adapter.extractDocMeta = extractDocMeta;
  adapter.flow = flow;
  adapter.attachName = attachName;
  if (typeof metadata === 'function') adapter.metadata = metadata;
  if (capabilityProfile) adapter.capabilityProfile = capabilityProfile;
  return adapter;
};

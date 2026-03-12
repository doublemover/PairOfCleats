const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

function createChunkAccumulator(maxBytes = DEFAULT_MAX_BUFFER_BYTES) {
  const limit = Number.isFinite(Number(maxBytes)) ? Math.max(1, Number(maxBytes)) : DEFAULT_MAX_BUFFER_BYTES;
  const chunks = [];
  let size = 0;
  let truncated = false;
  return {
    push(chunk) {
      if (!chunk || truncated) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const nextSize = size + value.length;
      if (nextSize > limit) {
        const remaining = limit - size;
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        size = limit;
        truncated = true;
        return;
      }
      chunks.push(value);
      size = nextSize;
    },
    text() {
      return Buffer.concat(chunks).toString('utf8');
    },
    truncated() {
      return truncated;
    },
    size() {
      return size;
    }
  };
}

function resolveConfiguredCli(repoRoot, configuredPath, extraArgs = [], defaults = {}) {
  const rawPath = String(configuredPath || '').trim();
  if (!rawPath) return { ok: true, command: defaults.command, argsPrefix: extraArgs };
  if (!isPathLike(rawPath)) {
    return {
      ok: true,
      command: rawPath,
      argsPrefix: extraArgs
    };
  }
  const resolvedPath = resolveConfigPath(repoRoot, rawPath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return {
      ok: false,
      message: `PairOfCleats CLI path does not exist: ${rawPath}`,
      detail: `Configured path resolved to ${resolvedPath || rawPath}. Update pairofcleats.cliPath or clear it to use auto-detection.`
    };
  }
  let stats = null;
  try {
    stats = fs.statSync(resolvedPath);
  } catch {}
  if (!stats || !stats.isFile()) {
    return {
      ok: false,
      message: `PairOfCleats CLI path is not a file: ${rawPath}`,
      detail: `Configured path resolved to ${resolvedPath}. Point pairofcleats.cliPath at an executable file or JS entrypoint, or clear it to use auto-detection.`
    };
  }
  if (resolvedPath.toLowerCase().endsWith(String(defaults.jsExtension || '.js').toLowerCase())) {
    return {
      ok: true,
      command: process.execPath,
      argsPrefix: [resolvedPath, ...extraArgs]
    };
  }
  return { ok: true, command: resolvedPath, argsPrefix: extraArgs };
}

function resolveConfigPath(repoRoot, rawPath) {
  if (!rawPath) return '';
  if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) return rawPath;
  if (repoRoot) return path.join(repoRoot, rawPath);
  return rawPath;
}

function isPathLike(rawPath) {
  return path.isAbsolute(rawPath)
    || rawPath.startsWith('.')
    || rawPath.includes('/')
    || rawPath.includes('\\');
}

function parseJsonPayload(stdout, options = {}) {
  const label = String(options.label || 'PairOfCleats command');
  if (options.stdoutTruncated) {
    return {
      ok: false,
      kind: 'stdout-truncated',
      message: `${label} output exceeded the VS Code capture limit.`,
      detail: 'The CLI produced more JSON than the extension can safely buffer. Narrow the scope or reduce result volume.'
    };
  }
  try {
    return {
      ok: true,
      payload: JSON.parse(stdout || '{}')
    };
  } catch (error) {
    return {
      ok: false,
      kind: 'invalid-json',
      message: `${label} returned invalid JSON: ${error.message}`,
      detail: stdout || null
    };
  }
}

function parseSearchPayload(stdout, options = {}) {
  return parseJsonPayload(stdout, {
    ...options,
    label: 'PairOfCleats search'
  });
}

function summarizeProcessFailure({ code, timedOut, cancelled, stderr, stdout, stdoutTruncated, stderrTruncated, timeoutMs }) {
  if (cancelled) {
    return {
      kind: 'cancelled',
      message: 'PairOfCleats search was cancelled.',
      detail: null
    };
  }
  if (timedOut) {
    return {
      kind: 'timeout',
      message: `PairOfCleats search timed out after ${timeoutMs}ms.`,
      detail: null
    };
  }
  if (code !== 0) {
    const detail = String(stderr || stdout || '').trim();
    const truncationNote = stdoutTruncated || stderrTruncated ? '\n[output truncated]' : '';
    return {
      kind: 'nonzero-exit',
      message: `PairOfCleats search failed${Number.isFinite(code) ? ` (exit ${code})` : ''}.`,
      detail: `${detail}${truncationNote}`.trim() || null
    };
  }
  if (stdoutTruncated) {
    return {
      kind: 'truncated-output',
      message: 'PairOfCleats search output was truncated.',
      detail: 'stdout'
    };
  }
  return null;
}

async function openSearchHit(vscodeApi, repoRoot, hit) {
  const repoContext = normalizeRepoContext(repoRoot);
  const pathError = validateHitPath(repoContext, hit?.file);
  if (pathError) {
    return {
      ok: false,
      filePath: String(hit?.file || ''),
      message: pathError.message,
      detail: pathError.detail
    };
  }
  const targetUri = resolveHitUri(vscodeApi, repoContext, hit?.file);
  const filePath = targetUri?.fsPath || String(hit?.file || '');
  try {
    const document = await vscodeApi.workspace.openTextDocument(targetUri);
    try {
      const editor = await vscodeApi.window.showTextDocument(document, { preview: true });
      const range = buildHitRange(vscodeApi, hit);
      if (range) {
        editor.selection = new vscodeApi.Selection(range.start, range.end);
        editor.revealRange(range, vscodeApi.TextEditorRevealType.InCenter);
      }
      return { ok: true, filePath };
    } catch (error) {
      return {
        ok: false,
        filePath,
        message: `PairOfCleats could not navigate to ${filePath}: ${error?.message || error}`,
        detail: String(error?.stack || error?.message || error)
      };
    }
  } catch (error) {
    return {
      ok: false,
      filePath,
      message: `PairOfCleats could not open ${filePath}: ${error?.message || error}`,
      detail: String(error?.stack || error?.message || error)
    };
  }
}

function normalizeRepoContext(value) {
  if (value && typeof value === 'object' && (value.repoRoot || value.repoUri)) {
    return value;
  }
  return { repoRoot: value || null, repoUri: null };
}

function resolveHitUri(vscodeApi, repoContext, hitFile) {
  if (path.isAbsolute(hitFile)) {
    return vscodeApi.Uri.file(hitFile);
  }
  if (repoContext.repoUri && typeof vscodeApi.Uri?.joinPath === 'function') {
    const segments = String(hitFile || '').split(/[\\/]+/).filter(Boolean);
    return vscodeApi.Uri.joinPath(repoContext.repoUri, ...segments);
  }
  return vscodeApi.Uri.file(path.join(repoContext.repoRoot || '', String(hitFile || '')));
}

function buildHitRange(vscodeApi, hit) {
  if (!Number.isFinite(hit?.startLine) || hit.startLine <= 0) return null;
  const startLine = Math.max(0, Number(hit.startLine) - 1);
  const startCol = Number.isFinite(hit?.startCol) && hit.startCol > 0 ? Number(hit.startCol) - 1 : 0;
  const endLine = Number.isFinite(hit?.endLine) && hit.endLine > 0
    ? Math.max(startLine, Number(hit.endLine) - 1)
    : startLine;
  const endCol = Number.isFinite(hit?.endCol) && hit.endCol > 0
    ? Math.max(startCol, Number(hit.endCol) - 1)
    : startCol;
  const start = new vscodeApi.Position(startLine, startCol);
  const end = new vscodeApi.Position(endLine, endCol);
  return new vscodeApi.Range(start, end);
}

function validateHitPath(repoContext, hitFile) {
  const rawPath = String(hitFile || '');
  if (!rawPath) {
    return {
      message: 'PairOfCleats returned an invalid result path.',
      detail: 'The selected search hit did not include a file path.'
    };
  }
  if (!path.isAbsolute(rawPath)) {
    if (!isContainedRelativePath(rawPath)) {
      return {
        message: `PairOfCleats refused to open a path outside the repo: ${rawPath}`,
        detail: 'The selected search hit escaped the repo root via relative traversal.'
      };
    }
    return null;
  }
  if (repoContext.repoRoot && !isAbsolutePathContained(repoContext.repoRoot, rawPath)) {
    return {
      message: `PairOfCleats refused to open a path outside the repo: ${rawPath}`,
      detail: `Resolved absolute path is outside repo root ${repoContext.repoRoot}.`
    };
  }
  return null;
}

function isContainedRelativePath(rawPath) {
  const segments = String(rawPath).split(/[\\/]+/).filter(Boolean);
  let depth = 0;
  for (const segment of segments) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (depth === 0) return false;
      depth -= 1;
      continue;
    }
    depth += 1;
  }
  return true;
}

function isAbsolutePathContained(rootPath, targetPath) {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

module.exports = {
  DEFAULT_MAX_BUFFER_BYTES,
  createChunkAccumulator,
  resolveConfiguredCli,
  parseJsonPayload,
  parseSearchPayload,
  summarizeProcessFailure,
  openSearchHit
};

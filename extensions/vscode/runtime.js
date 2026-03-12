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
  const resolvedPath = resolveConfigPath(repoRoot, rawPath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return {
      ok: false,
      message: `PairOfCleats CLI path does not exist: ${rawPath}`,
      detail: `Configured path resolved to ${resolvedPath || rawPath}. Update pairofcleats.cliPath or clear it to use auto-detection.`
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

function parseSearchPayload(stdout, options = {}) {
  if (options.stdoutTruncated) {
    return {
      ok: false,
      kind: 'stdout-truncated',
      message: 'PairOfCleats search output exceeded the VS Code capture limit.',
      detail: 'The CLI produced more JSON than the extension can safely buffer. Narrow the query or reduce result volume.'
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
      message: `PairOfCleats search returned invalid JSON: ${error.message}`,
      detail: stdout || null
    };
  }
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
  const filePath = path.isAbsolute(hit.file)
    ? hit.file
    : path.join(repoRoot, hit.file);
  try {
    const document = await vscodeApi.workspace.openTextDocument(vscodeApi.Uri.file(filePath));
    const editor = await vscodeApi.window.showTextDocument(document, { preview: true });
    if (Number.isFinite(hit.startLine) && hit.startLine > 0) {
      const line = Math.max(0, Number(hit.startLine) - 1);
      const pos = new vscodeApi.Position(line, 0);
      const range = new vscodeApi.Range(pos, pos);
      editor.selection = new vscodeApi.Selection(pos, pos);
      editor.revealRange(range, vscodeApi.TextEditorRevealType.InCenter);
    }
    return { ok: true, filePath };
  } catch (error) {
    return {
      ok: false,
      filePath,
      message: `PairOfCleats could not open ${filePath}: ${error?.message || error}`,
      detail: String(error?.stack || error?.message || error)
    };
  }
}

module.exports = {
  DEFAULT_MAX_BUFFER_BYTES,
  createChunkAccumulator,
  resolveConfiguredCli,
  parseSearchPayload,
  summarizeProcessFailure,
  openSearchHit
};

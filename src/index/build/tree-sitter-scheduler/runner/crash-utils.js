const SUBPROCESS_CRASH_PREFIX = '[tree-sitter:schedule] crash-event ';
const SUBPROCESS_INJECTED_CRASH_PREFIX = '[tree-sitter:schedule] injected-crash ';
const SUBPROCESS_GRAMMAR_PROGRESS_RE = /^\[tree-sitter:schedule\]\s+(\S+):\s+(start|done)\b/i;
const SUBPROCESS_OUTPUT_TAIL_LINES = 24;

/**
 * Parse structured crash-event JSON payloads emitted by scheduler subprocesses.
 *
 * @param {Error & {result?:{stderr?:string}}} error
 * @returns {object[]}
 */
export const parseSubprocessCrashEvents = (error) => {
  const stderr = String(error?.result?.stderr || '');
  if (!stderr.trim()) return [];
  const out = [];
  const lines = stderr.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const prefixes = [SUBPROCESS_CRASH_PREFIX, SUBPROCESS_INJECTED_CRASH_PREFIX];
    let payload = null;
    for (const prefix of prefixes) {
      if (!trimmed.startsWith(prefix)) continue;
      payload = trimmed.slice(prefix.length).trim();
      break;
    }
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object') out.push(parsed);
    } catch {}
  }
  return out;
};

/**
 * Split text into trimmed non-empty lines.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
const splitNonEmptyLines = (value) => String(value || '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

/**
 * Return the trailing N non-empty lines from subprocess output.
 *
 * @param {unknown} value
 * @param {number} [maxLines]
 * @returns {string[]}
 */
export const tailLines = (value, maxLines = SUBPROCESS_OUTPUT_TAIL_LINES) => {
  const lines = splitNonEmptyLines(value);
  if (!lines.length) return [];
  if (!Number.isFinite(maxLines) || maxLines <= 0) return lines;
  if (lines.length <= maxLines) return lines;
  return lines.slice(lines.length - maxLines);
};

/**
 * Identify fatal child exits that indicate a native parser crash path.
 *
 * @param {{exitCode?:number,signal?:string|null}} input
 * @returns {boolean}
 */
export const isSubprocessCrashExit = ({ exitCode, signal }) => {
  if (typeof signal === 'string' && signal) return true;
  if (!Number.isFinite(exitCode)) return false;
  if (exitCode < 0) return true;
  // Windows NTSTATUS-style fatal exits (e.g. 0xC0000005 access violation).
  return exitCode >= 0xC0000000;
};

/**
 * Infer likely failed grammar keys by reconciling start/done lifecycle logs.
 *
 * @param {{grammarKeysForTask?:string[],stdout?:string,stderr?:string}} input
 * @returns {string[]}
 */
export const inferFailedGrammarKeysFromSubprocessOutput = ({ grammarKeysForTask, stdout = '', stderr = '' }) => {
  const keys = Array.isArray(grammarKeysForTask)
    ? grammarKeysForTask.filter((key) => typeof key === 'string' && key)
    : [];
  if (!keys.length) return [];
  const keySet = new Set(keys);
  const started = new Set();
  const done = new Set();
  const lifecycleLines = [
    ...splitNonEmptyLines(stdout),
    ...splitNonEmptyLines(stderr)
  ];
  for (const line of lifecycleLines) {
    const match = line.match(SUBPROCESS_GRAMMAR_PROGRESS_RE);
    if (!match) continue;
    const grammarKey = String(match[1] || '').trim();
    const phase = String(match[2] || '').toLowerCase();
    if (!grammarKey || !keySet.has(grammarKey)) continue;
    if (phase === 'start') {
      started.add(grammarKey);
      continue;
    }
    if (phase === 'done') done.add(grammarKey);
  }
  const firstUndoneIndex = keys.findIndex((grammarKey) => !done.has(grammarKey));
  if (firstUndoneIndex >= 0) {
    return keys.slice(firstUndoneIndex);
  }
  // If all keys logged "done" but the subprocess still crashed, attribute to
  // the final grammar key so diagnostics are still actionable.
  return [keys[keys.length - 1]];
};

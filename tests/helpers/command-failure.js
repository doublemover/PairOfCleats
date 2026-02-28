/**
 * Normalize spawn output into UTF-8 text.
 *
 * @param {string|Buffer|null|undefined} value
 * @returns {string}
 */
const toText = (value) => {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return typeof value === 'string' ? value : '';
};

const trimLines = (value, maxLines = 80) => {
  const text = toText(value).trim();
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return lines.join('\n');
  return `${lines.slice(0, maxLines).join('\n')}\n... trimmed ${lines.length - maxLines} lines`;
};

const firstMeaningfulLine = (value) => {
  const text = toText(value);
  if (!text) return '';
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  return lines[0];
};

/**
 * Build a concise command failure report with root-cause hints.
 *
 * @param {{
 *   label:string,
 *   command?:string,
 *   cwd?:string,
 *   result:import('node:child_process').SpawnSyncReturns<string|Buffer>,
 *   maxLines?:number
 * }} input
 * @returns {string}
 */
export const formatCommandFailure = ({
  label,
  command = '',
  cwd = '',
  result,
  maxLines = 80
}) => {
  const lines = [];
  lines.push(`Failed: ${label}`);
  lines.push(`Exit: ${result?.status ?? 'null'}${result?.signal ? ` (signal ${result.signal})` : ''}`);
  if (result?.error) {
    lines.push(`Error: ${result.error.message || String(result.error)}`);
  }
  if (command) lines.push(`Command: ${command}`);
  if (cwd) lines.push(`CWD: ${cwd}`);
  const signature = firstMeaningfulLine(result?.stderr) || firstMeaningfulLine(result?.stdout);
  if (signature) lines.push(`Signature: ${signature}`);
  const stderrText = trimLines(result?.stderr, maxLines);
  const stdoutText = trimLines(result?.stdout, maxLines);
  if (stderrText) {
    lines.push('--- stderr ---');
    lines.push(stderrText);
  }
  if (stdoutText) {
    lines.push('--- stdout ---');
    lines.push(stdoutText);
  }
  return lines.join('\n');
};

/**
 * Format failure output from helpers that throw normalized command metadata
 * instead of returning SpawnSync result objects.
 *
 * @param {{
 *   label:string,
 *   command?:string,
 *   cwd?:string,
 *   error: {
 *     exitCode?: number|null,
 *     signal?: string|null,
 *     spawnError?: Error|null,
 *     stdout?: string,
 *     stderr?: string
 *   },
 *   maxLines?: number
 * }} input
 * @returns {string}
 */
export const formatErroredCommandFailure = ({
  label,
  command = '',
  cwd = '',
  error,
  maxLines = 80
}) => {
  const normalizedResult = {
    status: Number.isFinite(Number(error?.exitCode)) ? Number(error.exitCode) : null,
    signal: typeof error?.signal === 'string' ? error.signal : null,
    error: error?.spawnError || null,
    stdout: toText(error?.stdout),
    stderr: toText(error?.stderr)
  };
  return formatCommandFailure({
    label,
    command,
    cwd,
    result: normalizedResult,
    maxLines
  });
};


import {
  spawnSubprocess
} from '../../../shared/subprocess.js';

const summarize = (value, maxChars = 220) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
};

/**
 * Run a fail-open workspace probe command and normalize timeout/error/exit failures
 * to a shared degraded preflight classification shape.
 *
 * @param {{
 *   ctx?: { repoRoot?: string }|null,
 *   cmd: string,
 *   args: string[],
 *   timeoutMs: number,
 *   abortSignal?: AbortSignal|null,
 *   reasonPrefix: string,
 *   label: string
 * }} input
 * @returns {{
 *   state: 'ready'|'degraded',
 *   reasonCode: string|null,
 *   message: string,
 *   check: {name:string,status:'warn',message:string}|null,
 *   checks: Array<object>
 * }>}
 */
export const runWorkspaceCommandPreflight = async ({
  ctx,
  cmd,
  args,
  timeoutMs,
  abortSignal = null,
  reasonPrefix,
  label
}) => {
  const command = String(cmd || '').trim();
  const commandArgs = Array.isArray(args) ? args.map((entry) => String(entry)) : [];
  const timeout = Number.isFinite(Number(timeoutMs))
    ? Math.max(500, Math.floor(Number(timeoutMs)))
    : 5000;
  const prefix = String(reasonPrefix || '').trim().toLowerCase();
  const descriptor = String(label || 'workspace probe').trim() || 'workspace probe';
  if (!command || !prefix) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  try {
    const result = await spawnSubprocess(command, commandArgs, {
      cwd: String(ctx?.repoRoot || process.cwd()),
      stdio: ['ignore', 'pipe', 'pipe'],
      rejectOnNonZeroExit: false,
      captureStdout: true,
      captureStderr: true,
      outputMode: 'string',
      outputEncoding: 'utf8',
      timeoutMs: timeout,
      killTree: true,
      ...(abortSignal ? { signal: abortSignal } : {})
    });
    const exitCode = Number(result?.exitCode);
    if (Number.isFinite(exitCode) && exitCode === 0) {
      return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
    }
    const summary = summarize(result?.stderr || result?.stdout);
    const message = summary
      ? `${descriptor} probe failed (exit ${Number.isFinite(exitCode) ? exitCode : 'unknown'}): ${summary}`
      : `${descriptor} probe failed (exit ${Number.isFinite(exitCode) ? exitCode : 'unknown'}).`;
    return {
      state: 'degraded',
      reasonCode: `${prefix}_failed`,
      message,
      check: {
        name: `${prefix}_failed`,
        status: 'warn',
        message
      },
      checks: []
    };
  } catch (error) {
    if (error?.code === 'ABORT_ERR') {
      throw error;
    }
    if (error?.code === 'SUBPROCESS_TIMEOUT') {
      const message = `${descriptor} probe timed out after ${timeout}ms.`;
      return {
        state: 'degraded',
        reasonCode: `${prefix}_timeout`,
        message,
        check: {
          name: `${prefix}_timeout`,
          status: 'warn',
          message
        },
        checks: []
      };
    }
    const message = `${descriptor} probe error: ${summarize(error?.message || error) || 'unknown error'}`;
    return {
      state: 'degraded',
      reasonCode: `${prefix}_error`,
      message,
      check: {
        name: `${prefix}_error`,
        status: 'warn',
        message
      },
      checks: []
    };
  }
};

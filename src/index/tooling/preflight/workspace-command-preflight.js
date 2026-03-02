import {
  isSyncCommandTimedOut,
  runSyncCommandWithTimeout,
  toSyncCommandExitCode
} from '../../../shared/subprocess/sync-command.js';

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
 *   reasonPrefix: string,
 *   label: string
 * }} input
 * @returns {{
 *   state: 'ready'|'degraded',
 *   reasonCode: string|null,
 *   message: string,
 *   check: {name:string,status:'warn',message:string}|null,
 *   checks: Array<object>
 * }}
 */
export const runWorkspaceCommandPreflight = ({
  ctx,
  cmd,
  args,
  timeoutMs,
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
  const result = runSyncCommandWithTimeout(command, commandArgs, {
    cwd: String(ctx?.repoRoot || process.cwd()),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeoutMs: timeout,
    killTree: true
  });

  if (isSyncCommandTimedOut(result)) {
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

  const exitCode = toSyncCommandExitCode(result);
  if (exitCode === 0) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }

  if (result?.error) {
    const message = `${descriptor} probe error: ${summarize(result.error?.message || result.error) || 'unknown error'}`;
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

  const summary = summarize(result?.stderr || result?.stdout);
  const message = summary
    ? `${descriptor} probe failed (exit ${exitCode}): ${summary}`
    : `${descriptor} probe failed (exit ${exitCode}).`;
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
};

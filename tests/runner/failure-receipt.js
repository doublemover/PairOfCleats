import fs from 'node:fs/promises';
const secretKey = /^(?:--?)?(?:password|passwd|token|access[-_]?token|api[-_]?key|secret|authorization|credential)$/i;
export const redactRunnerArguments = args => {
  let hideNext = false, redacted = false;
  const values = args.map(value => {
    const text = String(value);
    if (hideNext) { hideNext = false; redacted = true; return '[REDACTED]'; }
    const equal = text.indexOf('=');
    if (equal >= 0 && secretKey.test(text.slice(0, equal))) { redacted = true; return text.slice(0, equal + 1) + '[REDACTED]'; }
    if (secretKey.test(text)) hideNext = true;
    return text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, (_, protocol) => { redacted = true; return protocol + '[REDACTED]@'; })
      .replace(/([?&](?:token|access_token|api_key|secret|password)=)[^&\s]+/gi, (_, prefix) => { redacted = true; return prefix + '[REDACTED]'; });
  });
  return { values, redacted };
};
export const buildFailureReceipt = ({ test, attempt, result, logPath }) => {
  const execution = result.execution || {}, args = redactRunnerArguments(execution.args || []);
  const raw = result.exitCode ?? null, unsigned = Number.isInteger(raw) && raw >= -2147483648 && raw <= 4294967295 ? raw >>> 0 : null;
  return { schemaVersion: 1, testId: test.id, attempt, recordedBy: 'test-runner-parent',
    invocation: { executable: execution.executable || null, resolvedExecutable: execution.resolvedExecutable || null,
      arguments: args.values, argumentsRedacted: args.redacted, cwd: execution.cwd || null,
      runtime: execution.runtime || null },
    process: { parentPid: process.pid, childPid: execution.pid ?? null, startedAt: execution.startedAt || null,
      endedAt: execution.endedAt || null },
    outcome: { status: result.status, rawExitStatus: raw, unsignedDecimal: unsigned,
      signedDecimal: unsigned === null ? null : unsigned | 0, hex: unsigned === null ? null : '0x' + unsigned.toString(16).toUpperCase().padStart(8, '0'),
      interpretation: process.platform === 'win32' && unsigned === 0xC0000005 ? 'Windows STATUS_ACCESS_VIOLATION value; faulting module and cause unknown' : null,
      signal: result.signal || null, spawnError: execution.spawnError || null, timedOut: result.timedOut,
      termination: result.termination || null, statusSource: execution.statusSource || 'unknown',
      propagation: 'Parent recorded the directly spawned test process status; descendant status propagation is not inferred.' },
    phase: { crashPhase: 'unknown', lastObservedMarker: execution.lastPhase || null, basis: 'Last captured child log marker; not a native stack or proof of crash location.' },
    output: { logPath, captured: execution.captureOutput === true, stdout: execution.stdout || null, stderr: execution.stderr || null,
      streamOrdering: 'stdout and stderr are captured separately; no total ordering guaranteed' } };
};
/** Parent-owned file survives a child native exit; no child exception handler is required. */
export const writeFailureReceipt = async ({ test, attempt, result, logPath }) => {
  if (!logPath || result.status !== 'failed') return null;
  const filename = logPath.replace(/\.log$/, '.failure.json');
  const handle = await fs.open(filename, 'w');
  try { await handle.writeFile(JSON.stringify(buildFailureReceipt({ test, attempt, result, logPath }), null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  return filename;
};

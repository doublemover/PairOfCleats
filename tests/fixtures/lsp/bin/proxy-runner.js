#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TERMINATION_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];

const toExitCodeFromSignal = (signal) => {
  if (typeof signal !== 'string' || !signal.trim()) return 1;
  return 128;
};

export const launchStubServer = ({
  metaUrl,
  mode,
  passthroughArgs = []
}) => {
  const __filename = fileURLToPath(metaUrl);
  const __dirname = path.dirname(__filename);
  const script = path.join(__dirname, '..', 'stub-lsp-server.js');
  const baseArgs = [script];
  if (mode != null && String(mode).trim()) {
    baseArgs.push('--mode', String(mode));
  }
  const child = spawn(
    process.execPath,
    [...baseArgs, ...(Array.isArray(passthroughArgs) ? passthroughArgs : [])],
    { stdio: 'inherit' }
  );
  let settling = false;
  const terminateChild = (signal = 'SIGTERM') => {
    if (settling) return;
    if (child.exitCode !== null || child.killed) return;
    try {
      child.kill(signal);
    } catch {}
    const hardStopTimer = setTimeout(() => {
      if (child.exitCode !== null || child.killed) return;
      try {
        child.kill('SIGKILL');
      } catch {}
    }, 250);
    hardStopTimer.unref?.();
  };
  for (const signal of TERMINATION_SIGNALS) {
    process.once(signal, () => {
      terminateChild(signal);
      const exitCode = toExitCodeFromSignal(signal);
      process.exit(exitCode);
    });
  }
  process.once('exit', () => {
    terminateChild('SIGTERM');
  });
  child.once('error', () => {
    settling = true;
    process.exit(1);
  });
  child.once('exit', (code, signal) => {
    settling = true;
    if (Number.isInteger(code)) {
      process.exit(code);
    }
    process.exit(toExitCodeFromSignal(signal));
  });
  return child;
};

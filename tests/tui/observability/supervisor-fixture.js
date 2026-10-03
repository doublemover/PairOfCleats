import { ensureTestingEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

ensureTestingEnv(process.env);

const PROTOCOL = 'poc.tui@1';
const POLL_INTERVAL_MS = 20;

export const root = process.cwd();

const supervisorPath = path.join(root, 'tools', 'tui', 'supervisor.js');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const splitProtocolLines = (state, chunk) => {
  const normalized = `${state.pending}${String(chunk)}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n');
  state.pending = parts.pop() || '';
  return parts.map((line) => line.trim()).filter(Boolean);
};

const createProtocolCapture = (stream) => {
  const state = { pending: '' };
  const lines = [];
  const events = [];
  stream.on('data', (chunk) => {
    for (const line of splitProtocolLines(state, chunk)) {
      lines.push(line);
      events.push(JSON.parse(line));
    }
  });
  return { events, lines };
};

const waitForChildExit = (child) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
};

export const createSupervisorFixture = async ({ tempPrefix, runId, beforeStart } = {}) => {
  const logDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  if (typeof beforeStart === 'function') {
    await beforeStart({ logDir });
  }

  const child = spawn(process.execPath, [supervisorPath], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PAIROFCLEATS_TUI_EVENT_LOG_DIR: logDir,
      PAIROFCLEATS_TUI_RUN_ID: runId
    }
  });
  child.stderr.on('data', () => {});

  const capture = createProtocolCapture(child.stdout);
  const waitForEvent = async (
    predicate,
    { timeoutMs = 12000, message = 'timeout waiting for supervisor event' } = {}
  ) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = capture.events.find(predicate);
      if (match) return match;
      await delay(POLL_INTERVAL_MS);
    }
    throw new Error(message);
  };

  const send = (payload) => {
    child.stdin.write(`${JSON.stringify({ proto: PROTOCOL, ...payload })}\n`);
  };

  const shutdown = async (reason = 'test_complete') => {
    send({ op: 'shutdown', reason });
    return await waitForChildExit(child);
  };

  const cleanup = async ({ extraPaths = [] } = {}) => {
    try { child.kill('SIGKILL'); } catch {}
    for (const extraPath of extraPaths.filter(Boolean)) {
      await fsPromises.rm(extraPath, { recursive: true, force: true });
    }
    await fsPromises.rm(logDir, { recursive: true, force: true });
  };

  return {
    child,
    events: capture.events,
    logDir,
    runId,
    send,
    shutdown,
    stdoutLines: capture.lines,
    waitForEvent,
    cleanup
  };
};

export const pathExists = (targetPath) => fs.existsSync(targetPath);

export const resolveEventLogPath = ({ logDir, runId }) => path.join(logDir, `${runId}.jsonl`);

export const resolveMetaPath = ({ logDir, runId }) => path.join(logDir, `${runId}.meta.json`);

export const resolveLogArtifactPath = (logDir, filename) => path.join(logDir, filename);

export const resolveSiblingPath = (baseDir, filename) => path.resolve(baseDir, '..', filename);

export const resolveMetadataEventLogPath = (eventLogPath) => (
  path.resolve(root, String(eventLogPath || '').replace(/\//g, path.sep))
);

export const readJsonFile = async (targetPath) => JSON.parse(await fsPromises.readFile(targetPath, 'utf8'));

export const readTextLines = (targetPath) => fs.readFileSync(targetPath, 'utf8').split(/\r?\n/).filter(Boolean);

export const readJsonlEvents = (targetPath) => readTextLines(targetPath).map((line) => JSON.parse(line));

export const findLogArtifacts = async (logDir) => {
  const entries = await fsPromises.readdir(logDir);
  return {
    jsonl: entries.find((entry) => entry.endsWith('.jsonl')),
    meta: entries.find((entry) => entry.endsWith('.meta.json'))
  };
};

export const removePath = async (targetPath) => {
  await fsPromises.rm(targetPath, { recursive: true, force: true });
};

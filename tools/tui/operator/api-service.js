import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { getEnvSecrets } from '../../../src/shared/env/runtime.js';
import { sameIdentityPath } from '../../../src/shared/indexing/build-pointer-roots.js';

const fault = (code, message) => Object.assign(new Error(message), { code });

/** A fixed loopback request; no URL, redirect, proxy, or credential is admitted
 * from producer output. The caller must first verify this owned child's startup.
 */
export const probeOwnedApiHealth = (port, { signal, env = process.env } = {}) => new Promise((resolve, reject) => {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) { reject(fault('ERR_TUI_API_ENDPOINT', 'Invalid owned API port.')); return; }
  const token = getEnvSecrets(env).apiToken;
  const request = http.get({ hostname: '127.0.0.1', port, path: '/health', method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(2000)]) : AbortSignal.timeout(2000) }, response => {
    const chunks = []; let bytes = 0;
    response.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 8192) { response.destroy(fault('ERR_TUI_API_HEALTH_BYTES', 'Health response exceeded its byte bound.')); return; }
      chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (response.statusCode !== 200 || value?.ok !== true || !Number.isSafeInteger(value.uptimeMs) || value.uptimeMs < 0) {
          throw fault('ERR_TUI_API_HEALTH', 'Owned API health did not return the canonical success shape.');
        }
        resolve({ ok: true, httpStatus: response.statusCode, uptimeMs: value.uptimeMs });
      } catch { reject(fault('ERR_TUI_API_HEALTH', 'Owned API health did not complete.')); }
    });
  });
  request.on('error', () => reject(fault('ERR_TUI_API_HEALTH', 'Owned API health request failed.')));
});

/** Start only a canonical API child. An occupied port cannot establish health:
 * no endpoint is probed until this exact child reports a verified listen event.
 */
export const createTuiApiServices = ({ toolRoot, requireScope, spawn = spawnSubprocess,
  probe = probeOwnedApiHealth } = {}) => {
  const services = new Map();
  const run = async ({ scope, jobId, argv }, { signal, env, onSpawn, onActivity }) => {
    requireScope(scope.id);
    if (services.size >= 2 || [...services.values()].some(entry => entry.scopeId === scope.id)) {
      throw fault('ERR_TUI_API_ADMISSION', 'This session already owns the selected API service or reached its two-service bound.');
    }
    const controller = new AbortController(), lifetime = AbortSignal.any([signal, controller.signal]);
    let resolveStartup, rejectStartup, settle;
    const startup = new Promise((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject; });
    startup.catch(() => {});
    const settlement = new Promise(resolve => { settle = resolve; });
    const entry = { scopeId: scope.id, jobId, controller, settlement, pid: null, phase: 'starting',
      endpoint: null, lastHealthAt: null, healthChecks: 0, healthErrorCode: null };
    services.set(jobId, entry);
    let line = '', stderrTail = '', announced = false, childClosed = false, failure = null;
    const stop = error => { failure ||= error; controller.abort(error); rejectStartup(error); };
    const startupTimer = setTimeout(() => stop(fault('ERR_TUI_API_STARTUP_TIMEOUT', 'Owned API startup did not complete.')), 10000);
    const completion = Promise.resolve().then(() => spawn(process.execPath, [path.join(toolRoot, 'bin/pairofcleats.js'), ...argv], {
      cwd: scope.configRoot, env, signal: lifetime, stdio: ['ignore', 'pipe', 'pipe'],
      captureStdout: false, captureStderr: false, rejectOnNonZeroExit: false,
      onSpawn: child => { entry.pid = child.pid; onSpawn?.(child); },
      onStdout: chunk => {
        if (announced || lifetime.aborted) return;
        if (Buffer.byteLength(chunk) + Buffer.byteLength(line) > 64 * 1024) {
          stop(fault('ERR_TUI_API_STARTUP_BYTES', 'Owned API startup exceeded its byte bound.')); return;
        }
        line += chunk;
        const newline = line.indexOf('\n');
        if (newline < 0) return;
        try {
          const value = JSON.parse(line.slice(0, newline));
          if (value?.ok !== true || value.host !== '127.0.0.1' || !Number.isSafeInteger(value.port)
            || value.port < 1 || value.port > 65535 || !sameIdentityPath(value.repo, scope.configRoot)
            || value.baseUrl !== `http://127.0.0.1:${value.port}`) throw new Error('Unexpected startup identity.');
          announced = true; line = ''; clearTimeout(startupTimer);
          entry.endpoint = value.baseUrl; entry.phase = 'listening-unverified'; resolveStartup(value.port);
        } catch { stop(fault('ERR_TUI_API_STARTUP', 'Owned API startup identity did not match its reviewed scope.')); }
      }, onStderr: chunk => {
        stderrTail = (stderrTail + String(chunk).slice(-256)).slice(-512);
        if (/\bEADDRINUSE\b/.test(stderrTail)) failure ||= fault('ERR_TUI_API_PORT_IN_USE', 'Owned API bind address is already in use.');
      } })).then(result => result, () => ({ exitCode: null, signal: null })).then(result => {
      childClosed = true; clearTimeout(startupTimer);
      rejectStartup(failure || fault('ERR_TUI_API_EXIT', 'Owned API process exited before startup.'));
      return result;
    });
    try {
      const port = await startup;
      while (!lifetime.aborted && !childClosed) {
        requireScope(scope.id);
        try {
          const health = await probe(port, { signal: lifetime, env });
          if (!childClosed && !lifetime.aborted && health.ok === true) {
            entry.phase = 'healthy'; entry.lastHealthAt = new Date().toISOString(); entry.healthErrorCode = null;
            entry.healthChecks += 1;
          }
        } catch { entry.phase = 'unhealthy'; entry.healthErrorCode = 'ERR_TUI_API_HEALTH'; }
        if (childClosed || lifetime.aborted) break;
        onActivity({ phase: 'api-health', stage: entry.phase, current: entry.healthChecks,
          unit: 'verified responses', message: 'Owned API startup identity and loopback /health observation.' });
        const sleeper = new AbortController();
        try { await Promise.race([completion, delay(5000, null, {
          signal: AbortSignal.any([lifetime, sleeper.signal]) }).catch(() => {})]); }
        finally { sleeper.abort(); }
      }
      const result = await completion;
      if (failure) throw failure;
      return { exitCode: signal.aborted ? 130 : 1, signal: result.signal || null,
        stdout: JSON.stringify({ service: 'api', endpoint: entry.endpoint, stopped: true,
          lastHealthAt: entry.lastHealthAt, healthChecks: entry.healthChecks }) };
    } finally {
      controller.abort(); clearTimeout(startupTimer); await completion;
      services.delete(jobId); settle();
    }
  };
  const status = scopeId => [...services.values()].filter(entry => entry.scopeId === scopeId)
    .map(({ controller: _controller, settlement: _settlement, scopeId: _scope, ...entry }) => ({ service: 'api', ...entry,
      healthMeaning: 'Last bounded /health response after this child\'s listen event; no index/search readiness claim.' }));
  return { run, status, dispose: async () => {
    const owned = [...services.values()];
    for (const entry of owned) entry.controller.abort();
    await Promise.all(owned.map(entry => entry.settlement));
  } };
};

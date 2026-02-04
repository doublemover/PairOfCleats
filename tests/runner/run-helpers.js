import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { splitCsv } from './run-discovery.js';

export const mergeNodeOptions = (base, extra) => {
  const baseText = typeof base === 'string' ? base.trim() : '';
  const extraText = typeof extra === 'string' ? extra.trim() : '';
  if (!extraText) return baseText;
  if (!baseText) return extraText;
  return `${baseText} ${extraText}`.trim();
};

export const resolveRetries = ({ cli, env, defaultRetries }) => {
  if (Number.isFinite(cli)) return Math.max(0, Math.floor(cli));
  if (Number.isFinite(env)) return Math.max(0, Math.floor(env));
  return defaultRetries;
};

export const resolveTimeout = ({ cli, env, defaultTimeout }) => {
  if (Number.isFinite(cli)) return Math.max(1000, Math.floor(cli));
  if (Number.isFinite(env)) return Math.max(1000, Math.floor(env));
  return defaultTimeout;
};

export const resolveLogDir = ({ cli, env, defaultDir, root }) => {
  const raw = String(cli || env || '').trim();
  if (raw) return path.resolve(root, raw);
  return defaultDir ? path.resolve(defaultDir) : '';
};

export const resolvePhysicalCores = () => {
  const logical = Math.max(1, Math.floor(os.cpus().length || 1));
  let logicalFromPlatform = null;
  try {
    if (process.platform === 'win32') {
      const output = execSync(
        'powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Sum NumberOfCores).Sum"',
        { encoding: 'utf8', timeout: 3000 }
      );
      const total = Number(String(output).trim());
      if (Number.isFinite(total) && total > 0) return total;
      const logicalOutput = execSync(
        'powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Sum NumberOfLogicalProcessors).Sum"',
        { encoding: 'utf8', timeout: 3000 }
      );
      const logicalTotal = Number(String(logicalOutput).trim());
      if (Number.isFinite(logicalTotal) && logicalTotal > 0) {
        logicalFromPlatform = logicalTotal;
      }
    }
    if (process.platform === 'darwin') {
      const output = execSync('sysctl -n hw.physicalcpu', { encoding: 'utf8', timeout: 3000 });
      const total = Number(output.trim());
      if (Number.isFinite(total) && total > 0) return total;
      const logicalOutput = execSync('sysctl -n hw.logicalcpu', { encoding: 'utf8', timeout: 3000 });
      const logicalTotal = Number(logicalOutput.trim());
      if (Number.isFinite(logicalTotal) && logicalTotal > 0) {
        logicalFromPlatform = logicalTotal;
      }
    }
    if (process.platform === 'linux') {
      try {
        const output = execSync('lscpu -p=CORE,SOCKET', { encoding: 'utf8', timeout: 3000 });
        const cores = new Set();
        output.split(/\r?\n/).forEach((line) => {
          if (!line || line.startsWith('#')) return;
          cores.add(line.trim());
        });
        if (cores.size > 0) return cores.size;
      } catch {}
      try {
        const logicalOutput = execSync('lscpu -p=CPU', { encoding: 'utf8', timeout: 3000 });
        const logicalCores = new Set();
        logicalOutput.split(/\r?\n/).forEach((line) => {
          if (!line || line.startsWith('#')) return;
          logicalCores.add(line.trim());
        });
        if (logicalCores.size > 0) {
          logicalFromPlatform = logicalCores.size;
        }
      } catch {}
      if (logicalFromPlatform === null) {
        try {
          const output = execSync('nproc --all', { encoding: 'utf8', timeout: 3000 });
          const total = Number(output.trim());
          if (Number.isFinite(total) && total > 0) {
            logicalFromPlatform = total;
          }
        } catch {}
      }
      if (Number.isFinite(logicalFromPlatform) && logicalFromPlatform > 0) {
        try {
          const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
          const corePairs = new Set();
          let physicalId = null;
          let coreId = null;
          cpuinfo.split(/\r?\n/).forEach((line) => {
            if (!line.trim()) {
              if (physicalId !== null && coreId !== null) {
                corePairs.add(`${physicalId}:${coreId}`);
              }
              physicalId = null;
              coreId = null;
              return;
            }
            const [key, value] = line.split(':').map((entry) => entry && entry.trim());
            if (key === 'physical id') physicalId = value;
            if (key === 'core id') coreId = value;
          });
          if (physicalId !== null && coreId !== null) {
            corePairs.add(`${physicalId}:${coreId}`);
          }
          if (corePairs.size > 0) return corePairs.size;
        } catch {}
      }
    }
  } catch {}
  const logicalFallback = Number.isFinite(logicalFromPlatform) && logicalFromPlatform > 0 ? logicalFromPlatform : logical;
  if (logicalFallback >= 4 && logicalFallback % 2 === 0) return logicalFallback / 2;
  return logicalFallback;
};

export const normalizeLaneArgs = (values) => {
  const raw = splitCsv(values.length ? values : ['ci']);
  let includeDestructive = false;
  let includeAll = false;
  const normalized = raw.map((lane) => {
    if (lane === 'all-with-destructive') {
      includeDestructive = true;
      includeAll = true;
      return 'all';
    }
    if (lane.endsWith('-with-destructive')) {
      includeDestructive = true;
      return lane.slice(0, -'-with-destructive'.length);
    }
    if (lane === 'all') {
      includeAll = true;
    }
    return lane;
  });
  if (includeAll) {
    return { requested: ['all'], includeDestructive, includeAll };
  }
  return { requested: normalized, includeDestructive, includeAll };
};

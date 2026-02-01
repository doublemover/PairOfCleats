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
  try {
    if (process.platform === 'win32') {
      const output = execSync('wmic cpu get NumberOfCores /value', { encoding: 'utf8', timeout: 3000 });
      const matches = output.match(/NumberOfCores=(\d+)/g) || [];
      const total = matches.reduce((sum, entry) => sum + Number(entry.split('=')[1] || 0), 0);
      if (Number.isFinite(total) && total > 0) return total;
    }
    if (process.platform === 'darwin') {
      const output = execSync('sysctl -n hw.physicalcpu', { encoding: 'utf8', timeout: 3000 });
      const total = Number(output.trim());
      if (Number.isFinite(total) && total > 0) return total;
    }
    if (process.platform === 'linux') {
      const output = execSync('lscpu -p=CORE,SOCKET', { encoding: 'utf8', timeout: 3000 });
      const cores = new Set();
      output.split(/\r?\n/).forEach((line) => {
        if (!line || line.startsWith('#')) return;
        cores.add(line.trim());
      });
      if (cores.size > 0) return cores.size;
    }
  } catch {}
  if (logical >= 4 && logical % 2 === 0) return logical / 2;
  return logical;
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

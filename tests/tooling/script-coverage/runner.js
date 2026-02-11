import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { toPosix } from '../../../src/shared/files.js';
import { rmDirRecursive } from '../../helpers/temp.js';

export const resolveRetries = ({ argvRetries, envRetries, defaultRetries = 2 }) => {
  if (Number.isFinite(argvRetries)) return Math.max(0, argvRetries);
  if (Number.isFinite(envRetries)) return Math.max(0, envRetries);
  return defaultRetries;
};

export const prepareCoverageDirs = async ({ baseCacheRoot, repoCacheRoot, failureLogRoot }) => {
  await rmDirRecursive(baseCacheRoot, { retries: 8, delayMs: 100 });
  await fsPromises.mkdir(repoCacheRoot, { recursive: true });
  await fsPromises.mkdir(failureLogRoot, { recursive: true });
};

const sanitizeLabel = (label) => label.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 120);

const writeFailureLog = (failureLogRoot, label, attempt, cmd, args, options, result) => {
  const safeLabel = sanitizeLabel(label);
  const logPath = path.join(failureLogRoot, `${safeLabel}.attempt-${attempt}.log`);
  const lines = [
    `label: ${label}`,
    `attempt: ${attempt}`,
    `command: ${[cmd, ...args].join(' ')}`,
    `cwd: ${options.cwd || process.cwd()}`,
    `exit: ${result.status ?? 'null'}`,
    ''
  ];
  if (result.stdout) {
    lines.push('--- stdout ---', String(result.stdout));
  }
  if (result.stderr) {
    lines.push('--- stderr ---', String(result.stderr));
  }
  fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
  return logPath;
};

export const createCommandRunner = ({ retries, failureLogRoot }) => {
  const run = (label, cmd, args, options = {}) => {
    const maxAttempts = retries + 1;
    const normalizeOutput = (value) => {
      if (!value) return '';
      let text = String(value);
      text = text.replace(/\r\n/g, '\n');
      text = text.replace(/\n{3,}/g, '\n\n');
      text = text.replace(/^\n+/, '\n');
      return text;
    };
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const { env: optionEnv, ...spawnOptions } = options;
      const env = { ...process.env, ...optionEnv };
      if (!env.PAIROFCLEATS_TEST_LOG_DIR) {
        env.PAIROFCLEATS_TEST_LOG_DIR = failureLogRoot;
      }
      const result = spawnSync(cmd, args, {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        stdio: 'pipe',
        env,
        ...spawnOptions
      });
      if (result.stdout) process.stdout.write(normalizeOutput(result.stdout));
      if (result.stderr) process.stderr.write(normalizeOutput(result.stderr));
      if (result.status === 0) return;
      if (result.status === 77) {
        console.log(`Skipped: ${label}`);
        return;
      }
      const logPath = writeFailureLog(failureLogRoot, label, attempt, cmd, args, options, result);
      console.error(`Failed: ${label} (attempt ${attempt}/${maxAttempts}). Log: ${logPath}`);
      if (attempt < maxAttempts) {
        console.error(`Retrying: ${label}`);
      }
    }
    process.exit(1);
  };

  const runNode = (label, scriptPath, args = [], options = {}) => {
    run(label, process.execPath, [scriptPath, ...args], options);
  };

  return { run, runNode };
};

export const runShellScripts = async ({ root, baseCacheRoot, run }) => {
  const shellScripts = [
    path.join(root, 'merge-history.sh'),
    path.join(root, 'merge-no-results.sh'),
    path.join(root, 'merge-metrics.sh'),
    path.join(root, 'tools', 'merge-history.sh'),
    path.join(root, 'tools', 'merge-no-results.sh'),
    path.join(root, 'tools', 'merge-metrics.sh'),
    path.join(root, 'tools', 'merge-agentinfo-notes.sh'),
    path.join(root, 'tools', 'merge-agentinfo-index.sh')
  ];

  const bashCheck = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
  const bashAvailable = bashCheck.status === 0;
  const jqCheck = bashAvailable ? spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' }) : null;
  const jqAvailable = jqCheck && jqCheck.status === 0;
  const toPosixPath = (value) => toPosix(value);
  const bashPathCheck = bashAvailable
    ? spawnSync('bash', ['-c', `cd "${toPosixPath(root)}"`], { encoding: 'utf8' })
    : null;
  const bashAccessible = bashPathCheck && bashPathCheck.status === 0;

  if (bashAvailable && bashAccessible) {
    const shellWorkDir = path.join(baseCacheRoot, 'shell');
    await fsPromises.mkdir(shellWorkDir, { recursive: true });
    const base = path.join(shellWorkDir, 'base.json');
    const ours = path.join(shellWorkDir, 'ours.json');
    const theirs = path.join(shellWorkDir, 'theirs.json');
    await fsPromises.writeFile(base, JSON.stringify({ file: { md: 1, code: 1 } }, null, 2));
    await fsPromises.writeFile(ours, JSON.stringify({ file: { md: 2, code: 0 } }, null, 2));
    await fsPromises.writeFile(theirs, JSON.stringify({ file: { md: 3, code: 2 } }, null, 2));

    for (const scriptPath of shellScripts) {
      if (!fs.existsSync(scriptPath)) continue;
      if (scriptPath.endsWith('merge-metrics.sh') && !jqAvailable) {
        console.log(`[skip] ${scriptPath} (jq not available)`);
        continue;
      }
      const args = [scriptPath, base, ours, theirs].map(toPosixPath);
      run('shell-script', 'bash', args, { cwd: root });
    }
  } else if (!bashAvailable) {
    console.log('[skip] shell scripts (bash not available)');
  } else {
    console.log('[skip] shell scripts (bash cannot access workspace path)');
  }
};

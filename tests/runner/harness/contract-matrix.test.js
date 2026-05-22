#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { copyFixtureToTemp } from '../../helpers/fixtures.js';
import { repoRoot } from '../../helpers/root.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');

const cases = [
  {
    name: 'pass target remains executable',
    async run() {
      const result = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'runner', 'harness', 'pass-target.test.js')], {
        encoding: 'utf8'
      });
      if (result.status !== 0) {
        throw new Error(result.stderr?.trim() || 'pass target failed');
      }
      if (!(result.stdout || '').includes('pass target ok')) {
        throw new Error('missing pass target success output');
      }
    }
  },
  {
    name: 'tests run correctly from the tests directory cwd',
    async run() {
      const target = path.join(ROOT, 'tests', 'tooling', 'config', 'contract-matrix.test.js');
      const result = spawnSync(process.execPath, [target], {
        cwd: path.join(ROOT, 'tests'),
        encoding: 'utf8'
      });
      if (result.status !== 0) {
        throw new Error(result.stderr?.trim() || 'cwd independence failed');
      }
    }
  },
  {
    name: 'copyFixtureToTemp does not mutate the source fixture',
    async run() {
      const fixturePath = path.join(ROOT, 'tests', 'fixtures', 'sample', 'README.md');
      const original = await fsPromises.readFile(fixturePath, 'utf8');
      const tempFixture = await copyFixtureToTemp('sample');
      const tempRoot = path.dirname(tempFixture);
      try {
        const tempReadme = path.join(tempFixture, 'README.md');
        await fsPromises.writeFile(tempReadme, `${original}\nmutation`);
        const updated = await fsPromises.readFile(fixturePath, 'utf8');
        if (updated !== original) {
          throw new Error('fixture source was mutated');
        }
      } finally {
        await rmDirRecursive(tempRoot);
      }
    }
  },
  {
    name: 'skip targets are reported as skipped with a reason',
    async run() {
      const result = spawnSync(process.execPath, [runnerPath, '--lane', 'all', '--match', 'runner/harness/skip-target', '--json'], {
        encoding: 'utf8'
      });
      if (result.status !== 0) {
        throw new Error(result.stderr?.trim() || 'skip semantics failed');
      }
      const payload = JSON.parse(result.stdout || '{}');
      const test = payload.tests?.[0];
      if (!payload.summary || payload.summary.skipped !== 1 || test?.status !== 'skipped') {
        throw new Error('expected one skipped test');
      }
      if (!test.skipReason || !test.skipReason.includes('skip target')) {
        throw new Error('missing skip reason');
      }
    }
  },
  {
    name: 'unit suffix tests are discoverable by runner selector',
    async run() {
      const result = spawnSync(process.execPath, [
        runnerPath,
        '--lane', 'unit',
        '--match', 'unit/retrieval-cache-key-asof',
        '--list',
        '--json'
      ], { encoding: 'utf8' });
      if (result.status !== 0) {
        throw new Error(result.stderr?.trim() || 'unit suffix discovery failed');
      }
      const payload = JSON.parse(result.stdout || '{}');
      const test = payload.tests?.find((entry) => entry.id === 'unit/retrieval-cache-key-asof');
      if (!test) {
        throw new Error('expected .unit.js test to be discoverable as unit/retrieval-cache-key-asof');
      }
      if (test.lane !== 'unit' || test.laneSource !== 'rule') {
        throw new Error('expected .unit.js test to be assigned to the unit lane by rule');
      }
    }
  },
  {
    name: 'redo targets are retried once and reported cleanly',
    async run() {
      if (process.platform !== 'win32') {
        return;
      }
      const markerPath = path.join(os.tmpdir(), `poc-redo-semantics-${process.pid}.marker`);
      fs.rmSync(markerPath, { force: true });
      try {
        const result = spawnSync(
          process.execPath,
          [runnerPath, '--lane', 'unit', '--match', 'harness/redo-target', '--json', '--retries', '0'],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              REDO_TARGET_HELPER: '1',
              REDO_TARGET_MARKER: markerPath
            }
          }
        );
        if (result.status !== 0) {
          throw new Error(result.stderr?.trim() || 'redo semantics failed');
        }
        const payload = JSON.parse(result.stdout || '{}');
        const test = payload.tests?.[0];
        if (!payload.summary || payload.summary.passed !== 1 || payload.summary.failed !== 0) {
          throw new Error('expected one passing redo target');
        }
        if (!test || test.status !== 'passed' || test.attempts !== 2) {
          throw new Error('redo target attempts/status contract failed');
        }
      } finally {
        fs.rmSync(markerPath, { force: true });
      }
    }
  },
  {
    name: 'timings ledgers are emitted with the expected schema',
    async run() {
      const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-timings-'));
      const timingsPath = path.join(tmpDir, 'timings.json');
      try {
        const result = spawnSync(process.execPath, [
          runnerPath,
          '--lane', 'all',
          '--match', 'harness/pass-target',
          '--json',
          '--timings-file', timingsPath
        ], { encoding: 'utf8' });
        if (result.status !== 0) {
          throw new Error(result.stderr?.trim() || 'timings ledger run failed');
        }
        const payload = JSON.parse(await fsPromises.readFile(timingsPath, 'utf8'));
        const row = payload.tests?.[0];
        if (payload.schemaVersion !== 1 || payload.pathPolicy !== 'repo-relative-posix' || payload.timeUnit !== 'ms') {
          throw new Error('timings ledger schema contract failed');
        }
        if (!payload.watchdog || typeof payload.watchdog.triggered !== 'boolean') {
          throw new Error('missing watchdog block');
        }
        if (!Array.isArray(payload.tests) || payload.tests.length !== 1) {
          throw new Error('expected one timings row');
        }
        if (typeof row.path !== 'string' || row.path.includes('\\')) {
          throw new Error('expected POSIX-normalized path');
        }
        if (!Number.isFinite(Number(row.durationMs))) {
          throw new Error('expected numeric durationMs');
        }
      } finally {
        await fsPromises.rm(tmpDir, { recursive: true, force: true });
      }
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('runner harness contract matrix test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import Ajv from 'ajv';

import { applyTestEnv } from '../../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'bench-output-schema');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const benchRunner = path.join(root, 'tools', 'bench', 'bench-runner.js');
const schemaPath = path.join(root, 'docs', 'schemas', 'bench-runner-report.schema.json');
const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const runCase = async ({ name, lines, useJsonFile }) => {
  const fixtureScript = path.join(tempRoot, `${name}.fixture.js`);
  await fs.writeFile(
    fixtureScript,
    [
      '#!/usr/bin/env node',
      ...lines.map((line) => `console.log(${JSON.stringify(line)});`),
      ''
    ].join('\n'),
    'utf8'
  );

  const outPath = path.join(tempRoot, `${name}.report.json`);
  const args = [benchRunner, '--scripts', fixtureScript, '--timeout-ms', '2000'];
  if (useJsonFile) {
    args.push('--json', outPath, '--quiet');
  }

  const result = spawnSync(
    process.execPath,
    args,
    { cwd: root, env: process.env, encoding: 'utf8' }
  );

  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    process.exit(result.status ?? 1);
  }

  const report = useJsonFile
    ? JSON.parse(await fs.readFile(outPath, 'utf8'))
    : JSON.parse(String(result.stdout || '{}'));
  const ok = validate(report);
  assert.ok(ok, ajv.errorsText(validate.errors, { separator: '\n' }));
};

const matrix = [
  {
    name: 'stdout-canonical',
    useJsonFile: false,
    lines: [
      '[bench] baseline duration=10.0ms throughput=100.0/s amount=1000',
      '[bench] current duration=8.0ms throughput=125.0/s amount=1000',
      '[bench] delta duration=-2.0ms (-20.0%) throughput=25.0/s (25.0%) amount=1000'
    ]
  },
  {
    name: 'file-noisy',
    useJsonFile: true,
    lines: [
      'noise before',
      '[bench] run-a baseline duration=10.0ms throughput=100.0/s amount=1000',
      '[bench] run-a current duration=8.0ms throughput=125.0/s amount=1000',
      '[bench] run-a delta duration=-2.0ms (-20.0%) throughput=25.0/s (25.0%) amount=1000',
      'noise after'
    ]
  }
];

for (const testCase of matrix) {
  await runCase(testCase);
}

console.log('bench output schema test passed');


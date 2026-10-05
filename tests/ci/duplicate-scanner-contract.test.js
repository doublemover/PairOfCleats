#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-duplicate-contract-'));
const cli = path.join(root, 'node_modules/jscpd/run-jscpd.js');
const config = JSON.parse(fs.readFileSync(path.join(root, '.jscpd.json'), 'utf8'));
const roots = ['src', 'bin', 'tools', 'tests', 'extensions', 'sublime'];
const source = 'export function example(input) {\n'
  + Array.from({ length: 30 }, (_, i) => `  const value${i} = input[${i}] + ${i};`).join('\n')
  + '\n  return value0;\n}\n';
try {
  const inputs = roots.map((name) => path.join(temp, name));
  for (const dir of inputs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'one.js'), source);
    fs.writeFileSync(path.join(dir, 'two.js'), source);
  }
  fs.mkdirSync(path.join(inputs[0], 'node_modules'));
  fs.writeFileSync(path.join(inputs[0], 'node_modules/ignored.js'), source);
  fs.writeFileSync(path.join(inputs[0], 'ignored.json'), JSON.stringify({ source }));
  fs.writeFileSync(path.join(inputs[0], 'oversize.js'), source.repeat(1000));
  fs.writeFileSync(path.join(inputs[0], '.gitignore'), 'gitignored.js\n');
  fs.writeFileSync(path.join(inputs[0], 'gitignored.js'), source);
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(inputs[0], 'one.js'), path.join(inputs[0], 'linked.js'));
  }
  const run = (name, overrides = {}, args = []) => {
    const output = path.join(temp, name);
    const configPath = path.join(temp, `${name}.json`);
    fs.writeFileSync(configPath, JSON.stringify({ ...config, ...overrides, output }));
    const result = spawnSync(process.execPath, [
      cli, '--config', configPath, '--absolute', '--workers', '1', ...args, ...inputs
    ], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.error, undefined, result.error?.message);
    return { result, output, report: JSON.parse(fs.readFileSync(path.join(output, 'jscpd-report.json'), 'utf8')) };
  };
  const ordinary = run('ordinary');
  assert.equal(ordinary.result.status, 0, ordinary.result.stderr);
  assert.equal(ordinary.report.statistics.total.sources, 12, 'all six roots scanned; ignored/oversized/symlink files excluded');
  assert.ok(ordinary.report.duplicates.length > 0, 'configured duplicate thresholds find controlled copies');
  assert.ok(fs.readFileSync(path.join(ordinary.output, 'jscpd-report.md'), 'utf8').length > 0);
  for (const duplicate of ordinary.report.duplicates) {
    assert.ok(path.isAbsolute(duplicate.firstFile.name), 'multi-root reports retain unambiguous paths');
    assert.ok(path.isAbsolute(duplicate.secondFile.name));
    assert.ok(duplicate.lines >= config.minLines);
    assert.ok(duplicate.tokens >= config.minTokens);
  }
  assert.equal(run('token-floor', { minTokens: 10000 }).report.duplicates.length, 0);
  assert.equal(run('line-floor', { minLines: 1000 }).report.duplicates.length, 0);
  assert.equal(run('threshold', {}, ['--threshold', '0']).result.status, 1, 'a violated duplication threshold must fail');
  console.log('duplicate scanner CLI/config/reporter and bounded scanning contract passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

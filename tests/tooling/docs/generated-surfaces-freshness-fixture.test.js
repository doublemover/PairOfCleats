#!/usr/bin/env node
import { ensureTestingEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execaSync } from 'execa';

ensureTestingEnv(process.env);

const root = process.cwd();
const toolPath = path.join(root, 'tools', 'docs', 'generated-surfaces.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pairofcleats-generated-surfaces-'));

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
};

const writeText = (filePath, contents) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

try {
  // Importing the builders in policy checks must not execute their writing CLIs.
  const builderUrls = ['repo-inventory', 'shared-module-ledger'].map((name) => (
    pathToFileURL(path.join(root, 'tools', 'docs', `${name}.js`)).href
  ));
  execaSync(process.execPath, ['--input-type=module', '--eval',
    `for (const url of ${JSON.stringify(builderUrls)}) await import(url);`
  ], { cwd: tempRoot });
  assert.equal(fs.existsSync(path.join(tempRoot, 'docs')), false, 'builder imports must not write local reports');

  writeJson(path.join(tempRoot, 'package.json'), { type: 'module' });
  writeText(
    path.join(tempRoot, 'tools', 'fixtures', 'generate-docs.js'),
    `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outMdIndex = args.indexOf('--out-md');
const valueIndex = args.indexOf('--value');
const outputJson = outIndex >= 0 ? args[outIndex + 1] : '';
const outputMd = outMdIndex >= 0 ? args[outMdIndex + 1] : '';
const requestedValue = valueIndex >= 0 ? args[valueIndex + 1] : 'ok';
const value = requestedValue === 'process-id' ? String(process.pid) : requestedValue;

if (outputJson) {
  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, JSON.stringify({ generatedAt: String(process.pid), value }, null, 2) + '\\n');
}
if (outputMd) {
  fs.mkdirSync(path.dirname(outputMd), { recursive: true });
  fs.writeFileSync(outputMd, '# Fixture\\n\\nvalue=' + value + '\\n');
}
`
  );

  writeText(
    path.join(tempRoot, 'tools', 'fixtures', 'audit-generated.js'),
    `#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);
const targetIndex = args.indexOf('--target');
const target = targetIndex >= 0 ? args[targetIndex + 1] : '';
if (!target || !fs.existsSync(target)) {
  console.error('missing target');
  process.exit(1);
}
console.log('audit ok');
`
  );

  const registryPath = path.join(tempRoot, 'docs', 'tooling', 'generated-surfaces.json');
  const registry = {
    schemaVersion: '1.0.0',
    surfaces: [
      {
        id: 'fixture-compare',
        owner: 'tests',
        committed: true,
        validationMode: 'registry-audited',
        freshnessExpectation: 'fixture compare',
        freshness: {
          mode: 'generated-compare',
          command: 'node tools/fixtures/generate-docs.js --out {output:0} --out-md {output:1} --value ok',
          outputs: [
            { format: 'json', omitKeys: ['generatedAt'] },
            { format: 'text' }
          ]
        },
        outputs: [
          'docs/generated/fixture.json',
          'docs/generated/fixture.md'
        ],
        refresh: {
          command: 'node tools/fixtures/generate-docs.js --out docs/generated/fixture.json --out-md docs/generated/fixture.md --value ok'
        },
        audit: {
          command: 'node tools/fixtures/audit-generated.js --target docs/generated/fixture.json'
        }
      },
      {
        id: 'fixture-audit',
        owner: 'tests',
        committed: true,
        validationMode: 'sync-check',
        freshnessExpectation: 'fixture audit',
        freshness: {
          mode: 'audit-command',
          command: 'node tools/fixtures/audit-generated.js --target docs/generated/audit.flag'
        },
        outputs: [
          'docs/generated/audit.flag'
        ],
        refresh: {
          command: 'node tools/fixtures/generate-docs.js --out docs/generated/unused.json --value ok'
        },
        audit: {
          command: 'node tools/fixtures/audit-generated.js --target docs/generated/audit.flag'
        }
      },
      {
        id: 'fixture-local',
        owner: 'tests',
        committed: false,
        validationMode: 'local-report',
        freshnessExpectation: 'local reports must be reproducible without a committed baseline',
        freshness: {
          mode: 'generated-reproducible',
          command: 'node tools/fixtures/generate-docs.js --out {output:0} --out-md {output:1} --value ok',
          outputs: [
            { format: 'json', omitKeys: ['generatedAt'] },
            { format: 'text' }
          ]
        },
        outputs: ['docs/generated/local.json', 'docs/generated/local.md'],
        refresh: {
          command: 'node tools/fixtures/generate-docs.js --out docs/generated/local.json --out-md docs/generated/local.md --value ok'
        }
      }
    ]
  };
  writeJson(registryPath, registry);

  writeJson(path.join(tempRoot, 'docs', 'generated', 'fixture.json'), {
    generatedAt: 'stale',
    value: 'ok'
  });
  writeText(path.join(tempRoot, 'docs', 'generated', 'fixture.md'), '# Fixture\n\nvalue=ok\n');
  writeText(path.join(tempRoot, 'docs', 'generated', 'audit.flag'), 'ok\n');

  const localSurface = registry.surfaces.find((surface) => surface.id === 'fixture-local');
  const localOutputs = localSurface.outputs.map((output) => path.join(tempRoot, output));
  execaSync(process.execPath, [toolPath, '--root', tempRoot, '--check'], { cwd: root });
  const freshPass = execaSync('node', [toolPath, '--root', tempRoot, '--check-freshness'], { cwd: root });
  if (!freshPass.stdout.includes('generated surfaces freshness check passed')) {
    console.error('generated surfaces freshness fixture test failed: expected fresh pass');
    process.exit(1);
  }
  assert.ok(localOutputs.every((output) => !fs.existsSync(output)), 'freshness checks must not create local reports');

  // Optional local caches can be stale, malformed or partly absent without
  // replacing source-derived checks or being rewritten as a side effect.
  writeText(localOutputs[0], 'stale local cache\n');
  execaSync(process.execPath, [toolPath, '--root', tempRoot, '--check-freshness', '--surface', 'fixture-local'], { cwd: root });
  assert.equal(fs.readFileSync(localOutputs[0], 'utf8'), 'stale local cache\n');
  assert.equal(fs.existsSync(localOutputs[1]), false);

  const localCommand = localSurface.freshness.command;
  localSurface.freshness.command = localCommand.replace('--value ok', '--value process-id');
  writeJson(registryPath, registry);
  assert.throws(
    () => execaSync(process.execPath, [toolPath, '--root', tempRoot, '--check-freshness', '--surface', 'fixture-local'], { cwd: root }),
    (error) => String(error.stderr).includes('fixture-local: non-reproducible output docs/generated/local.json'),
    'local-only outputs must still be checked for reproducibility'
  );
  localSurface.freshness.command = localCommand.replace(' --out-md {output:1}', '');
  writeJson(registryPath, registry);
  assert.throws(
    () => execaSync(process.execPath, [toolPath, '--root', tempRoot, '--check-freshness', '--surface', 'fixture-local'], { cwd: root }),
    (error) => String(error.stderr).includes('generator did not produce expected output docs/generated/local.md'),
    'every declared local output must be generated'
  );
  localSurface.freshness.command = localCommand;
  writeJson(registryPath, registry);
  execaSync(process.execPath, [toolPath, '--root', tempRoot, '--refresh', '--surface', 'fixture-local'], { cwd: root });
  assert.equal(JSON.parse(fs.readFileSync(localOutputs[0], 'utf8')).value, 'ok');
  assert.equal(fs.readFileSync(localOutputs[1], 'utf8'), '# Fixture\n\nvalue=ok\n');

  writeJson(path.join(tempRoot, 'docs', 'generated', 'fixture.json'), {
    generatedAt: 'stale',
    value: 'drifted'
  });
  let driftFailed = false;
  try {
    execaSync('node', [toolPath, '--root', tempRoot, '--check-freshness'], { cwd: root });
  } catch (error) {
    const stderr = String(error.stderr || '');
    if (!stderr.includes('fixture-compare: stale output docs/generated/fixture.json')) {
      console.error('generated surfaces freshness fixture test failed: missing stale-output summary');
      process.exit(1);
    }
    if (!stderr.includes('refresh: node tools/fixtures/generate-docs.js --out docs/generated/fixture.json --out-md docs/generated/fixture.md --value ok')) {
      console.error('generated surfaces freshness fixture test failed: missing refresh hint');
      process.exit(1);
    }
    driftFailed = true;
  }
  if (!driftFailed) {
    console.error('generated surfaces freshness fixture test failed: expected drift to fail');
    process.exit(1);
  }

  const refreshResult = execaSync('node', [toolPath, '--root', tempRoot, '--refresh', '--surface', 'fixture-compare'], { cwd: root });
  if (!refreshResult.stdout.includes('refreshed fixture-compare')) {
    console.error('generated surfaces freshness fixture test failed: missing refresh success output');
    process.exit(1);
  }
  const refreshedPass = execaSync('node', [toolPath, '--root', tempRoot, '--check-freshness'], { cwd: root });
  if (!refreshedPass.stdout.includes('generated surfaces freshness check passed')) {
    console.error('generated surfaces freshness fixture test failed: expected refreshed pass');
    process.exit(1);
  }

  fs.rmSync(path.join(tempRoot, 'docs', 'generated', 'audit.flag'));
  let auditFailed = false;
  try {
    execaSync('node', [toolPath, '--root', tempRoot, '--check-freshness'], { cwd: root });
  } catch (error) {
    const stderr = String(error.stderr || '');
    if (!stderr.includes('fixture-audit: audit failed')) {
      console.error('generated surfaces freshness fixture test failed: missing audit failure summary');
      process.exit(1);
    }
    auditFailed = true;
  }
  if (!auditFailed) {
    console.error('generated surfaces freshness fixture test failed: expected audit failure');
    process.exit(1);
  }
  assert.throws(
    () => execaSync(process.execPath, [toolPath, '--root', tempRoot, '--check'], { cwd: root }),
    (error) => String(error.stderr).includes('committed output missing for fixture-audit'),
    'registry checks must still reject missing committed outputs'
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('generated surfaces freshness fixture test passed');

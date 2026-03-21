#!/usr/bin/env node
import { ensureTestingEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
const value = valueIndex >= 0 ? args[valueIndex + 1] : 'ok';

if (outputJson) {
  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, JSON.stringify({ generatedAt: 'fresh', value }, null, 2) + '\\n');
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

  writeJson(path.join(tempRoot, 'docs', 'tooling', 'generated-surfaces.json'), {
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
          command: 'node tools/docs/generated-surfaces.js --check --surface fixture-compare'
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
      }
    ]
  });

  writeJson(path.join(tempRoot, 'docs', 'generated', 'fixture.json'), {
    generatedAt: 'stale',
    value: 'ok'
  });
  writeText(path.join(tempRoot, 'docs', 'generated', 'fixture.md'), '# Fixture\n\nvalue=ok\n');
  writeText(path.join(tempRoot, 'docs', 'generated', 'audit.flag'), 'ok\n');

  const freshPass = execaSync('node', [toolPath, '--root', tempRoot, '--check-freshness'], { cwd: root });
  if (!freshPass.stdout.includes('generated surfaces freshness check passed')) {
    console.error('generated surfaces freshness fixture test failed: expected fresh pass');
    process.exit(1);
  }

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
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('generated surfaces freshness fixture test passed');

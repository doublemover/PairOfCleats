#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createInProcessSearchRunner, ensureFixtureIndex } from '../../helpers/fixture-index.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const hasPython = () => {
  const candidates = ['python', 'python3'];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ['-c', 'import sys; sys.stdout.write("ok")'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === 'ok') return true;
  }
  return false;
};

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'fixture-sample',
  cacheScope: 'shared',
  requiredModes: ['code']
});
const runSearch = createInProcessSearchRunner({ fixtureRoot, env });
const pythonEnabled = hasPython();

const findCodeHit = (payload, predicate) => (payload.code || []).find((entry) => {
  try {
    return predicate(entry);
  } catch {
    return false;
  }
});

const cases = [
  {
    label: 'Python decorator metadata',
    enabled: pythonEnabled,
    query: 'message',
    validate: async () => {
      const payload = await runSearch({
        query: 'message',
        mode: 'code',
        args: ['--backend', 'memory']
      });
      const hit = findCodeHit(
        payload,
        (entry) => entry.file === 'src/sample.py' && String(entry.name || '').endsWith('message')
      );
      if (!hit) fail('Python metadata check failed: missing sample.py message chunk.');
      if (!String(hit.docmeta?.signature || '').includes('def message')) {
        fail('Python metadata check failed: missing signature metadata.');
      }
      if (!(hit.docmeta?.decorators || []).includes('staticmethod')) {
        fail('Python metadata check failed: missing decorator metadata.');
      }
    }
  },
  {
    label: 'Rust signature metadata',
    enabled: true,
    query: 'rust_greet',
    validate: async () => {
      const payload = await runSearch({
        query: 'rust_greet',
        mode: 'code',
        args: ['--backend', 'memory']
      });
      const hit = findCodeHit(
        payload,
        (entry) => entry.file === 'src/sample.rs' && entry.name === 'rust_greet'
      );
      if (!hit) fail('Rust metadata check failed: missing sample.rs rust_greet chunk.');
      if (!String(hit.docmeta?.signature || '').includes('fn rust_greet')) {
        fail('Rust metadata check failed: missing signature metadata.');
      }
    }
  },
  {
    label: 'Swift attribute metadata',
    enabled: true,
    query: 'sayHello',
    validate: async () => {
      const payload = await runSearch({
        query: 'sayHello',
        mode: 'code',
        args: ['--backend', 'memory']
      });
      const hit = findCodeHit(
        payload,
        (entry) => entry.file === 'src/sample.swift' && entry.name === 'Greeter.sayHello'
      );
      if (!hit) fail('Swift metadata check failed: missing sample.swift sayHello chunk.');
      if (!String(hit.docmeta?.signature || '').includes('func sayHello')) {
        fail('Swift metadata check failed: missing signature metadata.');
      }
      if (!(hit.docmeta?.decorators || []).includes('available')) {
        fail('Swift metadata check failed: missing attribute metadata.');
      }
    }
  }
];

if (!pythonEnabled) {
  console.log('Skipping Python sample metadata checks (python not available).');
}

for (const testCase of cases) {
  if (!testCase.enabled) continue;
  await testCase.validate();
}

console.log('Fixture sample metadata matrix ok.');

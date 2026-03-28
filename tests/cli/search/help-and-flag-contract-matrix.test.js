#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const searchPath = path.join(root, 'search.js');
const cliEntryPath = path.join(root, 'tools', 'search', 'cli-entry.js');
const searchEntryPath = path.join(root, 'src', 'retrieval', 'cli', 'search-entry.js');

const helpEnv = { ...process.env };
delete helpEnv.PAIROFCLEATS_TESTING;
delete helpEnv.PAIROFCLEATS_SUPPRESS_LEGACY_ENTRYPOINT_WARNING;
delete helpEnv.CI;

const defaultEnv = applyTestEnv({ syncProcess: false });

const runSearch = (args, env = defaultEnv) => spawnSync(
  process.execPath,
  [searchPath, ...args],
  { encoding: 'utf8', env }
);

const source = fs.readFileSync(searchEntryPath, 'utf8');
const helpIndex = source.indexOf('hasHelpArg(args)');
const versionIndex = source.indexOf('hasVersionArg(args)');
const importIndex = source.indexOf("await import('../../integrations/core/index.js')");

assertCondition(
  helpIndex !== -1 && versionIndex !== -1 && importIndex !== -1,
  'expected help/version checks and dynamic import in search entry'
);
assertCondition(
  helpIndex < importIndex && versionIndex < importIndex,
  'help/version checks should occur before dynamic import'
);
assertCondition(
  !/from ['"]\.\.\/\.\.\/integrations\/core\/index\.js['"]/.test(source),
  'expected canonical search entry to avoid static core-index imports'
);
assertCondition(
  /import\(['"]\.\.\/\.\.\/integrations\/core\/index\.js['"]\)/.test(source),
  'expected canonical search entry to lazy-load core index dynamically'
);

const helpCases = [
  {
    name: 'legacy wrapper without a query prints actionable help and warnings',
    run() {
      const result = runSearch([], helpEnv);
      assertCondition(result.status !== 0, 'expected bare search wrapper invocation to fail');
      const output = getCombinedOutput(result);
      assertCondition(output.includes('[deprecated] search.js'), 'expected legacy wrapper warning');
      for (const flag of ['--calls', '--uses', '--author', '--import', '--explain']) {
        assertCondition(output.includes(flag), `help output missing ${flag}`);
      }
    }
  },
  {
    name: 'CLI help fastpath exits successfully before heavyweight imports',
    run() {
      const result = spawnSync(process.execPath, [cliEntryPath, '--help'], { encoding: 'utf8' });
      assertCondition(result.status === 0, 'expected --help fastpath to exit 0');
      const output = getCombinedOutput(result, { trim: true });
      assertCondition(output.includes('Usage: search'), 'expected search usage banner');
    }
  }
];

const missingValueFlags = [
  '--type',
  '--author',
  '--import',
  '--repo',
  '--modified-since',
  '--bm25-k1',
  '--path',
  '--lang',
  '--ext',
  '--ann-backend',
  '--graph-ranking-max-work',
  '--fts-weights',
  '--risk'
];

const removedFlags = ['--human', '--headline'];

for (const entry of helpCases) {
  entry.run();
}

for (const flag of missingValueFlags) {
  const result = runSearch(['test', flag]);
  assertCondition(result.status !== 0, `expected non-zero exit for ${flag}`);
  const output = getCombinedOutput(result);
  assertCondition(output.includes(`Missing value for ${flag}`), `expected missing value message for ${flag}`);
}

for (const flag of removedFlags) {
  const result = runSearch(['test', flag], helpEnv);
  assertCondition(result.status !== 0, `expected non-zero exit for ${flag}`);
  const output = getCombinedOutput(result);
  assertCondition(
    output.toLowerCase().includes('removed') && output.includes(flag),
    `expected removed-flag guidance for ${flag}`
  );
}

console.log('search help and flag contract matrix test passed');

function assertCondition(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

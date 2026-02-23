#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildExecutionPlans,
  buildTaskCatalog
} from '../../../tools/bench/language-repos/planning.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-language-task-catalog-validation');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const queriesFile = path.join(tempRoot, 'queries.txt');
await fs.writeFile(queriesFile, 'how to benchmark?', 'utf8');
const queriesDir = path.join(tempRoot, 'queries-dir');
await fs.mkdir(queriesDir, { recursive: true });

const benchConfig = {
  javascript: {
    label: 'JavaScript / TypeScript',
    queries: 'queries.txt',
    repos: { typical: ['facebook/react'] }
  }
};

const tasks = buildTaskCatalog({
  benchConfig,
  argv: {},
  scriptRoot: tempRoot
});
assert.equal(tasks.length, 1, 'expected one benchmark task from valid config');
assert.equal(tasks[0].queriesPath, queriesFile, 'expected resolved queries file path');

assert.throws(
  () => buildTaskCatalog({
    benchConfig: {
      javascript: {
        label: 'JavaScript / TypeScript',
        repos: { typical: ['facebook/react'] }
      }
    },
    argv: {},
    scriptRoot: tempRoot
  }),
  /Missing queries path for language "javascript" in bench config\./,
  'expected explicit config validation when queries path is missing'
);

assert.throws(
  () => buildTaskCatalog({
    benchConfig: {
      javascript: {
        label: 'JavaScript / TypeScript',
        queries: 'queries-dir',
        repos: { typical: ['facebook/react'] }
      }
    },
    argv: {},
    scriptRoot: tempRoot
  }),
  /Queries path must resolve to a file:/,
  'expected directory paths to be rejected for queries input'
);

assert.throws(
  () => buildTaskCatalog({
    benchConfig,
    argv: { queries: queriesDir },
    scriptRoot: tempRoot
  }),
  /Queries path must resolve to a file:/,
  'expected --queries override to reject directory path'
);

const { executionPlans } = buildExecutionPlans({
  tasks: [
    {
      language: 'python',
      label: 'Python',
      tier: 'typical',
      repo: 'group/subgroup/project',
      queriesPath: queriesFile
    }
  ],
  reposRoot: path.join(tempRoot, 'repos'),
  resultsRoot: path.join(tempRoot, 'results'),
  cacheRoot: path.join(tempRoot, 'cache')
});
assert.equal(executionPlans.length, 1, 'expected one execution plan');
assert.equal(
  path.basename(executionPlans[0].repoPath),
  'group__subgroup__project',
  'expected repo path stem to replace all repo path separators'
);
assert.equal(
  path.basename(executionPlans[0].outFile),
  'group__subgroup__project.json',
  'expected outFile stem to replace all repo path separators'
);

console.log('bench-language task catalog validation test passed');

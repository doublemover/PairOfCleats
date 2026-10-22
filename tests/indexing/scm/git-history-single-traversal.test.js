#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { decodeGitMetaHistory } from '../../../src/index/scm/providers/git/meta-batch.js';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { getScmCommandRunner, setScmCommandRunner } from '../../../src/index/scm/runner.js';
const root = path.resolve('history-fixture');
const header = (id, author) => '\0\0__POC_GIT_META__' + id.repeat(40) + '\0'
  + '2026-10-22T00:00:00Z' + '\0' + author + '\0\n';
const labels = ['plain.js', ' spaced.js ', 'tab\tname.js', 'line\nname.js'];
const output = header('a', 'Latest') + labels.map(label => `2\t1\t${label}\0`).join('')
  + header('b', 'Older') + '1\t0\tplain.js\0-\t-\tbinary.bin\0';
const decoded = decodeGitMetaHistory({ stdout: output, repoRoot: root, numstat: true });
assert.equal(decoded.requiresNameOnly, false);
for (const label of labels) assert.equal(decoded.fileMetaByPath[label].lastAuthor, 'Latest');
assert.deepEqual(decoded.churnByPath['plain.js'], { churn: 4, churnAdded: 3, churnDeleted: 1, churnCommits: 2 });
assert.equal(decoded.churnByPath['binary.bin'].churn, 0);
const rename = decodeGitMetaHistory({ stdout: header('a', 'Latest') + '0\t0\t\0old.js\0new.js\0', repoRoot: root, numstat: true });
assert.equal(rename.requiresNameOnly, true); assert.equal(rename.fileMetaByPath['new.js'].lastAuthor, 'Latest');
assert.throws(() => decodeGitMetaHistory({ stdout: header('a', 'Latest') + '1\t0\t\0missing.js\0', repoRoot: root, numstat: true }));
const original = getScmCommandRunner(); let calls = 0;
try {
  setScmCommandRunner(async (_command, args) => { calls++; assert.ok(args.includes('-z')); assert.ok(args.includes('--numstat'));
    return { exitCode: 0, stdout: output, stderr: '' }; });
  const result = await gitProvider.getFileMetaBatch({ repoRoot: root, filesPosix: labels, includeChurn: true, timeoutMs: 1000 });
  assert.equal(calls, 1, 'qualified normal churn lane consumes one Git traversal');
  assert.equal(result.fileMetaByPath['plain.js'].churn, 4);
} finally { setScmCommandRunner(original); }

#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'search-filters');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitCheck.status !== 0) {
  console.log('[skip] git not available');
  process.exit(0);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const runGit = (args, label, envOverride = {}) => {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...envOverride }
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
};

runGit(['init'], 'git init');
runGit(['config', 'user.email', 'test@example.com'], 'git config email');
runGit(['config', 'user.name', 'Test User'], 'git config name');

const dayMs = 24 * 60 * 60 * 1000;
const now = Date.now();
const dateOld = new Date(now - 5 * dayMs).toISOString();
const dateNew = new Date(now - 1 * dayMs).toISOString();

await fsPromises.writeFile(path.join(repoRoot, 'alpha.txt'), 'alpha beta\nalpha beta\n');
runGit(['add', '.'], 'git add alpha');
runGit(
  ['commit', '-m', 'add alpha', '--author', 'Alice <alice@example.com>', '--date', dateOld],
  'git commit alpha',
  { GIT_AUTHOR_DATE: dateOld, GIT_COMMITTER_DATE: dateOld }
);

await fsPromises.writeFile(path.join(repoRoot, 'beta.txt'), 'alpha gamma\nalpha delta\n');
runGit(['add', '.'], 'git add beta');
runGit(
  ['commit', '-m', 'add beta', '--author', 'Bob <bob@example.com>', '--date', dateNew],
  'git commit beta',
  { GIT_AUTHOR_DATE: dateNew, GIT_COMMITTER_DATE: dateNew }
);

await fsPromises.writeFile(path.join(repoRoot, 'CaseFile.TXT'), 'AlphaCase alpha\n');
runGit(['add', '.'], 'git add CaseFile');
runGit(
  ['commit', '-m', 'add case file', '--author', 'Casey <casey@example.com>', '--date', dateNew],
  'git commit CaseFile',
  { GIT_AUTHOR_DATE: dateNew, GIT_COMMITTER_DATE: dateNew }
);

await fsPromises.writeFile(
  path.join(repoRoot, 'sample.js'),
  'const equal = (a, b) => a && b;\nfunction check(a, b) {\n  return a && b;\n}\n'
);
runGit(['add', '.'], 'git add sample.js');
runGit(
  ['commit', '-m', 'add sample.js', '--author', 'Dana <dana@example.com>', '--date', dateNew],
  'git commit sample.js',
  { GIT_AUTHOR_DATE: dateNew, GIT_COMMITTER_DATE: dateNew }
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build_index');
  process.exit(buildResult.status ?? 1);
}

const searchPath = path.join(root, 'search.js');
const branchName = (() => {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
})();

function runSearch(query, args, label, mode = 'prose') {
  const result = spawnSync(
    process.execPath,
    [searchPath, query, '--mode', mode, '--json', '--no-ann', '--repo', repoRoot, ...args],
    { cwd: repoRoot, env, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout || '{}');
}

const extractFiles = (payload, key = 'prose') =>
  new Set((payload[key] || []).map((hit) => path.basename(hit.file || '')));

const negativeToken = runSearch('alpha -gamma', [], 'negative token');
const negativeTokenFiles = extractFiles(negativeToken);
if (!negativeTokenFiles.has('alpha.txt') || negativeTokenFiles.has('beta.txt')) {
  console.error('Negative token filter failed.');
  process.exit(1);
}

const negativePhrase = runSearch('alpha -"alpha beta"', [], 'negative phrase');
const negativePhraseFiles = extractFiles(negativePhrase);
if (!negativePhraseFiles.has('beta.txt') || negativePhraseFiles.has('alpha.txt')) {
  console.error('Negative phrase filter failed.');
  process.exit(1);
}

const phraseSearch = runSearch('"alpha beta"', [], 'phrase search');
const phraseHits = phraseSearch.prose || [];
if (!phraseHits.length) {
  console.error('Phrase search returned no results.');
  process.exit(1);
}
const phraseMatch = phraseHits[0]?.scoreBreakdown?.phrase?.matches || 0;
if (phraseMatch <= 0) {
  console.error('Expected phrase match score breakdown for quoted phrase.');
  process.exit(1);
}

const chunkAuthorAlice = runSearch('alpha', ['--chunk-author', 'Alice'], 'chunk-author Alice');
const chunkAuthorAliceFiles = extractFiles(chunkAuthorAlice);
if (!chunkAuthorAliceFiles.has('alpha.txt') || chunkAuthorAliceFiles.has('beta.txt')) {
  console.error('Chunk author filter for Alice failed.');
  process.exit(1);
}

const chunkAuthorBob = runSearch('alpha', ['--chunk-author', 'Bob'], 'chunk-author Bob');
const chunkAuthorBobFiles = extractFiles(chunkAuthorBob);
if (!chunkAuthorBobFiles.has('beta.txt') || chunkAuthorBobFiles.has('alpha.txt')) {
  console.error('Chunk author filter for Bob failed.');
  process.exit(1);
}

const cutoff = new Date(now - 2 * dayMs).toISOString();
const modifiedAfter = runSearch('alpha', ['--modified-after', cutoff], 'modified-after');
const modifiedAfterFiles = extractFiles(modifiedAfter);
if (!modifiedAfterFiles.has('beta.txt') || modifiedAfterFiles.has('alpha.txt')) {
  console.error('modified-after filter failed.');
  process.exit(1);
}

const modifiedSince = runSearch('alpha', ['--modified-since', '2'], 'modified-since');
const modifiedSinceFiles = extractFiles(modifiedSince);
if (!modifiedSinceFiles.has('beta.txt') || modifiedSinceFiles.has('alpha.txt')) {
  console.error('modified-since filter failed.');
  process.exit(1);
}

if (branchName) {
  const branchMatch = runSearch('alpha', ['--branch', branchName], 'branch filter');
  if (!(branchMatch.prose || []).length) {
    console.error('branch filter returned no results for current branch.');
    process.exit(1);
  }
  const branchMiss = runSearch('alpha', ['--branch', 'no-such-branch'], 'branch mismatch');
  if ((branchMiss.prose || []).length) {
    console.error('branch mismatch should return no results.');
    process.exit(1);
  }
}

const caseInsensitiveFile = runSearch('alpha', ['--file', 'casefile.txt'], 'case-insensitive file');
if (!extractFiles(caseInsensitiveFile).has('CaseFile.TXT')) {
  console.error('case-insensitive file filter failed.');
  process.exit(1);
}
const caseSensitiveFile = runSearch('alpha', ['--file', 'casefile.txt', '--case-file'], 'case-sensitive file');
if (extractFiles(caseSensitiveFile).has('CaseFile.TXT')) {
  console.error('case-sensitive file filter should not match.');
  process.exit(1);
}
const regexFile = runSearch('alpha', ['--file', '/casefile\\.txt/'], 'regex file filter');
if (!extractFiles(regexFile).has('CaseFile.TXT')) {
  console.error('regex file filter failed.');
  process.exit(1);
}
const caseInsensitiveToken = runSearch('AlphaCase', [], 'case-insensitive token');
if (!extractFiles(caseInsensitiveToken).has('CaseFile.TXT')) {
  console.error('case-insensitive token match failed.');
  process.exit(1);
}
const caseSensitiveToken = runSearch('AlphaCase', ['--case-tokens'], 'case-sensitive token');
if (extractFiles(caseSensitiveToken).has('CaseFile.TXT')) {
  console.error('case-sensitive token match should not match.');
  process.exit(1);
}
const punctuationSearch = runSearch('&&', [], 'punctuation token', 'code');
if (!extractFiles(punctuationSearch, 'code').has('sample.js')) {
  console.error('punctuation token match failed.');
  process.exit(1);
}

console.log('Search filter tests passed');

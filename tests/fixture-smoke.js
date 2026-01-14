#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCli } from '../src/shared/cli.js';
import { getIndexDir, getMetricsDir, loadUserConfig, resolveSqlitePaths } from '../tools/dict-utils.js';
import { rankMinhash } from '../src/retrieval/rankers.js';

const root = process.cwd();
const fixturesRoot = path.join(root, 'tests', 'fixtures');
const argv = createCli({
  scriptName: 'fixture-smoke',
  options: {
    all: { type: 'boolean', default: false },
    fixture: { type: 'string', default: 'sample' }
  }
}).parse();

function resolveFixtures() {
  if (!argv.all) return [argv.fixture];
  const entries = fs.readdirSync(fixturesRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function hasPython() {
  const candidates = ['python', 'python3'];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ['-c', 'import sys; sys.stdout.write(\"ok\")'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === 'ok') return true;
  }
  return false;
}
const pythonAvailable = hasPython();

function run(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: currentFixtureRoot,
    env: currentEnv,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

function parseJson(label, raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch (err) {
    console.error(`Failed: ${label} invalid JSON`);
    console.error(String(err?.message || err));
    process.exit(1);
  }
}

function runJson(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: currentFixtureRoot,
    env: currentEnv,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  let payload = null;
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch {
    console.error(`Failed: ${label} returned invalid JSON`);
    process.exit(1);
  }
  return payload;
}

function loadQueries(fixtureRoot) {
  const queriesPath = path.join(fixtureRoot, 'queries.txt');
  if (!fs.existsSync(queriesPath)) return ['index', 'search'];
  return fs.readFileSync(queriesPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function assertChunkWeights(label, chunkMetaPath) {
  const raw = fs.readFileSync(chunkMetaPath, 'utf8');
  const chunks = JSON.parse(raw);
  if (!Array.isArray(chunks)) {
    console.error(`Invalid chunk metadata for ${label}: ${chunkMetaPath}`);
    process.exit(1);
  }
  for (const chunk of chunks) {
    const weight = chunk?.weight;
    if (!Number.isFinite(weight)) {
      console.error(`Invalid chunk weight for ${label}: ${chunkMetaPath}`);
      process.exit(1);
    }
  }
}

function assertMinhashConsistency(label, chunkMetaPath, minhashPath) {
  const rawChunks = fs.readFileSync(chunkMetaPath, 'utf8');
  const rawSigs = fs.readFileSync(minhashPath, 'utf8');
  const chunks = JSON.parse(rawChunks);
  const sigPayload = JSON.parse(rawSigs);
  const signatures = sigPayload?.signatures;
  if (!Array.isArray(chunks) || !Array.isArray(signatures)) {
    console.error(`Invalid minhash data for ${label}: ${minhashPath}`);
    process.exit(1);
  }
  const idx = chunks.findIndex((chunk, i) => Array.isArray(chunk?.tokens) && chunk.tokens.length && Array.isArray(signatures[i]));
  if (idx < 0) {
    console.error(`No usable minhash chunk found for ${label}: ${minhashPath}`);
    process.exit(1);
  }
  const tokens = chunks[idx].tokens;
  const scored = rankMinhash({ minhash: { signatures } }, tokens, 1);
  if (!scored.length || scored[0].idx !== idx || scored[0].sim !== 1) {
    console.error(`Minhash mismatch for ${label}: ${minhashPath}`);
    process.exit(1);
  }
}

let currentFixtureRoot = '';
let currentEnv = {};

const fixtures = resolveFixtures();
if (!fixtures.length) {
  console.error('No fixtures found.');
  process.exit(1);
}

for (const fixtureName of fixtures) {
  const fixtureSourceRoot = path.join(fixturesRoot, fixtureName);
  if (!fs.existsSync(fixtureSourceRoot)) {
    console.error(`Fixture not found: ${fixtureSourceRoot}`);
    process.exit(1);
  }
  console.log(`\nFixture smoke: ${fixtureName}`);

  const cacheRoot = path.join(root, 'tests', '.cache', `fixture-${fixtureName}`);
  await fsPromises.rm(cacheRoot, { recursive: true, force: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  currentEnv = {
    ...process.env,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_EMBEDDINGS: 'stub'
  };
  process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
  currentFixtureRoot = fixtureSourceRoot;
  const generatorPath = path.join(fixtureSourceRoot, 'generate.js');
  if (fs.existsSync(generatorPath)) {
    const generatedRoot = path.join(root, 'tests', '.cache', 'fixtures', fixtureName);
    const result = spawnSync(
      process.execPath,
      [generatorPath, '--out', generatedRoot],
      { cwd: fixtureSourceRoot, env: currentEnv, stdio: 'inherit' }
    );
    if (result.status !== 0) {
      console.error(`Fixture generator failed: ${fixtureName}`);
      process.exit(result.status ?? 1);
    }
    currentFixtureRoot = generatedRoot;
  }
  const repoArgs = ['--repo', currentFixtureRoot];

  run([path.join(root, 'build_index.js'), '--stub-embeddings', ...repoArgs], `build index (${fixtureName})`);
  run([path.join(root, 'tools', 'build-sqlite-index.js'), ...repoArgs], `build sqlite index (${fixtureName})`);

  const userConfig = loadUserConfig(currentFixtureRoot);
  const codeDir = getIndexDir(currentFixtureRoot, 'code', userConfig);
  const proseDir = getIndexDir(currentFixtureRoot, 'prose', userConfig);
  const sqlitePaths = resolveSqlitePaths(currentFixtureRoot, userConfig);
  const metricsDir = getMetricsDir(currentFixtureRoot, userConfig);

  const requiredFiles = [
    path.join(codeDir, 'chunk_meta.json'),
    path.join(codeDir, 'token_postings.json'),
    path.join(codeDir, 'dense_vectors_uint8.json'),
    path.join(codeDir, 'dense_vectors_doc_uint8.json'),
    path.join(codeDir, 'dense_vectors_code_uint8.json'),
    path.join(codeDir, 'repo_map.json'),
    path.join(proseDir, 'chunk_meta.json'),
    path.join(proseDir, 'token_postings.json'),
    path.join(proseDir, 'dense_vectors_uint8.json'),
    path.join(proseDir, 'dense_vectors_doc_uint8.json'),
    path.join(proseDir, 'dense_vectors_code_uint8.json'),
    path.join(proseDir, 'repo_map.json'),
    path.join(metricsDir, 'index-code.json'),
    path.join(metricsDir, 'index-prose.json'),
    sqlitePaths.codePath,
    sqlitePaths.prosePath
  ];

  for (const filePath of requiredFiles) {
    if (!fs.existsSync(filePath)) {
      console.error(`Missing fixture artifact: ${filePath}`);
      process.exit(1);
    }
  }

  const repoMapPath = path.join(codeDir, 'repo_map.json');
  const repoMapRaw = fs.readFileSync(repoMapPath, 'utf8');
  const repoMap = JSON.parse(repoMapRaw);
  if (!Array.isArray(repoMap) || !repoMap.length) {
    console.error('Fixture repo map missing or empty.');
    process.exit(1);
  }
  const sampleEntry = repoMap.find((entry) => entry && entry.file && entry.name);
  if (!sampleEntry) {
    console.error('Fixture repo map missing expected fields.');
    process.exit(1);
  }

  assertChunkWeights('code', path.join(codeDir, 'chunk_meta.json'));
  assertChunkWeights('prose', path.join(proseDir, 'chunk_meta.json'));
  assertMinhashConsistency('code', path.join(codeDir, 'chunk_meta.json'), path.join(codeDir, 'minhash_signatures.json'));
  assertMinhashConsistency('prose', path.join(proseDir, 'chunk_meta.json'), path.join(proseDir, 'minhash_signatures.json'));

  const queriesRoot = fs.existsSync(path.join(currentFixtureRoot, 'queries.txt'))
    ? currentFixtureRoot
    : fixtureSourceRoot;
  const queries = loadQueries(queriesRoot);
  const backends = ['memory', 'sqlite-fts'];
  for (const query of queries) {
    for (const backend of backends) {
      const searchResult = spawnSync(
        process.execPath,
        [path.join(root, 'search.js'), query, '--json', '--backend', backend, '--no-ann', ...repoArgs],
        { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
      );
      if (searchResult.status !== 0) {
        console.error(`Fixture search failed for query: ${query} (${backend})`);
        process.exit(searchResult.status ?? 1);
      }

      const payload = JSON.parse(searchResult.stdout || '{}');
      if (!payload.code?.length && !payload.prose?.length) {
        console.error(`Fixture search returned no results for query: ${query} (${backend})`);
        process.exit(1);
      }
      const hits = [...(payload.code || []), ...(payload.prose || [])];
      const sample = hits[0];
      if (!Number.isFinite(sample?.score)) {
        console.error(`Fixture search missing score for query: ${query} (${backend})`);
        process.exit(1);
      }
      if (!sample?.scoreType) {
        console.error(`Fixture search missing scoreType for query: ${query} (${backend})`);
        process.exit(1);
      }
      if (!sample?.scoreBreakdown?.selected) {
        console.error(`Fixture search missing scoreBreakdown for query: ${query} (${backend})`);
        process.exit(1);
      }
      if (sample.scoreBreakdown.selected.type !== sample.scoreType) {
        console.error(`Fixture search scoreType mismatch for query: ${query} (${backend})`);
        process.exit(1);
      }
    }
  }

  const compactQuery = queries[0];
  const compactResult = spawnSync(
    process.execPath,
    [path.join(root, 'search.js'), compactQuery, '--json-compact', '--backend', 'memory', '--no-ann', ...repoArgs],
    { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
  );
  if (compactResult.status !== 0) {
    console.error(`Fixture compact JSON failed for query: ${compactQuery}`);
    process.exit(compactResult.status ?? 1);
  }
  const compactPayload = JSON.parse(compactResult.stdout || '{}');
  const compactHits = [...(compactPayload.code || []), ...(compactPayload.prose || [])];
  if (!compactHits.length) {
    console.error(`Fixture compact JSON returned no results for query: ${compactQuery}`);
    process.exit(1);
  }
  const compactSample = compactHits[0] || {};
  if (!compactSample.file && compactSample.id === undefined) {
    console.error('Fixture compact JSON missing hit identity fields.');
    process.exit(1);
  }
  if (!Number.isFinite(compactSample.score)) {
    console.error('Fixture compact JSON missing score.');
    process.exit(1);
  }
  if (!compactSample.scoreType) {
    console.error('Fixture compact JSON missing scoreType.');
    process.exit(1);
  }
  const forbiddenFields = [
    'tokens',
    'ngrams',
    'preContext',
    'postContext',
    'codeRelations',
    'docmeta',
    'stats',
    'complexity',
    'lint',
    'externalDocs',
    'chunk_authors',
    'scoreBreakdown'
  ];
  for (const field of forbiddenFields) {
    if (compactSample[field] !== undefined) {
      console.error(`Fixture compact JSON includes unexpected field: ${field}`);
      process.exit(1);
    }
  }

  if (fixtureName === 'sample') {
    const extScoped = spawnSync(
      process.execPath,
      [path.join(root, 'search.js'), 'message', '--mode', 'code', '--json', '--backend', 'memory', '--no-ann', '--ext', '.py', ...repoArgs],
      { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
    );
    if (extScoped.status !== 0) {
      console.error('Fixture ext filter failed: search error.');
      process.exit(extScoped.status ?? 1);
    }
    const extPayload = JSON.parse(extScoped.stdout || '{}');
    const extHits = extPayload.code || [];
    if (!extHits.length) {
      console.error('Fixture ext filter returned no results.');
      process.exit(1);
    }
    if (extHits.some((hit) => hit.ext !== '.py')) {
      console.error('Fixture ext filter returned non-.py results.');
      process.exit(1);
    }

    const pathScoped = spawnSync(
      process.execPath,
      [path.join(root, 'search.js'), 'message', '--mode', 'code', '--json', '--backend', 'memory', '--no-ann', '--path', 'src/sample.py', ...repoArgs],
      { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
    );
    if (pathScoped.status !== 0) {
      console.error('Fixture path filter failed: search error.');
      process.exit(pathScoped.status ?? 1);
    }
    const pathPayload = JSON.parse(pathScoped.stdout || '{}');
    const pathHits = pathPayload.code || [];
    if (!pathHits.length) {
      console.error('Fixture path filter returned no results.');
      process.exit(1);
    }
    if (pathHits.some((hit) => hit.file !== 'src/sample.py')) {
      console.error('Fixture path filter returned unexpected files.');
      process.exit(1);
    }
  }

  if (pythonAvailable && fixtureName === 'sample') {
    const pythonCheck = spawnSync(
      process.execPath,
      [path.join(root, 'search.js'), 'message', '--json', '--backend', 'memory', '--no-ann', ...repoArgs],
      { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
    );
    if (pythonCheck.status !== 0) {
      console.error('Python AST check failed: search error.');
      process.exit(pythonCheck.status ?? 1);
    }
    const payload = JSON.parse(pythonCheck.stdout || '{}');
    const pythonHit = (payload.code || []).find(
      (hit) => hit.file === 'src/sample.py' && hit.name && hit.name.endsWith('message')
    );
    if (!pythonHit) {
      console.error('Python AST check failed: missing sample.py message chunk.');
      process.exit(1);
    }
    const signature = pythonHit.docmeta?.signature || '';
    const decorators = pythonHit.docmeta?.decorators || [];
    if (!signature.includes('def message')) {
      console.error('Python AST check failed: missing signature metadata.');
      process.exit(1);
    }
    if (!decorators.includes('staticmethod')) {
      console.error('Python AST check failed: missing decorator metadata.');
      process.exit(1);
    }
  }

  if (fixtureName === 'sample') {
    const swiftCheck = spawnSync(
      process.execPath,
      [path.join(root, 'search.js'), 'sayHello', '--json', '--backend', 'memory', '--no-ann', ...repoArgs],
      { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
    );
    if (swiftCheck.status !== 0) {
      console.error('Swift check failed: search error.');
      process.exit(swiftCheck.status ?? 1);
    }
    const payload = JSON.parse(swiftCheck.stdout || '{}');
    const swiftHit = (payload.code || []).find(
      (hit) => hit.file === 'src/sample.swift' && hit.name === 'Greeter.sayHello'
    );
    if (!swiftHit) {
      console.error('Swift check failed: missing sample.swift sayHello chunk.');
      process.exit(1);
    }
    const signature = swiftHit.docmeta?.signature || '';
    const decorators = swiftHit.docmeta?.decorators || [];
    if (!signature.includes('func sayHello')) {
      console.error('Swift check failed: missing signature metadata.');
      process.exit(1);
    }
    if (!decorators.includes('available')) {
      console.error('Swift check failed: missing attribute metadata.');
      process.exit(1);
    }
  }

  if (fixtureName === 'sample') {
    const typeScoped = spawnSync(
      process.execPath,
      [path.join(root, 'search.js'), 'sayHello', '--mode', 'code', '--json', '--backend', 'memory', '--no-ann', '--type', 'MethodDeclaration', ...repoArgs],
      { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
    );
    if (typeScoped.status !== 0) {
      console.error('Fixture type filter failed: search error.');
      process.exit(typeScoped.status ?? 1);
    }
    const typePayload = JSON.parse(typeScoped.stdout || '{}');
    const typeHits = typePayload.code || [];
    if (!typeHits.some((hit) => hit.file === 'src/sample.swift' && String(hit.name || '').includes('sayHello'))) {
      console.error('Fixture type filter returned no sayHello() hits.');
      process.exit(1);
    }

    const signatureScoped = spawnSync(
      process.execPath,
      [path.join(root, 'search.js'), 'sayHello', '--mode', 'code', '--json', '--backend', 'memory', '--no-ann', '--signature', 'func sayHello', ...repoArgs],
      { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
    );
    if (signatureScoped.status !== 0) {
      console.error('Fixture signature filter failed: search error.');
      process.exit(signatureScoped.status ?? 1);
    }
    const signaturePayload = JSON.parse(signatureScoped.stdout || '{}');
    const signatureHits = signaturePayload.code || [];
    if (!signatureHits.some((hit) => hit.file === 'src/sample.swift' && String(hit.name || '').includes('sayHello'))) {
      console.error('Fixture signature filter returned no sayHello() hits.');
      process.exit(1);
    }

    const decoratorScoped = spawnSync(
      process.execPath,
      [path.join(root, 'search.js'), 'sayHello', '--mode', 'code', '--json', '--backend', 'memory', '--no-ann', '--decorator', 'available', ...repoArgs],
      { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
    );
    if (decoratorScoped.status !== 0) {
      console.error('Fixture decorator filter failed: search error.');
      process.exit(decoratorScoped.status ?? 1);
    }
    const decoratorPayload = JSON.parse(decoratorScoped.stdout || '{}');
    const decoratorHits = decoratorPayload.code || [];
    if (!decoratorHits.some((hit) => hit.file === 'src/sample.swift' && String(hit.name || '').includes('sayHello'))) {
      console.error('Fixture decorator filter returned no sayHello() hits.');
      process.exit(1);
    }
  }

  if (fixtureName === 'sample') {
    const rustCheck = spawnSync(
      process.execPath,
      [path.join(root, 'search.js'), 'rust_greet', '--json', '--backend', 'memory', '--no-ann', ...repoArgs],
      { cwd: currentFixtureRoot, env: currentEnv, encoding: 'utf8' }
    );
    if (rustCheck.status !== 0) {
      console.error('Rust check failed: search error.');
      process.exit(rustCheck.status ?? 1);
    }
    const payload = JSON.parse(rustCheck.stdout || '{}');
    const rustHit = (payload.code || []).find(
      (hit) => hit.file === 'src/sample.rs' && hit.name === 'rust_greet'
    );
    if (!rustHit) {
      console.error('Rust check failed: missing sample.rs rust_greet chunk.');
      process.exit(1);
    }
    const signature = rustHit.docmeta?.signature || '';
    if (!signature.includes('fn rust_greet')) {
      console.error('Rust check failed: missing signature metadata.');
      process.exit(1);
    }
  }

  // Phase 7 e2e: index build + search above, plus map generation (json + dot + optional svg).
  const mapCacheDir = path.join(cacheRoot, 'maps', 'cache');
  const mapOutDir = path.join(cacheRoot, 'maps', 'out');
  await fsPromises.mkdir(mapOutDir, { recursive: true });

  const mapScript = path.join(root, 'tools', 'report-code-map.js');
  const mapJsonOut = path.join(mapOutDir, 'map.json');
  const mapDotOut = path.join(mapOutDir, 'map.dot');
  const mapSvgOut = path.join(mapOutDir, 'map.svg');

  const mapJsonReport = runJson([
    mapScript,
    '--format',
    'json',
    '--out',
    mapJsonOut,
    '--cache-dir',
    mapCacheDir,
    '--json',
    ...repoArgs
  ], `map json (${fixtureName})`);

  if (mapJsonReport.format !== 'json') {
    console.error(`Fixture map json returned unexpected format: ${mapJsonReport.format}`);
    process.exit(1);
  }
  if (!mapJsonReport.outPath || !fs.existsSync(mapJsonReport.outPath)) {
    console.error('Fixture map json did not write output file.');
    process.exit(1);
  }

  const mapModelRaw = fs.readFileSync(mapJsonReport.outPath, 'utf8');
  const mapModel = parseJson(`map model (${fixtureName})`, mapModelRaw);
  if (!mapModel || typeof mapModel !== 'object') {
    console.error('Fixture map json returned invalid model.');
    process.exit(1);
  }
  if (!Array.isArray(mapModel.nodes) || !mapModel.nodes.length) {
    console.error('Fixture map json missing nodes.');
    process.exit(1);
  }
  if (!Array.isArray(mapModel.edges)) {
    console.error('Fixture map json missing edges array.');
    process.exit(1);
  }

  const mapDotReport = runJson([
    mapScript,
    '--format',
    'dot',
    '--out',
    mapDotOut,
    '--cache-dir',
    mapCacheDir,
    '--json',
    ...repoArgs
  ], `map dot (${fixtureName})`);
  if (mapDotReport.format !== 'dot') {
    console.error(`Fixture map dot returned unexpected format: ${mapDotReport.format}`);
    process.exit(1);
  }
  if (!mapDotReport.outPath || !fs.existsSync(mapDotReport.outPath)) {
    console.error('Fixture map dot did not write output file.');
    process.exit(1);
  }
  const dotRaw = fs.readFileSync(mapDotReport.outPath, 'utf8');
  if (!dotRaw.includes('digraph CodeMap')) {
    console.error('Fixture map dot missing expected digraph header.');
    process.exit(1);
  }
  if (Array.isArray(mapModel.edges) && mapModel.edges.length > 0 && !dotRaw.includes('->')) {
    console.error('Fixture map dot missing expected edge arrows.');
    process.exit(1);
  }

  const mapSvgReport = runJson([
    mapScript,
    '--format',
    'svg',
    '--out',
    mapSvgOut,
    '--cache-dir',
    mapCacheDir,
    '--json',
    ...repoArgs
  ], `map svg (${fixtureName})`);

  if (!mapSvgReport.outPath || !fs.existsSync(mapSvgReport.outPath)) {
    console.error('Fixture map svg did not write output file.');
    process.exit(1);
  }
  const svgRaw = fs.readFileSync(mapSvgReport.outPath, 'utf8').trim();
  if (mapSvgReport.format === 'svg') {
    if (!svgRaw.startsWith('<svg') && !svgRaw.includes('<svg')) {
      console.error('Fixture map svg output missing <svg> tag.');
      process.exit(1);
    }
  } else if (mapSvgReport.format === 'dot') {
    if (!svgRaw.includes('digraph CodeMap')) {
      console.error('Fixture map svg fallback missing digraph header.');
      process.exit(1);
    }
  } else {
    console.error(`Fixture map svg returned unexpected format: ${mapSvgReport.format}`);
    process.exit(1);
  }
}

console.log('Fixture smoke tests passed');

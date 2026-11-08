import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { collectPythonImports } from '../../../src/lang/python/imports.js';
import { collectLanguageImportEntries } from '../../../src/index/language-registry.js';
import { findPythonExecutable } from '../../../src/lang/python/executable.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { assertEscapedImportReplay } from '../../lang/contracts/escaped-import-replay-fixture.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { observeHeapAllocations } from '../../helpers/heap-sampling.js';
import { createLoggerScope } from '../../../src/shared/progress-runtime.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const oracle = 'import ast,json,pathlib,sys,unicodedata; t=ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")); print(json.dumps({"implementation":sys.implementation.name,"version":list(sys.version_info),"executable":sys.executable,"unicode":unicodedata.unidata_version,"imports":sorted(set([a.name for n in ast.walk(t) if isinstance(n,ast.Import) for a in n.names]+[n.module for n in ast.walk(t) if isinstance(n,ast.ImportFrom)]))},ensure_ascii=False))';
const templates = {
  'escaped-triples': ['actual', 'after_semicolon', 'second_actual', 'single_actual'],
  'ascii-identifiers': ['plain', 'cafe', 'package', 'K', 'e'],
  'mixed-identifiers': ['plain', 'café', '包', 'K', 'é']
};
export const runScenario = async ({ destination, scenario }) => {
  assert.ok(['escaped', 'identifiers'].includes(scenario));
  const python = await findPythonExecutable(); assert.ok(python, 'Pinned CPython must be available.');
  const shapes = scenario === 'escaped' ? ['escaped-triples'] : ['ascii-identifiers', 'mixed-identifiers'];
  const observations = [];
  for (const shape of shapes) {
    const templateFile = path.resolve('tests/fixtures/benchmarks/python-import-costs', shape + '.py');
    const template = await fs.readFile(templateFile, 'utf8');
    for (const blocks of [32, 128, 512]) for (const newline of ['\n', '\r\n']) {
      const suffixes = Array.from({ length: blocks }, (_, index) => String(index).padStart(5, '0'));
      const source = suffixes.map(suffix => template.replaceAll('_template', '_' + suffix).replace(/\r?\n/g, newline)).join(newline);
      const expected = suffixes.flatMap(suffix => templates[shape].map(name => name + '_' + suffix)).toSorted();
      const name = shape + '-' + blocks + '-' + (newline.length === 1 ? 'lf' : 'crlf');
      const sourceFile = path.join(destination, name + '.py'); await fs.writeFile(sourceFile, source, { flag: 'wx' });
      const independent = await spawnSubprocess(python, ['-c', oracle, sourceFile], { timeoutMs: 5000, maxOutputBytes: 1024 * 1024,
        captureStdout: true, captureStderr: true, outputMode: 'string', rejectOnNonZeroExit: true });
      assert.equal(independent.stderr, ''); assert.equal(independent.outputCapture.stdout.truncated, false);
      const oracleReceipt = JSON.parse(independent.stdout);
      assert.equal(oracleReceipt.implementation, 'cpython'); assert.deepEqual(oracleReceipt.version.slice(0, 2), [3, 15]);
      assert.equal(oracleReceipt.unicode, '17.0.0');
      assert.deepEqual(oracleReceipt.imports.toSorted(), expected, 'actual CPython validates the authored saved corpus');
      const row = { shape, blocks, newline, oracle: { ...oracleReceipt, imports: undefined }, source: { path: sourceFile, bytes: Buffer.byteLength(source), sha256: hash(source),
        template: { path: templateFile, sha256: hash(template) }, expectedImports: expected.length, expectedSha256: hash(JSON.stringify(expected)) }, scans: [] };
      for (const route of ['lexical', 'registered']) {
        const operation = route === 'lexical' ? () => collectPythonImports(source).imports
          : () => collectLanguageImportEntries({ text: source, ext: '.py', relPath: 'source.py', mode: 'code' }).map(entry => entry.specifier);
        const samples = [];
        for (let iteration = 0; iteration < 16; iteration++) {
          const before = process.memoryUsage(), cpu = process.threadCpuUsage(), start = performance.now();
          const actual = operation(); const wallMs = performance.now() - start, used = process.threadCpuUsage(cpu);
          const after = process.memoryUsage();
          assert.deepEqual(actual.toSorted(), expected);
          samples.push({ wallMs, cpu: used, before, after });
        }
        row.scans.push({ route, samples, allocation: await observeHeapAllocations({ destination, name: name + '-' + route,
          iterations: 8, operation }), scope: 'clean scanner CPU/wall independent from sampled JS allocation pass;correctness excluded from timing' });
      }
      const replayPhases = [], progress = [], logger = createLoggerScope();
      logger.setProgressHandlers({ showProgress(step, completed, total, meta) {
        assert.equal(step, 'Imports'); assert.equal(completed, 1); assert.equal(total, 1);
        assert.deepEqual(meta, { stage: 'imports', mode: 'code' });
        assert.ok(progress.length < 6); progress.push({ step, completed, total, meta });
      } });
      let replay, replayRoot, primary, hasPrimary = false;
      try {
        replay = await logger.run(() => assertEscapedImportReplay({ name: 'python-cost-' + name, file: 'source.py', source, expected, collectorNow: null, onRoot: root => { replayRoot = root; },
          onPhase: value => { assert.ok(replayPhases.length < 16); replayPhases.push(value); } }));
        assert.equal(progress.length, 6, 'three real source scans each report their completion and final progress');
        assert.deepEqual(replayPhases.map(value => value.phase), ['cold-source-scan', 'durable-import-bundle-publication',
          'original-replay-admission', 'incremental-refresh-scan', 'durable-import-bundle-publication', 'original-replay-admission', 'original-replay-admission', 'incremental-refresh-scan']);
        row.replay = { phases: replayPhases, progress, fingerprint: replay.cold.importScanFingerprint,
          scope: 'actual supported lexical import scan and durable bundle replay;partial lexical receipts refresh rather than claim parser-complete warm hits;retired producer rejected' };
      } catch (error) { primary = error; hasPrimary = true; throw error; }
      finally {
        try { await logger.close(); }
        catch (cleanup) {
          if (hasPrimary) primary = addStorageFailureContext(primary, { phase: 'replay-progress-scope-close' }, cleanup, { secondaryPresent: true });
          else { primary = cleanup; hasPrimary = true; }
        }
        if (replayRoot) {
          try {
            const relative = path.relative(path.resolve('.tmp'), path.resolve(replayRoot));
            assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
            await fs.rm(replayRoot, { recursive: true, force: true });
          } catch (cleanup) {
            if (hasPrimary) primary = addStorageFailureContext(primary, { phase: 'original-replay-fixture-cleanup' }, cleanup, { secondaryPresent: true });
            else { primary = cleanup; hasPrimary = true; }
          }
        }
        if (hasPrimary) throw primary;
      }
      assert.equal(hash(await fs.readFile(sourceFile)), row.source.sha256); observations.push(row);
    }
  }
  return { issues: scenario === 'escaped' ? [1755] : [1756], scenario, python, observations,
    claim: 'saved-source scanner and actual incremental refresh cost observations;no historical speedup or complete-parser throughput claim' };
};

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { parse } from 'acorn';
import { withBenchParitySources } from '../../helpers/bench-parity-sources.js';
import { createShowThroughputPayload } from './show-throughput-report-fixture.js';
import { createThroughputInputSession } from '../../../tools/reports/show-throughput/result-input.js';
import { THROUGHPUT_INPUT_LIMITS, THROUGHPUT_INPUT_VERSION, THROUGHPUT_REPORT_VERSION, admitThroughputReport } from '../../../tools/reports/show-throughput/result-contract.js';
import { includeResultsFolder } from '../../../tools/reports/show-throughput/load.js';
import { describeStorageFailure } from '../../../src/shared/storage/failure-observation.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/reports/throughput-root-inventory/')[1];
assert.ok(['real-selected-root-cohort', 'ignored-entries-and-folder-bounds', 'original-root-close-observation', 'root-link-refusal-model'].includes(mode));
const collect = async (session, directory) => {
  const rows = []; for await (const row of session.folder(directory)) { rows.push(row.file); session.processed(row.path); } return rows;
};
if (mode === 'original-root-close-observation' || mode === 'root-link-refusal-model') {
  // Original root-discovery implementation, explicit finite directory-owner
  // models. No OS symlink, native close or privileged launch is manufactured.
  const source = await fs.readFile(new URL('../../../tools/reports/show-throughput/result-input.js', import.meta.url), 'utf8');
  const declarations = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .flatMap(node => (node.type === 'ExportNamedDeclaration' ? node.declaration : node)?.declarations ?? []);
  const declaration = declarations.find(row => row.id.name === 'createThroughputInputSession')?.init; assert.ok(declaration);
  const trace = { reads: 0, closes: 0, codeReads: 0, retired: false }, original = new Error('explicit directory close remains pending');
  Object.defineProperties(original, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => trace.retired },
    code: { get() { trace.codeReads++; throw new Error('unsafe root diagnostic'); } } }); Object.freeze(original);
  const bindings = { path, setImmediate, THROUGHPUT_INPUT_LIMITS, THROUGHPUT_INPUT_VERSION, includeResultsFolder, describeStorageFailure,
    assertNoSymlinkPath: () => {},
    fail: (state, code) => ({ state, cause: { code } }),
    withStorageDirectory: async (_directory, action) => {
      await action({ read: async () => { trace.reads++;
        return mode === 'root-link-refusal-model' && trace.reads === 1
          ? { name: 'linked-folder', isSymbolicLink: () => true, isDirectory: () => true } : null;
      } });
      trace.closes++; if (mode === 'original-root-close-observation') throw original; trace.retired = true;
    } };
  const create = vm.runInThisContext('"use strict";\n(({' + Object.keys(bindings).join(',') + '}) => '
    + source.slice(declaration.start, declaration.end) + ')');
  const session = create(bindings)();
  try {
    if (mode === 'original-root-close-observation') {
      const contains = (error, seen = new Set()) => {
        if (error === original) return true;
        if (!error || typeof error !== 'object' || seen.has(error)) return false; seen.add(error);
        return contains(Object.getOwnPropertyDescriptor(error, 'cause')?.value, seen)
          || (Object.getOwnPropertyDescriptor(error, 'errors')?.value ?? []).some(row => contains(row, seen));
      };
      await assert.rejects(session.listFolders(path.resolve('explicit-root-owner')), error => contains(error));
      assert.equal(trace.closes, 1); assert.equal(trace.retired, false); assert.equal(trace.codeReads, 0);
    } else {
      assert.deepEqual(await session.listFolders(path.resolve('explicit-root-owner')), []);
      assert.equal(session.snapshot().rootInventory.cause.code, 'ERR_THROUGHPUT_ROOT_LINK'); assert.equal(trace.retired, true);
    }
    assert.equal(session.snapshot().complete, false); assert.equal(session.snapshot().inventoryComplete, false);
    await assert.rejects(session.listFolders(path.resolve('explicit-root-owner')), /once before/u);
  } finally { session.close(); }
} else await withBenchParitySources(async source => {
  const root = path.join(source.root, 'results'); await fs.mkdir(root);
  for (const name of ['javascript', 'python', 'logs', 'usr']) await fs.mkdir(path.join(root, name));
  if (mode === 'real-selected-root-cohort') {
    const folder = path.join(root, 'javascript'), good = createShowThroughputPayload({ repoRoot: path.join(source.root, 'fixture-repo'), chunksPerSec: 20 });
    await fs.writeFile(path.join(folder, 'one.json'), JSON.stringify(good));
    const session = createThroughputInputSession();
    try {
      assert.deepEqual((await session.listFolders(root, { folderFilter: 'JAVA' })).map(row => row.name), ['javascript']);
      assert.equal(session.snapshot().complete, false, 'a selected but unexamined folder remains pending');
      assert.deepEqual(await collect(session, folder), ['one.json']);
      const admission = session.snapshot(); assert.equal(admission.complete, true);
      assert.equal(admission.version, THROUGHPUT_INPUT_VERSION); assert.equal(admission.rootInventory.selected, 1);
      assert.equal(admission.rootInventory.inventoried, 1); assert.ok(admission.entriesVisited >= 5);
      const report = { schemaVersion: THROUGHPUT_REPORT_VERSION, root, profile: 'raw', generatedAt: '2026-11-06T00:00:00Z',
        folders: [{}], ciSummary: { folderCount: 1 }, inputAdmission: admission };
      assert.equal(admitThroughputReport(report).ok, true);
      for (const change of [value => { value.inputAdmission.version = THROUGHPUT_INPUT_VERSION - 1; },
        value => { delete value.inputAdmission.rootInventory; }, value => { value.inputAdmission.rootInventory.selected++; },
        value => { value.inputAdmission.rootInventory.path += '-other'; }, value => { value.inputAdmission.entriesVisited = 0; },
        value => { value.inputAdmission.entriesVisited = THROUGHPUT_INPUT_LIMITS.entries + 1; },
        value => { value.inputAdmission.budget.limits.entries = THROUGHPUT_INPUT_LIMITS.entries + 1; }]) {
        const changed = structuredClone(report); change(changed); assert.equal(admitThroughputReport(changed).ok, false);
      }
      await assert.rejects(collect(session, folder), /duplicated/u);
      await assert.rejects(collect(session, path.join(root, 'python')), /outside/u);
    } finally { session.close(); }
    const usr = createThroughputInputSession();
    try { assert.deepEqual((await usr.listFolders(root, { includeUsrGuardrails: true })).map(row => row.name), ['javascript', 'python', 'usr']); }
    finally { usr.close(); }
  } else {
    for (let i = 0; i < 8; i++) await fs.writeFile(path.join(root, `ignored-${i}.txt`), 'not a JSON input');
    for (const [limits, operation] of [[{ entries: 2 }, 'root'], [{ entries: 2 }, 'folder'], [{ folders: 1 }, 'root'], [{ metadataBytes: 1 }, 'root']]) {
      const session = createThroughputInputSession({ limits });
      try {
        if (operation === 'root') await session.listFolders(root); else await collect(session, root);
        const receipt = session.snapshot(); assert.equal(receipt.complete, false); assert.equal(receipt.inventoryComplete, false);
        assert.ok(receipt.entriesVisited <= (limits.entries ?? THROUGHPUT_INPUT_LIMITS.entries));
        assert.equal(receipt.budget.observedReadBytes, 0, 'discarded entry enumeration never becomes a fabricated JSON read');
        const code = operation === 'root' ? receipt.rootInventory.cause.code : receipt.folders[0].stop.cause.code;
        assert.equal(code, limits.entries ? 'ERR_THROUGHPUT_ENTRY_BUDGET' : limits.folders ? 'ERR_THROUGHPUT_FOLDER_BUDGET' : 'ERR_THROUGHPUT_METADATA_BUDGET');
      } finally { session.close(); }
    }
    assert.throws(() => createThroughputInputSession({ limits: { unknown: 1 } }), /Unknown private/u);
  }
});
console.log('Throughput root and discarded-entry admission preserve bounded original directory observations.');

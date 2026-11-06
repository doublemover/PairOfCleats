import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { applyPatchesAsync } from '../../../tools/setup/apply-patches.js';
import { CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { createPatchFixture, originalText, patchedText } from './patch-fixture.js';
import { makeTempDir } from '../../helpers/temp.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/patch-summary-settlement/')[1];
assert.ok(['original-callback-after-publication', 'independent-publication-and-logging-failures'].includes(mode));
const root = await makeTempDir('patch-summary-settlement-');
try {
  const fixtures = await Promise.all(['aaa', 'bbb'].map(packageName => createPatchFixture(root, { packageName })));
  if (mode === 'original-callback-after-publication') {
    const entered = Promise.withResolvers(), release = Promise.withResolvers(), messages = []; let first = true, returned = false;
    const pending = applyPatchesAsync(root, { verbose: true, log: async message => {
      messages.push(message); if (first) { first = false; entered.resolve(); await release.promise; }
    } }).then(result => { returned = true; return result; });
    try {
      await entered.promise; assert.equal(returned, false); assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), true);
      for (const fixture of fixtures) assert.equal(await fsPromises.readFile(fixture.target, 'utf8'), patchedText);
    } finally { release.resolve(); }
    assert.equal(await pending, 2); assert.equal(messages.length, 5);
    assert.match(messages.at(-1), /apply: 2 packages, 2 target files, 2 hunks; 2 files changed/);
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
  } else {
    const publication = Object.freeze(new Error('actual second target publication failed'));
    const secondTarget = fs.realpathSync(fixtures[1].target);
    for (const logging of [false, 0, '', null, undefined, Object.freeze(new Error('independent log failure'))]) {
      for (const fixture of fixtures) await fsPromises.writeFile(fixture.target, originalText);
      const rename = fs.renameSync;
      fs.renameSync = (source, target, ...args) => {
        if (target === secondTarget) throw publication;
        return rename.call(fs, source, target, ...args);
      };
      let actual;
      try { actual = await applyPatchesAsync(root, { verbose: true, log: async () => { throw logging; } }).catch(error => error); }
      finally { fs.renameSync = rename; }
      assert.equal(errorGraphIncludes(actual, publication), true); assert.equal(errorGraphIncludes(actual, logging), true);
      assert.equal(actual.code, 'ERR_PATCH_PARTIAL_PUBLICATION'); assert.equal(actual.publishedFiles, 1);
      assert.equal(await fsPromises.readFile(fixtures[0].target, 'utf8'), patchedText);
      assert.equal(await fsPromises.readFile(fixtures[1].target, 'utf8'), originalText);
      assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
    }
  }
} finally { await fsPromises.rm(root, { recursive: true, force: true }); }
console.log('Patch diagnostics await original callbacks after synchronous publication and retain independent mutation/logging failures');

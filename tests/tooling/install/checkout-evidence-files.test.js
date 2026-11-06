import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getCheckoutEvidenceFiles } from '../../../tools/setup/checkout-evidence-files.js';
import { withCheckoutMutation, retireCheckoutMutationSession } from '../../../tools/setup/checkout-mutation.js';
import { CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { makeTempDir } from '../../helpers/temp.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/checkout-evidence-files/')[1];
assert.ok(['original-closed-file', 'held-descriptor-retains-root', 'original-path-and-link-admission',
  'unknown-open-retains-root', 'changed-parent-closes-original-descriptor'].includes(mode));
const root = await makeTempDir('checkout-evidence-files-'), retainedFixtureFds = new Set();
const lock = path.join(root, CHECKOUT_MUTATION_LOCK);
const directory = session => {
  const parent = path.join(session.root, '.tmp', 'checkout-bootstrap', 'logs'); fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, 'n-'));
};
try {
  if (mode === 'original-closed-file') {
    await withCheckoutMutation(root, session => {
      const group = getCheckoutEvidenceFiles(root, session), file = path.join(directory(session), '001.stdout');
      assert.equal(getCheckoutEvidenceFiles(root, session), group);
      const owner = group.open(file), bytes = Buffer.from('original descriptor bytes\n');
      assert.equal(group.isSettled(), false);
      owner.runSync(descriptor => {
        assert.equal(descriptor.write(bytes, 0, bytes.length, null), bytes.length); assert.equal(descriptor.sync(), undefined);
      });
      assert.equal(group.isSettled(), true); assert.deepEqual(fs.readFileSync(file), bytes);
    });
    assert.equal(fs.existsSync(lock), false);
  } else if (mode === 'held-descriptor-retains-root') {
    let owner, fd, file;
    const failure = await withCheckoutMutation(root, session => {
      file = path.join(directory(session), '001.stdout'); owner = getCheckoutEvidenceFiles(root, session).open(file); fd = owner.operations.fd;
      // Returning a logical result cannot close this actual original fd.
    }).catch(error => error);
    assert.equal(fs.existsSync(lock), true); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(fs.fstatSync(fd).isFile(), true);
    await assert.rejects(withCheckoutMutation(root, () => assert.fail('successor admitted with a live evidence descriptor')), { code: 'ERR_CHECKOUT_MUTATION_BUSY' });
    owner.runSync(() => {});
    assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' });
    await retireCheckoutMutationSession(failure.checkoutMutationSession);
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal(fs.existsSync(lock), false); assert.equal(fs.existsSync(file), true, 'retiring lifetime authority does not delete diagnostic artifacts');
  } else if (mode === 'original-path-and-link-admission') {
    await withCheckoutMutation(root, session => {
      assert.throws(() => getCheckoutEvidenceFiles(root, { ...session }), { code: 'ERR_CHECKOUT_MUTATION_SESSION' });
      const group = getCheckoutEvidenceFiles(root, session), selected = directory(session);
      for (const file of [path.join(root, 'source.js'), path.join(selected, 'unexpected.node'), path.join(selected, '../001.stdout')]) {
        assert.throws(() => group.open(file), { code: 'ERR_CHECKOUT_EVIDENCE_FILE' });
      }
      const original = fs.lstatSync; let opens = 0;
      fs.lstatSync = (target, ...args) => {
        const actual = original(target, ...args);
        return target === selected ? new Proxy(actual, { get(value, key) {
          if (key === 'isSymbolicLink') return () => true;
          const member = Reflect.get(value, key); return typeof member === 'function' ? member.bind(value) : member;
        } }) : actual;
      };
      try { assert.throws(() => group.open(path.join(selected, '001.stdout'), { io: { ...fs, openSync() { opens++; } } }), { code: 'ERR_CHECKOUT_EVIDENCE_FILE' }); }
      finally { fs.lstatSync = original; }
      assert.equal(opens, 0, 'injected link attributes stop admission without creating a symlink');
    });
    assert.equal(fs.existsSync(lock), false);
  } else if (mode === 'unknown-open-retains-root') {
    const failure = await withCheckoutMutation(root, session => {
      getCheckoutEvidenceFiles(root, session).open(path.join(directory(session), '001.stdout'), { io: { ...fs,
        openSync(...args) { const fd = fs.openSync(...args); retainedFixtureFds.add(fd); throw false; }
      } });
    }).catch(error => error);
    assert.equal(errorGraphIncludes(failure, false), true); assert.equal(retainedFixtureFds.size, 1);
    assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(fs.existsSync(lock), true);
    for (const fd of retainedFixtureFds) fs.closeSync(fd); retainedFixtureFds.clear();
    assert.equal(failure.cacheOwnershipReleased(), false, 'fixture cleanup is not original production open evidence');
  } else {
    let descriptor = null;
    await assert.rejects(withCheckoutMutation(root, session => {
      const group = getCheckoutEvidenceFiles(root, session), selected = directory(session), original = fs.lstatSync;
      let opened = false;
      fs.lstatSync = (target, ...args) => {
        const actual = original(target, ...args); if (opened && target === selected) actual.ino += 1n; return actual;
      };
      try { group.open(path.join(selected, '001.stdout'), { io: { ...fs, openSync(...args) {
        descriptor = fs.openSync(...args); opened = true; return descriptor;
      } } }); }
      finally { fs.lstatSync = original; }
    }), { code: 'ERR_ATOMIC_PARENT_CHANGED' });
    assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' });
    assert.equal(fs.existsSync(lock), false, 'a confirmed close permits retirement after a rejected path');
  }
} finally {
  for (const fd of retainedFixtureFds) fs.closeSync(fd);
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Original evidence descriptors retain the actual checkout owner through open, close and path-admission failure');

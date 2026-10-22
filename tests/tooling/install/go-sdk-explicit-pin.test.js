import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { ensureManagedGoSdk } from '../../../tools/tooling/install-go-sdk.js';
import { applyManagedGoEnvironment, GO_RELEASE_INDEX_URL, resolveGoSdkTarget } from '../../../src/shared/managed-go.js';
import { applyToolchainDaemonPolicyEnv } from '../../../src/shared/toolchain-env.js';

ensureTestingEnv(process.env);
const { dir } = await prepareIsolatedTestCacheDir('go-sdk-explicit-pin');
const target = resolveGoSdkTarget();
assert.ok(target);
const version = 'go1.27.3';
const bytes = Buffer.from('inert SDK contract fixture, never executed');
const filename = `${version}.${target.os}-${target.arch}.${target.archiveType}`;
const releases = [{ version, stable: true, files: [{ version, filename, ...target, kind: 'archive',
  size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] }];
const sdk = await ensureManagedGoSdk({ toolingRoot: dir, cwd: dir,
  storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] }, dependencies: {
  download: async ({ url }) => ({ sourceUrl: url, body: url === GO_RELEASE_INDEX_URL
    ? Buffer.from(JSON.stringify(releases)) : bytes }),
  extract: async (_archive, destination) => {
    const extension = process.platform === 'win32' ? '.exe' : '';
    for (const name of [`bin/go${extension}`, `bin/gofmt${extension}`, 'src/runtime/runtime.go',
      `pkg/tool/${target.os}_${target.arch}/compile${extension}`]) {
      const file = path.join(destination, 'go', name);
      await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
    }
    await fs.writeFile(path.join(destination, 'go/VERSION'), version);
  },
  probe: async (_command, { resourceId }) => ({ ok: true, status: 0, stdout: `go version ${version} ${target.os}/${target.arch}\n`, settlement: { resourceId, settled: true, pending: false } })
} });
const explicit = { PATH: path.join(dir, 'selected-path'), GOROOT: path.join(dir, 'selected-sdk'),
  GOTOOLCHAIN: 'go1.26.4+path' };
const original = { ...explicit };
const discovered = applyManagedGoEnvironment(explicit, { toolingRoot: dir });
assert.deepEqual(discovered, explicit, 'automatic cache discovery must not replace an explicit launch SDK pin');
const versionOnly = { PATH: explicit.PATH, GOTOOLCHAIN: explicit.GOTOOLCHAIN };
assert.deepEqual(applyManagedGoEnvironment(versionOnly, { toolingRoot: dir }), versionOnly,
  'an explicit version pin also retains the launcher PATH without an implicit SDK selection');
const server = applyToolchainDaemonPolicyEnv(explicit, { toolingRoot: dir, providerId: 'gopls', command: 'gopls' });
assert.equal(server.GOROOT, explicit.GOROOT); assert.equal(server.PATH, explicit.PATH);
const selected = applyManagedGoEnvironment(explicit, { toolingRoot: dir, sdk });
assert.equal(selected.GOROOT, sdk.goRoot, 'an explicitly selected SDK binds its own matching root');
assert.equal(selected.PATH.split(path.delimiter)[0], sdk.binDir);
assert.equal(selected.GOTOOLCHAIN, explicit.GOTOOLCHAIN);
assert.deepEqual(explicit, original, 'preparation never mutates caller environment');
console.log('Inert SDK contract retains explicit launch pins and distinguishes explicit selection from automatic discovery');

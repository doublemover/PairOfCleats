import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../src/shared/stable-json.js';
import { inspectStorageAccess } from '../../src/shared/storage/access.js';
import { resolveStorageLayout } from '../../src/shared/storage/layout.js';

/** Synthetic selected-install receipt, not a qualified binary or installer
 * publication. Its real files exercise canonical bounded inventory and leases. */
export const createManagedCommandFixture = async root => {
  const identity = value => createHash('sha256').update(stableStringify(value)).digest('hex');
  const toolingRoot = path.join(root, 'tools'), toolId = 'fixture-lsp', installId = 'a'.repeat(64);
  const owner = path.join(toolingRoot, 'installs', toolId), generationRoot = path.join(owner, 'generations', installId);
  const command = path.join(generationRoot, 'bin', 'tool');
  const bytes = Buffer.from('inert managed command fixture');
  const descriptor = { schemaVersion: 1, toolId, recipeId: 'fixture', version: '1.0.0',
    platform: process.platform, arch: process.arch, command: 'bin/tool', args: [], requiredFiles: ['bin/tool'] };
  const descriptorId = identity(descriptor);
  const files = [{ path: 'bin/tool', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
  const selector = { schemaVersion: 1, toolId, descriptorId, installId };
  const receipt = { schemaVersion: 1, application: 'pairofcleats', toolId, descriptorId, installId,
    root: generationRoot, descriptor, files, filesIdentity: identity(files), selectorIdentity: identity(selector) };
  await fs.mkdir(path.dirname(command), { recursive: true });
  await fs.mkdir(path.join(owner, 'receipts'));
  await fs.writeFile(command, bytes);
  await fs.writeFile(path.join(owner, 'current.json'), JSON.stringify(selector));
  await fs.writeFile(path.join(owner, 'receipts', installId + '.json'), JSON.stringify(receipt));
  const coordinationRoot = path.join(resolveStorageLayout({ overrides: { tooling: toolingRoot } }).descriptors.state.path, 'storage-access');
  return { toolingRoot, toolId, owner, command, installId, descriptorId,
    protected: async () => (await inspectStorageAccess(owner, { coordinationRoot })).protected };
};

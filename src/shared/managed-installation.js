import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertNoSymlinkPath } from './contained-file.js';
import { hashManagedToolFile, readManagedToolText } from './managed-tool-file.js';
import { stableStringify } from './stable-json.js';
export { retainManagedToolInstallation, retainManagedToolInstallationSync, inspectManagedInstallationSync } from './managed-installation-retain.js';

const identity = value => createHash('sha256').update(stableStringify(value)).digest('hex');
/** Read-only selected consumer locator; protocol/project readiness remains separate. */
export const resolveManagedToolInstallation = (toolingRoot, toolId) => {
  if (!toolingRoot || !/^[a-z0-9][a-z0-9.-]{0,100}$/.test(toolId || '')) return null;
  const owner = path.join(path.resolve(toolingRoot), 'installs', toolId);
  try {
    assertNoSymlinkPath(path.parse(owner).root, owner);
    const selector = JSON.parse(readManagedToolText(path.join(owner, 'current.json'), 65536));
    if (selector.schemaVersion !== 1 || selector.toolId !== toolId || !/^[a-f0-9]{64}$/.test(selector.descriptorId || '') || !/^[a-f0-9]{64}$/.test(selector.installId || '')) return null;
    const receipt = JSON.parse(readManagedToolText(path.join(owner, 'receipts', selector.installId + '.json'), 8 * 1024 * 1024));
    const root = path.join(owner, 'generations', selector.installId);
    const descriptor = receipt.descriptor;
    if (receipt.schemaVersion !== 1 || receipt.application !== 'pairofcleats' || receipt.toolId !== toolId || receipt.root !== root
      || receipt.installId !== selector.installId || receipt.descriptorId !== selector.descriptorId || identity(descriptor) !== selector.descriptorId
      || receipt.selectorIdentity !== identity(selector) || descriptor.platform !== process.platform || descriptor.arch !== process.arch
      || identity(selector) !== identity({ schemaVersion: 1, toolId, descriptorId: selector.descriptorId, installId: selector.installId })
      || descriptor.schemaVersion !== 1 || descriptor.toolId !== toolId || !Array.isArray(receipt.files) || identity(receipt.files) !== receipt.filesIdentity
      || !Array.isArray(descriptor.args || []) || (descriptor.args || []).some(argument => typeof argument !== 'string')
      || typeof descriptor.command !== 'string' || descriptor.command.split('/').some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part))) return null;
    const command = path.join(root, descriptor.command);
    assertNoSymlinkPath(owner, command);
    const file = receipt.files.find(entry => entry.path === descriptor.command);
    if (!file || hashManagedToolFile(command, 128 * 1024 * 1024) !== file.sha256) return null;
    return { owner, root, command, args: descriptor.args || [], binDir: path.dirname(command),
      descriptorId: selector.descriptorId, installId: selector.installId, version: descriptor.version, verification: 'selected-receipt-and-consumer-bytes' };
  } catch { return null; }
};

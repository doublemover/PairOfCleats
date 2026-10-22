import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { validateVsixContainer, buildVsixContainer } from '../../../tools/tooling/vsix-container.js';

const { dir } = await prepareTestCacheDir('vsix-container-contract');
const archive = path.join(dir, 'original.vsix');
await buildVsixContainer({ sourceDir: path.join(process.cwd(), 'extensions/vscode'), archivePath: archive });
const qualified = await validateVsixContainer(archive);
const manifest = JSON.parse(await fs.readFile('extensions/vscode/package.json', 'utf8'));
assert.equal(qualified.extensionId, `${manifest.publisher}.${manifest.name}`);
assert.equal(qualified.version, manifest.version);
assert.equal(qualified.engine, manifest.engines.vscode);
assert.ok(qualified.runtimeModules > 1, 'qualification must traverse shipped runtime modules');

let sequence = 0;
const rejectMutation = async (mutate, expected) => {
  const zip = new AdmZip(archive);
  mutate(zip);
  const output = path.join(dir, `invalid-${sequence++}.vsix`);
  zip.writeZip(output);
  await assert.rejects(validateVsixContainer(output), expected);
};
for (const name of ['extension.vsixmanifest', '[Content_Types].xml']) {
  await rejectMutation((zip) => zip.deleteFile(name), /Invalid VSIX: missing/);
}
const replaceMetadata = (zip, transform) => zip.updateFile('extension.vsixmanifest',
  Buffer.from(transform(zip.readAsText('extension.vsixmanifest'))));
await rejectMutation((zip) => replaceMetadata(zip, (text) => text.replace(`Version="${manifest.version}"`, 'Version="999.0.0"')),
  /manifest identity differs/);
await rejectMutation((zip) => replaceMetadata(zip, (text) => text.replace(manifest.engines.vscode, '^0.0.1')),
  /engine compatibility differs/);
await rejectMutation((zip) => replaceMetadata(zip, (text) => text.replace('Path="extension/package.json"', 'Path="extension/missing.json"')),
  /package manifest asset/);
await rejectMutation((zip) => zip.deleteFile('extension/runtime.js'), /missing runtime module/);
await rejectMutation((zip) => zip.updateFile('extension/extension.js', Buffer.from('require("../../outside.js");')),
  /escaping runtime dependency/);
await rejectMutation((zip) => zip.updateFile('extension/extension.js', Buffer.from('require(process.env.MODULE);')),
  /dynamic require/);
await rejectMutation((zip) => zip.updateFile('[Content_Types].xml', Buffer.from('<Types/>')),
  /content types/);
console.log('VSIX container metadata, payload and runtime closure contract passed');

import fs from 'node:fs/promises';
import path from 'node:path';

export const originalText = 'start\nold one\nmiddle\nold two\nend\n';
export const patchedText = 'start\nnew one\nmiddle\nnew two\nend\n';

export const createPatchFixture = async (root, { packageName = 'sample', version = '1.0.0' } = {}) => {
  const relative = `node_modules/${packageName}/source.txt`;
  const target = path.join(root, ...relative.split('/'));
  const packageJson = path.join(path.dirname(target), 'package.json');
  const patchFile = path.join(root, 'patches', `${packageName.replace('/', '+')}+${version}.patch`);
  const patch = [
    `diff --git a/${relative} b/${relative}`,
    'index 1111111..2222222 100644',
    `--- a/${relative}`,
    `+++ b/${relative}`,
    '@@ -1,5 +1,5 @@',
    ' start',
    '-old one',
    '+new one',
    ' middle',
    '-old two',
    '+new two',
    ' end',
    ''
  ].join('\n');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.mkdir(path.dirname(patchFile), { recursive: true });
  await fs.writeFile(packageJson, JSON.stringify({ name: packageName, version }));
  await fs.writeFile(target, originalText);
  await fs.writeFile(patchFile, patch);
  return { target, packageJson, patchFile, patch, relative };
};

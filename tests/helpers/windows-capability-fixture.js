import fs from 'node:fs/promises';
import path from 'node:path';

/** Ordinary inert bytes for actual evidence/lease owners. These files are not
 * installed compiler/SDK products and no produced executable is ever run. */
export const createWindowsCapabilityFixture = async root => {
  const toolset = path.join(root, 'VC', 'Tools', 'MSVC', '14.fixture');
  const compiler = path.join(toolset, 'bin', 'Hostx64', 'x64', 'cl.exe');
  const sdk = { root: path.join(root, 'sdk'), version: '10.0.26100.0' };
  const files = [compiler, path.join(path.dirname(compiler), 'link.exe'), path.join(toolset, 'include', 'vector'),
    path.join(sdk.root, 'Include', sdk.version, 'um', 'Windows.h'), path.join(sdk.root, 'Include', sdk.version, 'ucrt', 'stdio.h'),
    path.join(sdk.root, 'Lib', sdk.version, 'um', 'x64', 'kernel32.lib'), path.join(sdk.root, 'Lib', sdk.version, 'ucrt', 'x64', 'ucrt.lib')];
  for (const file of files) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'inert capability evidence'); }
  const report = { platform: 'win32', arch: 'x64', toolchain: { compiler: { executable: compiler }, sdk }, childEnv: {} };
  const spawn = async (_command, args) => {
    const object = args.find(arg => arg.startsWith('/Fo')), image = args.find(arg => arg.startsWith('/OUT:'));
    if (object) { const bytes = Buffer.alloc(20); bytes.writeUInt16LE(0x8664); await fs.writeFile(object.slice(3), bytes); }
    if (image) {
      const bytes = Buffer.alloc(88); bytes.writeUInt16LE(0x5a4d); bytes.writeUInt32LE(64, 0x3c);
      bytes.writeUInt32LE(0x4550, 64); bytes.writeUInt16LE(0x8664, 68); await fs.writeFile(image.slice(5), bytes);
    }
    return { exitCode: 0, stdout: 'inert capability fixture', stderr: '' };
  };
  return { report, files, spawn };
};

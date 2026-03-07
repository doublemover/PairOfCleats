import fs from 'node:fs/promises';
import path from 'node:path';

const toShellLiteral = (value) => String(value || '').replace(/'/g, `'"'"'`);

export const writeRuntimeCommandFixture = async ({
  binDir,
  name,
  stdout = '',
  stderr = '',
  exitCode = 0
}) => {
  await fs.mkdir(binDir, { recursive: true });
  const fixtureScriptPath = path.join(binDir, `${name}.fixture.js`);
  const scriptContent = [
    `process.stdout.write(${JSON.stringify(String(stdout))});`,
    `process.stderr.write(${JSON.stringify(String(stderr))});`,
    `process.exit(${Number.isFinite(Number(exitCode)) ? Math.floor(Number(exitCode)) : 0});`,
    ''
  ].join('\n');
  await fs.writeFile(fixtureScriptPath, scriptContent, 'utf8');

  if (process.platform === 'win32') {
    const wrapperPath = path.join(binDir, `${name}.cmd`);
    const wrapper = `@echo off\r\n"${process.execPath}" "${fixtureScriptPath}" %*\r\n`;
    await fs.writeFile(wrapperPath, wrapper, 'utf8');
    return wrapperPath;
  }

  const wrapperPath = path.join(binDir, name);
  const wrapper = `#!/usr/bin/env sh\n'${toShellLiteral(process.execPath)}' '${toShellLiteral(fixtureScriptPath)}' "$@"\n`;
  await fs.writeFile(wrapperPath, wrapper, 'utf8');
  await fs.chmod(wrapperPath, 0o755);
  return wrapperPath;
};

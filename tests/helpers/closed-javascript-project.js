import fs from 'node:fs/promises';
import path from 'node:path';

/** Tiny compiler fixtures own their source inventory and standard library.
 * Ambient @types packages from the author checkout are not fixture inputs.
 */
export const writeClosedJavaScriptProject = async (repoRoot, include) => {
  await fs.writeFile(path.join(repoRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { allowJs: true, checkJs: false, noEmit: true,
      target: 'ES2022', module: 'ESNext', types: [], lib: ['es2022'], skipLibCheck: true },
    include
  }));
};

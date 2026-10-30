import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderBashCompletion } from '../../../tools/cli/completions-renderer.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'completion-'));
try {
  const script = path.join(root, 'complete.sh');
  await fs.writeFile(script, renderBashCompletion({ '': ['index', 'search', 'help'], index: ['build', 'watch', 'validate'], help: ['index', 'search'] }) + `
check() {
  COMP_CWORD=$(($#-1)); COMP_WORDS=("$@"); __pairofcleats_complete
  printf '%s\\n' "\${COMPREPLY[*]}"
}
check pairofcleats ""
check pairofcleats se
check pairofcleats index ""
check pairofcleats help in
check pairofcleats unknown ""
check pairofcleats index wa
`);
  // Windows uses the Windows Git Bash binary explicitly; never the WSL launcher.
  const bash = process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe') : 'bash';
  const result = spawnSync(bash, [script.replace(/\\/g, '/')], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, String(result.error || result.stderr));
  assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.split(/\r?\n/).slice(0, 6), ['index search help', 'search', 'build watch validate', 'index', '', 'watch']);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Bash completion root, nested and repeated invocations produce candidates without diagnostics.');

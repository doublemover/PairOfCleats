import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runSetupPreflight } from '../../../tools/setup/preflight.js';
import { spawnResolvedSubprocess } from '../../../src/shared/subprocess/command-invocation.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('swift-native-operator-mask');
const scanner = path.resolve('node_modules/tree-sitter-swift/src/scanner.c').replaceAll('\\', '/');
const source = `#include <stdint.h>
#include "${scanner}"
typedef struct { TSLexer lexer; const char *text; unsigned at; } Input;
static void next(TSLexer *lexer, bool skip) {
  (void)skip; Input *input = (Input *)lexer;
  if (input->text[input->at]) input->at++;
  lexer->lookahead = (unsigned char)input->text[input->at];
}
static void mark(TSLexer *lexer) { (void)lexer; }
int main(void) {
  if (FAKE_TRY_BANG != 32) return 10;
  if (OP_SYMBOL_SUPPRESSOR[9] != (UINT64_C(1) << FAKE_TRY_BANG)) return 11;
  bool valid[TOKEN_COUNT] = {false}; valid[BANG] = true; valid[FAKE_TRY_BANG] = true;
  Input input = {0}; input.text = "!"; input.lexer.lookahead = '!';
  input.lexer.advance = next; input.lexer.mark_end = mark;
  enum TokenType result = BLOCK_COMMENT;
  if (eat_operators(&input.lexer, valid, true, 0, &result)) return 12;
  valid[FAKE_TRY_BANG] = false; input.at = 0; input.lexer.lookahead = '!';
  if (!eat_operators(&input.lexer, valid, true, 0, &result) || result != BANG) return 13;
  return 0;
}
`;
const input = path.join(dir, 'swift-mask.c');
const image = path.join(dir, process.platform === 'win32' ? 'swift-mask.exe' : 'swift-mask');
try {
  await fs.writeFile(input, source);
  const selected = runSetupPreflight();
  let compiler, args, env = { ...process.env, ...selected.childEnv };
  if (process.platform === 'win32') {
    compiler = selected.toolchain.compiler.executable;
    const bin = path.dirname(compiler), toolset = path.dirname(path.dirname(path.dirname(bin))), sdk = selected.toolchain.sdk;
    env = Object.fromEntries(Object.entries(env).filter(([key]) => !['cl', '_cl_', 'link', 'include', 'lib', 'libpath', 'path'].includes(key.toLowerCase())));
    Object.assign(env, {
      INCLUDE: [path.join(toolset, 'include'), ...['ucrt', 'shared', 'um'].map(part => path.join(sdk.root, 'Include', sdk.version, part))].join(';'),
      LIB: [path.join(toolset, 'lib', selected.arch), ...['um', 'ucrt'].map(part => path.join(sdk.root, 'Lib', sdk.version, part, selected.arch))].join(';'),
      PATH: [bin, process.env.PATH || process.env.Path || ''].join(';')
    });
    args = ['/nologo', '/TC', '/std:c11', '/W3', '/Fe' + image, '/Fo' + path.join(dir, 'swift-mask.obj'), input];
  } else {
    compiler = selected.toolchain.cCompiler.command;
    args = ['-std=c11', input, '-o', image];
  }
  const compiled = await spawnResolvedSubprocess(compiler, args, {
    cwd: dir, env, timeoutMs: 15000, maxOutputBytes: 65536, rejectOnNonZeroExit: false
  });
  assert.equal(compiled.exitCode, 0, compiled.stdout + compiled.stderr);
  const result = await spawnResolvedSubprocess(image, [], {
    cwd: dir, env, timeoutMs: 5000, maxOutputBytes: 65536, rejectOnNonZeroExit: false
  });
  assert.equal(result.exitCode, 0, 'actual Swift scanner must retain bit 32 and suppress only its valid try! context; code=' + result.exitCode);
  assert.doesNotMatch(compiled.stdout + compiled.stderr, /warning\s+C(?:4293|4334|6297)/i,
    'the actual scanner must compile without invalid-width shifts');
  console.log('Native Swift bit-32 suppression and ordinary bang operator pass.');
} finally { await fs.rm(dir, { recursive: true, force: true }); }

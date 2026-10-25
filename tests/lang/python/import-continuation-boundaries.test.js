import assert from 'node:assert/strict';
import { collectPythonImportEntries, collectPythonImports } from '../../../src/lang/python/imports.js';
import { collectLanguageImportEntries } from '../../../src/index/language-registry/registry.js';

const lines = ['value = (', '    1,', ')', 'from alpha import (', '    One,', '',
  '    # inside the continued import', '    Two as Second,', ')', 'import beta',
  'from ..gamma import (', '    Three,', ')', 'import delta; import epsilon as E',
  'from .zeta import \\', '    Four'];
const expected = ['..gamma', '.zeta', 'alpha', 'beta', 'delta', 'epsilon'];
for (const newline of ['\n', '\r\n']) for (const terminalNewline of ['', newline]) {
  const text = lines.join(newline) + terminalNewline;
  const { imports, usages } = collectPythonImports(text);
  assert.deepEqual([...imports].sort(), expected);
  assert.deepEqual(usages.sort(), ['E', 'Four', 'One', 'Second', 'Three', 'Two']);
  assert.deepEqual(collectPythonImportEntries(text).map(entry => entry.specifier).sort(), expected);
  assert.deepEqual(collectLanguageImportEntries({ ext: '.py', relPath: 'src/imports.py', mode: 'code', text })
    .map(entry => entry.specifier).sort(), expected);
}
console.log('Python multiline import boundaries passed');

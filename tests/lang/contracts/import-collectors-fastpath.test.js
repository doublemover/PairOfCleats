#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { collectCLikeImports } from '../../../src/lang/clike.js';
import { collectCSharpImports } from '../../../src/lang/csharp.js';
import { collectCssImports } from '../../../src/lang/css.js';
import { collectGoImports } from '../../../src/lang/go.js';
import { collectJavaImports } from '../../../src/lang/java.js';
import { collectKotlinImports } from '../../../src/lang/kotlin.js';
import { collectLuaImports } from '../../../src/lang/lua.js';
import { collectPerlImports } from '../../../src/lang/perl.js';
import { collectPhpImports } from '../../../src/lang/php.js';
import { collectPythonImports } from '../../../src/lang/python/imports.js';
import { collectRubyImports } from '../../../src/lang/ruby.js';
import { collectRustImports } from '../../../src/lang/rust.js';
import { collectShellImports } from '../../../src/lang/shell.js';

applyTestEnv();

assert.deepEqual(collectGoImports('package main\nfunc main() {}\n'), []);
assert.deepEqual(collectGoImports('import "fmt"\nimport (\n  "os"\n)\n').sort(), ['fmt', 'os']);

assert.deepEqual(collectJavaImports('class X {}\n'), []);
assert.deepEqual(collectJavaImports('import static java.util.Collections.*;\nimport java.util.List;\n').sort(), ['java.util.Collections.*', 'java.util.List']);

assert.deepEqual(collectCLikeImports('int main(){return 0;}\n'), []);
assert.deepEqual(collectCLikeImports('#include <stdio.h>\n# include "x.h"\n').sort(), ['stdio.h', 'x.h']);
assert.deepEqual(
  collectCLikeImports('#import <Foundation/Foundation.h>\n# import "ObjcLocal.h"\n').sort(),
  ['Foundation/Foundation.h', 'ObjcLocal.h']
);

assert.deepEqual(collectCSharpImports('namespace A {}\n'), []);
assert.deepEqual(collectCSharpImports('using static System.Math;\nusing IO = System.IO;\n').sort(), ['System.IO', 'System.Math']);

assert.deepEqual(collectKotlinImports('class Demo {}\n'), []);
assert.deepEqual(collectKotlinImports('import kotlin.collections.List\nimport kotlinx.coroutines.*\n').sort(), ['kotlin.collections.List', 'kotlinx.coroutines.*']);

assert.deepEqual(collectLuaImports('local x = 1\n'), []);
assert.deepEqual(collectLuaImports('local m = require \"mod.core\"\n').sort(), ['mod.core']);

assert.deepEqual(collectPerlImports('my $x = 1;\n'), []);
assert.deepEqual(collectPerlImports('use strict;\nrequire Foo::Bar;\n').sort(), ['Foo::Bar', 'strict']);

assert.deepEqual(collectPhpImports('<?php\necho 1;\n'), []);
assert.deepEqual(
  collectPhpImports('<?php\nuse Foo\\Bar as Baz, A\\B;\n').sort(),
  ['A\\B', 'Foo\\Bar']
);

assert.deepEqual(collectRubyImports('puts :ok\n'), []);
assert.deepEqual(collectRubyImports('require \"json\"\nrequire_relative \"../lib/x\"\n').sort(), ['../lib/x', 'json']);
assert.deepEqual(collectRubyImports('require_relative \"tasklib\"\n').sort(), ['./tasklib']);

assert.deepEqual(collectRustImports('fn main() {}\n'), []);
assert.deepEqual(collectRustImports('use std::fs;\nextern crate serde;\n').sort(), ['serde', 'std::fs']);

assert.deepEqual(collectShellImports('echo ok\n'), []);
assert.deepEqual(collectShellImports('source ./env.sh\n.\t./helpers.sh\n').sort(), ['./env.sh', './helpers.sh']);

assert.deepEqual(collectCssImports('body { color: red; }\n'), []);
assert.deepEqual(collectCssImports('@import \"base.css\";\n@import url(theme.css);\n').sort(), ['base.css', 'theme.css']);
assert.deepEqual(collectCssImports('@IMPORT \"upper.css\";\n@ImPoRt url(mixed.css);\n').sort(), ['mixed.css', 'upper.css']);

assert.deepEqual(collectPythonImports('x = 1\n'), { imports: [], usages: [] });
assert.deepEqual(
  collectPythonImports('import os, sys as system\nfrom pkg.mod import Item as Alias\n'),
  { imports: ['os', 'pkg.mod', 'sys'], usages: ['Alias', 'Item', 'system'] }
);

console.log('import collectors fastpath contract test passed');

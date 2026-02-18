#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'import-resolution-language-coverage');

await fs.rm(tempRoot, { recursive: true, force: true });

const write = async (relPath, content = '') => {
  const absPath = path.join(tempRoot, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content);
};

await write('go.mod', 'module github.com/example/demo\n\ngo 1.21\n');
await write(
  'pubspec.yaml',
  'publish_to: none\nversion: 0.1.0\nname: benchapp\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\n'
);

await write('python/pkg/main.py', 'import helpers\nfrom .utils import parse\nimport requests\n');
await write('python/pkg/helpers.py', 'VALUE = 1\n');
await write('python/pkg/utils/__init__.py', 'def parse():\n  return True\n');

await write('lib/App/Main.pm', "use App::Util;\n");
await write('lib/App/Util.pm', "package App::Util;\n1;\n");

await write('lua/app/main.lua', "local u = require('app.util')\n");
await write('lua/app/util.lua', 'return {}\n');

await write('src/App/Main.php', "<?php\nuse App\\Util\\Helper;\n");
await write('src/App/Util/Helper.php', "<?php\nclass Helper {}\n");

await write('cmd/app/main.go', 'package main\nimport "github.com/example/demo/internal/foo"\n');
await write('internal/foo/helper.go', 'package foo\n');

await write('src/main/java/com/acme/App.java', 'import com.acme.util.Helper;\n');
await write('src/main/java/com/acme/util/Helper.java', 'package com.acme.util;\n');

await write('src/main/kotlin/com/acme/KMain.kt', 'import com.acme.util.KHelper\n');
await write('src/main/kotlin/com/acme/util/KHelper.kt', 'package com.acme.util\n');

await write('src/App/Main.cs', 'using App.Util.Helper;\n');
await write('src/App/Util/Helper.cs', 'namespace App.Util { class Helper {} }\n');

await write('Sources/Core/Main.swift', 'import CoreNetworking\n');
await write('Sources/CoreNetworking/Client.swift', 'public struct Client {}\n');

await write('src/lib.rs', 'use crate::util::parser::parse;\n');
await write('src/util/parser.rs', 'pub fn parse() {}\n');

await write('scripts/main.sh', 'source lib/helpers.sh\n');
await write('scripts/lib/helpers.sh', 'echo ok\n');

await write('cmake/main.cmake', 'include(modules/common.cmake)\n');
await write('cmake/modules/common.cmake', '# helper\n');

await write('lib/main.dart', "import 'package:benchapp/src/util.dart';\nimport 'src/local.dart';\nimport 'package:flutter/material.dart';\n");
await write('lib/src/util.dart', 'class Util {}\n');
await write('lib/src/local.dart', 'class Local {}\n');

await write('src/main/scala/com/acme/ScalaMain.scala', 'import com.acme.util.ScalaHelper\n');
await write('src/main/scala/com/acme/util/ScalaHelper.scala', 'package com.acme.util\n');

await write('src/main/groovy/com/acme/GMain.groovy', 'import com.acme.util.GHelper\n');
await write('src/main/groovy/com/acme/util/GHelper.groovy', 'package com.acme.util\n');

await write('src/Main.jl', 'using Util.Core\n');
await write('src/Util/Core.jl', 'module Core\nend\n');

await write('src/main.cpp', '#include "myproj/foo.hpp"\n#include <vector>\n');
await write('include/myproj/foo.hpp', '#pragma once\n');

const entries = [
  'python/pkg/main.py',
  'python/pkg/helpers.py',
  'python/pkg/utils/__init__.py',
  'lib/App/Main.pm',
  'lib/App/Util.pm',
  'lua/app/main.lua',
  'lua/app/util.lua',
  'src/App/Main.php',
  'src/App/Util/Helper.php',
  'cmd/app/main.go',
  'internal/foo/helper.go',
  'src/main/java/com/acme/App.java',
  'src/main/java/com/acme/util/Helper.java',
  'src/main/kotlin/com/acme/KMain.kt',
  'src/main/kotlin/com/acme/util/KHelper.kt',
  'src/App/Main.cs',
  'src/App/Util/Helper.cs',
  'Sources/Core/Main.swift',
  'Sources/CoreNetworking/Client.swift',
  'src/lib.rs',
  'src/util/parser.rs',
  'scripts/main.sh',
  'scripts/lib/helpers.sh',
  'cmake/main.cmake',
  'cmake/modules/common.cmake',
  'lib/main.dart',
  'lib/src/util.dart',
  'lib/src/local.dart',
  'src/main/scala/com/acme/ScalaMain.scala',
  'src/main/scala/com/acme/util/ScalaHelper.scala',
  'src/main/groovy/com/acme/GMain.groovy',
  'src/main/groovy/com/acme/util/GHelper.groovy',
  'src/Main.jl',
  'src/Util/Core.jl',
  'src/main.cpp',
  'include/myproj/foo.hpp'
].map((rel) => ({ abs: path.join(tempRoot, rel), rel }));

const importsByFile = {
  'python/pkg/main.py': ['helpers', '.utils', 'requests'],
  'lib/App/Main.pm': ['App::Util'],
  'lua/app/main.lua': ['app.util'],
  'src/App/Main.php': ['App\\Util\\Helper'],
  'cmd/app/main.go': ['github.com/example/demo/internal/foo'],
  'src/main/java/com/acme/App.java': ['com.acme.util.Helper'],
  'src/main/kotlin/com/acme/KMain.kt': ['com.acme.util.KHelper'],
  'src/App/Main.cs': ['App.Util.Helper'],
  'Sources/Core/Main.swift': ['CoreNetworking'],
  'src/lib.rs': ['crate::util::parser'],
  'scripts/main.sh': ['lib/helpers.sh'],
  'cmake/main.cmake': ['modules/common.cmake'],
  'lib/main.dart': ['package:benchapp/src/util.dart', 'src/local.dart', 'package:flutter/material.dart'],
  'src/main/scala/com/acme/ScalaMain.scala': ['com.acme.util.ScalaHelper'],
  'src/main/groovy/com/acme/GMain.groovy': ['com.acme.util.GHelper'],
  'src/Main.jl': ['Util.Core'],
  'src/main.cpp': ['myproj/foo.hpp', 'vector']
};

const relations = new Map(Object.keys(importsByFile).map((file) => [file, { imports: importsByFile[file].slice() }]));

resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: relations,
  enableGraph: false
});

const assertLinks = (file, expected) => {
  const rel = relations.get(file);
  assert.ok(rel, `missing relations for ${file}`);
  assert.deepEqual(rel.importLinks || [], expected, `unexpected importLinks for ${file}`);
};

const assertExternal = (file, expected) => {
  const rel = relations.get(file);
  assert.ok(rel, `missing relations for ${file}`);
  assert.deepEqual(rel.externalImports || [], expected, `unexpected externalImports for ${file}`);
};

assertLinks('python/pkg/main.py', ['python/pkg/helpers.py', 'python/pkg/utils/__init__.py']);
assertExternal('python/pkg/main.py', ['requests']);
assertLinks('lib/App/Main.pm', ['lib/App/Util.pm']);
assertLinks('lua/app/main.lua', ['lua/app/util.lua']);
assertLinks('src/App/Main.php', ['src/App/Util/Helper.php']);
assertLinks('cmd/app/main.go', ['internal/foo/helper.go']);
assertLinks('src/main/java/com/acme/App.java', ['src/main/java/com/acme/util/Helper.java']);
assertLinks('src/main/kotlin/com/acme/KMain.kt', ['src/main/kotlin/com/acme/util/KHelper.kt']);
assertLinks('src/App/Main.cs', ['src/App/Util/Helper.cs']);
assertLinks('Sources/Core/Main.swift', ['Sources/CoreNetworking/Client.swift']);
assertLinks('src/lib.rs', ['src/util/parser.rs']);
assertLinks('scripts/main.sh', ['scripts/lib/helpers.sh']);
assertLinks('cmake/main.cmake', ['cmake/modules/common.cmake']);
assertLinks('lib/main.dart', ['lib/src/local.dart', 'lib/src/util.dart']);
assertExternal('lib/main.dart', ['package:flutter/material.dart']);
assertLinks('src/main/scala/com/acme/ScalaMain.scala', ['src/main/scala/com/acme/util/ScalaHelper.scala']);
assertLinks('src/main/groovy/com/acme/GMain.groovy', ['src/main/groovy/com/acme/util/GHelper.groovy']);
assertLinks('src/Main.jl', ['src/Util/Core.jl']);
assertLinks('src/main.cpp', ['include/myproj/foo.hpp']);
assertExternal('src/main.cpp', ['vector']);

console.log('import resolution language coverage tests passed');

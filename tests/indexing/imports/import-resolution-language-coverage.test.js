#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import {
  classifyUnresolvedImportSample,
  enrichUnresolvedImportSamples,
  summarizeUnresolvedImportTaxonomy
} from '../../../src/index/build/imports.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-resolution-language-coverage');

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
await write('python/pkg/stubs.pyi', 'from .helpers import VALUE\n');
await write('python/pkg/utils/__init__.py', 'def parse():\n  return True\n');
await write('python/service/main.py', 'from .proto import client_pb2\n');
await write('python/service/proto/client.proto', 'syntax = "proto3";\nmessage Client {}\n');
await write('python/pydantic_core/__init__.py', 'from ._pydantic_core import __version__\n');
await write('python/pydantic_core/_pydantic_core.pyi', '__version__: str\n');

await write('lib/App/Main.pm', "use App::Util;\n");
await write('lib/App/Util.pm', "package App::Util;\n1;\n");

await write('lua/app/main.lua', "local u = require('app.util')\n");
await write('lua/app/util.lua', 'return {}\n');

await write('src/App/Main.php', "<?php\nuse App\\Util\\Helper;\ninclude_once './bootstrap.php';\nrequire_once '../vendor/autoload.php';\n");
await write('src/App/bootstrap.php', "<?php\nreturn true;\n");
await write('src/App/Util/Helper.php', "<?php\nclass Helper {}\n");
await write('src/vendor/autoload.php', "<?php\n");

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
await write('scripts/system.sh', 'source /etc/bash_completion\nsource /usr/local/share/chruby/auto.sh\n');
await write('src/gen/consumer.ts', "import './generated/client.pb.ts';\n");
await write('index.html', '<!doctype html><img src="/logo/logo-clear.png"/>\n');
await write('logo/logo-clear.png', 'not-a-real-png-but-exists\n');
await write('web/frpc/index.html', '<!doctype html><script type="module" src="/src/main.ts"></script>\n');
await write('web/frpc/src/main.ts', 'console.log("frpc");\n');

await write('cmake/main.cmake', 'include(modules/common.cmake)\n');
await write('cmake/modules/common.cmake', '# helper\n');
await write('cmake/sub/main.cmake', 'include(../modules/common.cmake)\n');
await write('cmake/sub/modules/common.cmake', '# sibling should not win for ../ imports\n');
await write('nix/flake.nix', 'imports = [ ./modules ];\n');
await write('nix/modules/default.nix', '{ }:\n{ }\n');
await write('nix/pkgs/tool/default.nix', '{ }:\n{ }\n');
await write('nix/git-hooks.nix', '{ }:\n{ }\n');

await write('tools/defs.bzl', 'def macro():\n  pass\n');
await write('tools/pkg/pkg.bzl', 'def pkg_macro():\n  pass\n');
await write('tools/pkg/defs.bzl', 'def defs_macro():\n  pass\n');
await write(
  'app/rules.bzl',
  [
    'load("//tools:defs.bzl", "macro")',
    'load("//tools/pkg", "pkg_macro")',
    'load("//tools/pkg:defs", "defs_macro")',
    'load(":local.bzl", "local_macro")',
    ''
  ].join('\n')
);
await write('app/local.bzl', 'def local_macro():\n  pass\n');
await write(
  'MODULE.bazel',
  'load("//go:extensions.bzl", "go_deps")\nload("//go:missing_extension.bzl", "go_missing")\n'
);
await write('go/extensions.bzl', 'def go_deps():\n  pass\n');
await write('Makefile', 'include ./Dockerfile-kubernetes\n');
await write('Dockerfile-kubernetes', 'FROM scratch\n');
await write(
  'src/AspNet/OData/src/Asp.Versioning.WebApi.OData.ApiExplorer/Asp.Versioning.WebApi.OData.ApiExplorer.csproj',
  '<Project><Import Project="..\\\\..\\\\..\\\\..\\\\Common\\\\src\\\\Common.OData.ApiExplorer\\\\Common.OData.ApiExplorer.projitems"/></Project>\n'
);
await write('src/Common/src/Common.OData.ApiExplorer/Common.OData.ApiExplorer.projitems', '<Project></Project>\n');

await write('lib/main.dart', "import 'package:benchapp/src/util.dart';\nimport 'src/local.dart';\nimport 'package:flutter/material.dart';\n");
await write('lib/src/util.dart', 'class Util {}\n');
await write('lib/src/local.dart', 'class Local {}\n');

await write('src/main/scala/com/acme/ScalaMain.scala', 'import com.acme.util.ScalaHelper\n');
await write('src/main/scala/com/acme/util/ScalaHelper.scala', 'package com.acme.util\n');

await write('src/main/groovy/com/acme/GMain.groovy', 'import com.acme.util.GHelper\n');
await write('src/main/groovy/com/acme/util/GHelper.groovy', 'package com.acme.util\n');
await write('src/plugin/main.js', "import '@repo/dep.js';\n");
await write('src/repo_alias/dep.js', 'export const dep = 1;\n');
await write('src/custom/main.ts', "import './code-output/client.codegen.ts';\n");

await write('src/Main.jl', 'using Util.Core\n');
await write('src/Util/Core.jl', 'module Core\nend\n');

await write('src/main.cpp', '#include "myproj/foo.hpp"\n#include <vector>\n');
await write('include/myproj/foo.hpp', '#pragma once\n');
await write('rust/Cargo.toml', '[dependencies]\nutil = { path = "crates/util" }\n');
await write('rust/crates/util/Cargo.toml', '[package]\nname = "util"\nversion = "0.1.0"\n');
await write('serde/Cargo.toml', '[dependencies]\nserde_core = { path = "../serde_core" }\n');
await write('serde_core/Cargo.toml', '[package]\nname = "serde_core"\nversion = "0.1.0"\n');
await write(
  'unittests/runtime/CompatibilityOverrideRuntime.cpp',
  '#include "../../stdlib/public/CompatibilityOverride/CompatibilityOverrideRuntime.def"\n'
);
await write(
  'stdlib/public/CompatibilityOverride/CompatibilityOverrideRuntime.def',
  '#define SWIFT_COMPAT_OVERRIDE_RUNTIME 1\n'
);

const entries = [
  'python/pkg/main.py',
  'python/pkg/helpers.py',
  'python/pkg/stubs.pyi',
  'python/pkg/utils/__init__.py',
  'python/service/main.py',
  'python/service/proto/client.proto',
  'python/pydantic_core/__init__.py',
  'python/pydantic_core/_pydantic_core.pyi',
  'lib/App/Main.pm',
  'lib/App/Util.pm',
  'lua/app/main.lua',
  'lua/app/util.lua',
  'src/App/Main.php',
  'src/App/bootstrap.php',
  'src/App/Util/Helper.php',
  'src/vendor/autoload.php',
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
  'scripts/system.sh',
  'src/gen/consumer.ts',
  'scripts/lib/helpers.sh',
  'index.html',
  'web/frpc/index.html',
  'web/frpc/src/main.ts',
  'cmake/main.cmake',
  'cmake/modules/common.cmake',
  'cmake/sub/main.cmake',
  'cmake/sub/modules/common.cmake',
  'nix/flake.nix',
  'nix/modules/default.nix',
  'nix/pkgs/tool/default.nix',
  'nix/git-hooks.nix',
  'tools/defs.bzl',
  'tools/pkg/pkg.bzl',
  'tools/pkg/defs.bzl',
  'app/rules.bzl',
  'app/local.bzl',
  'MODULE.bazel',
  'go/extensions.bzl',
  'Makefile',
  'Dockerfile-kubernetes',
  'src/AspNet/OData/src/Asp.Versioning.WebApi.OData.ApiExplorer/Asp.Versioning.WebApi.OData.ApiExplorer.csproj',
  'src/Common/src/Common.OData.ApiExplorer/Common.OData.ApiExplorer.projitems',
  'lib/main.dart',
  'lib/src/util.dart',
  'lib/src/local.dart',
  'src/main/scala/com/acme/ScalaMain.scala',
  'src/main/scala/com/acme/util/ScalaHelper.scala',
  'src/main/groovy/com/acme/GMain.groovy',
  'src/main/groovy/com/acme/util/GHelper.groovy',
  'src/plugin/main.js',
  'src/repo_alias/dep.js',
  'src/custom/main.ts',
  'src/Main.jl',
  'src/Util/Core.jl',
  'src/main.cpp',
  'include/myproj/foo.hpp',
  'rust/Cargo.toml',
  'rust/crates/util/Cargo.toml',
  'serde/Cargo.toml',
  'serde_core/Cargo.toml',
  'unittests/runtime/CompatibilityOverrideRuntime.cpp',
  'stdlib/public/CompatibilityOverride/CompatibilityOverrideRuntime.def'
].map((rel) => ({ abs: path.join(tempRoot, rel), rel }));

const importsByFile = {
  'python/pkg/main.py': ['helpers', '.utils', 'requests'],
  'python/pkg/stubs.pyi': ['.helpers'],
  'python/service/main.py': ['./proto/client_pb2.py'],
  'python/pydantic_core/__init__.py': ['._pydantic_core'],
  'lib/App/Main.pm': ['App::Util'],
  'lua/app/main.lua': ['app.util'],
  'src/App/Main.php': ['App\\Util\\Helper', './bootstrap.php', '../vendor/autoload.php'],
  'cmd/app/main.go': ['github.com/example/demo/internal/foo'],
  'src/main/java/com/acme/App.java': ['com.acme.util.Helper'],
  'src/main/kotlin/com/acme/KMain.kt': ['com.acme.util.KHelper'],
  'src/App/Main.cs': ['App.Util.Helper'],
  'Sources/Core/Main.swift': ['CoreNetworking'],
  'src/lib.rs': ['crate::util::parser'],
  'scripts/main.sh': ['lib/helpers.sh', './lib/missing.sh'],
  'scripts/system.sh': ['/etc/bash_completion', '/usr/local/share/chruby/auto.sh'],
  'src/gen/consumer.ts': ['./generated/client.pb.ts'],
  'index.html': ['/logo/logo-clear.png'],
  'web/frpc/index.html': ['/src/main.ts'],
  'cmake/main.cmake': ['modules/common.cmake'],
  'cmake/sub/main.cmake': ['../modules/common.cmake'],
  'nix/flake.nix': ['./modules', './pkgs/tool', './git-hooks.nix'],
  'app/rules.bzl': ['//tools:defs.bzl', '//tools/pkg', '//tools/pkg:defs', ':local.bzl'],
  'MODULE.bazel': ['//go:extensions.bzl', '//go:missing_extension.bzl'],
  Makefile: ['./Dockerfile-kubernetes'],
  'src/AspNet/OData/src/Asp.Versioning.WebApi.OData.ApiExplorer/Asp.Versioning.WebApi.OData.ApiExplorer.csproj': [
    '..\\..\\..\\..\\Common\\src\\Common.OData.ApiExplorer\\Common.OData.ApiExplorer.projitems'
  ],
  'lib/main.dart': ['package:benchapp/src/util.dart', 'src/local.dart', 'package:flutter/material.dart'],
  'src/main/scala/com/acme/ScalaMain.scala': ['com.acme.util.ScalaHelper'],
  'src/main/groovy/com/acme/GMain.groovy': ['com.acme.util.GHelper'],
  'src/plugin/main.js': ['@repo/dep.js'],
  'src/custom/main.ts': ['./code-output/client.codegen.ts'],
  'src/Main.jl': ['Util.Core'],
  'src/main.cpp': ['myproj/foo.hpp', 'vector'],
  'rust/Cargo.toml': ['crates/util'],
  'serde/Cargo.toml': ['../serde_core'],
  'unittests/runtime/CompatibilityOverrideRuntime.cpp': [
    '../../stdlib/public/CompatibilityOverride/CompatibilityOverrideRuntime.def'
  ]
};

const relations = new Map(Object.keys(importsByFile).map((file) => [file, { imports: importsByFile[file].slice() }]));

const resolution = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: relations,
  enableGraph: false,
  resolverPlugins: {
    alias: {
      rules: [
        { match: '@repo/*', replace: 'src/repo_alias/*' }
      ]
    },
    buildContext: {
      generatedArtifactsConfig: {
        suffixes: ['.codegen.ts']
      }
    }
  }
});

const assertLinks = (file, expected) => {
  const rel = relations.get(file);
  assert.ok(rel, `missing relations for ${file}`);
  assert.deepEqual(rel.importLinks || [], expected, `unexpected importLinks for ${file}`);
};

const assertLinksUnordered = (file, expected) => {
  const rel = relations.get(file);
  assert.ok(rel, `missing relations for ${file}`);
  const actual = Array.isArray(rel.importLinks) ? rel.importLinks.slice().sort() : [];
  const want = Array.isArray(expected) ? expected.slice().sort() : [];
  assert.deepEqual(actual, want, `unexpected importLinks for ${file}`);
};

const assertExternal = (file, expected) => {
  const rel = relations.get(file);
  assert.ok(rel, `missing relations for ${file}`);
  assert.deepEqual(rel.externalImports || [], expected, `unexpected externalImports for ${file}`);
};

assertLinks('python/pkg/main.py', ['python/pkg/helpers.py', 'python/pkg/utils/__init__.py']);
assertExternal('python/pkg/main.py', ['requests']);
assertLinks('python/pkg/stubs.pyi', ['python/pkg/helpers.py']);
assertLinks('python/pydantic_core/__init__.py', ['python/pydantic_core/_pydantic_core.pyi']);
assertLinks('lib/App/Main.pm', ['lib/App/Util.pm']);
assertLinks('lua/app/main.lua', ['lua/app/util.lua']);
assertLinksUnordered('src/App/Main.php', ['src/App/Util/Helper.php', 'src/App/bootstrap.php', 'src/vendor/autoload.php']);
assertLinks('cmd/app/main.go', ['internal/foo/helper.go']);
assertLinks('src/main/java/com/acme/App.java', ['src/main/java/com/acme/util/Helper.java']);
assertLinks('src/main/kotlin/com/acme/KMain.kt', ['src/main/kotlin/com/acme/util/KHelper.kt']);
assertLinks('src/App/Main.cs', ['src/App/Util/Helper.cs']);
assertLinks('Sources/Core/Main.swift', ['Sources/CoreNetworking/Client.swift']);
assertLinks('src/lib.rs', ['src/util/parser.rs']);
assertLinks('scripts/main.sh', ['scripts/lib/helpers.sh']);
assertExternal('scripts/system.sh', ['/etc/bash_completion', '/usr/local/share/chruby/auto.sh']);
assertExternal('index.html', ['/logo/logo-clear.png']);
assertLinks('web/frpc/index.html', ['web/frpc/src/main.ts']);
assertLinks('cmake/main.cmake', ['cmake/modules/common.cmake']);
assertLinks('cmake/sub/main.cmake', ['cmake/modules/common.cmake']);
assertLinks('nix/flake.nix', ['nix/git-hooks.nix', 'nix/modules/default.nix', 'nix/pkgs/tool/default.nix']);
assertLinksUnordered('app/rules.bzl', ['app/local.bzl', 'tools/defs.bzl', 'tools/pkg/defs.bzl', 'tools/pkg/pkg.bzl']);
assertLinks('MODULE.bazel', ['go/extensions.bzl']);
assertLinks('Makefile', ['Dockerfile-kubernetes']);
assertLinks(
  'src/AspNet/OData/src/Asp.Versioning.WebApi.OData.ApiExplorer/Asp.Versioning.WebApi.OData.ApiExplorer.csproj',
  ['src/Common/src/Common.OData.ApiExplorer/Common.OData.ApiExplorer.projitems']
);
assertLinks('lib/main.dart', ['lib/src/local.dart', 'lib/src/util.dart']);
assertExternal('lib/main.dart', ['package:flutter/material.dart']);
assertLinks('src/main/scala/com/acme/ScalaMain.scala', ['src/main/scala/com/acme/util/ScalaHelper.scala']);
assertLinks('src/main/groovy/com/acme/GMain.groovy', ['src/main/groovy/com/acme/util/GHelper.groovy']);
assertLinks('src/plugin/main.js', ['src/repo_alias/dep.js']);
assertLinks('src/Main.jl', ['src/Util/Core.jl']);
assertLinks('src/main.cpp', ['include/myproj/foo.hpp']);
assertExternal('src/main.cpp', ['vector']);
assertLinks('rust/Cargo.toml', ['rust/crates/util/Cargo.toml']);
assertLinks('serde/Cargo.toml', ['serde_core/Cargo.toml']);
assertLinks(
  'unittests/runtime/CompatibilityOverrideRuntime.cpp',
  ['stdlib/public/CompatibilityOverride/CompatibilityOverrideRuntime.def']
);

const realUnresolvedSamples = enrichUnresolvedImportSamples(resolution.unresolvedSamples || []);
assert.equal(realUnresolvedSamples.length, 5, 'expected unresolved samples from shell, bazel label, and generated coverage');
const realBySpecifier = Object.fromEntries(realUnresolvedSamples.map((entry) => [entry.specifier, entry]));
assert.equal(realBySpecifier['./lib/missing.sh']?.category, 'missing_file');
assert.equal(realBySpecifier['./lib/missing.sh']?.reasonCode, 'IMP_U_MISSING_FILE_RELATIVE');
assert.equal(realBySpecifier['./lib/missing.sh']?.failureCause, 'missing_file');
assert.equal(realBySpecifier['./lib/missing.sh']?.disposition, 'actionable');
assert.equal(realBySpecifier['./lib/missing.sh']?.resolverStage, 'filesystem_probe');
assert.equal(realBySpecifier['//go:missing_extension.bzl']?.category, 'resolver_gap');
assert.equal(realBySpecifier['//go:missing_extension.bzl']?.reasonCode, 'IMP_U_RESOLVER_GAP');
assert.equal(realBySpecifier['//go:missing_extension.bzl']?.failureCause, 'resolver_gap');
assert.equal(realBySpecifier['//go:missing_extension.bzl']?.disposition, 'suppress_gate');
assert.equal(realBySpecifier['//go:missing_extension.bzl']?.resolverStage, 'language_resolver');
assert.equal(realBySpecifier['./generated/client.pb.ts']?.category, 'generated_expected_missing');
assert.equal(realBySpecifier['./generated/client.pb.ts']?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');
assert.equal(realBySpecifier['./generated/client.pb.ts']?.failureCause, 'generated_expected_missing');
assert.equal(realBySpecifier['./generated/client.pb.ts']?.disposition, 'suppress_gate');
assert.equal(realBySpecifier['./generated/client.pb.ts']?.resolverStage, 'build_system_resolver');
assert.equal(realBySpecifier['./proto/client_pb2.py']?.category, 'generated_expected_missing');
assert.equal(realBySpecifier['./proto/client_pb2.py']?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');
assert.equal(realBySpecifier['./proto/client_pb2.py']?.failureCause, 'generated_expected_missing');
assert.equal(realBySpecifier['./proto/client_pb2.py']?.disposition, 'suppress_gate');
assert.equal(realBySpecifier['./proto/client_pb2.py']?.resolverStage, 'build_system_resolver');
assert.equal(realBySpecifier['./code-output/client.codegen.ts']?.category, 'generated_expected_missing');
assert.equal(realBySpecifier['./code-output/client.codegen.ts']?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');
assert.equal(realBySpecifier['./code-output/client.codegen.ts']?.failureCause, 'generated_expected_missing');
assert.equal(realBySpecifier['./code-output/client.codegen.ts']?.disposition, 'suppress_gate');
assert.equal(realBySpecifier['./code-output/client.codegen.ts']?.resolverStage, 'build_system_resolver');

const taxonomySamples = enrichUnresolvedImportSamples([
  ...realUnresolvedSamples,
  { importer: 'tests/__fixtures__/case.test.js', specifier: './missing-fixture.js', reason: 'unresolved' },
  { importer: 'src/main.js', specifier: 'fsevents', reason: 'optional dependency not installed' },
  { importer: 'MODULE.bazel', specifier: '//go:missing.bzl', reason: 'unresolved' },
  { importer: 'src/main.js', specifier: '.\\windows\\path\\module.js', reason: 'unresolved' },
  { importer: 'src/main.js', specifier: './utlis.jss', reason: 'unresolved' }
]);
const taxonomy = summarizeUnresolvedImportTaxonomy(taxonomySamples);
const taxonomyBySpecifier = Object.fromEntries(
  taxonomySamples.map((sample) => [sample.specifier, sample.category])
);
assert.equal(taxonomyBySpecifier['./missing-fixture.js'], 'fixture');
assert.equal(taxonomyBySpecifier.fsevents, 'optional_dependency');
assert.equal(taxonomyBySpecifier['//go:missing.bzl'], 'resolver_gap');
assert.equal(taxonomyBySpecifier['.\\windows\\path\\module.js'], 'path_normalization');
assert.equal(taxonomyBySpecifier['./utlis.jss'], 'typo');
assert.equal(taxonomyBySpecifier['./lib/missing.sh'], 'missing_file');
assert.equal(taxonomyBySpecifier['./generated/client.pb.ts'], 'generated_expected_missing');
assert.equal(taxonomy.liveSuppressed, 2);
assert.equal(taxonomy.gateSuppressed, 5);
assert.equal(taxonomy.actionable, 3);
assert.equal(Object.keys(taxonomy.reasonCodes).length > 0, true, 'expected reason-code aggregation');
assert.deepEqual(
  Object.fromEntries(Object.entries(taxonomy.resolverStages)),
  {
    build_system_resolver: 3,
    classify: 3,
    filesystem_probe: 1,
    language_resolver: 2,
    normalize: 1
  },
  'expected resolver stage aggregation in taxonomy'
);
assert.deepEqual(
  taxonomy.actionableHotspots,
  [
    { importer: 'src/main.js', count: 2 },
    { importer: 'scripts/main.sh', count: 1 }
  ],
  'expected actionable unresolved importer hotspots'
);
assert.deepEqual(
  Object.fromEntries(Object.entries(taxonomy.actionableByLanguage || {})),
  { js: 2, sh: 1 },
  'expected actionable unresolved language hotspot counts'
);
assert.equal(Number.isFinite(Number(taxonomy.actionableRate)), true, 'expected actionable rate in taxonomy');
assert.equal(taxonomy.actionableUnresolvedRate, taxonomy.actionableRate, 'expected actionable rate alias');
assert.equal(taxonomy.parserArtifactRate, 0, 'expected parser artifact rate in taxonomy');
assert.equal(taxonomy.resolverGapRate, 2 / 10, 'expected resolver-gap rate in taxonomy');
assert.deepEqual(
  Object.fromEntries(Object.entries(taxonomy.categories)),
  {
    fixture: 1,
    generated_expected_missing: 3,
    missing_file: 1,
    optional_dependency: 1,
    path_normalization: 1,
    resolver_gap: 2,
    typo: 1
  }
);

const parseErrorCategory = classifyUnresolvedImportSample({
  importer: 'src/broken.js',
  specifier: './module.js',
  reason: 'parse_error'
});
assert.equal(parseErrorCategory.category, 'parse_error');
assert.equal(parseErrorCategory.suppressLive, false);
assert.equal(parseErrorCategory.reasonCode, 'IMP_U_PARSE_ERROR');
assert.equal(parseErrorCategory.failureCause, 'parse_error');
assert.equal(parseErrorCategory.resolutionState, 'unresolved');

const invalidIncomingFields = classifyUnresolvedImportSample({
  importer: 'src/noise.js',
  specifier: './missing.js',
  reasonCode: 'IMP_U_PARSER_NOISE_SUPPRESSED',
  failureCause: 'invalid_failure',
  disposition: 'actionable',
  resolverStage: 'invalid_stage'
});
assert.equal(invalidIncomingFields.reasonCode, 'IMP_U_PARSER_NOISE_SUPPRESSED');
assert.equal(invalidIncomingFields.failureCause, 'parser_artifact');
assert.equal(invalidIncomingFields.disposition, 'suppress_live');
assert.equal(invalidIncomingFields.resolverStage, 'classify');

console.log('import resolution language coverage tests passed');

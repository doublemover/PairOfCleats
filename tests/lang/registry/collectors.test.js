#!/usr/bin/env node
import { collectCmakeImports } from '../../../src/index/language-registry/import-collectors/cmake.js';
import { collectDartImports } from '../../../src/index/language-registry/import-collectors/dart.js';
import { collectDockerfileImports } from '../../../src/index/language-registry/import-collectors/dockerfile.js';
import { collectGraphqlImports } from '../../../src/index/language-registry/import-collectors/graphql.js';
import { collectGroovyImports } from '../../../src/index/language-registry/import-collectors/groovy.js';
import { collectHandlebarsImports } from '../../../src/index/language-registry/import-collectors/handlebars.js';
import { collectIniImports } from '../../../src/index/language-registry/import-collectors/ini.js';
import { collectJsonImports } from '../../../src/index/language-registry/import-collectors/json.js';
import { collectJinjaImports } from '../../../src/index/language-registry/import-collectors/jinja.js';
import { collectJuliaImports } from '../../../src/index/language-registry/import-collectors/julia.js';
import { collectMakefileImports } from '../../../src/index/language-registry/import-collectors/makefile.js';
import { collectMustacheImports } from '../../../src/index/language-registry/import-collectors/mustache.js';
import { collectNixImports } from '../../../src/index/language-registry/import-collectors/nix.js';
import { collectProtoImports } from '../../../src/index/language-registry/import-collectors/proto.js';
import { collectRazorImports } from '../../../src/index/language-registry/import-collectors/razor.js';
import { collectRImports } from '../../../src/index/language-registry/import-collectors/r.js';
import { collectScalaImports } from '../../../src/index/language-registry/import-collectors/scala.js';
import { collectStarlarkImports } from '../../../src/index/language-registry/import-collectors/starlark.js';
import { collectTomlImports } from '../../../src/index/language-registry/import-collectors/toml.js';
import { collectXmlImports } from '../../../src/index/language-registry/import-collectors/xml.js';
import { collectYamlImports } from '../../../src/index/language-registry/import-collectors/yaml.js';

const sort = (list) => list.slice().sort();
const expectSet = (label, actual, expected) => {
  const actualSorted = sort(actual);
  const expectedSorted = sort(expected);
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    console.error(`${label} mismatch: ${JSON.stringify(actualSorted)} !== ${JSON.stringify(expectedSorted)}`);
    process.exit(1);
  }
};

const cases = [
  {
    label: 'xml',
    fn: collectXmlImports,
    text: [
      '<root xmlns:cfg="urn:cfg" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
      '  xsi:schemaLocation="urn:cfg ./cfg.xsd">',
      '  <!-- <xsd:import schemaLocation="./ignored.xsd" /> -->',
      '  <xi:include href="./base.xml" />',
      '  <xsd:import schemaLocation="./types.xsd" />',
      '</root>'
    ].join('\n'),
    expected: [
      'urn:cfg',
      './cfg.xsd',
      './base.xml',
      './types.xsd'
    ]
  },
  {
    label: 'ini',
    fn: collectIniImports,
    text: [
      '[includes]',
      'files = "./base.ini", "./feature#v1.cfg" ; trailing comment',
      '[server]',
      'schema = ./schema.ini'
    ].join('\n'),
    expected: ['./base.ini', './feature#v1.cfg', './schema.ini']
  },
  {
    label: 'toml',
    fn: collectTomlImports,
    text: [
      '[dependencies]',
      'serde = "1.0"',
      'localcrate = { path = "../localcrate" }',
      'name = "pkg#name" # trailing comment',
      '[tool.poc]',
      'include = ["./base.toml", "./feature#v1.toml"] # trailing comment'
    ].join('\n'),
    expected: ['../localcrate', './base.toml', './feature#v1.toml']
  },
  {
    label: 'json',
    fn: collectJsonImports,
    text: JSON.stringify({
      schema: 'https://schemas.acme.dev/service.json',
      service: {
        include: ['./base.json', './feature.json'],
        configPath: 'configs/service.json',
        metadataUrl: 'https://acme.dev/docs',
        outputFile: 'build/out.json'
      }
    }),
    expected: [
      'https://schemas.acme.dev/service.json',
      './base.json',
      './feature.json'
    ]
  },
  {
    label: 'yaml',
    fn: collectYamlImports,
    text: [
      'defaults: &defaults',
      '  image: node:20',
      'service:',
      '  <<: *defaults',
      'include:',
      '- ./base.yaml',
      '- "./feature#v1.yml" # trailing comment',
      'extends: ./parent.yml',
      'quoted: "http://example.com/#fragment"'
    ].join('\n'),
    expected: ['./base.yaml', './feature#v1.yml', './parent.yml']
  },
  {
    label: 'dockerfile',
    fn: collectDockerfileImports,
    text: [
      'FROM --platform=$BUILDPLATFORM node:18 AS base',
      'FROM --platform $TARGETPLATFORM ghcr.io/acme/runtime:1 AS runtime',
      'FROM base AS build',
      'RUN echo from builder',
      'RUN --mount=type=cache,target=/root/.cache \\',
      '    --mount=type=bind,from=ghcr.io/acme/builder:latest,target=/src true',
      'COPY --from=base /src /dst'
    ].join('\n'),
    expected: ['node:18', 'base', 'runtime', 'ghcr.io/acme/runtime:1', 'build', 'ghcr.io/acme/builder:latest']
  },
  {
    label: 'makefile',
    fn: collectMakefileImports,
    text: [
      'include shared.mk',
      '-include local.mk',
      'sinclude optional.mk',
      '# include ignored.mk',
      'include $(wildcard mk/rules.mk mk/targets.mk)',
      'build/main.o: src/main.c',
      'app: src/main.o src/lib.o | build/.stamp'
    ].join('\n'),
    expected: ['shared.mk', 'local.mk', 'optional.mk', 'mk/rules.mk', 'mk/targets.mk', 'src/main.c', 'src/main.o', 'src/lib.o', 'build/.stamp']
  },
  {
    label: 'makefile-noise-filtering',
    fn: collectMakefileImports,
    text: [
      'include ./rules.mk',
      'publish: //api.github.com/repos/jgm/pandoc/releases',
      'headers: //raw.githubusercontent.com/nemequ/hedley/master/hedley.h',
      'app: ./dep.mk .FORCE .SYMBOLIC .obj /LIBPATH:"$(LUALIB)" //OPT:REF //DYNAMICBASE:NO $(OBJDIR)'
    ].join('\n'),
    expected: [
      './rules.mk',
      './dep.mk',
      'https://api.github.com/repos/jgm/pandoc/releases',
      'https://raw.githubusercontent.com/nemequ/hedley/master/hedley.h'
    ]
  },
  {
    label: 'proto',
    fn: collectProtoImports,
    text: [
      'import \"foo.proto\";',
      'import public \"bar.proto\";',
      'import weak \"baz.proto\";',
      'package poc.services.v1;',
      'option go_package = \"github.com/acme/poc/services/v1\";'
    ].join('\n'),
    expected: ['foo.proto', 'bar.proto', 'baz.proto']
  },
  {
    label: 'proto-inline-block-comment-import',
    fn: collectProtoImports,
    text: '/* c */ import "real.proto";',
    expected: ['real.proto']
  },
  {
    label: 'graphql',
    fn: collectGraphqlImports,
    text: [
      '#import \"common.graphql\"',
      "# import 'shared.graphql'",
      'extend schema @link(url: \"https://specs.apollo.dev/federation/v2.6\", import: [\"@key\"])'
    ].join('\n'),
    expected: ['common.graphql', 'shared.graphql', 'https://specs.apollo.dev/federation/v2.6']
  },
  {
    label: 'graphql-multiline-link',
    fn: collectGraphqlImports,
    text: [
      'extend schema @link(',
      '  url: "https://specs.apollo.dev/federation/v2.7",',
      '  import: ["@key"]',
      ')'
    ].join('\n'),
    expected: ['https://specs.apollo.dev/federation/v2.7']
  },
  {
    label: 'cmake',
    fn: collectCmakeImports,
    text: [
      'include(foo)',
      'add_subdirectory(bar)',
      'find_package(Baz)',
      'target_link_libraries(app PRIVATE core::lib extra_lib)',
      'add_dependencies(app codegen)'
    ].join('\n'),
    expected: ['foo', 'bar', 'Baz', 'core::lib', 'extra_lib', 'codegen']
  },
  {
    label: 'starlark',
    fn: collectStarlarkImports,
    text: [
      'load(\"//path:target\", \"x\")',
      'bazel_dep(name = \"rules_cc\", version = \"0.0.1\")',
      'use_extension(\"//tools:deps.bzl\", \"deps\")',
      'local_path_override(module_name = \"custom\", path = \"../third_party/custom\")'
    ].join('\n'),
    expected: ['//path:target', '@rules_cc', '//tools:deps.bzl', '../third_party/custom']
  },
  {
    label: 'starlark-ignores-inline-comment-noise',
    fn: collectStarlarkImports,
    text: [
      '# bazel_dep(name = "rules_cc")',
      'load("//path:target", "x") # bazel_dep(name = "rules_java")'
    ].join('\n'),
    expected: ['//path:target']
  },
  {
    label: 'starlark-multiline-calls',
    fn: collectStarlarkImports,
    text: [
      'bazel_dep(',
      '  name = "rules_go",',
      '  version = "0.48.0",',
      ')',
      'use_extension(',
      '  "//tools:deps.bzl",',
      '  "deps"',
      ')'
    ].join('\n'),
    expected: ['@rules_go', '//tools:deps.bzl']
  },
  {
    label: 'starlark-ignores-string-noise',
    fn: collectStarlarkImports,
    text: [
      'DOC = """',
      'load("//ignored:target", "x")',
      'bazel_dep(name = "ignored")',
      '"""',
      'load("//real:target", "x")'
    ].join('\n'),
    expected: ['//real:target']
  },
  {
    label: 'nix',
    fn: collectNixImports,
    text: [
      'import ./module.nix',
      'callPackage ../pkg.nix {}',
      'inherit ((import ./git-hooks.nix).pre-commit) hooks;',
      'imports = [ ./hosts/default.nix ../shared/infra.nix ];',
      'inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";',
      'inputs.local.path = ../local-override;'
    ].join('\n'),
    expected: [
      './module.nix',
      '../pkg.nix',
      './git-hooks.nix',
      './hosts/default.nix',
      '../shared/infra.nix',
      'github:NixOS/nixpkgs/nixos-24.11',
      '../local-override'
    ]
  },
  {
    label: 'nix-multiline-imports-array',
    fn: collectNixImports,
    text: [
      'imports = [',
      '  ./hosts/default.nix',
      '  ../shared/infra.nix',
      '];'
    ].join('\n'),
    expected: ['./hosts/default.nix', '../shared/infra.nix']
  },
  {
    label: 'nix-ignores-commented-imports',
    fn: collectNixImports,
    text: [
      '# import ./ignored.nix',
      '# callPackage ../nope.nix {}',
      'import ./real.nix'
    ].join('\n'),
    expected: ['./real.nix']
  },
  {
    label: 'nix-ignores-quoted-doc-noise',
    fn: collectNixImports,
    text: [
      'let',
      "  doc = ''",
      '    import ./ignored-in-doc.nix',
      "    builtins.getFlake \"github:ignored/example\"",
      "  '';",
      'in {',
      '  imports = [ ./real.nix ];',
      '}'
    ].join('\n'),
    expected: ['./real.nix']
  },
  {
    label: 'starlark-budget-cap',
    fn: collectStarlarkImports,
    text: Array.from(
      { length: 700 },
      (_, index) => `bazel_dep(name = "rules_${String(index).padStart(4, '0')}")`
    ).join('\n'),
    expected: Array.from(
      { length: 512 },
      (_, index) => `@rules_${String(index).padStart(4, '0')}`
    )
  },
  {
    label: 'nix-budget-cap',
    fn: collectNixImports,
    text: `imports = [ ${Array.from(
      { length: 1400 },
      (_, index) => `./modules/m${String(index).padStart(4, '0')}.nix`
    ).join(' ')} ];`,
    expected: Array.from(
      { length: 1024 },
      (_, index) => `./modules/m${String(index).padStart(4, '0')}.nix`
    )
  },
  {
    label: 'dart',
    fn: collectDartImports,
    text: [
      "import 'package:foo/bar.dart';",
      "export 'src/public_api.dart';",
      "part 'src/model.g.dart';",
      "part of 'package:foo/app.dart';"
    ].join('\n'),
    expected: ['package:foo/bar.dart', 'src/public_api.dart', 'src/model.g.dart', 'package:foo/app.dart']
  },
  {
    label: 'scala',
    fn: collectScalaImports,
    text: [
      'package com.example.service',
      'import foo.bar.Baz',
      'class Worker extends foo.core.Base with foo.core.Logging'
    ].join('\n'),
    expected: ['foo.bar.Baz', 'foo.core.Base', 'foo.core.Logging']
  },
  {
    label: 'groovy',
    fn: collectGroovyImports,
    text: [
      'package com.example.build',
      'import foo.bar.Baz',
      'class Worker extends foo.core.Base implements foo.api.Task'
    ].join('\n'),
    expected: ['foo.bar.Baz', 'foo.core.Base', 'foo.api.Task']
  },
  {
    label: 'r',
    fn: collectRImports,
    text: [
      '# library(ignored)',
      'library(ggplot2)',
      'require(\"dplyr\")',
      'requireNamespace(\"jsonlite\")',
      'source(\"R/helpers.R\")',
      '# source(\"R/ignored.R\")'
    ].join('\n'),
    expected: ['ggplot2', 'dplyr', 'jsonlite', 'R/helpers.R']
  },
  {
    label: 'julia',
    fn: collectJuliaImports,
    text: [
      'using Foo.Bar, Baz.Quux: run',
      'import LinearAlgebra',
      'include(\"kernels/fft.jl\")',
      '# include(\"ignored.jl\")'
    ].join('\n'),
    expected: ['Foo.Bar', 'Baz.Quux', 'LinearAlgebra', 'kernels/fft.jl']
  },
  {
    label: 'handlebars',
    fn: collectHandlebarsImports,
    text: '{{> partial-name}} {{> "partials/nav"}}',
    expected: ['partial-name', 'partials/nav']
  },
  {
    label: 'handlebars-comment-suppression',
    fn: collectHandlebarsImports,
    text: '{{!-- {{> ignored/partial}} --}}{{> "partials/nav"}}',
    expected: ['partials/nav']
  },
  {
    label: 'mustache',
    fn: collectMustacheImports,
    text: '{{> other}}{{> partials/footer}}',
    expected: ['other', 'partials/footer']
  },
  {
    label: 'mustache-comment-suppression',
    fn: collectMustacheImports,
    text: '{{! {{> ignored}} }}{{> partials/footer}}',
    expected: ['partials/footer']
  },
  {
    label: 'jinja',
    fn: collectJinjaImports,
    text: '{% extends \"base.html\" %}',
    expected: ['base.html']
  },
  {
    label: 'jinja-multiline-include',
    fn: collectJinjaImports,
    text: '{% include\n  \"partials/footer.html\"\n%}',
    expected: ['partials/footer.html']
  },
  {
    label: 'jinja-comment-suppression',
    fn: collectJinjaImports,
    text: '{# {% include "ignored.html" %} #}\n{% include "partials/footer.html" %}',
    expected: ['partials/footer.html']
  },
  {
    label: 'razor',
    fn: collectRazorImports,
    text: '@using System.Text // note',
    expected: ['System.Text']
  },
  {
    label: 'razor-static-using',
    fn: collectRazorImports,
    text: '@using static System.Math',
    expected: ['System.Math']
  },
  {
    label: 'razor-alias-using',
    fn: collectRazorImports,
    text: '@using Json = System.Text.Json;',
    expected: ['System.Text.Json']
  },
  {
    label: 'razor-inline-block-comment-tail',
    fn: collectRazorImports,
    text: '@using System.Text @* trailing note *@',
    expected: ['System.Text']
  },
  {
    label: 'razor-using-expression-not-import',
    fn: collectRazorImports,
    text: '@using (Html.BeginForm()) { }',
    expected: []
  },
  {
    label: 'collector-long-line-budget',
    fn: collectGraphqlImports,
    text: `#import "${'a'.repeat(8193)}.graphql"`,
    expected: []
  }
];

for (const testCase of cases) {
  const actual = testCase.fn(testCase.text);
  expectSet(testCase.label, actual, testCase.expected);
}

console.log('Language registry collectors test passed.');

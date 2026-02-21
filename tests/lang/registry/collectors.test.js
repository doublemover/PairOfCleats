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
      '  <xi:include href="./base.xml" />',
      '  <xsd:import schemaLocation="./types.xsd" />',
      '</root>'
    ].join('\n'),
    expected: [
      'namespace:cfg=urn:cfg',
      'namespace:xsi=http://www.w3.org/2001/XMLSchema-instance',
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
      'files = ./base.ini, ./feature.cfg',
      '[server]',
      'schema = ./schema.ini'
    ].join('\n'),
    expected: ['./base.ini', './feature.cfg', './schema.ini']
  },
  {
    label: 'toml',
    fn: collectTomlImports,
    text: [
      '[dependencies]',
      'serde = "1.0"',
      'localcrate = { path = "../localcrate" }',
      '[tool.poc]',
      'include = ["./base.toml", "./feature.toml"]'
    ].join('\n'),
    expected: ['dependency:serde', 'dependency:localcrate', '../localcrate', './base.toml', './feature.toml']
  },
  {
    label: 'json',
    fn: collectJsonImports,
    text: JSON.stringify({
      schema: 'https://schemas.acme.dev/service.json',
      service: {
        include: ['./base.json', './feature.json'],
        configPath: 'configs/service.json'
      }
    }),
    expected: [
      'keypath:schema',
      'keypath:service',
      'keypath:service.include',
      'keypath:service.configPath',
      'https://schemas.acme.dev/service.json',
      './base.json',
      './feature.json',
      'configs/service.json'
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
      '  - ./base.yaml',
      '  - "./feature.yml"',
      'extends: ./parent.yml'
    ].join('\n'),
    expected: ['anchor:defaults', 'alias:defaults', './base.yaml', './feature.yml', './parent.yml']
  },
  {
    label: 'dockerfile',
    fn: collectDockerfileImports,
    text: [
      'FROM --platform=$BUILDPLATFORM node:18 AS base',
      'FROM base AS build',
      'RUN --mount=type=bind,from=build,target=/src true',
      'COPY --from=base /src /dst'
    ].join('\n'),
    expected: ['node:18', 'base', 'build']
  },
  {
    label: 'makefile',
    fn: collectMakefileImports,
    text: [
      'include shared.mk',
      '-include local.mk',
      'sinclude optional.mk',
      'include $(wildcard mk/rules.mk mk/targets.mk)',
      'app: src/main.o src/lib.o | build/.stamp'
    ].join('\n'),
    expected: ['shared.mk', 'local.mk', 'optional.mk', 'mk/rules.mk', 'mk/targets.mk', 'src/main.o', 'src/lib.o', 'build/.stamp']
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
    expected: ['foo.proto', 'bar.proto', 'baz.proto', 'poc.services.v1', 'github.com/acme/poc/services/v1']
  },
  {
    label: 'graphql',
    fn: collectGraphqlImports,
    text: [
      '#import \"common.graphql\"',
      'extend schema @link(url: \"https://specs.apollo.dev/federation/v2.6\", import: [\"@key\"])'
    ].join('\n'),
    expected: ['common.graphql', 'https://specs.apollo.dev/federation/v2.6']
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
    label: 'nix',
    fn: collectNixImports,
    text: [
      'import ./module.nix',
      'callPackage ../pkg.nix {}',
      'imports = [ ./hosts/default.nix ../shared/infra.nix ];',
      'inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";',
      'inputs.local.path = ../local-override;'
    ].join('\n'),
    expected: [
      './module.nix',
      '../pkg.nix',
      './hosts/default.nix',
      '../shared/infra.nix',
      'github:NixOS/nixpkgs/nixos-24.11',
      '../local-override'
    ]
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
    expected: ['com.example.service', 'foo.bar.Baz', 'foo.core.Base', 'foo.core.Logging']
  },
  {
    label: 'groovy',
    fn: collectGroovyImports,
    text: [
      'package com.example.build',
      'import foo.bar.Baz',
      'class Worker extends foo.core.Base implements foo.api.Task'
    ].join('\n'),
    expected: ['com.example.build', 'foo.bar.Baz', 'foo.core.Base', 'foo.api.Task']
  },
  {
    label: 'r',
    fn: collectRImports,
    text: [
      'library(ggplot2)',
      'require(\"dplyr\")',
      'requireNamespace(\"jsonlite\")',
      'source(\"R/helpers.R\")'
    ].join('\n'),
    expected: ['ggplot2', 'dplyr', 'jsonlite', 'R/helpers.R']
  },
  {
    label: 'julia',
    fn: collectJuliaImports,
    text: [
      'using Foo.Bar',
      'import LinearAlgebra',
      'include(\"kernels/fft.jl\")'
    ].join('\n'),
    expected: ['Foo.Bar', 'LinearAlgebra', 'kernels/fft.jl']
  },
  {
    label: 'handlebars',
    fn: collectHandlebarsImports,
    text: '{{> partial-name}}',
    expected: ['partial-name']
  },
  {
    label: 'mustache',
    fn: collectMustacheImports,
    text: '{{> other}}',
    expected: ['other']
  },
  {
    label: 'jinja',
    fn: collectJinjaImports,
    text: '{% extends \"base.html\" %}',
    expected: ['base.html']
  },
  {
    label: 'razor',
    fn: collectRazorImports,
    text: '@using System.Text',
    expected: ['System.Text']
  }
];

for (const testCase of cases) {
  const actual = testCase.fn(testCase.text);
  expectSet(testCase.label, actual, testCase.expected);
}

console.log('Language registry collectors test passed.');

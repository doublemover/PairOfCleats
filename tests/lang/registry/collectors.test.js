#!/usr/bin/env node
import { collectCmakeImports } from '../../../src/index/language-registry/import-collectors/cmake.js';
import { collectDartImports } from '../../../src/index/language-registry/import-collectors/dart.js';
import { collectDockerfileImports } from '../../../src/index/language-registry/import-collectors/dockerfile.js';
import { collectGraphqlImports } from '../../../src/index/language-registry/import-collectors/graphql.js';
import { collectGroovyImports } from '../../../src/index/language-registry/import-collectors/groovy.js';
import { collectHandlebarsImports } from '../../../src/index/language-registry/import-collectors/handlebars.js';
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
    label: 'dockerfile',
    fn: collectDockerfileImports,
    text: 'FROM node:18 AS base\nCOPY --from=base /src /dst',
    expected: ['node:18', 'base']
  },
  {
    label: 'makefile',
    fn: collectMakefileImports,
    text: 'include shared.mk\n-include local.mk',
    expected: ['shared.mk', 'local.mk']
  },
  {
    label: 'proto',
    fn: collectProtoImports,
    text: 'import \"foo.proto\";\nimport public \"bar.proto\";',
    expected: ['foo.proto', 'bar.proto']
  },
  {
    label: 'graphql',
    fn: collectGraphqlImports,
    text: '#import \"common.graphql\"',
    expected: ['common.graphql']
  },
  {
    label: 'cmake',
    fn: collectCmakeImports,
    text: 'include(foo)\nadd_subdirectory(bar)\nfind_package(Baz)',
    expected: ['foo', 'bar', 'Baz']
  },
  {
    label: 'starlark',
    fn: collectStarlarkImports,
    text: 'load(\"//path:target\", \"x\")',
    expected: ['//path:target']
  },
  {
    label: 'nix',
    fn: collectNixImports,
    text: 'import ./module.nix\ncallPackage ../pkg.nix {}',
    expected: ['./module.nix', '../pkg.nix']
  },
  {
    label: 'dart',
    fn: collectDartImports,
    text: "import 'package:foo/bar.dart';",
    expected: ['package:foo/bar.dart']
  },
  {
    label: 'scala',
    fn: collectScalaImports,
    text: 'import foo.bar.Baz',
    expected: ['foo.bar.Baz']
  },
  {
    label: 'groovy',
    fn: collectGroovyImports,
    text: 'import foo.bar.Baz',
    expected: ['foo.bar.Baz']
  },
  {
    label: 'r',
    fn: collectRImports,
    text: 'library(ggplot2)\nrequire(\"dplyr\")',
    expected: ['ggplot2', 'dplyr']
  },
  {
    label: 'julia',
    fn: collectJuliaImports,
    text: 'using Foo.Bar',
    expected: ['Foo.Bar']
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

#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  collectLanguageImportEntries,
  collectLanguageImports,
  getLanguageForFile
} from '../../../src/index/language-registry.js';
import { collectNixImports } from '../../../src/index/language-registry/import-collectors/nix.js';
import { collectProtoImports } from '../../../src/index/language-registry/import-collectors/proto.js';
import { collectStarlarkImports } from '../../../src/index/language-registry/import-collectors/starlark.js';
import { collectGraphqlImports } from '../../../src/index/language-registry/import-collectors/graphql.js';
import { collectJinjaImports } from '../../../src/index/language-registry/import-collectors/jinja.js';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';
import {
  createCommentAwareLineStripper,
  stripInlineCommentAware
} from '../../../src/index/language-registry/import-collectors/comment-aware.js';
import { addCollectorImport } from '../../../src/index/language-registry/import-collectors/utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const sortUnique = (values) => Array.from(new Set(values || [])).sort();
const expectEquivalent = (label, collector, textA, textB) => {
  const a = sortUnique(collector(textA));
  const b = sortUnique(collector(textB));
  assert.deepEqual(b, a, `${label}: comment/doc placement should not alter detected imports`);
};

const cases = [
  {
    name: 'comment-aware stripping preserves literals while removing comments',
    run() {
      const hashStripper = createCommentAwareLineStripper({
        markers: ['#'],
        requireWhitespaceBefore: true
      });
      assert.equal(hashStripper('include = "value#fragment" # trailing comment'), 'include = "value#fragment"');
      assert.equal(hashStripper('include = value#fragment'), 'include = value#fragment');

      const slashStripper = createCommentAwareLineStripper({
        markers: ['//'],
        requireWhitespaceBefore: true
      });
      assert.equal(slashStripper('@using System.Text // trailing'), '@using System.Text');
      assert.equal(slashStripper('url = "https://example.com/path"'), 'url = "https://example.com/path"');

      const blockStripper = createCommentAwareLineStripper({
        markers: ['//'],
        blockCommentPairs: [['/*', '*/']],
        requireWhitespaceBefore: true
      });
      assert.equal(blockStripper('/* start comment'), '');
      assert.equal(blockStripper('still comment */ import "real.proto";'), ' import "real.proto";');
      assert.equal(blockStripper('import "next.proto"; // trailing'), 'import "next.proto";');

      assert.equal(
        stripInlineCommentAware('name = "pkg#name" # trailing', { markers: ['#'], requireWhitespaceBefore: true }),
        'name = "pkg#name"'
      );

      const imports = new Set();
      assert.equal(addCollectorImport(imports, 'anchor:token'), false);
      assert.equal(addCollectorImport(imports, '  ./real/path  '), true);
      assert.deepEqual(Array.from(imports), ['./real/path']);
    }
  },
  {
    name: 'comment placement metamorphism holds across nix starlark and proto collectors',
    run() {
      expectEquivalent(
        'nix',
        collectNixImports,
        [
          'import ./module.nix',
          'callPackage ../pkg/default.nix {}',
          'inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";'
        ].join('\n'),
        [
          '# import ./ignored.nix',
          'import ./module.nix # trailing comment',
          '# callPackage ../ignored/default.nix {}',
          'callPackage ../pkg/default.nix {} # keep',
          '',
          'inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11"; # pinned'
        ].join('\n')
      );

      expectEquivalent(
        'starlark',
        collectStarlarkImports,
        [
          'load("//tools:deps.bzl", "deps")',
          'bazel_dep(name = "rules_cc", version = "0.0.1")'
        ].join('\n'),
        [
          '# load("//ignored:deps.bzl", "deps")',
          'load("//tools:deps.bzl", "deps") # keep',
          '# bazel_dep(name = "rules_java", version = "0.1.0")',
          'bazel_dep(name = "rules_cc", version = "0.0.1")'
        ].join('\n')
      );

      expectEquivalent(
        'proto',
        collectProtoImports,
        [
          'import "foo.proto";',
          'import public "bar.proto";'
        ].join('\n'),
        [
          '// import "ignored.proto";',
          'import "foo.proto"; // trailing note',
          '/* block */ import public "bar.proto";'
        ].join('\n')
      );
    }
  },
  {
    name: 'registry selection resolves representative language/file pairs',
    run() {
      const expectId = (ext, relPath, expected) => {
        const lang = getLanguageForFile(ext, relPath);
        const actual = lang ? lang.id : null;
        assert.equal(actual, expected, `Language mismatch for ${relPath || ext}`);
      };

      expectId('.js', 'src/app.js', 'javascript');
      expectId('.mjs', 'src/app.mjs', 'javascript');
      expectId('.tsx', 'src/App.tsx', 'typescript');
      expectId('.py', 'src/app.py', 'python');
      expectId('.rs', 'src/lib.rs', 'rust');
      expectId('.go', 'src/main.go', 'go');
      expectId('.jsonc', 'config/deno.jsonc', 'json');
      expectId('', 'python/Pipfile', 'toml');
      expectId('.csproj', 'src/app/app.csproj', 'xml');
      expectId('', 'go.mod', 'go');
      expectId('', 'proto/buf.yaml', 'proto');
      expectId('.hbs', 'templates/view.hbs', 'handlebars');
      expectId('.dockerfile', 'Dockerfile.dockerfile', 'dockerfile');
    }
  },
  {
    name: 'import entries preserve specifiers and collector hints',
    run() {
      const starlarkText = [
        'load("//tools:deps.bzl", "deps")',
        'bazel_dep(name = "rules_cc", version = "0.0.1")',
        'local_path_override(module_name = "custom", path = "../third_party/custom")'
      ].join('\n');
      const starlarkEntries = collectLanguageImportEntries({
        ext: '.bzl',
        relPath: 'WORKSPACE.bzl',
        text: starlarkText,
        mode: 'code',
        options: {}
      });
      assert.deepEqual(
        starlarkEntries.map((entry) => entry.specifier),
        collectLanguageImports({
          ext: '.bzl',
          relPath: 'WORKSPACE.bzl',
          text: starlarkText,
          mode: 'code',
          options: {}
        })
      );
      assert.equal(
        starlarkEntries.find((entry) => entry.specifier === '//tools:deps.bzl')?.collectorHint?.reasonCode,
        'IMP_U_RESOLVER_GAP'
      );
      assert.equal(
        starlarkEntries.find((entry) => entry.specifier === '../third_party/custom')?.collectorHint || null,
        null
      );

      const pythonEntries = collectLanguageImportEntries({
        ext: '.py',
        relPath: 'app/main.py',
        text: [
          '"""',
          'from docs.fake import Demo',
          'import docs_only',
          '"""',
          'from pkg.runtime import loader as load',
          'import os',
          'config = """import hidden_runtime"""'
        ].join('\n'),
        mode: 'code',
        options: {}
      });
      assert.deepEqual(
        pythonEntries.map((entry) => entry.specifier),
        ['os', 'pkg.runtime']
      );
    }
  },
  {
    name: 'collector budget diagnostics are emitted for direct and heuristic collectors',
    run() {
      const graphqlDiagnostics = [];
      const graphqlSource = Array.from({ length: 16 }, (_, index) => `#import "mod${index}.graphql"`).join('\n');
      const graphqlImports = collectGraphqlImports(graphqlSource, {
        collectorDiagnostics: graphqlDiagnostics,
        collectorScanBudgets: {
          graphql: {
            maxChars: 16384,
            maxMatches: 64,
            maxTokens: 3,
            maxMs: 200
          }
        }
      });
      assert.equal(graphqlImports.length, 3);
      const graphqlBudgetDiagnostic = graphqlDiagnostics.find((entry) => entry?.collectorId === 'graphql');
      assert.ok(graphqlBudgetDiagnostic);
      assert.ok(Array.isArray(graphqlBudgetDiagnostic.reasons) && graphqlBudgetDiagnostic.reasons.includes('scan_tokens'));

      const diagnostics = [];
      collectLanguageImportEntries({
        ext: '.bzl',
        relPath: 'tools/deps.bzl',
        text: [
          'load("//tools:deps.bzl", "deps")',
          'bazel_dep(name = "rules_proto")',
          'bazel_dep(name = "rules_cc")'
        ].join('\n'),
        mode: 'code',
        options: {
          collectorDiagnostics: diagnostics,
          collectorScanBudgets: {
            starlark: {
              maxMatches: 1,
              maxTokens: 1
            }
          }
        }
      });
      collectLanguageImportEntries({
        ext: '.nix',
        relPath: 'flake.nix',
        text: `imports = [ ${Array.from({ length: 8 }, (_, idx) => `./m${idx}.nix`).join(' ')} ];`,
        mode: 'code',
        options: {
          collectorDiagnostics: diagnostics,
          collectorScanBudgets: {
            nix: { maxTokens: 2 }
          }
        }
      });
      assert.ok(diagnostics.find((entry) => entry?.type === 'collector-scan-budget' && entry?.collectorId === 'starlark'));
      assert.ok(diagnostics.find((entry) => entry?.type === 'collector-scan-budget' && entry?.collectorId === 'nix'));

      const heuristicDiagnostics = [];
      const makefileEntry = LANGUAGE_REGISTRY.find((entry) => entry.id === 'makefile');
      assert.ok(makefileEntry);
      makefileEntry.buildRelations({
        text: Array.from({ length: 48 }, (_, index) => `target${index}: dep${index} dep${index + 1}`).join('\n'),
        relPath: 'Makefile',
        options: {
          collectorDiagnostics: heuristicDiagnostics,
          collectorScanBudgets: {
            'heuristic-adapter': {
              maxChars: 65536,
              maxLines: 128,
              maxMatches: 1,
              maxTokens: 64,
              maxMs: 200
            }
          }
        }
      });
      const heuristicNamespaceBudgetDiagnostic = heuristicDiagnostics.find(
        (entry) => entry?.collectorId === 'heuristic-adapter:makefile'
      );
      assert.ok(heuristicNamespaceBudgetDiagnostic);
      assert.ok(
        Array.isArray(heuristicNamespaceBudgetDiagnostic.reasons)
          && heuristicNamespaceBudgetDiagnostic.reasons.includes('scan_matches')
      );

      const jinjaDiagnostics = [];
      collectJinjaImports(Array.from({ length: 24 }, () => '{% include "partials/item.html" %}').join('\n'), {
        collectorDiagnostics: jinjaDiagnostics,
        collectorScanBudgets: {
          jinja: {
            maxChars: 40,
            maxMatches: 32,
            maxTokens: 32,
            maxMs: 200
          }
        }
      });
      const jinjaBudgetDiagnostic = jinjaDiagnostics.find((entry) => entry?.collectorId === 'jinja');
      assert.ok(jinjaBudgetDiagnostic);
      assert.ok(Array.isArray(jinjaBudgetDiagnostic.reasons) && jinjaBudgetDiagnostic.reasons.includes('source_bytes'));
    }
  }
];

for (const entry of cases) {
  entry.run();
}

console.log('language registry contract matrix test passed');

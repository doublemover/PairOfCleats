import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { qualifiedTargetSources } from './qualified-target-source-fixture.js';

const language = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/api-contracts/qualified-target-ambient-scope/')[1];
assert.ok(['js', 'ts'].includes(language));
const { dir } = await prepareIsolatedTestCacheDir(`qualified-target-ambient-${language}`);
try {
  for (const operation of ['clean', 'violation']) {
    const sources = qualifiedTargetSources(language, operation);
    const type = language === 'ts' ? ': number' : '';
    assert.equal(sources[`a.${language}`], `export function foo(a${type}) { return a; }\nexport function useA() { return foo(1); }\n`);
    assert.equal(sources[`b.${language}`], `export function foo(a${type}, b${type}) { return a+b; }\n${operation === 'violation' ? 'export function useB() { return foo(1); }' : ''}\n`);
    const root = path.join(dir, operation); await fs.mkdir(root);
    for (const [file, text] of Object.entries(sources)) await fs.writeFile(path.join(root, file), text);
    const modern = path.join(root, `modern.${language}`);
    await fs.writeFile(modern, 'export const modern = Promise.resolve(1);\n');
    const outcomes = new Map();
    for (const lib of ['es5', 'es2022']) {
      const program = ts.createProgram([...Object.keys(sources).map(file => path.join(root, file)), modern], {
        allowJs: true, checkJs: true, noEmit: true, types: [], lib: [`lib.${lib}.d.ts`]
      });
      const checker = program.getTypeChecker(), calls = [], declarations = [];
      for (const [file, text] of Object.entries(sources)) {
        const source = program.getSourceFile(path.join(root, file)); assert.equal(source.text, text);
        const visit = node => {
          if (ts.isFunctionDeclaration(node) && node.name?.text === 'foo') {
            declarations.push({ file, start: node.getStart(source), end: node.end,
              parameters: node.parameters.map(parameter => parameter.name.getText(source)) });
          }
          if (ts.isCallExpression(node)) {
            assert.ok(ts.isIdentifier(node.expression) && node.expression.text === 'foo', 'every original invocation is a direct local source call');
            const symbol = checker.getSymbolAtLocation(node.expression), signature = checker.getResolvedSignature(node);
            const declaration = signature?.declaration;
            assert.ok(symbol && declaration && ts.isFunctionDeclaration(declaration));
            assert.equal(declaration.name.text, 'foo');
            assert.equal(declaration.getSourceFile(), source, 'no default-library or external declaration participates in a target join');
            assert.ok(symbol.declarations.includes(declaration));
            calls.push({ file, start: node.getStart(source), argumentCount: node.arguments.length,
              declarationStart: declaration.getStart(source), declarationEnd: declaration.end,
              parameterCount: declaration.parameters.length,
              signature: checker.signatureToString(signature, node, ts.TypeFormatFlags.NoTruncation) });
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
      assert.deepEqual(declarations.map(row => [row.file, row.parameters.length]), [[`a.${language}`, 1], [`b.${language}`, 2]]);
      assert.equal(calls.length, operation === 'violation' ? 2 : 1);
      assert.ok(calls.every(row => row.argumentCount === 1));
      const modernDiagnostics = program.getSemanticDiagnostics(program.getSourceFile(modern));
      if (lib === 'es5') assert.ok(modernDiagnostics.some(row => [2304, 2585].includes(row.code)), 'the negative exposes real missing modern ambient authority');
      else assert.deepEqual(modernDiagnostics, [], 'ES2022 genuinely supplies Promise instead of a noLib shortcut');
      assert.ok(program.getSourceFiles().some(source => /lib\.es5\.d\.ts$/i.test(source.fileName)), 'both programs load an actual standard library');
      outcomes.set(lib, { declarations, calls });
      console.log(JSON.stringify({ language, operation, lib, compilerVersion: ts.version,
        sourceHashes: Object.fromEntries(Object.entries(sources).map(([file, text]) => [file, crypto.createHash('sha256').update(text).digest('hex')])),
        defaultLibraryFiles: program.getSourceFiles().filter(source => program.isSourceFileDefaultLibrary(source)).map(source => path.basename(source.fileName)),
        localMapping: outcomes.get(lib), modernDiagnosticCodes: modernDiagnostics.map(row => row.code) }));
    }
    assert.deepEqual(outcomes.get('es5'), outcomes.get('es2022'), 'all original local target/signature/argument oracles are independent of newer ambient declarations');
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }

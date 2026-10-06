#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { Bookmark, Document, ImageRun, ImportedXmlComponent, Packer, Paragraph, TextRun } from 'docx';
import { extractDocx, loadDocxExtractorRuntime } from '../../../src/index/extractors/docx.js';
import { applyPatches } from '../../../tools/setup/apply-patches.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Use real documents and the installed vendor CLI: an available fallback
// extractor or a parser mock would conceal a broken dependency migration.
const env = applyTestEnv({
  extraEnv: {
    NODE_OPTIONS: '--max-old-space-size=512',
    NODE_NO_WARNINGS: null,
    FORCE_COLOR: null,
    NO_COLOR: '1'
  }
});
const require = createRequire(import.meta.url);
const mammothRoot = path.dirname(require.resolve('mammoth/package.json'));
const mammothCli = path.join(mammothRoot, 'bin', 'mammoth');
const runtime = await loadDocxExtractorRuntime({ refresh: true });
assert.equal(runtime?.backend, 'mammoth', 'the real Mammoth backend must be available');
assert.equal(runtime.version, '1.13.0', 'exercise the reviewed Mammoth release');

const root = await makeTempDir('poc mammoth migration ');
const paragraphs = ['Mammoth migration first paragraph', 'Second paragraph survives'];
const expectedHtml = paragraphs.map((text) => `<p>${text}</p>`).join('');
const expectedMarkdown = paragraphs.map((text) => `${text}\n\n`).join('');
const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAAXNSR0IArs4c6QAAAAlwSFlzAAAOvgAADr4B6kKxwAAAABNJREFUKFNj/M+ADzDhlWUYqdIAQSwBE8U+X40AAAAASUVORK5CYII=',
  'base64'
);

const runCli = (args, label) => {
  // Every invocation rejects accidental use of argparse's legacy shims.
  const result = runNode(['--throw-deprecation', mammothCli, ...args], label, root, env, {
    allowFailure: true,
    stdio: 'pipe',
    timeoutMs: 5000
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${label}: CLI must exit normally`);
  return result;
};

const expectSuccess = (args, output, label) => {
  const result = runCli(args, label);
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  assert.equal(result.stderr, '', `${label}: no warnings or deprecations`);
  assert.equal(result.stdout, output, `${label}: expected converted output`);
};

const expectFailure = (args, message, label) => {
  const result = runCli(args, label);
  assert.equal(result.status, 2, `${label}: ${result.stderr}`);
  assert.equal(result.stdout, '', `${label}: failures must not emit document content`);
  assert.match(result.stderr, message, `${label}: expected actionable error`);
  assert.doesNotMatch(result.stderr, /DeprecationWarning|is not a function|is not callable/);
};

try {
  const documentBytes = await Packer.toBuffer(new Document({
    sections: [{ children: paragraphs.map((text) => new Paragraph(text)) }]
  }));
  const documentPath = path.join(root, 'two paragraphs.docx');
  await fs.writeFile(documentPath, documentBytes);

  const extracted = await extractDocx({ buffer: documentBytes });
  assert.equal(extracted.ok, true, JSON.stringify(extracted));
  assert.equal(extracted.extractor?.name, 'mammoth');
  assert.equal(extracted.extractor?.version, '1.13.0');
  assert.deepEqual(extracted.paragraphs, paragraphs.map((text, index) => ({ index: index + 1, text })));
  assert.deepEqual(extracted.warnings, []);

  // Mammoth 1.13's body reader now traverses custom XML and move destinations,
  // while ignoring move origins to avoid duplicate text from tracked revisions.
  const wrapXml = (name, children, attributes = {}) => {
    const component = new ImportedXmlComponent(name, attributes);
    for (const child of children) component.push(child);
    return component;
  };
  const revisionAttributes = { 'w:author': 'Fixture', 'w:date': '2026-01-01T00:00:00Z' };
  const revisionBytes = await Packer.toBuffer(new Document({
    sections: [{ children: [
      wrapXml('w:customXml', [new Paragraph('Custom XML paragraph survives')], {
        'w:element': 'fixture', 'w:uri': 'urn:pairofcleats:mammoth-test'
      }),
      wrapXml('w:moveFrom', [new Paragraph('Old paragraph must be excluded')], {
        ...revisionAttributes, 'w:id': '1'
      }),
      wrapXml('w:moveTo', [new Paragraph('Moved paragraph survives')], {
        ...revisionAttributes, 'w:id': '1'
      }),
      new Paragraph({ children: [
        new TextRun('Before '),
        wrapXml('w:moveFrom', [new TextRun('old run must be excluded')], {
          ...revisionAttributes, 'w:id': '2'
        }),
        wrapXml('w:moveTo', [new TextRun('moved run')], {
          ...revisionAttributes, 'w:id': '2'
        }),
        new TextRun(' after')
      ] })
    ] }]
  }));
  assert.ok(revisionBytes.length < 64 * 1024, 'tracked revision fixture stays small');
  const revised = await extractDocx({ buffer: revisionBytes });
  assert.equal(revised.ok, true, JSON.stringify(revised));
  assert.equal(revised.extractor?.name, 'mammoth');
  assert.deepEqual(revised.paragraphs, [
    { index: 1, text: 'Custom XML paragraph survives' },
    { index: 2, text: 'Moved paragraph survives' },
    { index: 3, text: 'Before moved run after' }
  ]);
  assert.deepEqual(revised.warnings, []);

  expectSuccess([documentPath], expectedHtml, 'HTML to stdout with spaces in input path');
  const outputPath = path.join(root, 'converted document.html');
  expectSuccess([documentPath, outputPath], '', 'HTML to positional output path');
  assert.equal(await fs.readFile(outputPath, 'utf8'), expectedHtml);
  expectSuccess([documentPath, '--output-format=markdown'], expectedMarkdown, 'Markdown with equals syntax');
  expectSuccess(['--output-format', 'markdown', documentPath], expectedMarkdown, 'Markdown before input path');

  // The 1.13 Markdown writer delegates bookmark attributes to its HTML writer;
  // document-controlled quotes and markup must remain inside the anchor ID.
  const bookmarkPath = path.join(root, 'escaped bookmark.docx');
  await fs.writeFile(bookmarkPath, await Packer.toBuffer(new Document({
    sections: [{ children: [new Paragraph({ children: [new Bookmark({
      id: 'bookmark" <tag> & marker',
      children: [new TextRun('Bookmark label')]
    })] })] }]
  })));
  expectSuccess(
    [bookmarkPath, '--output-format=markdown'],
    '<a id="bookmark&quot; &lt;tag&gt; &amp; marker"></a>Bookmark label\n\n',
    'Markdown escapes bookmark HTML attributes'
  );

  const styleMapPath = path.join(root, 'custom style map.txt');
  await fs.writeFile(styleMapPath, 'p => span:fresh', 'utf8');
  expectSuccess(
    [documentPath, '--style-map', styleMapPath],
    paragraphs.map((text) => `<span>${text}</span>`).join(''),
    'custom style map'
  );

  const dashedFilename = '--looks-like-an-option.docx';
  await fs.writeFile(path.join(root, dashedFilename), documentBytes);
  expectSuccess(['--', dashedFilename], expectedHtml, 'end-of-options permits a dashed filename');

  const imageDocumentPath = path.join(root, 'embedded image.docx');
  await fs.writeFile(imageDocumentPath, await Packer.toBuffer(new Document({
    sections: [{ children: [new Paragraph({ children: [new ImageRun({
      type: 'png',
      data: imageBytes,
      transformation: { width: 10, height: 10 }
    })] })] }]
  })));
  expectSuccess(
    [imageDocumentPath],
    `<p><img src="data:image/png;base64,${imageBytes.toString('base64')}" /></p>`,
    'image remains inline without output directory'
  );
  const outputDir = path.join(root, 'image output');
  await fs.mkdir(outputDir);
  expectSuccess([imageDocumentPath, '--output-dir', outputDir], '', 'separate image output');
  assert.deepEqual((await fs.readdir(outputDir)).sort(), ['1.png', 'embedded image.html']);
  assert.equal(await fs.readFile(path.join(outputDir, 'embedded image.html'), 'utf8'), '<p><img src="1.png" /></p>');
  assert.deepEqual(await fs.readFile(path.join(outputDir, '1.png')), imageBytes);

  const help = runCli(['--help'], 'CLI help');
  assert.equal(help.status, 0, help.stderr);
  assert.equal(help.stderr, '');
  for (const option of ['docx-path', 'output-path', '--output-dir', '--output-format', '--style-map']) {
    assert.ok(help.stdout.includes(option), `help documents ${option}`);
  }
  expectFailure([], /required.*docx-path/, 'missing input argument');
  expectFailure([documentPath, '--unknown'], /unrecognized arguments.*--unknown/, 'unknown option');
  expectFailure([documentPath, '--output-format', 'pdf'], /invalid choice.*pdf/, 'invalid output format');
  expectFailure([documentPath, outputPath, 'extra'], /unrecognized arguments.*extra/, 'extra positional argument');
  const conflictOutput = path.join(root, 'conflict must not be written.html');
  expectFailure(
    [documentPath, conflictOutput, '--output-dir', outputDir],
    /not allowed with argument/,
    'positional output conflicts with output directory'
  );
  expectFailure(
    ['--output-dir', outputDir, documentPath, conflictOutput],
    /not allowed with argument/,
    'output directory conflicts with later positional output'
  );
  await assert.rejects(fs.access(conflictOutput), { code: 'ENOENT' });
  assert.deepEqual((await fs.readdir(outputDir)).sort(), ['1.png', 'embedded image.html']);
  expectFailure([path.join(root, 'missing.docx')], /Fatal Error: ENOENT/, 'missing file reports native promise failure');

  // Exercise the checked-in patch against only a disposable copy of the
  // installed CLI, package identity, and its license, never node_modules itself.
  const installedSource = await fs.readFile(mammothCli, 'utf8');
  const fixtureSource = installedSource.replace(/\r\n/g, '\n');
  const license = await fs.readFile(path.join(mammothRoot, 'LICENSE'), 'utf8');
  assert.ok(Buffer.byteLength(fixtureSource) < 16 * 1024, 'CLI fixture must remain bounded');
  assert.ok(Buffer.byteLength(license) < 16 * 1024, 'license fixture must remain bounded');
  const patchFixture = path.join(root, 'patch installation');
  const fixturePackage = path.join(patchFixture, 'node_modules', 'mammoth');
  const fixtureCli = path.join(fixturePackage, 'bin', 'mammoth');
  const fixtureManifest = path.join(fixturePackage, 'package.json');
  const fixturePatch = path.join(patchFixture, 'patches', 'mammoth+1.13.0.patch');
  await fs.mkdir(path.dirname(fixtureCli), { recursive: true });
  await fs.mkdir(path.dirname(fixturePatch), { recursive: true });
  await fs.writeFile(fixtureCli, fixtureSource, { mode: 0o755 });
  await fs.writeFile(path.join(fixturePackage, 'LICENSE'), license);
  await fs.writeFile(fixtureManifest, JSON.stringify({ name: 'mammoth', version: '1.13.0' }));
  await fs.copyFile(new URL('../../../patches/mammoth+1.13.0.patch', import.meta.url), fixturePatch);

  // Undo the installed patch in the disposable fixture to obtain upstream
  // bytes without fetching a package or keeping a second vendor source copy.
  const gitEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !/^GIT_/i.test(key)));
  const emptyGitConfig = path.join(patchFixture, 'empty.gitconfig');
  await fs.writeFile(emptyGitConfig, '');
  Object.assign(gitEnv, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyGitConfig,
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: root
  });
  const reverse = spawnSync('git', [
    '-c', 'core.autocrlf=false', 'apply', '--reverse', '--whitespace=nowarn', fixturePatch
  ], {
    cwd: patchFixture,
    env: gitEnv,
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
    maxBuffer: 64 * 1024
  });
  assert.ifError(reverse.error);
  assert.equal(reverse.status, 0, `installed CLI must contain the complete reviewed patch: ${reverse.stderr}`);
  const pristineSource = await fs.readFile(fixtureCli, 'utf8');
  assert.match(pristineSource, /parser\.addArgument/);
  assert.equal(applyPatches(patchFixture), 1, 'the actual patch applies to pristine vendor source');
  assert.equal(await fs.readFile(fixtureCli, 'utf8'), fixtureSource);
  assert.equal(applyPatches(patchFixture), 1, 'repeat patch application is accepted');
  assert.equal(await fs.readFile(fixtureCli, 'utf8'), fixtureSource);

  await fs.writeFile(fixtureCli, pristineSource);
  await fs.writeFile(fixtureManifest, JSON.stringify({ name: 'mammoth', version: '1.13.1' }));
  assert.throws(() => applyPatches(patchFixture), /requires exactly mammoth@1\.13\.0/);
  assert.equal(await fs.readFile(fixtureCli, 'utf8'), pristineSource, 'version mismatch leaves source intact');

  await fs.writeFile(fixtureManifest, JSON.stringify({ name: 'mammoth', version: '1.13.0' }));
  const partialSource = pristineSource.replace('addHelp: true', 'add_help: true');
  assert.notEqual(partialSource, pristineSource);
  await fs.writeFile(fixtureCli, partialSource);
  assert.throws(() => applyPatches(patchFixture), /not fully applied/);
  assert.equal(await fs.readFile(fixtureCli, 'utf8'), partialSource, 'a partial patch fails without changing source');
  assert.equal(await fs.readFile(mammothCli, 'utf8'), installedSource, 'fixture checks never modify installed Mammoth');

  console.log('Mammoth security migration preserves real DOCX extraction and CLI conversion, images, and argument errors.');
} finally {
  await rmDirRecursive(root);
}

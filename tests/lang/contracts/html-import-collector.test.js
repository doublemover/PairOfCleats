#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { collectHtmlImports, getHtmlMetadata } from '../../../src/lang/html.js';

applyTestEnv();

const html = [
  '<!doctype html>',
  '<html>',
  '<head>',
  '<SCRIPT SRC="/assets/app.js"></SCRIPT>',
  '<link rel="stylesheet" href="/assets/site.css">',
  '<img src="/assets/logo.png">',
  '<!-- <script src="/assets/ignored.js"></script> -->',
  '<!--',
  '<link href="/assets/also-ignored.css">',
  '-->',
  '<script type="module" src="/assets/module.js"></script>',
  '<script>const tpl = "<script src=\\"/assets/fake.js\\"><link href=\\"/assets/fake.css\\">";</script>',
  '<script src=/assets/noquote.js defer></script>',
  '</head>',
  '</html>'
].join('\n');

const fastImports = collectHtmlImports(html).slice().sort();
const metadataImports = getHtmlMetadata(html).imports.slice().sort();

assert.deepEqual(
  fastImports,
  metadataImports,
  'fast HTML import collector must remain compatible with metadata import extraction'
);
assert.ok(fastImports.includes('/assets/app.js'));
assert.ok(fastImports.includes('/assets/site.css'));
assert.ok(fastImports.includes('/assets/module.js'));
assert.ok(fastImports.includes('/assets/noquote.js'));
assert.ok(!fastImports.includes('/assets/logo.png'));
assert.ok(!fastImports.includes('/assets/fake.js'));
assert.ok(!fastImports.includes('/assets/fake.css'));
assert.ok(!fastImports.includes('/assets/ignored.js'));
assert.ok(!fastImports.includes('/assets/also-ignored.css'));

console.log('html import collector contract test passed');

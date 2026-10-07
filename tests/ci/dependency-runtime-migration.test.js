#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { copy, createCopier, MaxDepthExceededError } from 'fast-copy';
import pretty from 'pino-pretty';
import { SourceMapConsumer, SourceMapGenerator } from 'source-map-js';
import postcss from 'postcss';
import { compileStyle } from '@vue/compiler-sfc';

// Exercise the actual pino-pretty transitive copy API and its new bounded depth.
const log = { level: 50, time: 0, msg: 'migration marker', err: { type: 'Error', message: 'fixture failure', stack: 'fixture stack' }, detail: { count: 2 } };
const rendered = pretty.prettyFactory({ colorize: false, translateTime: false })(log);
assert.match(rendered, /migration marker/);
assert.match(rendered, /fixture failure/);
assert.match(rendered, /"count": 2/);
assert.equal(log.detail.count, 2);
const buffer = Buffer.from([1, 2, 3]);
const cloned = copy(buffer);
cloned[0] = 9;
assert.equal(buffer[0], 1, 'copied Buffer must own its bytes');
const view = new DataView(Uint8Array.from([1, 2, 3, 4]).buffer, 1, 2);
const copiedView = copy(view);
assert.equal(copiedView.byteOffset, 1);
assert.equal(copiedView.byteLength, 2);
assert.equal(copiedView.getUint8(0), 2);
copiedView.setUint8(0, 8);
assert.equal(view.getUint8(0), 2);
let deep = {};
for (let depth = 0; depth < 1010; depth++) deep = { child: deep };
assert.throws(() => copy(deep), MaxDepthExceededError);
assert.throws(() => createCopier({ maxDepth: 2 })({ child: { child: {} } }), MaxDepthExceededError);

// Normal source maps and downstream CSS compilation must survive the security cap.
const generator = new SourceMapGenerator({ file: 'output.css' });
generator.addMapping({ generated: { line: 1, column: 0 }, original: { line: 3, column: 2 }, source: 'input.css' });
const consumer = new SourceMapConsumer(generator.toJSON());
assert.deepEqual(consumer.originalPositionFor({ line: 1, column: 0 }), { source: 'input.css', line: 3, column: 2, name: null });
assert.deepEqual(SourceMapGenerator.fromSourceMap(consumer).toJSON().sources, ['input.css']);
assert.throws(() => new SourceMapConsumer({ version: 3, sections: [{ offset: { line: 10000001, column: 0 }, map: generator.toJSON() }] }), /offset|line|maximum|limit/i);
const processed = await postcss([]).process('.fixture { color: red }', { from: 'input.css', to: 'output.css', map: { inline: false } });
assert.match(processed.css, /color: red/);
assert.ok(processed.map.toJSON().sources.some((source) => source.endsWith('input.css')));
const style = compileStyle({ source: '.fixture { color: red }', filename: 'Component.vue', id: 'data-v-fixture', scoped: true });
assert.deepEqual(style.errors, []);
assert.match(style.code, /\.fixture\[data-v-fixture\]/);

// Resolve through the optional SDK's actual Express chain, not a copied implementation.
const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('@modelcontextprotocol/sdk/server/index.js'));
const expressRequire = createRequire(sdkRequire.resolve('express'));
const proxyaddr = expressRequire('proxy-addr');
const request = { socket: { remoteAddress: '203.0.113.9' }, headers: { 'x-forwarded-for': '192.0.2.99' } };
assert.equal(proxyaddr(request, proxyaddr.compile('::ffff:10.0.0.0/8')), '203.0.113.9');
assert.equal(proxyaddr.compile('::/1')('203.0.113.9'), false);
const trusted = proxyaddr.compile('::ffff:10.0.0.0/104');
assert.equal(trusted('10.1.2.3'), true);
assert.equal(trusted('203.0.113.9'), false);
assert.equal(proxyaddr({ ...request, socket: { remoteAddress: '10.1.2.3' } }, trusted), '192.0.2.99');
console.log('dependency runtime migrations passed');

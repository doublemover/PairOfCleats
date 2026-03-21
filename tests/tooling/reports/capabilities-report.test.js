#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getCapabilities } from '../../../src/shared/capabilities.js';
import { getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';

const caps = getCapabilities({ refresh: true });
const manifest = getRuntimeCapabilityManifest({ runtimeCapabilities: caps });
const repoRoot = process.cwd();
const workspaceRoute = manifest.surfaces?.api?.routes?.find((route) => route.id === 'search.workspace');
const contextPackCommand = manifest.surfaces?.cli?.commands?.find((command) => command.id === 'context-pack');
const riskExplainCommand = manifest.surfaces?.cli?.commands?.find((command) => command.id === 'risk.explain');

assert.ok(caps && typeof caps === 'object', 'capabilities should be an object');
assert.equal(typeof caps.watcher?.chokidar, 'boolean', 'watcher.chokidar should be boolean');
assert.equal(typeof caps.watcher?.parcel, 'boolean', 'watcher.parcel should be boolean');
assert.equal(typeof caps.regex?.re2, 'boolean', 'regex.re2 should be boolean');
assert.equal(typeof caps.regex?.re2js, 'boolean', 'regex.re2js should be boolean');
assert.equal(typeof caps.hash?.nodeRsXxhash, 'boolean', 'hash.nodeRsXxhash should be boolean');
assert.equal(typeof caps.hash?.wasmXxhash, 'boolean', 'hash.wasmXxhash should be boolean');
assert.equal(typeof caps.compression?.gzip, 'boolean', 'compression.gzip should be boolean');
assert.equal(typeof caps.compression?.zstd, 'boolean', 'compression.zstd should be boolean');
assert.equal(typeof caps.extractors?.pdf, 'boolean', 'extractors.pdf should be boolean');
assert.equal(typeof caps.extractors?.docx, 'boolean', 'extractors.docx should be boolean');
assert.equal(typeof caps.mcp?.legacy, 'boolean', 'mcp.legacy should be boolean');
assert.equal(typeof caps.mcp?.sdk, 'boolean', 'mcp.sdk should be boolean');
assert.equal(typeof caps.externalBackends?.tantivy, 'boolean', 'externalBackends.tantivy should be boolean');
assert.equal(typeof caps.externalBackends?.lancedb, 'boolean', 'externalBackends.lancedb should be boolean');
assert.equal(manifest.manifestVersion, '1.0.0', 'manifest version mismatch');
assert.deepEqual(manifest.runtimeCapabilities, caps, 'manifest runtime capabilities mismatch');
assert.ok(manifest.surfaces?.mcp?.tools?.some((tool) => tool.name === 'search'), 'manifest should expose MCP search tool');
assert.ok(manifest.surfaces?.editor?.vscode?.commands?.some((command) => command.id === 'pairofcleats.search'), 'manifest should expose VS Code search command');
assert.equal(manifest.surfaces?.tui?.supervisor?.capabilities?.supportsFlowControl, true, 'manifest should expose TUI flow control capability');
assert.ok(manifest.flags?.['index.build']?.flags?.some((flag) => flag.name === 'sqlite'), 'manifest should expose index.build flags');
assert.equal(workspaceRoute?.path, '/search/federated', 'workspace search capability should advertise the live federated search route');
assert.equal(contextPackCommand?.script, 'tools/analysis/context-pack.js', 'context-pack command should point at the live script');
assert.equal(riskExplainCommand?.script, 'tools/analysis/explain-risk.js', 'risk.explain command should point at the live script');
assert.equal(fs.existsSync(path.join(repoRoot, contextPackCommand.script)), true, 'context-pack command script should exist');
assert.equal(fs.existsSync(path.join(repoRoot, riskExplainCommand.script)), true, 'risk.explain command script should exist');

console.log('capabilities report tests passed');

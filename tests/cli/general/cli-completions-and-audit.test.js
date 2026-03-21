#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';

const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');

assert.equal(fs.existsSync(binPath), true, `Missing CLI entrypoint: ${binPath}`);

const runCli = (...args) => spawnSync(process.execPath, [binPath, ...args], {
  cwd: root,
  encoding: 'utf8'
});

const auditResult = runCli('cli', 'audit', '--json');
assert.equal(auditResult.status, 0, `cli audit failed: ${getCombinedOutput(auditResult, { trim: true })}`);
const auditPayload = JSON.parse(auditResult.stdout || '{}');
assert.equal(auditPayload.ok, true, 'expected cli audit JSON payload to report ok=true');
assert.ok(Number.isFinite(auditPayload.cliCommands), 'expected cli audit payload to include cliCommands count');

const bashResult = runCli('cli', 'completions', '--shell', 'bash');
assert.equal(bashResult.status, 0, `bash completions failed: ${getCombinedOutput(bashResult, { trim: true })}`);
assert.match(bashResult.stdout || '', /complete -F __pairofcleats_complete pairofcleats/);
assert.match(bashResult.stdout || '', /tree\["cli"\]="audit completions"/);
assert.match(bashResult.stdout || '', /tree\["report"\]="compare-models eval map metrics parity summary throughput"/);

const powershellResult = runCli('cli', 'completions', '--shell', 'powershell');
assert.equal(
  powershellResult.status,
  0,
  `PowerShell completions failed: ${getCombinedOutput(powershellResult, { trim: true })}`
);
assert.match(powershellResult.stdout || '', /Register-ArgumentCompleter/);
assert.match(powershellResult.stdout || '', /'cli' = @\('audit', 'completions'\)/);
assert.match(powershellResult.stdout || '', /'bench' = @\('language', 'matrix', 'micro', 'summarize'\)/);

const zshResult = runCli('cli', 'completions', '--shell', 'zsh');
assert.equal(zshResult.status, 0, `zsh completions failed: ${getCombinedOutput(zshResult, { trim: true })}`);
assert.match(zshResult.stdout || '', /#compdef pairofcleats/);
assert.match(zshResult.stdout || '', /compdef _pairofcleats pairofcleats/);
assert.match(zshResult.stdout || '', /_pairofcleats_tree\['cli'\]='audit completions'/);

console.log('cli completions and audit test passed');

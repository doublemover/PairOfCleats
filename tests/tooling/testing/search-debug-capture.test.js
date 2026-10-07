#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  captureCommandDebugRun,
  captureCommandTerminalRun
} from '../../../tools/testing/search-debug-capture.js';
import { runCaptureSearchDebugCli } from '../../../tools/testing/capture-search-debug.js';

const root = process.cwd();
const logsRoot = path.join(root, '.testLogs', 'search-debug-tests', `${process.pid}-${Date.now()}`);
await fs.rm(logsRoot, { recursive: true, force: true });
await fs.mkdir(logsRoot, { recursive: true });

const genericCapture = await captureCommandDebugRun({
  command: process.execPath,
  args: [
    '-e',
    'process.stdout.write("\\u001b[32mgreen\\u001b[0m\\n");process.stderr.write("\\u001b[31mred\\u001b[0m\\n");'
  ],
  cwd: root,
  logsRoot,
  label: 'ansi-generic',
  env: {
    ...process.env,
    COLUMNS: '188',
    LINES: '30'
  },
  trackedEnvKeys: ['COLUMNS', 'LINES']
});

assert.equal(genericCapture.status, 'passed', 'expected generic capture command to succeed');
assert.match(
  path.basename(genericCapture.outputDir),
  /ansi-generic-188x30-/u,
  'expected output directory name to include terminal size suffix'
);
const stdoutRaw = await fs.readFile(genericCapture.files.stdoutRaw, 'utf8');
const stderrRaw = await fs.readFile(genericCapture.files.stderrRaw, 'utf8');
const stdoutPlain = await fs.readFile(genericCapture.files.stdoutPlain, 'utf8');
const stderrPlain = await fs.readFile(genericCapture.files.stderrPlain, 'utf8');
const combinedRaw = await fs.readFile(genericCapture.files.combinedRaw, 'utf8');
const eventsJsonl = await fs.readFile(genericCapture.files.eventsJsonl, 'utf8');

assert.match(stdoutRaw, /\u001b\[32m/u, 'expected raw stdout log to preserve ANSI codes');
assert.match(stderrRaw, /\u001b\[31m/u, 'expected raw stderr log to preserve ANSI codes');
assert.doesNotMatch(stdoutPlain, /\u001b\[/u, 'expected stripped stdout log to remove ANSI codes');
assert.doesNotMatch(stderrPlain, /\u001b\[/u, 'expected stripped stderr log to remove ANSI codes');
assert.match(combinedRaw, /stdout/u, 'expected combined log to annotate stdout chunks');
assert.match(combinedRaw, /stderr/u, 'expected combined log to annotate stderr chunks');
assert.ok(eventsJsonl.trim().split(/\r?\n/u).length >= 2, 'expected event log entries for both streams');

const ptyCapture = await captureCommandTerminalRun({
  command: process.execPath,
  args: [
    '-e',
    'process.stdout.write("\\u001b[36mpty\\u001b[0m\\n");'
  ],
  cwd: root,
  logsRoot,
  label: 'ansi-pty',
  env: {
    ...process.env,
    COLUMNS: '72',
    LINES: '20'
  },
  trackedEnvKeys: ['COLUMNS', 'LINES']
});

assert.equal(ptyCapture.status, 'passed', 'expected PTY capture command to succeed');
assert.equal(ptyCapture.mode, 'pty', 'expected PTY capture metadata mode');
assert.match(
  path.basename(ptyCapture.outputDir),
  /ansi-pty-72x20-/u,
  'expected PTY output directory name to include terminal size suffix'
);
const terminalRaw = await fs.readFile(ptyCapture.files.terminalRaw, 'utf8');
const terminalPlain = await fs.readFile(ptyCapture.files.terminalPlain, 'utf8');
const screenTxt = await fs.readFile(ptyCapture.files.screenTxt, 'utf8');
const screenJson = JSON.parse(await fs.readFile(ptyCapture.files.screenJson, 'utf8'));
assert.match(terminalRaw, /\u001b\[36m/u, 'expected PTY raw log to preserve ANSI codes');
assert.doesNotMatch(terminalPlain, /\u001b\[/u, 'expected PTY plain log to strip ANSI codes');
assert.equal(screenTxt.trim(), 'pty', 'expected reconstructed PTY screen to preserve visible terminal content');
assert.equal(screenJson.usedWidth >= 3, true, 'expected PTY screen summary to record visible width');

const alignedPtyCapture = await captureCommandTerminalRun({
  command: process.execPath,
  args: [
    '-e',
    'process.stdout.write("\\u001b[2J\\u001b[HSearch Results\\u001b[20Celapsed 10ms\\r\\n");'
  ],
  cwd: root,
  logsRoot,
  label: 'aligned-pty',
  env: {
    ...process.env,
    COLUMNS: '60',
    LINES: '12'
  },
  trackedEnvKeys: ['COLUMNS', 'LINES']
});
const alignedScreen = await fs.readFile(alignedPtyCapture.files.screenTxt, 'utf8');
assert.match(alignedScreen, /Search Results\s+elapsed 10ms/u, 'expected reconstructed PTY screen to preserve aligned spacing');

const cliLabel = 'search-help';
const beforeEntries = new Set(await fs.readdir(logsRoot));
const cliExitCode = await runCaptureSearchDebugCli([
  '--logs-root',
  logsRoot,
  '--label',
  cliLabel,
  '--',
  '--help'
]);

assert.equal(cliExitCode, 0, 'expected capture-search-debug CLI to succeed for search --help');
const afterEntries = (await fs.readdir(logsRoot)).filter((entry) => !beforeEntries.has(entry));
assert.equal(afterEntries.length, 1, 'expected one new search debug capture directory');
const cliDir = path.join(logsRoot, afterEntries[0]);
const cliMeta = JSON.parse(await fs.readFile(path.join(cliDir, 'meta.json'), 'utf8'));
assert.equal(cliMeta.status, 'passed', 'expected search debug capture status=passed');
assert.equal(cliMeta.command, process.execPath, 'expected search capture to spawn node');
assert.equal(
  path.basename(String(cliMeta.args?.[0] || '')),
  'search.js',
  'expected search capture to invoke search.js'
);
const cliStdoutRaw = await fs.readFile(cliMeta.files.stdoutRaw, 'utf8');
const cliStderrRaw = await fs.readFile(cliMeta.files.stderrRaw, 'utf8');
assert.equal(
  cliStdoutRaw.length > 0 || cliStderrRaw.length > 0,
  true,
  'expected search debug capture to persist search output'
);

const ptyCliLabel = 'search-help-pty';
const beforePtyEntries = new Set(await fs.readdir(logsRoot));
const ptyCliExitCode = await runCaptureSearchDebugCli([
  '--logs-root',
  logsRoot,
  '--label',
  ptyCliLabel,
  '--pty',
  '--',
  '--help'
]);
assert.equal(ptyCliExitCode, 0, 'expected PTY capture-search-debug CLI to succeed for search --help');
const afterPtyEntries = (await fs.readdir(logsRoot)).filter((entry) => !beforePtyEntries.has(entry));
assert.equal(afterPtyEntries.length, 1, 'expected one new PTY search debug capture directory');
const ptyCliDir = path.join(logsRoot, afterPtyEntries[0]);
const ptyCliMeta = JSON.parse(await fs.readFile(path.join(ptyCliDir, 'meta.json'), 'utf8'));
assert.equal(ptyCliMeta.mode, 'pty', 'expected PTY search debug capture status mode=pty');
assert.equal(typeof ptyCliMeta.files.terminalRaw, 'string', 'expected PTY capture to persist terminal transcript');
assert.equal(typeof ptyCliMeta.files.screenTxt, 'string', 'expected PTY capture to persist reconstructed screen');

console.log('search debug capture test passed');

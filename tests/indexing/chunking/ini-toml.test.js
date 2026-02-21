#!/usr/bin/env node
import { chunkIniToml } from '../../../src/index/chunking.js';

const expect = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

const tomlText = [
  '[package]',
  'name = "demo"',
  '',
  '[[plugins]]',
  'name = "a"',
  '',
  '[[plugins]]',
  'name = "b"'
].join('\n');
const tomlChunks = chunkIniToml(tomlText, 'toml', {}) || [];
const tomlNames = new Set(tomlChunks.map((chunk) => chunk.name));
expect(tomlNames.has('package'), 'Missing TOML chunk for [package].');
expect(tomlNames.has('plugins'), 'Missing TOML chunk for [[plugins]].');

const iniText = [
  '[server]',
  'port=8080',
  '',
  '[logging]',
  'level=info'
].join('\n');
const iniChunks = chunkIniToml(iniText, 'ini', {}) || [];
const iniNames = new Set(iniChunks.map((chunk) => chunk.name));
expect(iniNames.has('server'), 'Missing INI chunk for [server].');
expect(iniNames.has('logging'), 'Missing INI chunk for [logging].');

console.log('Chunking INI/TOML test passed.');

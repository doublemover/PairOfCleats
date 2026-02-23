#!/usr/bin/env node
import assert from 'node:assert/strict';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';

const namesOf = (chunks) => chunks.map((chunk) => String(chunk?.name || '').trim());

const dockerText = [
  'FROM node:20 AS build',
  'RUN npm ci',
  'FROM node:20-slim',
  'COPY --from=build /app /app'
].join('\n');
const dockerChunks = smartChunk({ text: dockerText, ext: '.dockerfile', mode: 'code' });
const dockerNames = namesOf(dockerChunks);
assert.ok(dockerNames.some((name) => name === 'FROM build'), 'expected Dockerfile FROM stage heading chunk');
assert.ok(dockerNames.some((name) => name === 'RUN'), 'expected Dockerfile RUN heading chunk');
assert.ok(dockerChunks.every((chunk) => chunk?.meta?.format === 'dockerfile'), 'expected Dockerfile chunks to carry format metadata');

const makefileText = [
  'build:',
  '\tnpm run build',
  'test: build',
  '\tnpm test'
].join('\n');
const makefileChunks = smartChunk({ text: makefileText, ext: '.makefile', mode: 'code' });
const makefileNames = namesOf(makefileChunks);
assert.ok(makefileNames.includes('build'), 'expected Makefile target heading for build');
assert.ok(makefileNames.includes('test'), 'expected Makefile target heading for test');
assert.ok(makefileChunks.every((chunk) => chunk?.meta?.format === 'makefile'), 'expected Makefile chunks to carry format metadata');

const cmakeText = [
  'cmake_minimum_required(VERSION 3.20)',
  'project(PairOfCleats)',
  'add_executable(pairofcleats main.cpp)'
].join('\n');
const cmakeChunks = smartChunk({ text: cmakeText, ext: '.cmake', mode: 'code' });
const cmakeNames = namesOf(cmakeChunks);
assert.ok(cmakeNames.includes('project'), 'expected CMake project heading chunk');
assert.ok(cmakeNames.includes('add_executable'), 'expected CMake command heading chunk');

const jinjaText = [
  '{% extends "base.html" %}',
  '{% block body %}',
  '{{ title }}',
  '{% endblock %}',
  '{% macro render_item(item) %}',
  '{{ item }}',
  '{% endmacro %}'
].join('\n');
const jinjaChunks = smartChunk({ text: jinjaText, ext: '.jinja', mode: 'code' });
const jinjaNames = namesOf(jinjaChunks);
assert.ok(jinjaNames.some((name) => name.startsWith('block body')), 'expected Jinja block heading chunk');
assert.ok(jinjaNames.some((name) => name.startsWith('macro render_item')), 'expected Jinja macro heading chunk');

const razorText = [
  '@page',
  '@model ExamplePageModel',
  '@section Scripts {',
  '  <script src="/app.js"></script>',
  '}'
].join('\n');
const razorChunks = smartChunk({ text: razorText, ext: '.cshtml', mode: 'code' });
const razorNames = namesOf(razorChunks);
assert.ok(razorNames.includes('page'), 'expected Razor page directive heading chunk');
assert.ok(razorNames.includes('model ExamplePageModel'), 'expected Razor model directive heading chunk');
assert.ok(razorNames.includes('section Scripts'), 'expected Razor section directive heading chunk');

console.log('heuristic chunkers contract test passed');

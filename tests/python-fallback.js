#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildPythonHeuristicChunks } from '../src/lang/python.js';

const root = process.cwd();
const fixturePath = path.join(root, 'tests', 'fixtures', 'languages', 'src', 'python_advanced.py');

if (!fs.existsSync(fixturePath)) {
  console.error(`Missing python fixture at ${fixturePath}`);
  process.exit(1);
}

const text = fs.readFileSync(fixturePath, 'utf8');
const chunks = buildPythonHeuristicChunks(text) || [];

const hasPoint = chunks.some((chunk) => chunk.name === 'Point');
const hasDistance = chunks.some((chunk) => chunk.name === 'Point.distance');
const hasOuter = chunks.some((chunk) => chunk.name === 'outer');

if (!hasPoint || !hasDistance || !hasOuter) {
  console.error('Python heuristic fallback missing expected chunks (Point, Point.distance, outer).');
  process.exit(1);
}

console.log('Python heuristic fallback test passed');

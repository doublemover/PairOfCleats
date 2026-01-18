#!/usr/bin/env node
import { getLanguageForFile } from '../../src/index/language-registry.js';

const expectId = (ext, relPath, expected) => {
  const lang = getLanguageForFile(ext, relPath);
  const actual = lang ? lang.id : null;
  if (actual !== expected) {
    console.error(`Language mismatch for ${relPath || ext}: ${actual} !== ${expected}`);
    process.exit(1);
  }
};

expectId('.js', 'src/app.js', 'javascript');
expectId('.ts', 'src/app.ts', 'typescript');
expectId('.tsx', 'src/App.tsx', 'typescript');
expectId('.py', 'src/app.py', 'python');
expectId('.rs', 'src/lib.rs', 'rust');
expectId('.go', 'src/main.go', 'go');
expectId('.hbs', 'templates/view.hbs', 'handlebars');
expectId('.dockerfile', 'Dockerfile.dockerfile', 'dockerfile');

console.log('Language registry selection test passed.');

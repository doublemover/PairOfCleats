#!/usr/bin/env node
import { getLanguageForFile } from '../../../src/index/language-registry.js';

const expectId = (ext, relPath, expected) => {
  const lang = getLanguageForFile(ext, relPath);
  const actual = lang ? lang.id : null;
  if (actual !== expected) {
    console.error(`Language mismatch for ${relPath || ext}: ${actual} !== ${expected}`);
    process.exit(1);
  }
};

expectId('.js', 'src/app.js', 'javascript');
expectId('.mjs', 'src/app.mjs', 'javascript');
expectId('.cjs', 'src/app.cjs', 'javascript');
expectId('.jsx', 'src/App.jsx', 'javascript');
expectId('.ts', 'src/app.ts', 'typescript');
expectId('.mts', 'src/app.mts', 'typescript');
expectId('.cts', 'src/app.cts', 'typescript');
expectId('.tsx', 'src/App.tsx', 'typescript');
expectId('.py', 'src/app.py', 'python');
expectId('.rs', 'src/lib.rs', 'rust');
expectId('.go', 'src/main.go', 'go');
expectId('.jsonc', 'config/deno.jsonc', 'json');
expectId('.resolved', 'swift/Package.resolved', 'json');
expectId('', 'python/Pipfile', 'toml');
expectId('.csproj', 'src/app/app.csproj', 'xml');
expectId('', 'go.mod', 'go');
expectId('', 'proto/buf.yaml', 'proto');
expectId('', 'proto/buf.gen.yaml', 'proto');
expectId('.hbs', 'templates/view.hbs', 'handlebars');
expectId('.dockerfile', 'Dockerfile.dockerfile', 'dockerfile');

console.log('Language registry selection test passed.');

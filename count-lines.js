import fs from 'fs';
import path from 'path';

const root = process.cwd();
const skipDirs = new Set(['.git', 'node_modules', 'coverage', 'test-results']);

const toPosix = (value) => value.split(path.sep).join('/');

const shouldSkipDir = (dirName) => skipDirs.has(dirName);

const countLines = (content) => {
  if (!content) return 0;
  return content.split(/\r\n|\r|\n/).length;
};

const walk = (dir, files) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      walk(fullPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
};

const allFiles = [];
walk(root, allFiles);

const isTestFile = (filePath) => {
  const posix = toPosix(path.relative(root, filePath));
  return posix.startsWith('tests/') || posix.includes('/test/');
};

const isExcludedSourceFile = (filePath) => {
  const posix = `/${toPosix(path.relative(root, filePath))}`;
  return (
    posix.includes('/js/vendor/') ||
    posix.includes('/webmidi/') ||
    posix.includes('/jquery/') ||
    posix.includes('/benchmarks/') || 
    posix.includes('/.cache/') ||
    posix.includes('/.logs/')
  );
};

const sourceFiles = [];
const testFiles = [];

for (const filePath of allFiles) {
  if (isTestFile(filePath)) {
    testFiles.push(filePath);
    continue;
  }
  if (!isExcludedSourceFile(filePath)) {
    sourceFiles.push(filePath);
  }
}

const sumLines = (files) => (
  files.reduce((total, filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    return total + countLines(content);
  }, 0)
);

const sourceLines = sumLines(sourceFiles);
const testLines = sumLines(testFiles);

const lines = [
  `SourceFiles : ${sourceFiles.length}`,
  `SourceLines : ${sourceLines}`,
  `TestFiles   : ${testFiles.length}`,
  `TestLines   : ${testLines}`
];

console.log(lines.join('\n'));

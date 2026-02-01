import { smartChunk } from '../src/index/chunking.js';

const assertNoBlob = (chunks, label) => {
  if (!Array.isArray(chunks) || !chunks.length) {
    console.error(`Expected chunks for ${label}, got none.`);
    process.exit(1);
  }
  const hasBlob = chunks.some((chunk) => chunk?.kind === 'Blob' || chunk?.name === 'blob');
  if (hasBlob) {
    console.error(`Found blob chunk in ${label}: ${JSON.stringify(chunks[0])}`);
    process.exit(1);
  }
};

const proseChunks = smartChunk({
  text: '/** comment */\nconst x = 1;\n',
  ext: '.js',
  mode: 'prose',
  context: {}
});
assertNoBlob(proseChunks, 'prose/.js fallback');

const codeChunks = smartChunk({
  text: 'some text with no parser',
  ext: '.unknown',
  mode: 'code',
  context: {}
});
assertNoBlob(codeChunks, 'code/.unknown fallback');

console.log('chunking no-blob fallback test passed.');

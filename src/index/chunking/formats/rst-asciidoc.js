import { projectRstOutline } from './rst-outline.js';
import { projectAsciiDocOutline } from './asciidoc-outline.js';

export function chunkAsciiDoc(text) {
  return projectAsciiDocOutline(text).chunks;
}

export function chunkRst(text) {
  return projectRstOutline(text).chunks;
}

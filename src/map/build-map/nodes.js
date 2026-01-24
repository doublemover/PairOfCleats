import { basename, classifyFilePath, extension, sortBy } from '../utils.js';

export const buildFileNodes = (membersByFile) => {
  const nodes = [];
  for (const [file, members] of membersByFile.entries()) {
    const list = sortBy(members || [], (member) => `${member.name}:${member.range?.startLine || 0}`);
    nodes.push({
      id: file,
      path: file,
      name: basename(file),
      ext: extension(file) || null,
      category: classifyFilePath(file),
      type: 'file',
      members: list
    });
  }
  return nodes;
};

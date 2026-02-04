import { basename, classifyFilePath, extension, sortBy } from '../utils.js';

export function* buildFileNodesIterable(membersByFile, { intern } = {}) {
  for (const [file, members] of membersByFile.entries()) {
    const list = sortBy(members || [], (member) => `${member.name}:${member.range?.startLine || 0}`);
    const filePath = intern ? intern(file) : file;
    yield {
      id: filePath,
      path: filePath,
      name: intern ? intern(basename(filePath)) : basename(filePath),
      ext: extension(filePath) || null,
      category: classifyFilePath(filePath),
      type: 'file',
      members: list
    };
  }
}

export const buildFileNodes = (membersByFile, options = {}) => {
  return Array.from(buildFileNodesIterable(membersByFile, options));
};

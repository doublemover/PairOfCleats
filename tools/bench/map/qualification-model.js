import { MAP_MODEL_VERSION } from '../../../src/map/model-version.js';

const shapes = Object.freeze({ medium: [4096, 24, 32768], large: [8192, 32, 65536] });
export const createMapQualificationModel = ({ profile, root }) => {
  if (!Object.hasOwn(shapes, profile)) throw new TypeError('Unknown private serializer qualification shape.');
  const [files, membersPerFile, edgeCount] = shapes[profile];
  const nodes = Array.from({ length: files }, (_, index) => ({ id: `file-${index}`, path: `src/file-${index}.js`, name: `file-${index}.js`, type: 'file',
    members: Array.from({ length: membersPerFile }, (_, member) => ({ id: `member-${index}-${member}`, name: `function-${index}-${member}`, kind: 'function' })) }));
  const edges = Array.from({ length: edgeCount }, (_, index) => ({ type: 'call',
    from: { file: `src/file-${index % files}.js`, member: `member-${index % files}-${index % membersPerFile}` },
    to: { file: `src/file-${(index + 1) % files}.js`, member: `member-${(index + 1) % files}-${(index + 1) % membersPerFile}` } }));
  return { version: MAP_MODEL_VERSION, generatedAt: '2026-10-30T00:00:00Z', root: { path: root, id: null }, legend: {}, nodes, edges,
    summary: { counts: { files, members: files * membersPerFile, edges: edgeCount }, truncated: false,
      inventory: { status: 'authored-synthetic-serializer-input', files }, dropped: { files: 0, members: 0, edges: 0 } }, options: {}, warnings: [] };
};

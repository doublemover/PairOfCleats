import path from 'node:path';
import { writeJsonArrayFile } from '../../../../shared/json-stream.js';

export const createFileRelationsIterator = (relations) => function* fileRelationsIterator() {
  if (!relations || typeof relations.entries !== 'function') return;
  for (const [file, data] of relations.entries()) {
    if (!file || !data) continue;
    yield {
      file,
      relations: data
    };
  }
};

export const enqueueFileRelationsArtifacts = ({
  state,
  outDir,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
}) => {
  if (!state.fileRelations || !state.fileRelations.size) return;
  const relationsPath = path.join(outDir, 'file_relations.json');
  const fileRelationsIterator = createFileRelationsIterator(state.fileRelations);
  enqueueWrite(
    formatArtifactLabel(relationsPath),
    () => writeJsonArrayFile(
      relationsPath,
      fileRelationsIterator(),
      { atomic: true }
    )
  );
  addPieceFile({
    type: 'relations',
    name: 'file_relations',
    format: 'json',
    count: state.fileRelations.size
  }, relationsPath);
};

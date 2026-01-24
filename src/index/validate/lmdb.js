import fs from 'node:fs';
import path from 'node:path';
import { Unpackr } from 'msgpackr';

const unpackr = new Unpackr();

export const decode = (value) => (value == null ? null : unpackr.unpack(value));

export const hasLmdbStore = (storePath) => {
  if (!storePath || !fs.existsSync(storePath)) return false;
  return fs.existsSync(path.join(storePath, 'data.mdb'));
};

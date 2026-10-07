import fs from 'node:fs';
import path from 'node:path';

export const contentTypeForMapIsoPath = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.map') return 'application/json; charset=utf-8';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.hdr') return 'application/octet-stream';
  return 'application/octet-stream';
};

export const serveMapIsoStaticFileOr404 = (res, filePath, notFoundMessage) => {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end(notFoundMessage);
      return;
    }
  } catch {
    res.writeHead(404);
    res.end(notFoundMessage);
    return;
  }

  res.writeHead(200, { 'Content-Type': contentTypeForMapIsoPath(filePath) });
  const stream = fs.createReadStream(filePath);
  const onResponseClose = () => {
    if (!stream.destroyed) {
      stream.destroy();
    }
  };
  res.once('close', onResponseClose);
  stream.once('close', () => {
    res.off('close', onResponseClose);
  });
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(404);
    }
    if (!res.writableEnded) {
      res.end(notFoundMessage);
    }
  });
  stream.pipe(res);
};

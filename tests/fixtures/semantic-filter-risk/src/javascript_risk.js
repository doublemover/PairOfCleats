import { exec } from 'child_process';

export function runCommand(req) {
  const cmd = (req && req.body && req.body.cmd) || process.env.CMD || '';
  return exec(cmd);
}

export function renderUnsafe(req) {
  const html = req && req.query ? req.query.html : '';
  document.body.innerHTML = html;
}

export function sqlLookup(req, db) {
  const id = req && req.params ? req.params.id : '0';
  return db.query(`SELECT * FROM widgets WHERE id=${id}`);
}

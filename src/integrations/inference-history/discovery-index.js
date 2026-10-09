import { advanceHistoryGeneration } from './generation.js';
const columns = 'id,snapshot,title,path,facets,title_terms,path_terms,facets_terms';
const selection = (where = '') => `SELECT u.id,s.id snapshot,
 CASE WHEN COALESCE((SELECT json_array_length(json_extract(policy,'$.redactions')) FROM history_privacy WHERE record_id=u.record_id),0)>0 THEN '' ELSE s.title END title,
 CASE WHEN COALESCE((SELECT json_array_length(json_extract(policy,'$.redactions')) FROM history_privacy WHERE record_id=u.record_id),0)>0 THEN '' ELSE COALESCE(json_extract(u.metadata,'$.sourceDetails.locator'),'') || ' ' || COALESCE((SELECT group_concat(member,' ') FROM occurrences WHERE snapshot_id=s.id),'') END path,
 CASE WHEN COALESCE((SELECT json_array_length(json_extract(policy,'$.redactions')) FROM history_privacy WHERE record_id=u.record_id),0)>0 THEN '' ELSE COALESCE(json_extract(u.metadata,'$.evidenceKind'),'') || ' ' || COALESCE(json_extract(u.metadata,'$.sourceDetails.artifactKind'),'') || ' ' || COALESCE(json_extract(u.metadata,'$.role'),'') END facets
 FROM units u JOIN records r ON r.id=u.record_id JOIN snapshot_units su ON su.unit_id=u.id JOIN snapshots s ON s.id=su.snapshot_id
 WHERE r.deleted=0 AND r.excluded=0 ${where}`;
const insert = where => `INSERT INTO units_discovery_fts(${columns})
 SELECT id,snapshot,title,path,facets,history_lexical_text(title),history_lexical_text(path),history_lexical_text(facets) FROM (${selection(where)});`;
export const installHistoryDiscoveryIndex = db => {
  db.exec(`CREATE TABLE IF NOT EXISTS history_discovery_units (id TEXT PRIMARY KEY);
 CREATE VIRTUAL TABLE IF NOT EXISTS units_discovery_fts USING fts5(id UNINDEXED,snapshot UNINDEXED,title UNINDEXED,path UNINDEXED,facets UNINDEXED,title_terms,path_terms,facets_terms,tokenize="unicode61 remove_diacritics 0 tokenchars '_'");
 CREATE TRIGGER IF NOT EXISTS discovery_snapshot_unit AFTER INSERT ON snapshot_units BEGIN
 ${insert('AND u.id=new.unit_id AND s.id=new.snapshot_id')}
 INSERT OR IGNORE INTO history_discovery_units VALUES(new.unit_id);
 END;
 CREATE TRIGGER IF NOT EXISTS discovery_unit_update AFTER UPDATE OF text,metadata ON units BEGIN
 DELETE FROM units_discovery_fts WHERE id=old.id;
 ${insert('AND u.id=new.id')}
 INSERT OR IGNORE INTO history_discovery_units VALUES(new.id);
 END;
 CREATE TRIGGER IF NOT EXISTS discovery_unit_delete AFTER DELETE ON units BEGIN
 DELETE FROM units_discovery_fts WHERE id=old.id;
 DELETE FROM history_discovery_units WHERE id=old.id;
 END;`);
};
/** Explicit derived-index rebuild preserves every source/citation namespace. */
export const rebuildHistoryDiscoveryIndex = db => {
  installHistoryDiscoveryIndex(db);
  db.transaction(() => {
    db.exec('DELETE FROM units_discovery_fts; DELETE FROM history_discovery_units');
    db.exec(insert(''));
    db.exec('INSERT INTO history_discovery_units SELECT DISTINCT id FROM units_discovery_fts');
    advanceHistoryGeneration(db);
  })();
  return { version: 'history-discovery.v2', rows: db.prepare('SELECT COUNT(*) count FROM units_discovery_fts').get().count };
};

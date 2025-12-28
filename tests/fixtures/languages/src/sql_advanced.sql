-- Widget table
CREATE TABLE widgets (
  id INTEGER PRIMARY KEY,
  name TEXT
);

CREATE VIEW widget_names AS
  SELECT name FROM widgets;

CREATE FUNCTION widget_count()
RETURNS INTEGER
AS $$
  SELECT COUNT(*) FROM widgets;
$$ LANGUAGE SQL;

CREATE INDEX idx_widgets_name ON widgets (name);

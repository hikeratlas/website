-- Each park's counts (routes#252): its listed trails, those still open, and
-- its official trails, so the regressions page can list the parks without
-- reading every row, and opens one park at a time. Kept by the triggers
-- below as rows are saved (a park's rows, by its index: cheap).

ALTER TABLE park ADD COLUMN listed_n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE park ADD COLUMN open_n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE park ADD COLUMN trail_n INTEGER NOT NULL DEFAULT 0;

UPDATE park SET
  listed_n = (SELECT count(*) FROM listed_trail l WHERE l.park_id = park.park_id AND l.data IS NOT NULL),
  open_n = (SELECT count(*) FROM listed_trail l WHERE l.park_id = park.park_id AND l.data IS NOT NULL AND l.status = 'open'),
  trail_n = (SELECT count(*) FROM trail t WHERE t.park_id = park.park_id AND t.data IS NOT NULL);

CREATE TRIGGER listed_trail_count_added AFTER INSERT ON listed_trail BEGIN
  UPDATE park SET
    listed_n = (SELECT count(*) FROM listed_trail l WHERE l.park_id = NEW.park_id AND l.data IS NOT NULL),
    open_n = (SELECT count(*) FROM listed_trail l WHERE l.park_id = NEW.park_id AND l.data IS NOT NULL AND l.status = 'open')
  WHERE park_id = NEW.park_id;
END;
CREATE TRIGGER listed_trail_count_saved AFTER UPDATE OF rev ON listed_trail BEGIN
  UPDATE park SET
    listed_n = (SELECT count(*) FROM listed_trail l WHERE l.park_id = NEW.park_id AND l.data IS NOT NULL),
    open_n = (SELECT count(*) FROM listed_trail l WHERE l.park_id = NEW.park_id AND l.data IS NOT NULL AND l.status = 'open')
  WHERE park_id = NEW.park_id;
END;
CREATE TRIGGER trail_count_added AFTER INSERT ON trail BEGIN
  UPDATE park SET trail_n = (SELECT count(*) FROM trail t WHERE t.park_id = NEW.park_id AND t.data IS NOT NULL)
  WHERE park_id = NEW.park_id;
END;
CREATE TRIGGER trail_count_saved AFTER UPDATE OF rev ON trail BEGIN
  UPDATE park SET trail_n = (SELECT count(*) FROM trail t WHERE t.park_id = NEW.park_id AND t.data IS NOT NULL)
  WHERE park_id = NEW.park_id;
END;

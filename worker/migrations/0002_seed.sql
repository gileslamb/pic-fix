-- Migrate the V1 library (the SEED array in index.html) into D1.
-- Idempotent: INSERT OR IGNORE keyed on the UNIQUE yt_id, so re-running is safe.
-- Approved on V1 sign-off (Gabriella, 3 July 2026).
INSERT OR IGNORE INTO videos (yt_id, title, channel, food_group, status, added_by, added_at, approved_at)
VALUES
  ('SajyHgJTy3E', 'The Romans — History in a Nutshell',        'History in a Nutshell', 'learn', 'approved', 'seed', unixepoch('2026-07-03'), unixepoch('2026-07-03')),
  ('3uzucyoUe6Q', 'The Amazon Rainforest — World of the Wild', 'World of the Wild',     'watch', 'approved', 'seed', unixepoch('2026-07-03'), unixepoch('2026-07-03')),
  ('Pc50h4ZlQb8', 'Paper butterfly — easy origami',            NULL,                    'make',  'approved', 'seed', unixepoch('2026-07-03'), unixepoch('2026-07-03')),
  ('23VdtT0vQUY', 'Cosmic Kids Yoga — dance party',            'Cosmic Kids Yoga',      'move',  'approved', 'seed', unixepoch('2026-07-03'), unixepoch('2026-07-03')),
  ('J7TY3D4mqL8', 'Dragons Love Tacos — read aloud',           NULL,                    'wind',  'approved', 'seed', unixepoch('2026-07-03'), unixepoch('2026-07-03'));

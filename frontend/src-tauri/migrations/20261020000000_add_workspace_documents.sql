-- Logical folders never move or remove recording files (folder_path).
CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
ALTER TABLE meetings ADD COLUMN document_type TEXT NOT NULL DEFAULT 'meeting'
    CHECK (document_type IN ('meeting', 'note'));
ALTER TABLE meetings ADD COLUMN scheduled_at TEXT;
ALTER TABLE meetings ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE meetings ADD COLUMN recording_session_id TEXT;
CREATE UNIQUE INDEX meetings_recording_session ON meetings(recording_session_id)
    WHERE recording_session_id IS NOT NULL;
CREATE INDEX meetings_folder_id ON meetings(folder_id);

-- DROP of the former folders table fires meetings.folder_id ON DELETE SET NULL
-- even inside a transaction. Preserve memberships explicitly until replacement.
CREATE TEMP TABLE kh_folder_membership AS
    SELECT id AS document_id, folder_id FROM meetings WHERE folder_id IS NOT NULL;
CREATE TABLE folders_next (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
    parent_id TEXT REFERENCES folders_next(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (parent_id IS NULL OR parent_id <> id)
);
INSERT INTO folders_next (id, name, parent_id, created_at, updated_at)
    SELECT id, name, NULL, created_at, updated_at FROM folders;
DROP TABLE folders;
ALTER TABLE folders_next RENAME TO folders;
CREATE UNIQUE INDEX folders_root_name ON folders(name COLLATE NOCASE) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX folders_sibling_name ON folders(parent_id, name COLLATE NOCASE) WHERE parent_id IS NOT NULL;
UPDATE meetings SET folder_id = (
    SELECT folder_id FROM kh_folder_membership WHERE document_id = meetings.id
) WHERE id IN (SELECT document_id FROM kh_folder_membership);
DROP TABLE kh_folder_membership;

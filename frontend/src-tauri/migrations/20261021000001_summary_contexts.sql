-- Adapted from upstream PR #848 (367c45f9229f265040203d2abe2f48dbbc8b27c4).
-- Only global and meeting contexts are part of this workspace release.
CREATE TABLE summary_contexts (
    scope TEXT NOT NULL CHECK (scope IN ('global', 'meeting')),
    scope_id TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '' CHECK (length(context) <= 4000),
    use_inherited INTEGER NOT NULL DEFAULT 1 CHECK (use_inherited IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope, scope_id),
    CHECK ((scope = 'global' AND scope_id = '') OR (scope = 'meeting' AND length(scope_id) > 0))
);
CREATE TRIGGER summary_context_meeting_deleted AFTER DELETE ON meetings BEGIN
    DELETE FROM summary_contexts WHERE scope = 'meeting' AND scope_id = OLD.id;
END;

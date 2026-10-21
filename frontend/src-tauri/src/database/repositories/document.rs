use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct DocumentInfo {
    pub id: String,
    pub title: String,
    pub document_type: String,
    pub scheduled_at: Option<String>,
    pub folder_id: Option<String>,
    pub folder_path: Option<String>,
    pub recording_session_id: Option<String>,
    pub has_recording: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct DocumentsRepository;

// Historical recordings may contain transcripts/summaries without an audio path.
// Use this projection everywhere a DocumentInfo leaves native storage.
const DOCUMENT_SELECT: &str = "SELECT m.*,
    (m.folder_path IS NOT NULL OR m.recording_session_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM transcripts t WHERE t.meeting_id = m.id)
     OR EXISTS (SELECT 1 FROM summary_processes s WHERE s.meeting_id = m.id)) AS has_recording
    FROM meetings m";

fn invalid(message: &str) -> sqlx::Error {
    sqlx::Error::Protocol(message.to_string())
}

fn validate_title_and_schedule(title: &str, scheduled_at: Option<&str>) -> Result<(), sqlx::Error> {
    if title.trim().is_empty() {
        return Err(invalid("Title cannot be empty"));
    }
    if let Some(schedule) = scheduled_at {
        chrono::DateTime::parse_from_rfc3339(schedule)
            .map_err(|_| invalid("Schedule must be RFC3339"))?;
    }
    Ok(())
}

impl DocumentsRepository {
    pub async fn list(pool: &SqlitePool) -> Result<Vec<DocumentInfo>, sqlx::Error> {
        sqlx::query_as(&format!(
            "{} ORDER BY m.updated_at DESC, m.id",
            DOCUMENT_SELECT
        ))
        .fetch_all(pool)
        .await
    }

    pub async fn get(pool: &SqlitePool, id: &str) -> Result<DocumentInfo, sqlx::Error> {
        if id.trim().is_empty() {
            return Err(invalid("Document ID cannot be empty"));
        }
        sqlx::query_as(&format!("{} WHERE m.id = ?", DOCUMENT_SELECT))
            .bind(id)
            .fetch_one(pool)
            .await
    }

    pub async fn create(
        pool: &SqlitePool,
        title: &str,
        document_type: &str,
        scheduled_at: Option<&str>,
        folder_id: Option<&str>,
    ) -> Result<DocumentInfo, sqlx::Error> {
        validate_title_and_schedule(title, scheduled_at)?;
        if !matches!(document_type, "meeting" | "note") {
            return Err(invalid("Invalid document type"));
        }
        let mut tx = pool.begin().await?;
        if let Some(folder_id) = folder_id {
            sqlx::query("SELECT id FROM folders WHERE id = ?")
                .bind(folder_id)
                .fetch_one(&mut *tx)
                .await?;
        }
        let id = format!("meeting-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO meetings (id, title, document_type, scheduled_at, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(&id).bind(title.trim()).bind(document_type).bind(scheduled_at).bind(folder_id).bind(&now).bind(&now).execute(&mut *tx).await?;
        let document = sqlx::query_as(&format!("{} WHERE m.id = ?", DOCUMENT_SELECT))
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(document)
    }

    pub async fn update(
        pool: &SqlitePool,
        id: &str,
        title: &str,
        scheduled_at: Option<&str>,
    ) -> Result<DocumentInfo, sqlx::Error> {
        validate_title_and_schedule(title, scheduled_at)?;
        let result = sqlx::query(
            "UPDATE meetings SET title = ?, scheduled_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(title.trim())
        .bind(scheduled_at)
        .bind(Utc::now().to_rfc3339())
        .bind(id)
        .execute(pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }
        Self::get(pool, id).await
    }

    pub async fn folders(pool: &SqlitePool) -> Result<Vec<Folder>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM folders ORDER BY name COLLATE NOCASE, id")
            .fetch_all(pool)
            .await
    }

    pub async fn create_folder(pool: &SqlitePool, name: &str) -> Result<Folder, sqlx::Error> {
        Self::create_folder_in(pool, name, None).await
    }

    pub async fn create_folder_in(
        pool: &SqlitePool,
        name: &str,
        parent_id: Option<&str>,
    ) -> Result<Folder, sqlx::Error> {
        if name.trim().is_empty() {
            return Err(invalid("Folder name cannot be empty"));
        }
        let id = format!("folder-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        let mut tx = pool.begin().await?;
        if let Some(parent) = parent_id {
            sqlx::query("SELECT id FROM folders WHERE id = ?")
                .bind(parent)
                .fetch_one(&mut *tx)
                .await?;
        }
        sqlx::query("INSERT INTO folders (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(name.trim())
            .bind(parent_id)
            .bind(&now)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        let folder = sqlx::query_as("SELECT * FROM folders WHERE id = ?")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(folder)
    }

    pub async fn rename_folder(
        pool: &SqlitePool,
        id: &str,
        name: &str,
    ) -> Result<Folder, sqlx::Error> {
        if name.trim().is_empty() {
            return Err(invalid("Folder name cannot be empty"));
        }
        let result = sqlx::query("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?")
            .bind(name.trim())
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }
        sqlx::query_as("SELECT * FROM folders WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
    }

    pub async fn remove_folder(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
        let mut tx = pool.begin().await?;
        // Take SQLite's writer lock before checking children, matching reparent.
        let locked = sqlx::query("UPDATE folders SET updated_at = updated_at WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        if locked.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }
        let child: Option<(String,)> =
            sqlx::query_as("SELECT id FROM folders WHERE parent_id = ? LIMIT 1")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        if child.is_some() {
            return Err(invalid(
                "Folder has children; move children first before removing it",
            ));
        }
        sqlx::query("UPDATE meetings SET folder_id = NULL, updated_at = ? WHERE folder_id = ?")
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM folders WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await
    }

    pub async fn move_folder(
        pool: &SqlitePool,
        id: &str,
        parent_id: Option<&str>,
    ) -> Result<Folder, sqlx::Error> {
        let mut tx = pool.begin().await?;
        // A deferred transaction must acquire its write lock BEFORE ancestry is
        // read, so concurrent inverse moves cannot both validate a stale tree.
        let locked = sqlx::query("UPDATE folders SET updated_at = updated_at WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        if locked.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }
        if let Some(parent) = parent_id {
            sqlx::query("SELECT id FROM folders WHERE id = ?")
                .bind(parent)
                .fetch_one(&mut *tx)
                .await?;
            let cycle: Option<(String,)> = sqlx::query_as(
                "WITH RECURSIVE ancestors(id, parent_id) AS (
                    SELECT id, parent_id FROM folders WHERE id = ?
                    UNION SELECT f.id, f.parent_id FROM folders f JOIN ancestors a ON f.id = a.parent_id
                 ) SELECT id FROM ancestors WHERE id = ? LIMIT 1"
            ).bind(parent).bind(id).fetch_optional(&mut *tx).await?;
            if cycle.is_some() {
                return Err(invalid(
                    "Cannot move a folder into itself or its descendants",
                ));
            }
        }
        sqlx::query("UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ?")
            .bind(parent_id)
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&mut *tx)
            .await?;
        let folder = sqlx::query_as("SELECT * FROM folders WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(folder)
    }

    pub async fn move_document(
        pool: &SqlitePool,
        id: &str,
        folder_id: Option<&str>,
    ) -> Result<DocumentInfo, sqlx::Error> {
        let mut tx = pool.begin().await?;
        if let Some(folder_id) = folder_id {
            sqlx::query("SELECT id FROM folders WHERE id = ?")
                .bind(folder_id)
                .fetch_one(&mut *tx)
                .await?;
        }
        let result = sqlx::query("UPDATE meetings SET folder_id = ?, updated_at = ? WHERE id = ?")
            .bind(folder_id)
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&mut *tx)
            .await?;
        if result.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }
        let document = sqlx::query_as(&format!("{} WHERE m.id = ?", DOCUMENT_SELECT))
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(document)
    }

    pub async fn validate_recording_target(
        pool: &SqlitePool,
        id: &str,
    ) -> Result<DocumentInfo, sqlx::Error> {
        let document = Self::get(pool, id).await?;
        if document.document_type != "meeting" {
            return Err(invalid("Personal notes cannot be recorded"));
        }
        if document.has_recording {
            return Err(invalid("Meeting already has a recording"));
        }
        Ok(document)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::repositories::meeting_notes::{
        test_support::test_pool, MeetingNotesRepository,
    };

    #[tokio::test]
    async fn legacy_pathless_transcripts_and_summary_only_rows_remain_recorded() {
        let pool = test_pool().await;
        for id in ["transcript-only", "summary-only", "prepared"] {
            sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?, ?, '2026-01-01', '2026-01-01')")
                .bind(id).bind(id).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO transcripts (id, meeting_id, transcript, timestamp) VALUES ('t', 'transcript-only', 'Keep transcript', '00:01')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, result) VALUES ('summary-only', 'completed', '2026-01-01', '2026-01-01', '{\"summary\":\"Keep summary\"}')")
            .execute(&pool).await.unwrap();
        for id in ["transcript-only", "summary-only"] {
            let document = DocumentsRepository::get(&pool, id).await.unwrap();
            assert!(document.has_recording);
            assert_eq!(document.folder_path, None);
            assert_eq!(document.recording_session_id, None);
            assert!(DocumentsRepository::validate_recording_target(&pool, id)
                .await
                .is_err());
            assert!(
                crate::database::repositories::transcript::TranscriptsRepository::save_recording(
                    &pool,
                    "Replacement",
                    &[],
                    None,
                    Some(id),
                    Some("new-session")
                )
                .await
                .is_err()
            );
            assert!(
                DocumentsRepository::update(&pool, id, "Renamed", None)
                    .await
                    .unwrap()
                    .has_recording
            );
            assert!(
                DocumentsRepository::move_document(&pool, id, None)
                    .await
                    .unwrap()
                    .has_recording
            );
        }
        let documents = DocumentsRepository::list(&pool).await.unwrap();
        assert_eq!(documents.iter().filter(|d| d.has_recording).count(), 2);
        assert!(
            !DocumentsRepository::get(&pool, "prepared")
                .await
                .unwrap()
                .has_recording
        );
        assert!(
            DocumentsRepository::validate_recording_target(&pool, "prepared")
                .await
                .is_ok()
        );
        let summary: (String,) = sqlx::query_as(
            "SELECT result FROM summary_processes WHERE meeting_id = 'summary-only'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(summary.0, r#"{"summary":"Keep summary"}"#);
        let transcript: (String,) = sqlx::query_as(
            "SELECT transcript FROM transcripts WHERE meeting_id = 'transcript-only'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(transcript.0, "Keep transcript");
    }

    #[tokio::test]
    async fn documents_roundtrip_and_folder_removal_preserves_notes_and_recording_path() {
        let pool = test_pool().await;
        let folder = DocumentsRepository::create_folder(&pool, "Work")
            .await
            .unwrap();
        let meeting = DocumentsRepository::create(
            &pool,
            "Prepared",
            "meeting",
            Some("2026-10-20T10:00:00Z"),
            Some(&folder.id),
        )
        .await
        .unwrap();
        let note = DocumentsRepository::create(&pool, "Personal", "note", None, Some(&folder.id))
            .await
            .unwrap();
        MeetingNotesRepository::upsert(&pool, &meeting.id, "Agenda A+B", Some("[]"))
            .await
            .unwrap();
        let recording = tempfile::tempdir().unwrap();
        std::fs::write(recording.path().join("audio.mp4"), b"keep audio").unwrap();
        sqlx::query("UPDATE meetings SET folder_path = ? WHERE id = ?")
            .bind(recording.path().to_string_lossy().as_ref())
            .bind(&meeting.id)
            .execute(&pool)
            .await
            .unwrap();
        DocumentsRepository::remove_folder(&pool, &folder.id)
            .await
            .unwrap();
        let saved = DocumentsRepository::get(&pool, &meeting.id).await.unwrap();
        assert_eq!(saved.title, "Prepared");
        assert_eq!(saved.scheduled_at.as_deref(), Some("2026-10-20T10:00:00Z"));
        assert_eq!(
            saved.folder_path.as_deref(),
            Some(recording.path().to_string_lossy().as_ref())
        );
        assert_eq!(
            std::fs::read(recording.path().join("audio.mp4")).unwrap(),
            b"keep audio"
        );
        assert_eq!(saved.folder_id, None);
        assert_eq!(
            DocumentsRepository::get(&pool, &note.id)
                .await
                .unwrap()
                .document_type,
            "note"
        );
        assert_eq!(
            MeetingNotesRepository::get(&pool, &meeting.id)
                .await
                .unwrap()
                .unwrap()
                .markdown,
            "Agenda A+B"
        );
        assert_eq!(DocumentsRepository::list(&pool).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn validates_types_schedule_names_and_missing_folder() {
        let pool = test_pool().await;
        assert!(DocumentsRepository::create(&pool, "x", "task", None, None)
            .await
            .is_err());
        assert!(
            DocumentsRepository::create(&pool, " ", "meeting", None, None)
                .await
                .is_err()
        );
        assert!(
            DocumentsRepository::create(&pool, "x", "meeting", Some("tomorrow"), None)
                .await
                .is_err()
        );
        assert!(
            DocumentsRepository::create(&pool, "x", "note", None, Some("missing"))
                .await
                .is_err()
        );
        assert!(DocumentsRepository::create_folder(&pool, " ")
            .await
            .is_err());
        DocumentsRepository::create_folder(&pool, "Work")
            .await
            .unwrap();
        assert!(DocumentsRepository::create_folder(&pool, "work")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn migrates_existing_recordings_and_roundtrips_prepared_notes_after_restart() {
        use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
        let directory = tempfile::tempdir().unwrap();
        let options = SqliteConnectOptions::new()
            .filename(directory.path().join("scratch.sqlite"))
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.clone())
            .await
            .unwrap();
        let migrator = sqlx::migrate!("./migrations");
        // Reproduce a pre-workspace installation, including PR849 note content.
        for migration in migrator.iter().filter(|m| m.version < 20261020000000) {
            sqlx::raw_sql(&migration.sql).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at, folder_path) VALUES ('old', 'Old recording', '2026-01-01', '2026-01-01', '/old/audio')").execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!(
            "../../../migrations/20261020000000_add_workspace_documents.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            DocumentsRepository::get(&pool, "old")
                .await
                .unwrap()
                .document_type,
            "meeting"
        );
        assert!(DocumentsRepository::validate_recording_target(&pool, "old")
            .await
            .is_err());
        let meeting = DocumentsRepository::create(&pool, "Prepared", "meeting", None, None)
            .await
            .unwrap();
        MeetingNotesRepository::upsert(&pool, &meeting.id, "A+B", Some("[]"))
            .await
            .unwrap();
        pool.close().await;
        let reopened = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        assert_eq!(
            DocumentsRepository::get(&reopened, &meeting.id)
                .await
                .unwrap()
                .title,
            "Prepared"
        );
        assert_eq!(
            MeetingNotesRepository::get(&reopened, &meeting.id)
                .await
                .unwrap()
                .unwrap()
                .markdown,
            "A+B"
        );
        assert_eq!(
            DocumentsRepository::get(&reopened, "old")
                .await
                .unwrap()
                .folder_path
                .as_deref(),
            Some("/old/audio")
        );
    }

    #[tokio::test]
    async fn rename_move_unfile_and_failed_removal_are_transactional() {
        let pool = test_pool().await;
        let folder = DocumentsRepository::create_folder(&pool, "Work")
            .await
            .unwrap();
        let renamed = DocumentsRepository::rename_folder(&pool, &folder.id, "Projects")
            .await
            .unwrap();
        assert_eq!(renamed.name, "Projects");
        let note = DocumentsRepository::create(&pool, "Original", "note", None, None)
            .await
            .unwrap();
        let moved = DocumentsRepository::move_document(&pool, &note.id, Some(&folder.id))
            .await
            .unwrap();
        assert_eq!(moved.folder_id.as_deref(), Some(folder.id.as_str()));
        assert!(
            DocumentsRepository::move_document(&pool, &note.id, Some("missing"))
                .await
                .is_err()
        );
        assert_eq!(
            DocumentsRepository::get(&pool, &note.id)
                .await
                .unwrap()
                .folder_id,
            moved.folder_id
        );
        sqlx::query("CREATE TRIGGER fail_folder_delete BEFORE DELETE ON folders BEGIN SELECT RAISE(ABORT, 'simulated failure'); END").execute(&pool).await.unwrap();
        assert!(DocumentsRepository::remove_folder(&pool, &folder.id)
            .await
            .is_err());
        assert_eq!(
            DocumentsRepository::get(&pool, &note.id)
                .await
                .unwrap()
                .folder_id,
            moved.folder_id
        );
        let updated = DocumentsRepository::update(&pool, &note.id, "Edited", None)
            .await
            .unwrap();
        assert_eq!(updated.title, "Edited");
        assert_eq!(
            DocumentsRepository::move_document(&pool, &note.id, None)
                .await
                .unwrap()
                .folder_id,
            None
        );
    }
}

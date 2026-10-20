use crate::api::{SearchMatchSource, TranscriptSearchResult, TranscriptSegment};
use crate::database::repositories::search_snippet;
use chrono::Utc;
use sqlx::{Error as SqlxError, SqlitePool};
use uuid::Uuid;

pub struct TranscriptsRepository;

impl TranscriptsRepository {
    /// Saves a new meeting and its associated transcript segments.
    /// This function uses a transaction to ensure that either both the meeting
    /// and all its transcripts are saved, or none of them are.
    pub async fn save_transcript(
        pool: &SqlitePool,
        meeting_title: &str,
        transcripts: &[TranscriptSegment],
        folder_path: Option<String>,
    ) -> Result<String, SqlxError> {
        Self::save_recording(pool, meeting_title, transcripts, folder_path, None, None).await
    }

    /// Attach once, or acknowledge an already committed session after response loss.
    /// Manual notes and prepared document metadata are never part of this write.
    pub async fn save_recording(
        pool: &SqlitePool,
        meeting_title: &str,
        transcripts: &[TranscriptSegment],
        folder_path: Option<String>,
        target_id: Option<&str>,
        recording_session_id: Option<&str>,
    ) -> Result<String, SqlxError> {
        if target_id.map_or(false, |id| id.trim().is_empty())
            || recording_session_id.map_or(false, |id| id.trim().is_empty())
        {
            return Err(SqlxError::Protocol("Recording IDs cannot be empty".into()));
        }
        let mut transaction = pool.begin().await?;
        if let Some(session_id) = recording_session_id {
            let existing: Option<(String,)> =
                sqlx::query_as("SELECT id FROM meetings WHERE recording_session_id = ?")
                    .bind(session_id)
                    .fetch_optional(&mut *transaction)
                    .await?;
            if let Some((id,)) = existing {
                if target_id.map_or(false, |target| target != id) {
                    return Err(SqlxError::Protocol(
                        "Session belongs to another meeting".into(),
                    ));
                }
                transaction.commit().await?;
                return Ok(id);
            }
        }
        let meeting_id = target_id
            .map(str::to_owned)
            .unwrap_or_else(|| format!("meeting-{}", Uuid::new_v4()));
        // Mark even silent recordings with no audio file as attached.
        let session_id = recording_session_id
            .map(str::to_owned)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now();
        if target_id.is_some() {
            let claimed = sqlx::query(
                "UPDATE meetings SET folder_path = ?, recording_session_id = ?, updated_at = ?
                 WHERE id = ? AND document_type = 'meeting' AND recording_session_id IS NULL AND folder_path IS NULL
                 AND NOT EXISTS (SELECT 1 FROM transcripts WHERE meeting_id = meetings.id)
                 AND NOT EXISTS (SELECT 1 FROM summary_processes WHERE meeting_id = meetings.id)"
            ).bind(&folder_path).bind(&session_id).bind(now).bind(&meeting_id).execute(&mut *transaction).await?;
            if claimed.rows_affected() != 1 {
                return Err(SqlxError::Protocol(
                    "Target is missing, a personal note, or already recorded".into(),
                ));
            }
        } else {
            sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at, folder_path, recording_session_id) VALUES (?, ?, ?, ?, ?, ?)")
                .bind(&meeting_id).bind(meeting_title).bind(now).bind(now).bind(&folder_path).bind(&session_id).execute(&mut *transaction).await?;
        }
        for segment in transcripts {
            sqlx::query(
                "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration)
                 VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(format!("transcript-{}", Uuid::new_v4()))
            .bind(&meeting_id).bind(&segment.text).bind(&segment.timestamp)
            .bind(segment.audio_start_time).bind(segment.audio_end_time).bind(segment.duration)
            .execute(&mut *transaction).await?;
        }
        transaction.commit().await?;
        Ok(meeting_id)
    }

    /// Searches for a query string within the transcripts.
    /// It returns a list of matching transcripts with context.
    pub async fn search_transcripts(
        pool: &SqlitePool,
        query: &str,
    ) -> Result<Vec<TranscriptSearchResult>, SqlxError> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }

        let search_query = format!("%{}%", query.to_lowercase());

        let rows = sqlx::query_as::<_, (String, String, String, String)>(
            "SELECT m.id, m.title, t.transcript, t.timestamp
             FROM meetings m
             JOIN transcripts t ON m.id = t.meeting_id
             WHERE LOWER(t.transcript) LIKE ?",
        )
        .bind(&search_query)
        .fetch_all(pool)
        .await?;

        let results = rows
            .into_iter()
            .map(|(id, title, transcript, timestamp)| {
                let match_context = search_snippet::match_context(&transcript, query);
                TranscriptSearchResult {
                    id,
                    title,
                    match_context,
                    timestamp,
                    source: SearchMatchSource::Transcript,
                }
            })
            .collect();

        Ok(results)
    }
}

#[cfg(test)]
mod workspace_tests {
    use super::*;
    use crate::database::repositories::{
        document::DocumentsRepository,
        meeting_notes::{test_support::test_pool, MeetingNotesRepository},
    };

    #[tokio::test]
    async fn attaches_same_id_preserves_notes_and_replays_after_lost_response() {
        let pool = test_pool().await;
        let meeting = DocumentsRepository::create(
            &pool,
            "Original title",
            "meeting",
            Some("2026-10-20T10:00:00Z"),
            None,
        )
        .await
        .unwrap();
        MeetingNotesRepository::upsert(&pool, &meeting.id, "A", Some("[]"))
            .await
            .unwrap();
        MeetingNotesRepository::upsert(&pool, &meeting.id, "A+B", Some("[]"))
            .await
            .unwrap();
        let segments = vec![TranscriptSegment {
            id: "segment-one".into(),
            text: "spoken".into(),
            timestamp: "00:01".into(),
            audio_start_time: Some(1.0),
            audio_end_time: Some(2.0),
            duration: Some(1.0),
        }];
        let first = TranscriptsRepository::save_recording(
            &pool,
            "Ignored title",
            &segments,
            Some("/recording/session".into()),
            Some(&meeting.id),
            Some("session-one"),
        )
        .await
        .unwrap();
        let replay = TranscriptsRepository::save_recording(
            &pool,
            "Ignored",
            &segments,
            Some("/recording/session".into()),
            Some(&meeting.id),
            Some("session-one"),
        )
        .await
        .unwrap();
        assert_eq!(first, meeting.id);
        assert_eq!(replay, first);
        let saved = DocumentsRepository::get(&pool, &first).await.unwrap();
        assert_eq!(saved.title, "Original title");
        assert_eq!(saved.recording_session_id.as_deref(), Some("session-one"));
        assert_eq!(
            MeetingNotesRepository::get(&pool, &first)
                .await
                .unwrap()
                .unwrap()
                .markdown,
            "A+B"
        );
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM transcripts WHERE meeting_id = ?")
            .bind(&first)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 1);
        assert!(TranscriptsRepository::save_recording(
            &pool,
            "Other",
            &segments,
            None,
            Some(&first),
            Some("session-two")
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn rejects_notes_and_existing_recordings_and_replays_legacy_session() {
        let pool = test_pool().await;
        let note = DocumentsRepository::create(&pool, "Note", "note", None, None)
            .await
            .unwrap();
        assert!(TranscriptsRepository::save_recording(
            &pool,
            "x",
            &[],
            None,
            Some(&note.id),
            Some("s")
        )
        .await
        .is_err());
        let id = TranscriptsRepository::save_recording(
            &pool,
            "Legacy",
            &[],
            Some("/audio".into()),
            None,
            Some("legacy-session"),
        )
        .await
        .unwrap();
        assert_eq!(
            TranscriptsRepository::save_recording(
                &pool,
                "Legacy",
                &[],
                Some("/audio".into()),
                None,
                Some("legacy-session")
            )
            .await
            .unwrap(),
            id
        );
        assert!(DocumentsRepository::validate_recording_target(&pool, &id)
            .await
            .is_err());
        assert!(
            TranscriptsRepository::save_recording(&pool, "x", &[], None, Some(&id), None)
                .await
                .is_err()
        );
    }
}

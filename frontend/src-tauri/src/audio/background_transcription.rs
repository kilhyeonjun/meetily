//! Finishing a stopped recording's transcription in the background.
//!
//! Stop no longer waits for the transcription backlog: it detaches the recording's
//! [`TranscriptionSession`], saves the audio and returns, so the user can start the next
//! recording right away. This module drains the detached task, writes the late segments to
//! `transcripts.json`, appends them to the meeting once the frontend has saved it, and emits
//! `recording-transcripts-finalized`.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use log::{error, info, warn};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::task::JoinHandle;

use super::recording_saver::{append_transcript_segments, TranscriptSegment as FileSegment};
use super::transcription::{TranscriptUpdate, TranscriptionSession};
use crate::api::TranscriptSegment as DbSegment;
use crate::database::repositories::transcript::TranscriptsRepository;
use crate::state::AppState;

/// Detached tasks still transcribing. They use the shared model and their results are not
/// on disk yet, so quitting or unloading the model must wait for them.
static TRANSCRIBING: AtomicUsize = AtomicUsize::new(0);

/// Sessions whose late segments are not in the database yet.
static PENDING_SESSIONS: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

/// How long late segments wait for the frontend to save the meeting row.
const MEETING_SAVE_WAIT: Duration = Duration::from_secs(600);

pub fn transcribing() -> bool {
    TRANSCRIBING.load(Ordering::SeqCst) > 0
}

fn pending_sessions() -> std::sync::MutexGuard<'static, HashSet<String>> {
    PENDING_SESSIONS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Registration of one stopped recording, taken before Stop clears the recording flags so the
/// quit guard never sees a gap.
pub(crate) struct BackgroundTicket {
    recording_session_id: Option<String>,
    transcribing: bool,
}

impl BackgroundTicket {
    pub(crate) fn register(recording_session_id: Option<String>) -> Self {
        TRANSCRIBING.fetch_add(1, Ordering::SeqCst);
        if let Some(id) = &recording_session_id {
            pending_sessions().insert(id.clone());
        }
        Self { recording_session_id, transcribing: true }
    }

    fn transcription_done(&mut self) {
        if std::mem::take(&mut self.transcribing) {
            TRANSCRIBING.fetch_sub(1, Ordering::SeqCst);
        }
    }
}

impl Drop for BackgroundTicket {
    fn drop(&mut self) {
        self.transcription_done();
        if let Some(id) = &self.recording_session_id {
            pending_sessions().remove(id);
        }
    }
}

/// Drain `task` in the background and persist what it transcribes after Stop.
/// `task` is `None` when it already finished during Stop; its tail is still persisted.
pub(crate) fn spawn<R: Runtime>(
    app: AppHandle<R>,
    task: Option<JoinHandle<()>>,
    session: Arc<TranscriptionSession>,
    ticket: BackgroundTicket,
    folder: Option<PathBuf>,
) {
    tauri::async_runtime::spawn(finish(app, task, session, ticket, folder));
}

async fn finish<R: Runtime>(
    app: AppHandle<R>,
    task: Option<JoinHandle<()>>,
    session: Arc<TranscriptionSession>,
    mut ticket: BackgroundTicket,
    folder: Option<PathBuf>,
) {
    if let Some(task) = task {
        if task.await.is_err() {
            error!("Background transcription task panicked");
        }
    }
    let tail = session.take_tail();
    info!("Background transcription finished; {} segments after stop", tail.len());

    if let (Some(folder), false) = (&folder, tail.is_empty()) {
        let segments: Vec<FileSegment> = tail.iter().map(file_segment).collect();
        if let Err(e) = append_transcript_segments(folder, &segments) {
            error!("Failed to add late segments to transcripts.json: {}", e);
        }
    }
    ticket.transcription_done();
    super::common::unload_engine_when_idle(&app).await;

    let recording_session_id = ticket.recording_session_id.clone();
    let meeting_id = match &recording_session_id {
        Some(session_id) => attach_to_meeting(&app, session_id, &tail).await,
        None => None,
    };
    let added = if meeting_id.is_some() { tail.len() } else { 0 };
    drop(ticket);

    let _ = app.emit(
        "recording-transcripts-finalized",
        serde_json::json!({
            "recording_session_id": recording_session_id,
            "meeting_id": meeting_id,
            "added_segments": added,
        }),
    );
}

/// Append `tail` to the meeting saved for `session_id`, waiting for the frontend's save.
async fn attach_to_meeting<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    tail: &[TranscriptUpdate],
) -> Option<String> {
    let state = app.try_state::<AppState>()?;
    let pool = state.db_manager.pool();
    let deadline = tokio::time::Instant::now() + MEETING_SAVE_WAIT;
    let meeting_id = loop {
        match TranscriptsRepository::meeting_for_session(pool, session_id).await {
            Ok(Some(id)) => break id,
            Ok(None) if tail.is_empty() => return None,
            Ok(None) if tokio::time::Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            Ok(None) => {
                warn!("Meeting for a stopped recording was not saved within {:?}; late segments stay in transcripts.json", MEETING_SAVE_WAIT);
                return None;
            }
            Err(e) => {
                error!("Failed to look up meeting for late segments: {}", e);
                return None;
            }
        }
    };
    if tail.is_empty() {
        return Some(meeting_id);
    }
    let segments: Vec<DbSegment> = tail.iter().map(db_segment).collect();
    match TranscriptsRepository::append_to_meeting(pool, &meeting_id, &segments).await {
        Ok(()) => {
            info!("Added {} late segments to the saved meeting", segments.len());
            Some(meeting_id)
        }
        Err(e) => {
            error!("Failed to add late segments to the meeting: {}", e);
            None
        }
    }
}

fn file_segment(update: &TranscriptUpdate) -> FileSegment {
    FileSegment {
        id: format!("seg_{}", update.sequence_id),
        text: update.text.clone(),
        audio_start_time: update.audio_start_time,
        audio_end_time: update.audio_end_time,
        duration: update.duration,
        display_time: update.timestamp.clone(),
        confidence: update.confidence,
        sequence_id: update.sequence_id,
    }
}

fn db_segment(update: &TranscriptUpdate) -> DbSegment {
    DbSegment {
        id: format!("seg_{}", update.sequence_id),
        text: update.text.clone(),
        timestamp: update.timestamp.clone(),
        audio_start_time: Some(update.audio_start_time),
        audio_end_time: Some(update.audio_end_time),
        duration: Some(update.duration),
    }
}

/// Whether a meeting still waits for segments transcribed after its recording stopped.
#[tauri::command]
pub async fn is_background_transcription_pending(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<bool, String> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT recording_session_id FROM meetings WHERE id = ?")
            .bind(&meeting_id)
            .fetch_optional(state.db_manager.pool())
            .await
            .map_err(|e| e.to_string())?;
    Ok(match row {
        Some((Some(session_id),)) => pending_sessions().contains(&session_id),
        _ => false,
    })
}

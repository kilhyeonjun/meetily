use crate::{database::repositories::document::DocumentsRepository, state::AppState};
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime, State};

/// Resolve from native storage; the WebView cannot grant itself arbitrary paths.
#[tauri::command]
pub async fn get_meeting_audio_path<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    meeting_id: String,
) -> Result<Option<String>, String> {
    let meeting = DocumentsRepository::get(state.db_manager.pool(), &meeting_id)
        .await
        .map_err(|error| format!("Cannot load meeting audio: {}", error))?;
    let file = super::playback_path::resolve_meeting_audio(
        &meeting.document_type,
        meeting.folder_path.as_deref().map(Path::new),
    )?;
    match file {
        Some(file) => {
            app.asset_protocol_scope()
                .allow_file(&file)
                .map_err(|error| format!("Cannot allow recording playback: {}", error))?;
            Ok(Some(file.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

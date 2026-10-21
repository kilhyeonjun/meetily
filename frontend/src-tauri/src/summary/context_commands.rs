use super::context::{self, ContextText, MeetingSummaryContext};
use crate::state::AppState;

#[tauri::command]
pub async fn api_get_meeting_summary_context(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<MeetingSummaryContext, String> {
    context::get_meeting_context(state.db_manager.pool(), &meeting_id).await
}
#[tauri::command]
pub async fn api_save_meeting_summary_context(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    context: String,
    use_inherited: bool,
) -> Result<(), String> {
    context::save_meeting_context(
        state.db_manager.pool(),
        &meeting_id,
        &context,
        use_inherited,
    )
    .await
}
#[tauri::command]
pub async fn api_get_global_summary_context(
    state: tauri::State<'_, AppState>,
) -> Result<ContextText, String> {
    context::get_global_context(state.db_manager.pool()).await
}
#[tauri::command]
pub async fn api_save_global_summary_context(
    state: tauri::State<'_, AppState>,
    context: String,
) -> Result<(), String> {
    context::save_global_context(state.db_manager.pool(), &context).await
}

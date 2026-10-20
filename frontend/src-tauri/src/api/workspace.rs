use crate::database::repositories::document::{DocumentInfo, DocumentsRepository, Folder};
use crate::state::AppState;
use tauri::{AppHandle, Emitter, Runtime, State};

pub(crate) fn documents_changed<R: Runtime>(app: &AppHandle<R>) {
    // A notification failure must not turn a committed write into an IPC error.
    let _ = app.emit("documents-updated", ());
    let _ = app.emit("meetings-updated", ());
}

#[tauri::command]
pub async fn api_create_document<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    title: String,
    document_type: String,
    scheduled_at: Option<String>,
    folder_id: Option<String>,
) -> Result<DocumentInfo, String> {
    let result = DocumentsRepository::create(
        state.db_manager.pool(),
        &title,
        &document_type,
        scheduled_at.as_deref(),
        folder_id.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;
    documents_changed(&app);
    Ok(result)
}

#[tauri::command]
pub async fn api_get_documents(state: State<'_, AppState>) -> Result<Vec<DocumentInfo>, String> {
    DocumentsRepository::list(state.db_manager.pool())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_get_document(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<DocumentInfo, String> {
    DocumentsRepository::get(state.db_manager.pool(), &document_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_update_document<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    document_id: String,
    title: String,
    scheduled_at: Option<String>,
) -> Result<DocumentInfo, String> {
    let result = DocumentsRepository::update(
        state.db_manager.pool(),
        &document_id,
        &title,
        scheduled_at.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;
    documents_changed(&app);
    Ok(result)
}

#[tauri::command]
pub async fn api_get_folders(state: State<'_, AppState>) -> Result<Vec<Folder>, String> {
    DocumentsRepository::folders(state.db_manager.pool())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_create_folder<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    name: String,
) -> Result<Folder, String> {
    let result = DocumentsRepository::create_folder(state.db_manager.pool(), &name)
        .await
        .map_err(|e| e.to_string())?;
    documents_changed(&app);
    Ok(result)
}

#[tauri::command]
pub async fn api_rename_folder<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    folder_id: String,
    name: String,
) -> Result<Folder, String> {
    let result = DocumentsRepository::rename_folder(state.db_manager.pool(), &folder_id, &name)
        .await
        .map_err(|e| e.to_string())?;
    documents_changed(&app);
    Ok(result)
}

#[tauri::command]
pub async fn api_remove_folder<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    folder_id: String,
) -> Result<(), String> {
    DocumentsRepository::remove_folder(state.db_manager.pool(), &folder_id)
        .await
        .map_err(|e| e.to_string())?;
    documents_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn api_move_document<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    document_id: String,
    folder_id: Option<String>,
) -> Result<DocumentInfo, String> {
    let result = DocumentsRepository::move_document(
        state.db_manager.pool(),
        &document_id,
        folder_id.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;
    documents_changed(&app);
    Ok(result)
}

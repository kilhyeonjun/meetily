use anyhow::Result;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use crate::database::repositories::setting::SettingsRepository;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OnboardingStatus {
    pub version: String,
    pub completed: bool,
    #[serde(default)]
    pub workspace_ready: bool,
    pub current_step: u8,
    pub model_status: ModelStatus,
    pub last_updated: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ModelStatus {
    pub parakeet: String, // "downloaded" | "not_downloaded" | "downloading"
    pub summary: String,  // Generic field for summary model (Qwen 3.5 or legacy Gemma variants)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_summary_model: Option<String>,
}

impl Default for OnboardingStatus {
    fn default() -> Self {
        Self {
            version: "1.0".to_string(),
            completed: false,
            workspace_ready: false,
            current_step: 1,
            model_status: ModelStatus {
                parakeet: "not_downloaded".to_string(),
                summary: "not_downloaded".to_string(), // Changed from gemma
                selected_summary_model: None,
            },
            last_updated: chrono::Utc::now().to_rfc3339(),
        }
    }
}

// Serialize read/merge/write so an older frontend autosave cannot revoke notes
// access after the dedicated command succeeds. Explicit reset remains supported.
static ONBOARDING_WRITE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn retain_workspace_access(status: &mut OnboardingStatus, stored: Option<&serde_json::Value>) {
    status.workspace_ready |= stored
        .and_then(|value| value.get("workspace_ready"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
}

async fn prepare_notes_workspace(
    pool: &sqlx::SqlitePool,
    status: &mut OnboardingStatus,
) -> Result<()> {
    // Readiness is a usable migrated workspace schema, independent of models.
    sqlx::query("SELECT id FROM meetings LIMIT 0")
        .execute(pool)
        .await?;
    status.workspace_ready = true;
    Ok(())
}

#[tauri::command]
pub async fn enable_notes_workspace(app: AppHandle) -> Result<OnboardingStatus, String> {
    use tauri::Manager;
    if app.try_state::<AppState>().is_none() {
        let db_manager = crate::database::manager::DatabaseManager::new_from_app_handle(&app)
            .await
            .map_err(|error| format!("Failed to initialize notes workspace: {}", error))?;
        app.manage(AppState { db_manager });
    }
    let state = app
        .try_state::<AppState>()
        .ok_or("Workspace database is not initialized")?;
    let mut status = load_onboarding_status(&app)
        .await
        .map_err(|error| format!("Failed to load onboarding status: {}", error))?;
    prepare_notes_workspace(state.db_manager.pool(), &mut status)
        .await
        .map_err(|error| format!("Workspace database is not ready: {}", error))?;
    save_onboarding_status(&app, &status)
        .await
        .map_err(|error| format!("Failed to save notes workspace readiness: {}", error))?;
    Ok(status)
}

/// Load onboarding status from store
pub async fn load_onboarding_status<R: Runtime>(app: &AppHandle<R>) -> Result<OnboardingStatus> {
    // Try to load from Tauri store
    let store = match app.store("onboarding-status.json") {
        Ok(store) => store,
        Err(e) => {
            warn!("Failed to access onboarding store: {}, using defaults", e);
            return Ok(OnboardingStatus::default());
        }
    };

    // Try to get the status from store
    let status = if let Some(value) = store.get("status") {
        match serde_json::from_value::<OnboardingStatus>(value.clone()) {
            Ok(s) => {
                info!(
                    "Loaded onboarding status from store - Step: {}, Completed: {}",
                    s.current_step, s.completed
                );
                s
            }
            Err(e) => {
                warn!(
                    "Failed to deserialize onboarding status: {}, using defaults",
                    e
                );
                OnboardingStatus::default()
            }
        }
    } else {
        info!("No stored onboarding status found, using defaults");
        OnboardingStatus::default()
    };

    Ok(status)
}

/// Save onboarding status to store
pub async fn save_onboarding_status<R: Runtime>(
    app: &AppHandle<R>,
    status: &OnboardingStatus,
) -> Result<()> {
    let _write_guard = ONBOARDING_WRITE_LOCK.lock().await;
    info!(
        "Saving onboarding status: step={}, completed={}",
        status.current_step, status.completed
    );

    // Get or create store
    let store = app
        .store("onboarding-status.json")
        .map_err(|e| anyhow::anyhow!("Failed to access onboarding store: {}", e))?;

    // Update last_updated timestamp
    let mut status = status.clone();
    retain_workspace_access(&mut status, store.get("status").as_ref());
    status.last_updated = chrono::Utc::now().to_rfc3339();

    // Serialize status to JSON value
    let status_value = serde_json::to_value(&status)
        .map_err(|e| anyhow::anyhow!("Failed to serialize onboarding status: {}", e))?;

    // Save to store
    store.set("status", status_value);

    // Persist to disk
    store
        .save()
        .map_err(|e| anyhow::anyhow!("Failed to save onboarding store to disk: {}", e))?;

    info!("Successfully persisted onboarding status to disk");
    Ok(())
}

/// Reset onboarding status (delete from store)
pub async fn reset_onboarding_status<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let _write_guard = ONBOARDING_WRITE_LOCK.lock().await;
    info!("Resetting onboarding status");

    let store = app
        .store("onboarding-status.json")
        .map_err(|e| anyhow::anyhow!("Failed to access onboarding store: {}", e))?;

    // Clear the status key
    store.delete("status");

    // Persist deletion to disk
    store
        .save()
        .map_err(|e| anyhow::anyhow!("Failed to save onboarding store after reset: {}", e))?;

    info!("Successfully reset onboarding status");
    Ok(())
}

/// Tauri commands for onboarding status
#[tauri::command]
pub async fn get_onboarding_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<OnboardingStatus>, String> {
    let status = load_onboarding_status(&app)
        .await
        .map_err(|e| format!("Failed to load onboarding status: {}", e))?;

    // Return None if it's the default (never saved before)
    // Check if we have any saved data by seeing if the store has the key
    let store = app
        .store("onboarding-status.json")
        .map_err(|e| format!("Failed to access store: {}", e))?;

    if store.get("status").is_none() {
        Ok(None)
    } else {
        Ok(Some(status))
    }
}

#[tauri::command]
pub async fn save_onboarding_status_cmd<R: Runtime>(
    app: AppHandle<R>,
    status: OnboardingStatus,
) -> Result<(), String> {
    save_onboarding_status(&app, &status)
        .await
        .map_err(|e| format!("Failed to save onboarding status: {}", e))
}

#[tauri::command]
pub async fn reset_onboarding_status_cmd<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    reset_onboarding_status(&app)
        .await
        .map_err(|e| format!("Failed to reset onboarding status: {}", e))
}

#[tauri::command]
pub async fn complete_onboarding<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    model: String,
) -> Result<(), String> {
    info!("Completing onboarding with builtin-ai model: {}", model);

    // Step 1: Save model configuration to SQLite database FIRST
    let pool = state.db_manager.pool();

    // Onboarding always uses builtin-ai (local LLM)
    if let Err(e) =
        SettingsRepository::save_model_config(pool, "builtin-ai", &model, "large-v3", None).await
    {
        error!("Failed to save builtin-ai model config: {}", e);
        return Err(format!("Failed to save builtin-ai model config: {}", e));
    }
    info!("Saved builtin-ai model config: model={}", model);

    // Save transcription model config (parakeet provider) - always parakeet
    if let Err(e) = SettingsRepository::save_transcript_config(
        pool,
        "parakeet",
        crate::config::DEFAULT_PARAKEET_MODEL,
    )
    .await
    {
        error!("Failed to save transcription model config: {}", e);
        return Err(format!("Failed to save transcription model config: {}", e));
    }
    info!(
        "Saved transcription model config: provider=parakeet, model={}",
        crate::config::DEFAULT_PARAKEET_MODEL
    );

    // Step 2: Only NOW mark onboarding as complete (after DB operations succeed)
    let mut status = load_onboarding_status(&app)
        .await
        .map_err(|e| format!("Failed to load onboarding status: {}", e))?;

    status.completed = true;
    status.current_step = 4; // Max step (4 on macOS with permissions, 3 on other platforms)
    status.model_status.parakeet = "downloaded".to_string();
    status.model_status.summary = "downloaded".to_string();
    status.model_status.selected_summary_model = Some(model.clone());

    save_onboarding_status(&app, &status)
        .await
        .map_err(|e| format!("Failed to save completed onboarding status: {}", e))?;

    info!("Onboarding completed successfully with model: {}", model);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn onboarding_status_deserializes_without_selected_summary_model() {
        let status: OnboardingStatus = serde_json::from_str(
            r#"{
                "version": "1.0",
                "completed": true,
                "current_step": 4,
                "model_status": {
                    "parakeet": "downloaded",
                    "summary": "downloaded"
                },
                "last_updated": "2026-05-30T00:00:00Z"
            }"#,
        )
        .expect("old onboarding status should remain compatible");

        assert_eq!(status.model_status.selected_summary_model, None);
        assert!(!status.workspace_ready);
    }

    #[tokio::test]
    async fn notes_workspace_transition_preserves_model_setup_and_recording_guard() {
        let pool = crate::database::repositories::meeting_notes::test_support::test_pool().await;
        sqlx::query("INSERT INTO settings (id, provider, model, whisperModel) VALUES ('keep', 'custom', 'keep-summary', 'keep-whisper')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO transcript_settings (id, provider, model) VALUES ('keep', 'custom-stt', 'keep-transcription')").execute(&pool).await.unwrap();
        let mut status = OnboardingStatus::default();
        status.current_step = 2;
        status.model_status.parakeet = "downloading".into();
        let before = serde_json::to_value(&status).unwrap();
        prepare_notes_workspace(&pool, &mut status).await.unwrap();
        assert!(status.workspace_ready);
        assert!(!status.completed);
        let after = serde_json::to_value(&status).unwrap();
        for key in [
            "version",
            "completed",
            "current_step",
            "model_status",
            "last_updated",
        ] {
            assert_eq!(after[key], before[key], "notes access must preserve {key}");
        }
        let settings: Vec<(String, String, String)> =
            sqlx::query_as("SELECT provider, model, whisperModel FROM settings")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            settings,
            vec![(
                "custom".into(),
                "keep-summary".into(),
                "keep-whisper".into()
            )]
        );
        let transcription: Vec<(String, String)> =
            sqlx::query_as("SELECT provider, model FROM transcript_settings")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            transcription,
            vec![("custom-stt".into(), "keep-transcription".into())]
        );
        let restored: OnboardingStatus = serde_json::from_value(after).unwrap();
        assert!(restored.workspace_ready);
        assert!(!restored.completed);
    }

    #[tokio::test]
    async fn failed_database_readiness_never_grants_workspace_access() {
        let pool = crate::database::repositories::meeting_notes::test_support::test_pool().await;
        pool.close().await;
        let mut status = OnboardingStatus::default();
        assert!(prepare_notes_workspace(&pool, &mut status).await.is_err());
        assert!(!status.workspace_ready);
        assert!(!status.completed);
        assert_eq!(status.model_status.parakeet, "not_downloaded");
        assert_eq!(status.model_status.summary, "not_downloaded");
    }

    #[test]
    fn stale_frontend_status_cannot_revoke_notes_access_or_complete_recording_setup() {
        let stored = serde_json::json!({"workspace_ready": true});
        let mut stale = OnboardingStatus::default();
        retain_workspace_access(&mut stale, Some(&stored));
        assert!(stale.workspace_ready);
        assert!(!stale.completed);
        assert_eq!(stale.current_step, 1);
        assert_eq!(stale.model_status.parakeet, "not_downloaded");
        assert_eq!(stale.model_status.summary, "not_downloaded");
        let mut fresh = OnboardingStatus::default();
        retain_workspace_access(&mut fresh, None);
        assert!(!fresh.workspace_ready);
    }
}

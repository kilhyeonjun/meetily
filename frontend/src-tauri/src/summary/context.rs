//! Global/meeting context composition adapted from upstream PR #848.
use crate::database::repositories::summary_context::{
    SummaryContextRepository, MAX_SUMMARY_CONTEXT_CHARS,
};
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InheritedContext {
    pub scope: String,
    pub scope_id: String,
    pub label: Option<String>,
    pub context: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSummaryContext {
    pub context: String,
    pub use_inherited: bool,
    pub inherited: Vec<InheritedContext>,
}

#[derive(Debug, Serialize)]
pub struct ContextText {
    pub context: String,
}

pub async fn get_global_context(pool: &SqlitePool) -> Result<ContextText, String> {
    let row = SummaryContextRepository::get(pool, "global", "")
        .await
        .map_err(|e| e.to_string())?;
    Ok(ContextText {
        context: row.map(|r| r.context).unwrap_or_default(),
    })
}

pub async fn get_meeting_context(
    pool: &SqlitePool,
    meeting_id: &str,
) -> Result<MeetingSummaryContext, String> {
    sqlx::query("SELECT id FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    let row = SummaryContextRepository::get(pool, "meeting", meeting_id)
        .await
        .map_err(|e| e.to_string())?;
    let global = get_global_context(pool).await?;
    let inherited = if global.context.trim().is_empty() {
        vec![]
    } else {
        vec![InheritedContext {
            scope: "global".into(),
            scope_id: String::new(),
            label: None,
            context: global.context,
        }]
    };
    Ok(MeetingSummaryContext {
        context: row.as_ref().map(|r| r.context.clone()).unwrap_or_default(),
        use_inherited: row.map(|r| r.use_inherited).unwrap_or(true),
        inherited,
    })
}

pub async fn save_global_context(pool: &SqlitePool, context: &str) -> Result<(), String> {
    SummaryContextRepository::save(pool, "global", "", context, true)
        .await
        .map_err(|e| e.to_string())
}

pub async fn save_meeting_context(
    pool: &SqlitePool,
    meeting_id: &str,
    context: &str,
    use_inherited: bool,
) -> Result<(), String> {
    SummaryContextRepository::save(pool, "meeting", meeting_id, context, use_inherited)
        .await
        .map_err(|e| e.to_string())
}

pub async fn resolve_for_run(
    pool: &SqlitePool,
    meeting_id: &str,
    custom_prompt: Option<&str>,
    use_inherited: Option<bool>,
) -> Result<String, String> {
    let saved = SummaryContextRepository::get(pool, "meeting", meeting_id)
        .await
        .map_err(|e| format!("Cannot load summary context: {e}"))?;
    let meeting_text =
        custom_prompt.unwrap_or_else(|| saved.as_ref().map(|r| r.context.as_str()).unwrap_or(""));
    if meeting_text.chars().count() > MAX_SUMMARY_CONTEXT_CHARS {
        return Err("Summary context limit is 4000 Unicode characters".into());
    }
    if !use_inherited.unwrap_or_else(|| saved.as_ref().map(|r| r.use_inherited).unwrap_or(true)) {
        return Ok(meeting_text.to_owned());
    }
    let global = get_global_context(pool).await?;
    if global.context.trim().is_empty() {
        return Ok(meeting_text.to_owned());
    }
    let mut composed = format!(
        "General context (applies to every meeting):\n{}",
        global.context.trim()
    );
    if !meeting_text.trim().is_empty() {
        composed.push_str(&format!("\n\nContext for this meeting:\n{}\n\nIf these conflict, this meeting's context takes priority over the general context.", meeting_text.trim()));
    }
    Ok(composed)
}

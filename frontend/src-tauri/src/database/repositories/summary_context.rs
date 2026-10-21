//! Adapted from upstream PR #848, pinned at 367c45f9229f265040203d2abe2f48dbbc8b27c4.
use chrono::Utc;
use sqlx::{FromRow, SqlitePool};

pub const MAX_SUMMARY_CONTEXT_CHARS: usize = 4000;

#[derive(Debug, FromRow)]
pub struct SummaryContextRow {
    pub context: String,
    pub use_inherited: bool,
}

pub struct SummaryContextRepository;
impl SummaryContextRepository {
    pub async fn get(
        pool: &SqlitePool,
        scope: &str,
        scope_id: &str,
    ) -> Result<Option<SummaryContextRow>, sqlx::Error> {
        sqlx::query_as(
            "SELECT context, use_inherited FROM summary_contexts WHERE scope = ? AND scope_id = ?",
        )
        .bind(scope)
        .bind(scope_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn save(
        pool: &SqlitePool,
        scope: &str,
        scope_id: &str,
        context: &str,
        use_inherited: bool,
    ) -> Result<(), sqlx::Error> {
        if context.chars().count() > MAX_SUMMARY_CONTEXT_CHARS {
            return Err(sqlx::Error::Protocol(
                "Summary context limit is 4000 Unicode characters".into(),
            ));
        }
        let mut tx = pool.begin().await?;
        if scope == "meeting" {
            sqlx::query("SELECT id FROM meetings WHERE id = ? AND document_type = 'meeting'")
                .bind(scope_id)
                .fetch_one(&mut *tx)
                .await?;
        }
        let now = Utc::now();
        sqlx::query("INSERT INTO summary_contexts (scope, scope_id, context, use_inherited, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(scope, scope_id) DO UPDATE SET
            context=excluded.context, use_inherited=excluded.use_inherited, updated_at=excluded.updated_at")
            .bind(scope).bind(scope_id).bind(context).bind(use_inherited).bind(now).bind(now).execute(&mut *tx).await?;
        tx.commit().await
    }
}

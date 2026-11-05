use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyInput {
    pub id: Option<String>,
    pub kind: String,
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct DocumentProperty {
    pub id: String,
    pub meeting_id: String,
    pub kind: String,
    pub label: String,
    pub value: String,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

pub struct DocumentPropertiesRepository;

fn invalid(message: &str) -> sqlx::Error {
    sqlx::Error::Protocol(message.to_owned())
}

pub fn user_message(error: sqlx::Error) -> String {
    match error {
        sqlx::Error::Protocol(message) => message,
        sqlx::Error::RowNotFound => "Document not found".to_owned(),
        other => other.to_string(),
    }
}

impl DocumentPropertiesRepository {
    pub async fn list(pool: &SqlitePool, meeting_id: &str) -> Result<Vec<DocumentProperty>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM document_properties WHERE meeting_id = ? ORDER BY position, id")
            .bind(meeting_id).fetch_all(pool).await
    }

    pub async fn replace(pool: &SqlitePool, meeting_id: &str, properties: Vec<PropertyInput>) -> Result<Vec<DocumentProperty>, sqlx::Error> {
        if properties.len() > 50 {
            return Err(invalid("At most 50 properties are allowed"));
        }
        for property in &properties {
            let label = property.label.trim();
            let value = property.value.trim();
            if label.is_empty() || label.chars().count() > 80 {
                return Err(invalid("Property label must contain 1–80 characters"));
            }
            if value.is_empty() || value.chars().count() > 2048 {
                return Err(invalid("Property value must contain 1–2048 characters"));
            }
            match property.kind.as_str() {
                "text" => (),
                "url" => {
                    let parsed = url::Url::parse(value).map_err(|_| invalid("Property URL must be an HTTP or HTTPS URL"))?;
                    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
                        return Err(invalid("Property URL must be an HTTP or HTTPS URL"));
                    }
                },
                _ => return Err(invalid("Invalid property kind")),
            }
        }
        let mut tx = pool.begin().await?;
        let found = sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
            .bind(Utc::now().to_rfc3339()).bind(meeting_id).execute(&mut *tx).await?;
        if found.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }
        let mut previous: HashMap<String, String> = sqlx::query_as::<_, (String, String)>(
            "SELECT id, created_at FROM document_properties WHERE meeting_id = ?",
        ).bind(meeting_id).fetch_all(&mut *tx).await?.into_iter().collect();
        sqlx::query("DELETE FROM document_properties WHERE meeting_id = ?")
            .bind(meeting_id).execute(&mut *tx).await?;
        let now = Utc::now().to_rfc3339();
        for (position, property) in properties.into_iter().enumerate() {
            let (id, created_at) = match property.id {
                Some(id) => match previous.remove(&id) {
                    Some(created_at) => (id, created_at),
                    None => (Uuid::new_v4().to_string(), now.clone()),
                },
                None => (Uuid::new_v4().to_string(), now.clone()),
            };
            sqlx::query("INSERT INTO document_properties (id, meeting_id, kind, label, value, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(id).bind(meeting_id).bind(property.kind)
                .bind(property.label.trim()).bind(property.value.trim()).bind(position as i64)
                .bind(created_at).bind(&now).execute(&mut *tx).await?;
        }
        let stored = sqlx::query_as("SELECT * FROM document_properties WHERE meeting_id = ? ORDER BY position, id")
            .bind(meeting_id).fetch_all(&mut *tx).await?;
        tx.commit().await?;
        Ok(stored)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::repositories::{document::DocumentsRepository, meeting_notes::test_support::test_pool};

    fn input(kind: &str, label: &str, value: &str) -> PropertyInput {
        PropertyInput { id: None, kind: kind.into(), label: label.into(), value: value.into() }
    }

    #[tokio::test]
    async fn roundtrip_order_replace_and_cascade() {
        let pool = test_pool().await;
        let doc = DocumentsRepository::create(&pool, "Meeting", "meeting", None, None).await.unwrap();
        let result = DocumentPropertiesRepository::replace(&pool, &doc.id, vec![input("url", " Notion ", " https://notion.so/meeting "), input("text", "Owner", " Me ")]).await.unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].label, "Notion");
        assert_eq!(result[0].value, "https://notion.so/meeting");
        assert_eq!(result[1].position, 1);
        assert_eq!(result[1].value, "Me");
        let listed = DocumentPropertiesRepository::list(&pool, &doc.id).await.unwrap();
        assert_eq!(listed[0].id, result[0].id);
        assert_eq!(listed[1].label, "Owner");
        DocumentPropertiesRepository::replace(&pool, &doc.id, vec![input("text", "Next", "Value")]).await.unwrap();
        assert_eq!(DocumentPropertiesRepository::list(&pool, &doc.id).await.unwrap().len(), 1);
        sqlx::query("DELETE FROM meetings WHERE id = ?").bind(&doc.id).execute(&pool).await.unwrap();
        assert!(DocumentPropertiesRepository::list(&pool, &doc.id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn rejects_invalid_values_without_replacing_existing_rows() {
        let pool = test_pool().await;
        let doc = DocumentsRepository::create(&pool, "Note", "note", None, None).await.unwrap();
        DocumentPropertiesRepository::replace(&pool, &doc.id, vec![input("text", "Keep", "Original")]).await.unwrap();
        for property in [input("text", " ", "value"), input("text", &"x".repeat(81), "value"), input("text", "Label", " "), input("text", "Label", &"x".repeat(2049)), input("url", "Link", "not a url"), input("url", "Link", "javascript:alert(1)"), input("url", "Link", "ftp://example.com"), input("other", "Label", "Value")] {
            assert!(DocumentPropertiesRepository::replace(&pool, &doc.id, vec![property]).await.is_err());
        }
        assert!(DocumentPropertiesRepository::replace(&pool, &doc.id, vec![input("text", "Label", "Value"); 51]).await.is_err());
        assert!(DocumentPropertiesRepository::replace(&pool, "missing", vec![]).await.is_err());
        assert_eq!(DocumentPropertiesRepository::list(&pool, &doc.id).await.unwrap()[0].value, "Original");
        assert!(DocumentPropertiesRepository::replace(&pool, &doc.id, vec![]).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn preserves_owned_ids_and_creation_times_only_once() {
        let pool = test_pool().await;
        let first = DocumentsRepository::create(&pool, "First", "meeting", None, None).await.unwrap();
        let second = DocumentsRepository::create(&pool, "Second", "note", None, None).await.unwrap();
        let saved = DocumentPropertiesRepository::replace(&pool, &first.id, vec![input("text", "Owner", "Team")]).await.unwrap().remove(0);
        sqlx::query("UPDATE document_properties SET created_at = '2020-01-01' WHERE id = ?").bind(&saved.id).execute(&pool).await.unwrap();
        let mut edited = input("text", "Owner", "New team");
        edited.id = Some(saved.id.clone());
        let foreign = DocumentPropertiesRepository::replace(&pool, &second.id, vec![edited.clone()]).await.unwrap();
        assert_ne!(foreign[0].id, saved.id);
        let replaced = DocumentPropertiesRepository::replace(&pool, &first.id, vec![edited.clone(), edited]).await.unwrap();
        assert_eq!(replaced[0].id, saved.id);
        assert_eq!(replaced[0].created_at, "2020-01-01");
        assert_eq!(replaced[0].value, "New team");
        assert_ne!(replaced[1].id, saved.id);
        assert_ne!(replaced[1].created_at, "2020-01-01");
    }

    #[test]
    fn validation_and_not_found_messages_are_plain() {
        assert_eq!(user_message(invalid("Invalid property kind")), "Invalid property kind");
        assert_eq!(user_message(sqlx::Error::RowNotFound), "Document not found");
    }

    #[tokio::test]
    async fn migration_preserves_existing_document() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await.unwrap();
        let migrator = sqlx::migrate!("./migrations");
        for migration in migrator.iter().filter(|m| m.version < 20261105000000) {
            sqlx::raw_sql(&migration.sql).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at, folder_path) VALUES ('existing', 'Unchanged', '2026-01-01', '2026-01-01', '/existing/audio')").execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../../../migrations/20261105000000_document_properties.sql")).execute(&pool).await.unwrap();
        let title: String = sqlx::query_scalar("SELECT title FROM meetings WHERE id = 'existing'").fetch_one(&pool).await.unwrap();
        assert_eq!(title, "Unchanged");
        assert!(DocumentPropertiesRepository::list(&pool, "existing").await.unwrap().is_empty());
        let document = DocumentsRepository::get(&pool, "existing").await.unwrap();
        assert_eq!(document.folder_path.as_deref(), Some("/existing/audio"));
        assert!(document.has_recording);
        DocumentPropertiesRepository::replace(&pool, "existing", vec![input("url", "Notion", "https://notion.so/meeting")]).await.unwrap();
        assert_eq!(DocumentPropertiesRepository::list(&pool, "existing").await.unwrap().len(), 1);
    }
}

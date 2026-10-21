use super::document::DocumentsRepository;
use super::meeting_notes::test_support::test_pool;

#[tokio::test]
async fn hierarchy_names_cycles_and_leaf_removal_preserve_documents() {
    let pool = test_pool().await;
    let a = DocumentsRepository::create_folder(&pool, "A")
        .await
        .unwrap();
    let b = DocumentsRepository::create_folder(&pool, "B")
        .await
        .unwrap();
    let child = DocumentsRepository::create_folder_in(&pool, "A", Some(&a.id))
        .await
        .unwrap();
    assert_eq!(child.parent_id.as_deref(), Some(a.id.as_str()));
    assert!(
        DocumentsRepository::create_folder_in(&pool, "a", Some(&a.id))
            .await
            .is_err()
    );
    assert!(
        DocumentsRepository::create_folder_in(&pool, "X", Some("missing"))
            .await
            .is_err()
    );
    assert!(
        DocumentsRepository::move_folder(&pool, &a.id, Some(&child.id))
            .await
            .is_err()
    );
    assert!(DocumentsRepository::move_folder(&pool, &a.id, Some(&a.id))
        .await
        .is_err());
    assert!(DocumentsRepository::remove_folder(&pool, &a.id)
        .await
        .unwrap_err()
        .to_string()
        .contains("children"));
    let document = DocumentsRepository::create(&pool, "Keep", "meeting", None, Some(&child.id))
        .await
        .unwrap();
    let moved = DocumentsRepository::move_folder(&pool, &child.id, Some(&b.id))
        .await
        .unwrap();
    assert_eq!(moved.parent_id.as_deref(), Some(b.id.as_str()));
    DocumentsRepository::remove_folder(&pool, &child.id)
        .await
        .unwrap();
    assert_eq!(
        DocumentsRepository::get(&pool, &document.id)
            .await
            .unwrap()
            .folder_id,
        None
    );
    assert!(
        DocumentsRepository::move_folder(&pool, &b.id, Some("missing"))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn upgrade_with_foreign_keys_on_preserves_memberships_and_rolls_back() {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    let directory = tempfile::tempdir().unwrap();
    let options = SqliteConnectOptions::new()
        .filename(directory.path().join("upgrade.sqlite"))
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options.clone())
        .await
        .unwrap();
    for migration in sqlx::migrate!("./migrations")
        .iter()
        .filter(|m| m.version < 20261021000000)
    {
        sqlx::raw_sql(&migration.sql).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO folders VALUES ('root', 'Work', 'created', 'updated')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO meetings(id,title,created_at,updated_at,folder_id,folder_path,recording_session_id) VALUES ('m','Keep','created','updated','root','/keep/audio','session')").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO meeting_notes VALUES ('m','Keep notes','[]','created','updated')")
        .execute(&pool)
        .await
        .unwrap();
    let migration = include_str!("../../../migrations/20261021000000_folder_hierarchy.sql");
    let mut tx = pool.begin().await.unwrap();
    sqlx::raw_sql(migration).execute(&mut *tx).await.unwrap();
    tx.rollback().await.unwrap();
    let membership: (String,) = sqlx::query_as("SELECT folder_id FROM meetings WHERE id='m'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(membership.0, "root");
    let mut tx = pool.begin().await.unwrap();
    sqlx::raw_sql(migration).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    pool.close().await;
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    let document = DocumentsRepository::get(&pool, "m").await.unwrap();
    assert_eq!(document.folder_id.as_deref(), Some("root"));
    assert_eq!(document.folder_path.as_deref(), Some("/keep/audio"));
    assert_eq!(document.recording_session_id.as_deref(), Some("session"));
    let folders = DocumentsRepository::folders(&pool).await.unwrap();
    assert_eq!(folders[0].parent_id, None);
    assert_eq!(folders[0].created_at, "created");
    let notes: (String,) =
        sqlx::query_as("SELECT notes_markdown FROM meeting_notes WHERE meeting_id='m'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(notes.0, "Keep notes");
    assert!(sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&pool)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn concurrent_inverse_moves_cannot_commit_a_cycle() {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    let directory = tempfile::tempdir().unwrap();
    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(directory.path().join("concurrent.sqlite"))
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let a = DocumentsRepository::create_folder(&pool, "A")
        .await
        .unwrap();
    let b = DocumentsRepository::create_folder(&pool, "B")
        .await
        .unwrap();
    let (first, second) = tokio::join!(
        DocumentsRepository::move_folder(&pool, &a.id, Some(&b.id)),
        DocumentsRepository::move_folder(&pool, &b.id, Some(&a.id))
    );
    assert_ne!(first.is_ok(), second.is_ok());
    let folders = DocumentsRepository::folders(&pool).await.unwrap();
    assert_eq!(folders.iter().filter(|f| f.parent_id.is_some()).count(), 1);
}

use super::context::*;
use crate::database::repositories::meeting_notes::{
    test_support::{seed_meeting, test_pool},
    MeetingNotesRepository,
};

#[tokio::test]
async fn context_roundtrips_raw_unicode_inherits_and_never_reads_manual_notes() {
    let pool = test_pool().await;
    seed_meeting(&pool, "m", "Prepared").await;
    MeetingNotesRepository::upsert(&pool, "m", "Secret manual notes", Some("[]"))
        .await
        .unwrap();
    save_global_context(&pool, " Global context ")
        .await
        .unwrap();
    save_meeting_context(&pool, "m", " Meeting context \n", true)
        .await
        .unwrap();
    let loaded = get_meeting_context(&pool, "m").await.unwrap();
    assert_eq!(loaded.context, " Meeting context \n");
    assert_eq!(loaded.inherited[0].context, " Global context ");
    let prompt = resolve_for_run(&pool, "m", None, None).await.unwrap();
    assert!(prompt.contains("Global context"));
    assert!(prompt.contains("Meeting context"));
    assert!(!prompt.contains("Secret manual"));
    save_meeting_context(&pool, "m", " raw prompt ", false)
        .await
        .unwrap();
    assert_eq!(
        resolve_for_run(&pool, "m", None, None).await.unwrap(),
        " raw prompt "
    );
    assert_eq!(
        MeetingNotesRepository::get(&pool, "m")
            .await
            .unwrap()
            .unwrap()
            .markdown,
        "Secret manual notes"
    );
}

#[tokio::test]
async fn raw_codepoint_limit_includes_whitespace_and_failed_saves_preserve_previous_text() {
    let pool = test_pool().await;
    seed_meeting(&pool, "m", "Prepared").await;
    let at_limit = "한🎯".repeat(2000);
    save_meeting_context(&pool, "m", &at_limit, true)
        .await
        .unwrap();
    save_global_context(&pool, &at_limit).await.unwrap();
    assert!(
        save_meeting_context(&pool, "m", &format!(" {at_limit}"), true)
            .await
            .is_err()
    );
    assert!(save_global_context(&pool, &format!("{at_limit}\n"))
        .await
        .is_err());
    assert_eq!(
        get_meeting_context(&pool, "m").await.unwrap().context,
        at_limit
    );
    assert!(save_meeting_context(&pool, "missing", "context", true)
        .await
        .is_err());
}

#[tokio::test]
async fn blank_context_keeps_original_prompt_and_read_failures_abort_generation() {
    let pool = test_pool().await;
    seed_meeting(&pool, "m", "Prepared").await;
    assert_eq!(
        resolve_for_run(&pool, "m", Some(""), None).await.unwrap(),
        ""
    );
    save_global_context(&pool, " \n ").await.unwrap();
    assert_eq!(
        resolve_for_run(&pool, "m", Some(" raw prompt \n"), None)
            .await
            .unwrap(),
        " raw prompt \n"
    );
    pool.close().await;
    assert!(resolve_for_run(&pool, "m", Some("context"), Some(true))
        .await
        .is_err());
}

#[tokio::test]
async fn deleting_meeting_cleans_only_its_context() {
    let pool = test_pool().await;
    seed_meeting(&pool, "m", "Prepared").await;
    save_global_context(&pool, "Global").await.unwrap();
    save_meeting_context(&pool, "m", "Meeting", false)
        .await
        .unwrap();
    sqlx::query("DELETE FROM meetings WHERE id='m'")
        .execute(&pool)
        .await
        .unwrap();
    let count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM summary_contexts WHERE scope='meeting'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count.0, 0);
    assert_eq!(get_global_context(&pool).await.unwrap().context, "Global");
}

// Tests adapted from upstream PR #869, plus KH persistence regressions.
use super::*;

fn rule(find: &str, replace: &str) -> SubstitutionRule {
    SubstitutionRule {
        find: find.to_string(),
        replace: replace.to_string(),
        whole_word: true,
        case_sensitive: false,
        enabled: true,
    }
}

fn run(rules: &[SubstitutionRule], text: &str) -> String {
    let compiled = compile_rules(rules);
    apply_rules(text, &compiled)
}

#[test]
fn basic_case_insensitive_replace() {
    let rules = vec![rule("newplains", "New Plains")];
    assert_eq!(
        run(&rules, "we use newplains for that"),
        "we use New Plains for that"
    );
    assert_eq!(
        run(&rules, "We use NewPlains today"),
        "We use New Plains today"
    );
}

#[test]
fn whole_word_respects_boundaries() {
    let mut r = rule("tuttle", "Tuttle");
    r.whole_word = true;
    assert_eq!(
        run(&[r.clone()], "she lives in tuttle ok"),
        "she lives in Tuttle ok"
    );
    assert_eq!(
        run(&[r], "tuttledom is not a place"),
        "tuttledom is not a place"
    );
}

#[test]
fn substring_mode_when_whole_word_off() {
    let mut r = rule("skags", "Skaggs");
    r.whole_word = false;
    assert_eq!(run(&[r], "skags and SKAGS"), "Skaggs and Skaggs");
}

#[test]
fn case_sensitive_matches_exact_only() {
    let mut r = rule("May", "Can");
    r.case_sensitive = true;
    assert_eq!(run(&[r], "May I go, may I stay"), "Can I go, may I stay");
}

#[test]
fn empty_or_disabled_rules_are_noops() {
    assert_eq!(run(&[], "unchanged text"), "unchanged text");
    let mut r = rule("a", "b");
    r.enabled = false;
    assert_eq!(run(&[r], "a a a"), "a a a");
    let blank = rule("   ", "x");
    assert_eq!(run(&[blank], "a a a"), "a a a");
}

#[test]
fn regex_metacharacters_are_literal() {
    let rules = vec![rule("c++", "C++")];
    assert_eq!(run(&rules, "we write in c++ here"), "we write in C++ here");
}

#[test]
fn rules_apply_in_order() {
    let rules = vec![rule("john", "John Smith"), rule("John Smith", "J. Smith")];
    assert_eq!(run(&rules, "john called"), "J. Smith called");
}

#[test]
fn initial_prompt_dedupes_and_skips_nonalpha() {
    let rules = vec![
        rule("tuttle", "Tuttle"),
        rule("TUTTLE", "Tuttle"), // duplicate target
        rule("123", "123"),       // no alphabetic chars -> skipped
        SubstitutionRule {
            find: "x".into(),
            replace: "".into(), // empty -> skipped
            whole_word: true,
            case_sensitive: false,
            enabled: true,
        },
    ];
    let prompt = build_initial_prompt(&rules).unwrap();
    assert!(prompt.starts_with("Glossary"), "got: {}", prompt);
    assert!(prompt.contains("Tuttle"));
    assert_eq!(prompt.matches("Tuttle").count(), 1);
    assert!(!prompt.contains("123"));
}

#[test]
fn initial_prompt_none_when_empty() {
    assert!(build_initial_prompt(&[]).is_none());
}

#[test]
fn literal_dollars_korean_word_boundaries_and_symbols_are_preserved() {
    assert_eq!(
        run(&[rule("cafe\u{301}", "Café")], "cafe\u{301} cafe\u{301}ine"),
        "Café cafe\u{301}ine"
    );
    assert_eq!(
        run(&[rule("budget", "$25 and ${name} $$")], "budget"),
        "$25 and ${name} $$"
    );
    assert_eq!(
        run(
            &[rule("미틸리", "Meetily")],
            "미틸리 미틸리는 English 미틸리!"
        ),
        "Meetily 미틸리는 English Meetily!"
    );
    let mut substring = rule("미틸리", "Meetily");
    substring.whole_word = false;
    assert_eq!(run(&[substring], "미틸리는"), "Meetily는");
    assert_eq!(run(&[rule("c++", "C++")], "c++ c+++"), "C++ C+++");
}

#[test]
fn saved_rules_roundtrip_and_hot_reload_before_text_and_glossary_use() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("substitutions.json");
    let mut store = VocabularyStore::open(path.clone()).unwrap();
    assert_eq!(store.apply("미틸리 budget"), "미틸리 budget");
    store
        .save(&[rule("미틸리", "Meetily"), rule("budget", "$25")])
        .unwrap();
    assert_eq!(store.apply("미틸리 budget"), "Meetily $25");
    let mut reopened = VocabularyStore::open(path).unwrap();
    assert_eq!(reopened.apply("미틸리 budget"), "Meetily $25");
    assert!(reopened.prompt.clone().unwrap().contains("Meetily"));
    reopened.save(&[]).unwrap();
    assert_eq!(reopened.apply("미틸리 budget"), "미틸리 budget");
}

#[cfg(unix)]
#[test]
fn failed_atomic_write_keeps_previous_file_and_active_rules() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("substitutions.json");
    let mut store = VocabularyStore::open(path.clone()).unwrap();
    store.save(&[rule("old", "Kept")]).unwrap();
    let previous = std::fs::read(&path).unwrap();
    let original = std::fs::metadata(directory.path()).unwrap().permissions();
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
    let outcome = store.save(&[rule("old", "Lost")]);
    std::fs::set_permissions(directory.path(), original).unwrap();
    assert!(
        outcome.is_err(),
        "test must run without root filesystem bypass"
    );
    assert_eq!(std::fs::read(&path).unwrap(), previous);
    assert_eq!(store.apply("old"), "Kept");
}

#[test]
fn invalid_external_file_keeps_active_rules_and_surfaces_load_error() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("substitutions.json");
    let mut store = VocabularyStore::open(path.clone()).unwrap();
    store.save(&[rule("old", "Kept")]).unwrap();
    std::fs::write(&path, "invalid JSON with a distinct length").unwrap();
    assert!(store.reload_if_changed().is_err());
    assert_eq!(store.apply("old"), "Kept");
}

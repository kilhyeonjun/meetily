//! Vocabulary corrections adapted from upstream PR #869 (b82f50997cf58edb788732356f9acb6670c31ca2).
//! App-specific atomic persistence replaces the upstream shared Meetily path.
use once_cell::sync::Lazy;
use regex::{NoExpand, Regex};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::SystemTime,
};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubstitutionRule {
    pub find: String,
    pub replace: String,
    #[serde(default = "default_true")]
    pub whole_word: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// On-disk JSON shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SubstitutionFile {
    version: u32,
    rules: Vec<SubstitutionRule>,
}

/// A compiled rule (regex prebuilt for speed).
struct CompiledRule {
    regex: Regex,
    replace: String,
}

// ---------------------------------------------------------------------------
// Pure engine (unit-testable, no filesystem)
// ---------------------------------------------------------------------------

/// Compile rules into regexes. Returns only the enabled rules, in order.
fn compile_rules(rules: &[SubstitutionRule]) -> Vec<CompiledRule> {
    rules
        .iter()
        .filter(|r| r.enabled && !r.find.trim().is_empty())
        .filter_map(|r| {
            let mut pattern = String::new();
            if !r.case_sensitive {
                pattern.push_str("(?i)");
            }
            let lit = r.find.trim();
            let escaped = regex::escape(lit);
            if r.whole_word {
                // Word boundaries only make sense adjacent to word characters.
                // A token like "c++" ends in '+', where `\b` can never match
                // (boundary needs a word char on one side), so only add `\b`
                // where the token edge is itself a word character.
                let is_word = |c: char| {
                    static WORD_CHARACTER: Lazy<Regex> =
                        Lazy::new(|| Regex::new(r"^\w$").expect("valid Unicode word matcher"));
                    WORD_CHARACTER.is_match(&c.to_string())
                };
                if lit.chars().next().map(is_word).unwrap_or(false) {
                    pattern.push_str(r#"\b"#);
                }
                pattern.push_str(&escaped);
                if lit.chars().last().map(is_word).unwrap_or(false) {
                    pattern.push_str(r#"\b"#);
                }
            } else {
                pattern.push_str(&escaped);
            }
            match Regex::new(&pattern) {
                Ok(regex) => Some(CompiledRule {
                    regex,
                    replace: r.replace.clone(),
                }),
                Err(e) => {
                    log::warn!("Invalid substitution rule '{}': {}", r.find, e);
                    None
                }
            }
        })
        .collect()
}

/// Apply compiled rules to text, in order.
fn apply_rules(text: &str, compiled: &[CompiledRule]) -> String {
    let mut out = text.to_string();
    for rule in compiled {
        if rule.regex.is_match(&out) {
            out = rule
                .regex
                .replace_all(&out, NoExpand(rule.replace.as_str()))
                .to_string();
        }
    }
    out
}

/// Build the Whisper `initial_prompt` glossary from enabled rules.
/// Uses the distinct replacement values (the spellings we WANT), capped to
/// keep the prompt within Whisper's effective context (~224 tokens).
fn build_initial_prompt(rules: &[SubstitutionRule]) -> Option<String> {
    let mut seen = std::collections::HashSet::new();
    let mut terms: Vec<String> = rules
        .iter()
        .filter(|r| r.enabled && !r.find.trim().is_empty())
        .map(|r| r.replace.trim().to_string())
        .filter(|t| !t.is_empty() && t.chars().any(|c| c.is_alphabetic()))
        .filter(|t| seen.insert(t.to_lowercase()))
        .collect();
    terms.sort();
    if terms.is_empty() {
        return None;
    }
    let mut prompt = String::from("Glossary of correct spellings for this meeting: ");
    for term in &terms {
        let candidate = if prompt.ends_with(": ") {
            format!("{}{}", prompt, term)
        } else {
            format!("{}, {}", prompt, term)
        };
        if candidate.len() > 400 {
            break;
        }
        prompt = candidate;
    }
    if prompt.ends_with(": ") {
        return None; // nothing fit
    }
    prompt.push('.');
    Some(prompt)
}

#[derive(Clone, PartialEq)]
struct FileStamp {
    modified: SystemTime,
    length: u64,
}

fn file_stamp(path: &Path) -> Result<Option<FileStamp>, String> {
    match std::fs::metadata(path) {
        Ok(metadata) => Ok(Some(FileStamp {
            modified: metadata.modified().map_err(|e| e.to_string())?,
            length: metadata.len(),
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Cannot read vocabulary metadata: {error}")),
    }
}

struct VocabularyStore {
    path: PathBuf,
    stamp: Option<FileStamp>,
    rules: Vec<SubstitutionRule>,
    compiled: Vec<CompiledRule>,
    prompt: Option<String>,
}

impl VocabularyStore {
    fn empty(path: PathBuf) -> Self {
        Self {
            path,
            stamp: None,
            rules: vec![],
            compiled: vec![],
            prompt: None,
        }
    }
    fn open(path: PathBuf) -> Result<Self, String> {
        let mut store = Self::empty(path);
        store.reload_if_changed()?;
        Ok(store)
    }
    fn reload_if_changed(&mut self) -> Result<(), String> {
        let stamp = file_stamp(&self.path)?;
        if stamp == self.stamp {
            return Ok(());
        }
        let rules = if stamp.is_none() {
            vec![]
        } else {
            let file: SubstitutionFile =
                serde_json::from_slice(&std::fs::read(&self.path).map_err(|e| e.to_string())?)
                    .map_err(|e| format!("Cannot load vocabulary: {e}"))?;
            if file.version != 1 {
                return Err("Unsupported vocabulary file version".into());
            }
            file.rules
        };
        let compiled = compile_rules(&rules);
        let prompt = build_initial_prompt(&rules);
        self.rules = rules;
        self.compiled = compiled;
        self.prompt = prompt;
        self.stamp = stamp;
        Ok(())
    }
    fn apply(&mut self, text: &str) -> String {
        if let Err(error) = self.reload_if_changed() {
            log::warn!("Vocabulary reload failed; keeping active rules: {error}");
        }
        apply_rules(text, &self.compiled)
    }
    fn save(&mut self, rules: &[SubstitutionRule]) -> Result<(), String> {
        let compiled = compile_rules(rules);
        let prompt = build_initial_prompt(rules);
        let parent = self.path.parent().ok_or("Vocabulary path has no parent")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let file = SubstitutionFile {
            version: 1,
            rules: rules.to_vec(),
        };
        let mut temporary = tempfile::NamedTempFile::new_in(parent)
            .map_err(|e| format!("Cannot prepare vocabulary save: {e}"))?;
        serde_json::to_writer_pretty(&mut temporary, &file).map_err(|e| e.to_string())?;
        temporary.write_all(b"\n").map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        temporary
            .persist(&self.path)
            .map_err(|e| format!("Cannot commit vocabulary save: {e}"))?;
        // Only a successful atomic disk commit may change active corrections.
        self.rules = rules.to_vec();
        self.compiled = compiled;
        self.prompt = prompt;
        self.stamp = file_stamp(&self.path).ok().flatten();
        Ok(())
    }
}

static STATE: Lazy<Mutex<Option<VocabularyStore>>> = Lazy::new(|| Mutex::new(None));

/// Called once during Tauri setup, and defensively by settings commands. No
/// shared Meetily directory or other application's settings are read or copied.
pub fn initialize<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("substitutions.json");
    let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
    if state.as_ref().map_or(false, |store| store.path == path) {
        return Ok(());
    }
    let store = match VocabularyStore::open(path.clone()) {
        Ok(store) => store,
        Err(error) => {
            log::warn!("Vocabulary load failed; corrections inactive: {error}");
            VocabularyStore::empty(path)
        }
    };
    *state = Some(store);
    Ok(())
}

pub fn apply(text: &str) -> String {
    let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
    state
        .as_mut()
        .map(|store| store.apply(text))
        .unwrap_or_else(|| text.to_owned())
}

pub fn initial_prompt() -> Option<String> {
    let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let store = state.as_mut()?;
    if let Err(error) = store.reload_if_changed() {
        log::warn!("Vocabulary reload failed; keeping active glossary: {error}");
    }
    store.prompt.clone()
}

#[tauri::command]
pub async fn substitutions_list<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<SubstitutionRule>, String> {
    initialize(&app)?;
    let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let store = state.as_mut().ok_or("Vocabulary is not initialized")?;
    store.reload_if_changed()?;
    Ok(store.rules.clone())
}
#[tauri::command]
pub async fn substitutions_save<R: Runtime>(
    app: AppHandle<R>,
    rules: Vec<SubstitutionRule>,
) -> Result<(), String> {
    initialize(&app)?;
    STATE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_mut()
        .ok_or("Vocabulary is not initialized")?
        .save(&rules)
}
#[tauri::command]
pub async fn substitutions_test<R: Runtime>(
    app: AppHandle<R>,
    text: String,
) -> Result<String, String> {
    initialize(&app)?;
    let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let store = state.as_mut().ok_or("Vocabulary is not initialized")?;
    store.reload_if_changed()?;
    Ok(apply_rules(&text, &store.compiled))
}
#[tauri::command]
pub async fn substitutions_file_path<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    initialize(&app)?;
    Ok(STATE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .ok_or("Vocabulary is not initialized")?
        .path
        .to_string_lossy()
        .into_owned())
}

#[cfg(test)]
mod tests;

use super::constants::AUDIO_EXTENSIONS;
use std::path::{Path, PathBuf};

pub(super) fn resolve_meeting_audio(
    document_type: &str,
    folder: Option<&Path>,
) -> Result<Option<PathBuf>, String> {
    if document_type != "meeting" {
        return Ok(None);
    }
    let Some(folder) = folder else {
        return Ok(None);
    };
    let folder = match folder.canonicalize() {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Cannot access recording folder: {}", error)),
    };
    if !folder.is_dir() {
        return Err("Recording folder is not a directory".into());
    }
    let preferred = [
        "audio.mp4",
        "audio.m4a",
        "audio.wav",
        "audio.mp3",
        "audio.flac",
        "audio.ogg",
        "recording.mp4",
        "audio.mkv",
        "audio.webm",
        "audio.wma",
    ];
    let mut candidates: Vec<PathBuf> = preferred.iter().map(|name| folder.join(name)).collect();
    let mut extra: Vec<PathBuf> = std::fs::read_dir(&folder)
        .map_err(|error| format!("Cannot list recording folder: {}", error))?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<_, _>>()
        .map_err(|error| format!("Cannot read recording entry: {}", error))?;
    extra.sort();
    candidates.extend(extra);
    for candidate in candidates {
        let supported = candidate
            .extension()
            .and_then(|value| value.to_str())
            .map(|extension| AUDIO_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
            .unwrap_or(false);
        if !supported {
            continue;
        }
        let resolved = match candidate.canonicalize() {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("Cannot resolve recording file: {}", error)),
        };
        if !resolved.starts_with(&folder) {
            return Err("Recording file resolves outside its meeting folder".into());
        }
        if resolved.is_file() {
            return Ok(Some(resolved));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "meetily-playback-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    // Returning a caller path or directory instead of a canonical audio file breaks this.
    #[test]
    fn recorded_meeting_resolves_exact_canonical_file() {
        let temp = Fixture::new();
        std::fs::write(temp.0.join("audio.mp4"), b"audio fixture").unwrap();
        let audio = resolve_meeting_audio("meeting", Some(&temp.0)).unwrap();
        assert_eq!(
            audio,
            Some(temp.0.join("audio.mp4").canonicalize().unwrap())
        );
    }

    #[test]
    fn notes_and_prepared_or_missing_recordings_have_no_playback() {
        let temp = Fixture::new();
        std::fs::write(temp.0.join("audio.wav"), b"fixture").unwrap();
        assert_eq!(resolve_meeting_audio("note", Some(&temp.0)).unwrap(), None);
        assert_eq!(resolve_meeting_audio("meeting", None).unwrap(), None);
        assert_eq!(
            resolve_meeting_audio("meeting", Some(&temp.0.join("deleted"))).unwrap(),
            None
        );
    }

    #[test]
    fn fallback_skips_directories_and_accepts_supported_uppercase_extension() {
        let temp = Fixture::new();
        std::fs::create_dir(temp.0.join("audio.mp4")).unwrap();
        std::fs::write(temp.0.join("capture.WAV"), b"fixture").unwrap();
        assert_eq!(
            resolve_meeting_audio("meeting", Some(&temp.0)).unwrap(),
            Some(temp.0.join("capture.WAV").canonicalize().unwrap())
        );
    }

    #[test]
    fn unsupported_files_never_become_assets() {
        let temp = Fixture::new();
        std::fs::write(temp.0.join("transcripts.json"), b"private").unwrap();
        assert_eq!(
            resolve_meeting_audio("meeting", Some(&temp.0)).unwrap(),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn escaping_audio_symlink_is_rejected_including_sibling_prefix() {
        let temp = Fixture::new();
        let meeting = temp.0.join("meeting");
        let sibling = temp.0.join("meeting-secret");
        std::fs::create_dir(&meeting).unwrap();
        std::fs::create_dir(&sibling).unwrap();
        std::fs::write(sibling.join("private.wav"), b"secret").unwrap();
        std::os::unix::fs::symlink(sibling.join("private.wav"), meeting.join("audio.wav")).unwrap();
        assert!(resolve_meeting_audio("meeting", Some(&meeting)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_staying_inside_meeting_grants_only_resolved_file() {
        let temp = Fixture::new();
        std::fs::write(temp.0.join("source.wav"), b"fixture").unwrap();
        std::os::unix::fs::symlink(temp.0.join("source.wav"), temp.0.join("audio.wav")).unwrap();
        assert_eq!(
            resolve_meeting_audio("meeting", Some(&temp.0)).unwrap(),
            Some(temp.0.join("source.wav").canonicalize().unwrap())
        );
    }
}

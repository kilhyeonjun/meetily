use anyhow::Result;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::mpsc;
use tokio::sync::Mutex as AsyncMutex;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RecordingIdentity {
    #[serde(default)]
    pub meeting_id: Option<String>,
    #[serde(default)]
    pub recording_session_id: Option<String>,
    #[serde(default)]
    pub folder_path: Option<String>,
}

/// Recover identity from native storage, including recordings made before sessions existed.
pub fn read_recording_identity(folder: &std::path::Path) -> Result<Option<RecordingIdentity>> {
    let path = folder.join("metadata.json");
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

use super::audio_processing::create_meeting_folder;
use super::incremental_saver::IncrementalAudioSaver;
use super::recording_state::AudioChunk;

/// Structured transcript segment for JSON export
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    pub audio_start_time: f64, // Seconds from recording start
    pub audio_end_time: f64,   // Seconds from recording start
    pub duration: f64,         // Segment duration in seconds
    pub display_time: String,  // Formatted time for display like "[02:15]"
    pub confidence: f32,
    pub sequence_id: u64,
}

/// Meeting metadata structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingMetadata {
    pub version: String,
    pub meeting_id: Option<String>,
    #[serde(default)]
    pub recording_session_id: Option<String>,
    pub meeting_name: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub duration_seconds: Option<f64>,
    pub devices: DeviceInfo,
    pub audio_file: String,
    pub transcript_file: String,
    pub sample_rate: u32,
    pub status: String, // "recording", "completed", "error"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub microphone: Option<String>,
    pub system_audio: Option<String>,
}

/// New recording saver using incremental saving strategy
pub struct RecordingSaver {
    incremental_saver: Option<Arc<AsyncMutex<IncrementalAudioSaver>>>,
    meeting_folder: Option<PathBuf>,
    meeting_name: Option<String>,
    identity: RecordingIdentity,
    metadata: Option<MeetingMetadata>,
    transcript_segments: Arc<Mutex<Vec<TranscriptSegment>>>,
    is_saving: Arc<Mutex<bool>>,
}

impl RecordingSaver {
    pub fn new() -> Self {
        Self {
            incremental_saver: None,
            meeting_folder: None,
            meeting_name: None,
            identity: RecordingIdentity {
                recording_session_id: Some(uuid::Uuid::new_v4().to_string()),
                ..RecordingIdentity::default()
            },
            metadata: None,
            transcript_segments: Arc::new(Mutex::new(Vec::new())),
            is_saving: Arc::new(Mutex::new(false)),
        }
    }

    /// Set the meeting name for this recording session
    pub fn set_meeting_name(&mut self, name: Option<String>) {
        self.meeting_name = name;
    }

    pub fn set_target_meeting(&mut self, meeting_id: Option<String>) {
        self.identity.meeting_id = meeting_id;
    }

    pub fn get_recording_identity(&self) -> RecordingIdentity {
        let mut identity = self.identity.clone();
        identity.folder_path = self
            .meeting_folder
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned());
        identity
    }

    /// Must succeed before opening capture streams: recovery may never depend only on the browser.
    pub fn prepare_storage(&mut self, auto_save: bool) -> Result<()> {
        if self.meeting_folder.is_none() {
            let name = self
                .meeting_name
                .clone()
                .unwrap_or_else(|| "Meeting".into());
            self.initialize_meeting_folder(&name, auto_save)?;
        }
        Ok(())
    }

    /// Set device information in metadata
    pub fn set_device_info(&mut self, mic_name: Option<String>, sys_name: Option<String>) {
        if let Some(ref mut metadata) = self.metadata {
            metadata.devices.microphone = mic_name;
            metadata.devices.system_audio = sys_name;

            // Write updated metadata to disk if folder exists
            if let Some(folder) = &self.meeting_folder {
                let metadata_clone = metadata.clone();
                if let Err(_) = self.write_metadata(folder, &metadata_clone) {
                    warn!("Failed to update metadata with device info");
                }
            }
        }
    }

    /// Add or update a structured transcript segment (upserts based on sequence_id)
    /// Also saves incrementally to disk
    pub fn add_transcript_segment(&self, segment: TranscriptSegment) {
        if let Ok(mut segments) = self.transcript_segments.lock() {
            // Check if segment with same sequence_id exists (update it)
            if let Some(existing) = segments
                .iter_mut()
                .find(|s| s.sequence_id == segment.sequence_id)
            {
                *existing = segment.clone();
                info!(
                    "Updated transcript segment {} (seq: {}) - total segments: {}",
                    segment.id,
                    segment.sequence_id,
                    segments.len()
                );
            } else {
                // New segment, add it
                segments.push(segment.clone());
                info!(
                    "Added new transcript segment {} (seq: {}) - total segments: {}",
                    segment.id,
                    segment.sequence_id,
                    segments.len()
                );
            }
        } else {
            error!(
                "Failed to lock transcript segments for adding segment {}",
                segment.id
            );
        }

        // NEW: Save incrementally to disk
        if let Some(folder) = &self.meeting_folder {
            if let Err(_) = self.write_transcripts_json(folder) {
                warn!("Failed to write incremental transcript update");
            }
        }
    }

    /// Legacy method for backward compatibility - converts text to basic segment
    pub fn add_transcript_chunk(&self, text: String) {
        let segment = TranscriptSegment {
            id: format!("seg_{}", chrono::Utc::now().timestamp_millis()),
            text,
            audio_start_time: 0.0,
            audio_end_time: 0.0,
            duration: 0.0,
            display_time: "[00:00]".to_string(),
            confidence: 1.0,
            sequence_id: 0,
        };
        self.add_transcript_segment(segment);
    }

    /// Start accumulation with optional incremental saving
    ///
    /// # Arguments
    /// * `auto_save` - If true, creates checkpoints and enables saving. If false, audio chunks are discarded.
    pub fn start_accumulation(
        &mut self,
        auto_save: bool,
        mut receiver: mpsc::UnboundedReceiver<AudioChunk>,
    ) {
        // Start accumulation task
        let is_saving_clone = self.is_saving.clone();
        let incremental_saver_arc = self.incremental_saver.clone();
        let save_audio = auto_save;

        tokio::spawn(async move {
            info!(
                "Recording saver accumulation task started (save_audio: {})",
                save_audio
            );

            while let Some(chunk) = receiver.recv().await {
                // Check if we should continue
                let should_continue = if let Ok(is_saving) = is_saving_clone.lock() {
                    *is_saving
                } else {
                    false
                };

                if !should_continue {
                    break;
                }

                // Only process audio chunks if auto_save is enabled
                if save_audio {
                    // Add chunk to incremental saver
                    if let Some(saver_arc) = &incremental_saver_arc {
                        let mut saver_guard = saver_arc.lock().await;
                        if saver_guard.add_chunk(chunk).is_err() {
                            error!("Failed to add chunk to incremental saver");
                        }
                    } else {
                        error!("Incremental saver not available while accumulating");
                    }
                } else {
                    // auto_save is false: discard audio chunk (no-op)
                    // Transcription already happened in the pipeline before this point
                }
            }

            info!("Recording saver accumulation task ended");
        });

        // Set saving flag
        if let Ok(mut is_saving) = self.is_saving.lock() {
            *is_saving = true;
        }
    }

    /// Initialize meeting folder structure and metadata
    ///
    /// # Arguments
    /// * `meeting_name` - Name of the meeting
    /// * `create_checkpoints` - Whether to create .checkpoints/ directory and IncrementalAudioSaver
    fn initialize_meeting_folder(
        &mut self,
        meeting_name: &str,
        create_checkpoints: bool,
    ) -> Result<()> {
        // Load preferences to get base recordings folder
        let base_folder = super::recording_preferences::get_default_recordings_folder();
        self.initialize_meeting_folder_at(&base_folder, meeting_name, create_checkpoints)
    }

    fn initialize_meeting_folder_at(
        &mut self,
        base_folder: &PathBuf,
        meeting_name: &str,
        create_checkpoints: bool,
    ) -> Result<()> {
        // Two documents with the same title in one minute need distinct audio
        // and recovery files. The native session identity is stable across retries.
        let storage_name = format!(
            "{}_{}",
            meeting_name,
            self.identity
                .recording_session_id
                .as_deref()
                .unwrap_or("legacy")
        );

        // Create meeting folder structure (with or without .checkpoints/ subdirectory)
        let meeting_folder = create_meeting_folder(base_folder, &storage_name, create_checkpoints)?;

        // Only initialize incremental saver if checkpoints are needed (auto_save is true)
        if create_checkpoints {
            let incremental_saver = IncrementalAudioSaver::new(meeting_folder.clone(), 48000)?;
            self.incremental_saver = Some(Arc::new(AsyncMutex::new(incremental_saver)));
            info!("Incremental audio saver initialized");
        } else {
            info!("⚠️  Skipped incremental audio saver (auto-save disabled)");
        }

        // Create initial metadata
        let metadata = MeetingMetadata {
            version: "1.0".to_string(),
            meeting_id: self.identity.meeting_id.clone(),
            recording_session_id: self.identity.recording_session_id.clone(),
            meeting_name: Some(meeting_name.to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
            completed_at: None,
            duration_seconds: None,
            devices: DeviceInfo {
                microphone: None, // Could be enhanced to store actual device names
                system_audio: None,
            },
            audio_file: if create_checkpoints {
                "audio.mp4".to_string()
            } else {
                "".to_string()
            },
            transcript_file: "transcripts.json".to_string(),
            sample_rate: 48000,
            status: "recording".to_string(),
        };

        // Write initial metadata.json
        self.write_metadata(&meeting_folder, &metadata)?;

        self.meeting_folder = Some(meeting_folder);
        self.metadata = Some(metadata);

        Ok(())
    }

    /// Write metadata.json to disk (atomic write with temp file)
    fn write_metadata(&self, folder: &PathBuf, metadata: &MeetingMetadata) -> Result<()> {
        let metadata_path = folder.join("metadata.json");
        let temp_path = folder.join(".metadata.json.tmp");

        let json_string = serde_json::to_string_pretty(metadata)?;
        std::fs::write(&temp_path, json_string)?;
        std::fs::rename(&temp_path, &metadata_path)?; // Atomic

        Ok(())
    }

    /// Write transcripts.json to disk (atomic write with temp file and validation)
    fn write_transcripts_json(&self, folder: &PathBuf) -> Result<()> {
        // Clone segments to avoid holding lock during I/O
        let segments_clone = if let Ok(segments) = self.transcript_segments.lock() {
            segments.clone()
        } else {
            error!("Failed to lock transcript segments for writing");
            return Err(anyhow::anyhow!("Failed to lock transcript segments"));
        };

        info!(
            "Writing {} transcript segments to JSON",
            segments_clone.len()
        );

        let transcript_path = folder.join("transcripts.json");
        let temp_path = folder.join(".transcripts.json.tmp");

        // Create JSON structure
        let json = serde_json::json!({
            "version": "1.0",
            "segments": segments_clone,
            "last_updated": chrono::Utc::now().to_rfc3339(),
            "total_segments": segments_clone.len()
        });

        // Serialize to pretty JSON string
        let json_string = serde_json::to_string_pretty(&json).map_err(|e| {
            error!("Failed to serialize transcripts to JSON: {}", e);
            anyhow::anyhow!("JSON serialization failed: {}", e)
        })?;

        // Write to temp file with error handling
        std::fs::write(&temp_path, &json_string).map_err(|e| {
            error!("Failed to write transcript temp file");
            anyhow::anyhow!("Failed to write temp file: {}", e)
        })?;

        // Verify temp file was written correctly
        if !temp_path.exists() {
            error!("Temp transcript file does not exist after write");
            return Err(anyhow::anyhow!("Temp file verification failed"));
        }

        // Atomic rename
        std::fs::rename(&temp_path, &transcript_path).map_err(|e| {
            error!("Failed to replace transcript file");
            anyhow::anyhow!("Failed to rename transcript file: {}", e)
        })?;

        info!(
            "✅ Successfully wrote transcripts.json with {} segments",
            segments_clone.len()
        );
        Ok(())
    }

    // in frontend/src-tauri/src/audio/recording_saver.rs
    pub fn get_stats(&self) -> (usize, u32) {
        if let Some(ref saver) = self.incremental_saver {
            if let Ok(guard) = saver.try_lock() {
                (guard.get_checkpoint_count() as usize, 48000)
            } else {
                (0, 48000)
            }
        } else {
            (0, 48000)
        }
    }

    /// Stop and save using incremental saving approach
    ///
    /// # Arguments
    /// * `app` - Tauri app handle for emitting events
    /// * `recording_duration` - Actual recording duration in seconds (from RecordingState)
    pub async fn stop_and_save<R: Runtime>(
        &mut self,
        app: &AppHandle<R>,
        recording_duration: Option<f64>,
    ) -> Result<Option<String>, String> {
        info!("Stopping recording saver");

        // Stop accumulation
        if let Ok(mut is_saving) = self.is_saving.lock() {
            *is_saving = false;
        }

        // Give time for final chunks
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        // Check if incremental saver exists (indicates auto_save was enabled)
        let should_save_audio = self.incremental_saver.is_some();

        if !should_save_audio {
            info!("⚠️  No audio saver initialized (auto-save was disabled) - skipping audio finalization");
            info!("✅ Transcripts and metadata already saved incrementally");
            return Ok(None);
        }

        // Finalize incremental saver (merge checkpoints into final audio.mp4)
        let final_audio_path = if let Some(saver_arc) = &self.incremental_saver {
            let mut saver = saver_arc.lock().await;
            match saver.finalize().await {
                Ok(path) => {
                    info!("Successfully finalized audio");
                    path
                }
                Err(e) => {
                    error!("Failed to finalize incremental saver");
                    return Err(format!("Failed to finalize audio: {}", e));
                }
            }
        } else {
            error!("No incremental saver initialized - cannot save recording");
            return Err("No incremental saver initialized".to_string());
        };

        // Save final transcripts.json with validation
        if let Some(folder) = &self.meeting_folder {
            if let Err(e) = self.write_transcripts_json(folder) {
                error!("Failed to write final transcripts");
                return Err(format!("Failed to save transcripts: {}", e));
            }

            // Verify transcripts were written correctly
            let transcript_path = folder.join("transcripts.json");
            if !transcript_path.exists() {
                error!("Transcript file was not created");
                return Err("Transcript file verification failed".to_string());
            }
            info!("Transcripts saved and verified");
        }

        // Update metadata to completed status with actual recording duration
        if let (Some(folder), Some(mut metadata)) = (&self.meeting_folder, self.metadata.clone()) {
            metadata.status = "completed".to_string();
            metadata.completed_at = Some(chrono::Utc::now().to_rfc3339());

            // Use actual recording duration from RecordingState (more accurate than transcript segments)
            // Falls back to last transcript segment if duration not provided
            metadata.duration_seconds = recording_duration.or_else(|| {
                if let Ok(segments) = self.transcript_segments.lock() {
                    segments.last().map(|seg| seg.audio_end_time)
                } else {
                    None
                }
            });

            if let Err(e) = self.write_metadata(folder, &metadata) {
                error!("Failed to update metadata to completed");
                return Err(format!("Failed to update metadata: {}", e));
            }

            info!(
                "✅ Metadata updated with duration: {:?}s",
                metadata.duration_seconds
            );
        }

        // Emit save event with audio and transcript paths
        let save_event = serde_json::json!({
            "audio_file": final_audio_path.to_string_lossy(),
            "transcript_file": self.meeting_folder.as_ref()
                .map(|f| f.join("transcripts.json").to_string_lossy().to_string()),
            "meeting_name": self.meeting_name,
            "meeting_folder": self.meeting_folder.as_ref()
                .map(|f| f.to_string_lossy().to_string())
        });

        if let Err(e) = app.emit("recording-saved", &save_event) {
            warn!("Failed to emit recording-saved event: {}", e);
        }

        // Clean up transcript segments
        if let Ok(mut segments) = self.transcript_segments.lock() {
            segments.clear();
        }

        Ok(Some(final_audio_path.to_string_lossy().to_string()))
    }

    /// Get the meeting folder path (for passing to backend)
    pub fn get_meeting_folder(&self) -> Option<&PathBuf> {
        self.meeting_folder.as_ref()
    }

    /// Get accumulated transcript segments (for reload sync)
    pub fn get_transcript_segments(&self) -> Vec<TranscriptSegment> {
        if let Ok(segments) = self.transcript_segments.lock() {
            segments.clone()
        } else {
            Vec::new()
        }
    }

    /// Get meeting name (for reload sync)
    pub fn get_meeting_name(&self) -> Option<String> {
        self.meeting_name.clone()
    }
}

impl Default for RecordingSaver {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod identity_tests {
    use super::*;

    #[test]
    fn every_session_has_native_identity_and_sidecar_recovery_retains_target() {
        let mut saver = RecordingSaver::new();
        saver.set_target_meeting(Some("meeting-prepared".into()));
        let identity = saver.get_recording_identity();
        assert_eq!(identity.meeting_id.as_deref(), Some("meeting-prepared"));
        assert!(identity.recording_session_id.is_some());
        let folder = tempfile::tempdir().unwrap();
        saver
            .initialize_meeting_folder_at(&folder.path().to_path_buf(), "Same title", false)
            .unwrap();
        let mut other = RecordingSaver::new();
        other
            .initialize_meeting_folder_at(&folder.path().to_path_buf(), "Same title", false)
            .unwrap();
        assert_ne!(saver.get_meeting_folder(), other.get_meeting_folder());
        let recovered = read_recording_identity(saver.get_meeting_folder().unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(recovered.meeting_id, identity.meeting_id);
        assert_eq!(
            recovered.recording_session_id,
            identity.recording_session_id
        );
    }

    #[test]
    fn old_sidecars_without_identity_remain_readable() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(
            folder.path().join("metadata.json"),
            r#"{"meeting_name":"Old recording","status":"completed"}"#,
        )
        .unwrap();
        let identity = read_recording_identity(folder.path()).unwrap().unwrap();
        assert_eq!(identity.meeting_id, None);
        assert_eq!(identity.recording_session_id, None);
    }
}

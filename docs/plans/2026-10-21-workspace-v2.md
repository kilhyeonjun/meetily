# KH workspace v2 execution plan

Status: user approved all five shortlisted PR improvements plus folder browser v2; independent design review cleared2026-10-21 after normal-exit and STARTING protection clarification. Implementation in progress.
Baseline: personal origin/devtest `4f306989efb76d6943abe2429ba1299e31608c45`.
Branch: `enhance/kh-workspace-v2` in separate `meetily-kh-workspace-v2` worktree.

## Scope and live-app boundary

- Folder/subfolder browser, PR817 resize/collapse, PR848 summary context, PR869 vocabulary corrections, PR543 playback/seek and PR864 close preference.
- Pin source heads:817=888733d64a5ac33dc8d6451f2f3582ee4aaf172e;848=367c45f9229f265040203d2abe2f48dbbc8b27c4;869=b82f50997cf58edb788732356f9acb6670c31ca2;543=733d2700806906017ba75035043aff6006522d91;864=69ab949157f4b0d288385166e943c1ce809b766d. Preserve attribution.
- Existing installed app is frozen for the user's2026-10-21 15:00 KST meeting: never quit/restart/replace it, edit its live data/settings, trigger capture, or install a new build. Native builds run remotely. GUI/audio validation remains explicitly deferred until computer use is available.
- Exclude tags/Trash/purge, DB reset/checksum self-heal, i18n overhaul, new audio capture/resampler algorithms, calendar/cloud services and unrelated export/provider changes.

## Folder persistence contract

- New migration only; leave all applied migrations byte-identical. Folder gains nullable `parent_id`; existing folders remain roots with identical IDs/names/timestamps/document membership.
- Names are case-insensitively unique within the same parent (including root), while different parents may have identical child names. Empty names/unknown parent IDs are rejected.
- Replacing the old global UNIQUE constraint must preserve `meetings.folder_id` under SQLite foreign-key actions. Exercise the real upgrade with foreign_keys=ON, including transient DROP TABLE effects, and rollback; do not rely on disabling foreign_keys inside an existing migration transaction.
- Create/rename/reparent validates sibling collisions; reparent atomically rejects self/descendant cycles against the current committed tree. Concurrent updates cannot produce a cycle. Moving documents retains notes, recordings, identity, schedule and paths.
- Removing a folder with children fails with an actionable instruction to move children first. Removing a leaf returns its documents to Unfiled, retaining existing behavior and physical audio. No cascade deletion.
- Existing command `api_create_folder({name,parentId?})` remains compatible when parentId is omitted. Add `api_move_folder({folderId,parentId:null|string})`. `api_get_folders` returns Folder with nullable parent_id. Existing document create/move contracts remain unchanged.

## Browser and layout contract

- Shared folder/document state supports sidebar tree and a distinct content browser. All documents and Unfiled are virtual destinations; `folderId` in the workspace URL selects a real folder, preserving browser back/forward and restart selection.
- Expand/collapse state persists; tree supports keyboard navigation, selected state, meaningful labels. Content shows breadcrumbs, immediate child folders/documents, sort/search, empty/error/retry states.
- New meeting/note/subfolder is created in the selected real folder; document and folder move dialogs show full paths and search. Actions live in row menus. Drag/drop invokes the same validated move commands; keyboard/menu alternatives cover all operations.
- PR817 resize uses one actual sidebarWidth source for MainContent, home controls/overlays and sidebar; preserve collapse/restore state. Transcript-pane collapse composes with the existing Notes/Transcript/Summary modes and does not unmount/discard unsaved notes.

## Summary context contract

- Adapt PR848 global/per-meeting context persistence and Generate/Regenerate propagation. Manual notes remain separate and are never automatically included as AI context.
- Limit context consistently to4000 Unicode characters; show inherited context and per-meeting opt-out. Empty contexts preserve the previous prompt/cache behavior.
- Slow loads cannot overwrite edits, and pending saves retain their scope/document ID. Synchronously retain a durable local draft before debounce; clear only the exact acknowledged version, expose conflict/retry rather than overwrite newer persisted content.
- Generate/Regenerate waits for that meeting's pending context save and reports failure without generating from a mismatched/stale context. Switching documents or summary regeneration cannot overwrite manual notes.

## Vocabulary contract

- Adapt PR869 substitutions and Whisper glossary. Rules live under this app's app_data_dir, not a hardcoded shared Meetily directory. Zero rules leave transcripts unchanged.
- Literal replacement must preserve dollar signs via NoExpand/equivalent. Test Korean/English mixed text, Unicode whole-word on/off semantics, symbols, case/rule ordering and glossary deduplication.
- Serialize saves; persist atomically before updating the cached active rules. Failed writes retain previous file and active rules. Show errors in Settings with explicit retry. Existing transcription paths apply the same rules before storage/export.

## Playback and close policy contract

- Adapt PR543 playback with missing-file/no-recording degradation. Input is a meeting ID, never a caller-supplied path. Resolve only a supported audio file inside that meeting's canonical recording directory; reject escaping symlinks. Grant asset scope to that exact file, not a directory tree.
- Audio supports play/pause, seek/rate and transcript timestamp jumps; queue pre-metadata seeks and clamp them to valid bounds. Tab switches preserve playback and editor state. Prepared/personal documents have no erroneous audio controls.
- Close preference defaults to existing close-to-tray behavior and persists per app. During startup, capture or stop-tail, every normal app-controlled exit entry (window close, tray Quit and ExitRequested/Cmd+Q) uses the same native guard and preserves the recording regardless of preference. Guard programmatic tray/app.exit calls before invoking them as defense in depth, including its forced-exit fallback on runtime request failure. Idle explicit exit still performs normal cleanup. This is not a promise to prevent crashes, forced OS termination or power loss.
- Acquire a compare-and-swap RAII STARTING guard synchronously before the first lifecycle-lock await in both real recording-start paths. Reject reentrant starts; Drop clears STARTING after validation/capture failure or unwind. On success publish ACTIVE before dropping STARTING. Read busy flags in STARTING→ACTIVE→STOPPING order so transitions cannot expose an unprotected gap. Test the RAII state machine with local atomics, without altering live global state.
- Never describe implemented playback/close UI as live-tested while the user's native GUI/audio pause remains in force. Existing audio timing defects remain documented; no checkpoint encoding change is imported here.

## Ownership and integration

- Native worker: migrations, document/workspace APIs, summary context, substitutions/Whisper/Parakeet integration and native tests. Do not edit lib.rs/tray.rs/audio/playback.rs/audio/mod.rs/close_policy.rs/tauri.conf.json or the visibility of audio/retranscription.rs::find_audio_file; send required command registrations to parent. Expose recording_commands::is_recording_active() including STARTING/ACTIVE/STOPPING to parent.
- Frontend worker: all frontend/src TS/TSX and frontend/tests, including folder browser/layout/context/vocabulary/playback/preferences. Do not edit native/config/manifests/CI/docs. Coordinate native command names and complete response fixtures.
- Parent: lib.rs/tray.rs/audio/playback.rs/audio/mod.rs/tauri.conf.json, CI/docs and integrated verification. Read-only independent reviewer evaluates design and changed behavior by ACCEPTANCE/DIFF_REGRESSION.
- Contributors share a worktree; never revert others' edits. No worker commits/pushes; parent commits bounded, attributed milestones.

## Verification and upstream delivery

- New behavior uses meaningful TDD. Existing imported tests are retained and adapted; new regression tests must fail before fixes. Do not call a dependency-fetch failure a RED behavior result.
- Actual SQLite upgrade/reopen/foreign-key checks, folder cycles/concurrency, durable editor/context save boundaries, vocabulary persistence/failure and secure playback paths, close policy recording/stop-tail protection.
- Isolated Bun suites, TypeScript, Next build, complete Rust library tests and arm64 Tauri build in CI. Heavy local native builds and live-app smoke are prohibited around the meeting.
- Independent design then implementation review; fix evidenced requirement failures or diff regressions, not unrelated upstream backlog.
- Prepare a personal integration PR and focused upstream contribution units based on upstream/devtest, keeping KH-only configuration out and acknowledging existing PRs. Avoid duplicate feature submissions while prerequisite PRs are unmerged; publish only suitable original units with accurate evidence.
- Personal PR merge requires concrete-result approval under kh-dispatch. Installed-app replacement remains separate from source delivery and is deferred beyond the user's meeting/testing boundary.

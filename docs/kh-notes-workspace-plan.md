# KH notes workspace MVP

Status: approved product scope; independent design review cleared after notes lifecycle, recording replay and durable-draft contract fixes.
Baseline: upstream/devtest `24f45338215455f3a52afddb5349acfecd7db5ba`.
Fork: https://github.com/kilhyeonjun/meetily (public upstream fork).

## Acceptance and boundaries

- Create a meeting before recording with title, optional schedule and editable agenda/notes. Persist through restart without microphone permissions or speech models.
- Start a recording from that meeting, attach audio/transcripts to the same ID, and retain its notes, title and folder. New recordings without a prepared meeting continue to work.
- Create independent personal notes without audio. Reuse the editor with autosave, visible save failure/retry and Markdown copying/export.
- Organize meetings and personal notes in single-level folders: create, rename, move, and remove a folder by returning its documents to Unfiled. Never delete documents or audio as a side effect of folder operations.
- Manual notes and generated summaries remain separate; summary regeneration must not overwrite notes.
- Existing SQLite migrations, recordings, transcript storage and installed stable app/data stay compatible and preserved.
- Excluded: tags, nested folders, automated Trash/purge, sync, AI search, calendar services, company integrations and OAuth-token copying.

## Proposed persistence and interfaces

- Keep existing `meetings` as the document identity table to preserve all current foreign keys. Add `document_type` (`meeting`/`note`, default `meeting` for existing rows), nullable `scheduled_at`, and nullable `folder_id`. The UI calls these documents; existing command names may remain compatible.
- Existing `meeting_notes` stores both prepared meeting notes and standalone note content. Reuse PR #849's editor/autosave/persistence and recovery behavior, retaining attribution and tests.
- Prepared meetings use their existing meeting ID and `meeting_notes` as the single note storage path before, during and after recording. Initialize the recording notes editor with existing content. Never run PR849's legacy recording-draft whole-note import for prepared meetings; legacy recordings without a document retain that draft path.
- Every document edit synchronously retains a durable local draft keyed by document ID before debounce. Clear only the exact version acknowledged by SQLite. On restart restore a draft only when its saved base still matches the DB, clear it if DB already contains that content, and retain/show an explicit recovery conflict if DB is newer. Storage failures stay visible. This protects the last debounce interval without relying on asynchronous `beforeunload` completion.
- Add `folders` with ID, nonempty name and timestamps. Unique case-insensitive names; one-level UI. No physical relocation of recordings for logical folder moves. Folder removal clears references transactionally.
- New native commands create documents, update schedule, create/rename/remove folders and move documents. Validate IDs and document types natively. Emit an existing-style documents/meetings change event after successful changes.
- Existing recording start accepts an optional prepared meeting ID. Validate it exists, is type meeting and has no recording attached before capture. Preserve the target ID in native recording metadata and stop/recovery payloads, not solely browser sessionStorage.
- Save transcript with an optional existing meeting ID. In one transaction either create the legacy new recording meeting, or attach to the still-unrecorded prepared meeting without rewriting its manual notes, title, schedule or logical folder. Reject an already recorded target rather than overwriting its audio/transcripts. Additional recording sessions per meeting are outside this MVP.
- Generate a native `recording_session_id` for each recording, persist it with target meeting ID in recording metadata, propagate to stop/recovery and store it on attachment. A retry of the same session returns the same meeting result without duplicate transcript inserts; a different session aimed at an already recorded meeting is rejected. Retain legacy compatibility for old recordings without a session ID.
- A standalone note has no recording controls. A prepared meeting has a Start Recording action and a useful empty transcript state. Recording failures retain the prepared document and notes.
- Search includes manual note text as well as transcripts; no external AI search.

## Integration candidates

- Notes PR #849 head `1ea2b33f4ddc20a7ef12b4872cc59913a0d67926`: reuse existing editor, notes repository, autosave/recovery and tests. It alone does not provide pre-recording documents.
- Folder PR #842 head `26e68aa4a1c51237a6e67ba34573abd22b081090`: reference/select folder behavior. Do not adopt its tags, Trash or file purge scheduler.
- Both target the baseline devtest and overlap in sidebar/search/recording stop/meeting details. Resolve these explicitly and test the composed result.

## Verification and delivery

- TDD for new behavior. Real SQLite tests exercise migrations, restart round-trips, note ownership, non-destructive folder removal, same-ID transcript attachment and duplicate recording rejection.
- Include prepared note A → record → edit A+B → stop/restart/recover preservation; commit-success/IPC-response-loss replay idempotency; and last edit → immediate close/restart with stale-draft conflict protection.
- Frontend tests cover note autosave/error recovery, meeting-vs-note actions, prepared-recording routing, and folder/document navigation.
- Run existing affected suites, TypeScript check, Next production build, Rust library tests and an Apple Silicon Tauri build. Attribute baseline failures with reproduction, not assumption.
- Disk availability on the development Mac is approximately 2 GiB; use public-fork standard macOS GitHub Actions runners for full Rust builds. Avoid unrelated cleanup or unbounded build caches/artifacts.
- Independent design review before implementation and independent implementation review before merge. Freeze review scope to this document and relevant diff regressions.
- Deliver a reviewable branch/PR and build artifact in the personal fork. Per dispatch contract, final PR merge requires explicit user approval after the concrete result is ready. Never write to the vendor repository or replace the stable app without the deployment decision.

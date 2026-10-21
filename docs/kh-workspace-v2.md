# Workspace v2

This integration extends prepared meetings and manual notes with nested folders and selected community improvements. Source work is isolated from the installed app. It is not installed or native-GUI/audio-verified yet.

## Working with folders

- The sidebar selects All documents, Unfiled or a folder. Expand folders to browse their children; the content browser shows the selected folder's immediate children and documents.
- Breadcrumbs, search, sorting and row menus support browsing and moving items. New meetings, notes and subfolders use the selected folder.
- Folder names are unique within their parent. Move cannot create a cycle. A folder containing subfolders must have them moved first; deleting a leaf folder sends its documents to Unfiled.
- Folder organization does not relocate audio files or delete recordings. The new migration preserves existing root folders, IDs and meeting memberships. Existing applied migrations are unchanged.

## Meeting tools

- Resize the sidebar and collapse the transcript pane while retaining the notes editor's state.
- Global and per-meeting summary context provide explicit instructions for Generate and Regenerate. Context is limited to4000 Unicode codepoints; manual notes are separate and are not automatically sent as context. Generation waits for pending meeting-context saves.
- Vocabulary rules correct literal spellings and provide Whisper glossary hints. Rules are stored under this app's data directory. A failed save keeps the previously active rules.
- Recorded meetings can play saved audio and seek from transcript timestamps. Missing recordings and prepared meetings without audio have no playback. Native lookup accepts a meeting ID and grants only its canonical audio file.
- Keep Running in Tray defaults on. Closing a busy recording window keeps it in the tray. Explicit Quit/Cmd+Q is blocked while recording starts, runs or is saved. This does not protect against a process crash, forced OS termination or power loss.

## Community attribution

The following source PRs informed or contributed to this integration. They are adapted to the KH document lifecycle and reviewed as integration changes; their authors' test reports are not substitutes for this branch's verification.

| Source | Author | Pinned source head | Adaptation |
| --- | --- | --- | --- |
| [PR817](https://github.com/Zackriya-Solutions/meetily/pull/817) | pedramamini | `888733d64a5ac33dc8d6451f2f3582ee4aaf172e` | Resizing and pane collapse, composed with notes |
| [PR848](https://github.com/Zackriya-Solutions/meetily/pull/848) | passabilities | `367c45f9229f265040203d2abe2f48dbbc8b27c4` | Global/meeting context, durable saves and fail-closed generation |
| [PR869](https://github.com/Zackriya-Solutions/meetily/pull/869) | dsskaggs-ai | `b82f50997cf58edb788732356f9acb6670c31ca2` | Vocabulary/glossary, per-app path, literal replacement and atomic saves |
| [PR543](https://github.com/Zackriya-Solutions/meetily/pull/543) | KoalaBear | `733d2700806906017ba75035043aff6006522d91` | Playback/seek with native ID-based exact-file scope |
| [PR864](https://github.com/Zackriya-Solutions/meetily/pull/864) | arvanus | `69ab949157f4b0d288385166e943c1ce809b766d` | Close preference plus all normal quit paths and startup protection |

The prior notes integration retains PR849 attribution. No imported feature is resubmitted upstream as an original contribution.

## Verification and delivery

- Independent design review cleared the persistence, draft, path and exit contracts in [the plan](plans/2026-10-21-workspace-v2.md). Implementation review and complete CI remain delivery requirements.
- Local standalone Rust tests cover shared close policy and real filesystem playback path boundaries; full Rust/arm64 verification runs in KH CI. Frontend suites run in isolated Bun processes.
- The installed app is frozen for the user's2026-10-21 15:00 KST meeting. Do not install a build, restart it or change its settings/data as part of source delivery.
- Actual WebView, microphone/system audio, mixed-language capture, saved audio timing and native close interactions remain pending until the user reports computer use is available. No screenshots or manual-test success are claimed.
- A personal integration PR and focused original upstream units are separate deliverables. Upstream units must start at upstream/devtest and exclude KH branding, fork CI and unrelated schema/UI changes. Existing open feature PRs remain attributed dependencies, not duplicate submissions.

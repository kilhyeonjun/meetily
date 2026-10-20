# Meetily KH workspace

This personal fork adds prepared meetings, standalone notes and single-level
folders. Its notes editor is based on the work in upstream
[PR #849](https://github.com/Zackriya-Solutions/meetily/pull/849)
(`1ea2b33f4ddc20a7ef12b4872cc59913a0d67926`). Folder behavior was reviewed
against [PR #842](https://github.com/Zackriya-Solutions/meetily/pull/842);
tags, Trash and automatic file purging are outside this fork's MVP.

## Everyday use

On first launch, choose **Use notes first** to prepare documents without speech
model downloads or audio permissions. Use **Set up recording** when ready to
configure recording; this does not mark missing models as downloaded.

1. Choose **New meeting** in the sidebar to prepare an agenda before recording.
   Use **New note** for a personal note that does not need audio.
2. Edit notes directly. The save indicator reports saving, saved or failed;
   failed saves can be retried. Copy/export produces Markdown.
3. For a meeting, set an optional scheduled time and choose **Save details**.
   Title and schedule use this explicit save action; the note body autosaves.
4. Choose **Start Recording** from a prepared meeting to attach its audio and
   transcripts to that same document. Its existing notes stay with it.
5. Choose **New folder**, then use a document's folder selector to organize it.
   Removing a folder returns its documents to **Unfiled** and preserves content.

Manual notes are stored separately from generated summaries. A recording
session can be recovered or retried without creating a second meeting.
This MVP supports one recording attachment per prepared meeting.

## Persistence

Notes, document metadata and logical folder membership live in local SQLite.
Pending editor changes have a document-specific local recovery draft. When
that draft conflicts with newer saved content, the UI offers recovery rather
than silently replacing the newer content.

Moving a document between logical folders does not relocate its audio files.
Recordings remain accessible in the app's recording folder, with a unique
physical directory for each recording session.

## Build and verify

Use pnpm 9.15.9 with the committed lockfile. Run frontend suites in separate
Bun processes because upstream suites install module mocks:

```sh
cd frontend
pnpm install --frozen-lockfile
node ../.github/scripts/run-frontend-tests.mjs
pnpm exec tsc --noEmit
pnpm build
```

The **KH Apple Silicon verification** workflow also runs native Rust library
tests and builds the summary sidecar and macOS app. It produces a short-lived
arm64 app artifact with an ad-hoc signature; it is not an Apple-notarized release.

The KH build profile `frontend/src-tauri/tauri.kh.conf.json` uses the name
**Meetily KH** and identifier `com.kilhyeonjun.meetily`. It has separate SQLite
and WebView storage from the vendor app. Models and saved meetings are not
automatically migrated from the vendor installation. The original app and
its data can remain installed while the fork is evaluated.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from '@blocknote/core';
import { parseNotesBlocks, type NotesContent } from '@/lib/meeting-notes';
import { notifyUnsavedNotes } from '@/lib/notes-toast';
import { createNotesAutosaver, type NotesSaveState } from '@/lib/notes-autosave';
import { documentDraftStore } from '@/services/documentDraft';
import { notesService } from '@/services/notesService';

export type NotesLoadState = 'loading' | 'ready' | 'error';

interface LoadedNotes {
  meetingId: string;
  blocks: Block[] | null;
  markdown: string;
}

/**
 * Loads a meeting's note and saves edits automatically.
 * Loaded content and save status are tagged with their meeting, so nothing
 * from one meeting is shown or saved under another while switching.
 */
export function useMeetingNotes(meetingId: string, saveDelayMs = 1000) {
  const versionsRef = useRef(new WeakMap<NotesContent, string>());
  const baseRef = useRef(new Map<string, NotesContent>());
  const [draftError, setDraftError] = useState(false);
  const [conflict, setConflict] = useState<NotesContent | null>(null);
  const [loaded, setLoaded] = useState<LoadedNotes | null>(null);
  const [failedMeetingId, setFailedMeetingId] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveStatus, setSaveStatus] = useState<{ meetingId: string; state: NotesSaveState }>({
    meetingId,
    state: 'idle',
  });

  const autosaver = useMemo(
    () =>
      createNotesAutosaver({
        save: async (content) => {
          await notesService.save(meetingId, content);
          baseRef.current.set(meetingId, content);
          if (typeof window !== 'undefined') {
            try { documentDraftStore().acknowledge(meetingId, content, versionsRef.current.get(content)); setDraftError(false); }
            catch { setDraftError(true); }
          }
        },
        delayMs: saveDelayMs,
        onStateChange: (state) => setSaveStatus({ meetingId, state }),
      }),
    [meetingId, saveDelayMs],
  );

  // Save pending edits when the meeting changes, the view closes, or the window closes.
  useEffect(() => {
    const flush = () => {
      void autosaver.flush();
    };
    // This autosaver is about to be discarded, so a failed save must be retried
    // here and, if it still fails, reported while the text can still be copied.
    const flushOnLeave = async () => {
      await autosaver.flush();
      if (autosaver.hasUnsaved()) await autosaver.retry();
      if (!autosaver.hasUnsaved()) return;
      const markdown = autosaver.latest()?.markdown ?? '';
      notifyUnsavedNotes({
        level: 'error',
        title: "Couldn't save notes",
        description: 'Your last edits to the previous meeting were not saved. Copy them now so they are not lost.',
        markdown,
      });
    };
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', flush);
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('beforeunload', flush);
      void flushOnLeave();
    };
  }, [autosaver]);

  useEffect(() => {
    let cancelled = false;
    setFailedMeetingId(null);
    notesService
      .get(meetingId)
      .then((stored) => {
        if (cancelled) return;
        const base = {blocks: parseNotesBlocks(stored?.notes_json) ?? [], markdown: stored?.markdown ?? ''};
        baseRef.current.set(meetingId, base);
        setConflict(null);
        let content = base;
        if (typeof window !== 'undefined') {
          try {
            const recovery = documentDraftStore().recover(meetingId, base);
            if (recovery.status === 'restore') { content = recovery.content; versionsRef.current.set(content, recovery.version); autosaver.schedule(content); }
            if (recovery.status === 'conflict') setConflict(recovery.content);
            setDraftError(false);
          } catch { setDraftError(true); }
        }
        setLoaded({meetingId, blocks: content.blocks.length ? content.blocks : null, markdown: content.markdown});
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load meeting notes', error);
        setFailedMeetingId(meetingId);
      });
    return () => {
      cancelled = true;
      // Content loaded for this meeting is stale once it is left, so coming back reloads it.
      setLoaded(null);
    };
  }, [meetingId, loadAttempt, autosaver]);

  // Only content that was loaded for the meeting now on screen counts.
  const ready = loaded && loaded.meetingId === meetingId ? loaded : null;
  const loadState: NotesLoadState = ready ? 'ready' : failedMeetingId === meetingId ? 'error' : 'loading';
  const storedMarkdown = ready?.markdown ?? '';
  const storedMarkdownRef = useRef(storedMarkdown);
  storedMarkdownRef.current = storedMarkdown;

  const handleChange = useCallback((content: NotesContent) => {
    if (typeof window !== 'undefined') {
      try { const version=documentDraftStore().write(meetingId, baseRef.current.get(meetingId) ?? {blocks: [], markdown: ''}, content); versionsRef.current.set(content,version); setDraftError(false); }
      catch { setDraftError(true); }
    }
    autosaver.schedule(content);
  }, [autosaver, meetingId]);
  const retrySave = useCallback(() => {
    void autosaver.retry();
  }, [autosaver]);
  const reload = useCallback(() => {
    // Pending edits are saved first so the reload cannot show older content over them.
    void autosaver.flush().then(() => {
      // A failed save leaves the newer edit unsaved, and loading would show older content over it.
      if (!autosaver.hasUnsaved()) setLoadAttempt((attempt) => attempt + 1);
    });
  }, [autosaver]);
  const getMarkdown = useCallback(
    () => autosaver.latest()?.markdown ?? storedMarkdownRef.current,
    [autosaver],
  );

  return {
    loadState,
    draftError,
    conflict,
    discardConflict: () => {
      try { documentDraftStore().discard(meetingId); setConflict(null); setDraftError(false); }
      catch { setDraftError(true); }
    },
    saveState: saveStatus.meetingId === meetingId ? saveStatus.state : ('idle' as NotesSaveState),
    initialBlocks: ready?.blocks ?? null,
    initialMarkdown: storedMarkdown,
    handleChange,
    retrySave,
    reload,
    getMarkdown,
  };
}

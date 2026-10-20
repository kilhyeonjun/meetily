import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const originalDynamic = { ...await import('next/dynamic') };
const originalMarkdown = { ...await import('../../src/lib/blocknote-markdown') };
const originalCore = { ...await import('@tauri-apps/api/core') };
const oldWindow = globalThis.window;
const storage = new Map<string, string>();
let editorChange: (blocks: any[]) => void;
const initial = [{ id: 'base', type: 'paragraph', content: [{ type: 'text', text: 'base', styles: {} }], children: [] }];
function FakeEditor(props: any) {
  editorChange = props.onChange;
  useEffect(() => { props.onEditorReady({ document: props.initialContent ?? initial }); }, []);
  return null;
}
const releases: Array<(value: { markdown: string }) => void> = [];
mock.module('next/dynamic', () => ({ ...originalDynamic, default: () => FakeEditor }));
mock.module('../../src/lib/blocknote-markdown', () => ({ ...originalMarkdown, blocksToMarkdownSafely: () => new Promise(resolve => releases.push(resolve)) }));
let stored: {markdown:string; notes_json:string|null} | null;
mock.module('@tauri-apps/api/core', () => ({ ...originalCore, invoke: async (command: string, args?:any) => {
  if (command === 'api_get_meeting_notes') return stored;
  if (command === 'api_save_meeting_notes') {
    const structured=args.notesJson ? JSON.parse(args.notesJson) : [];
    // Match the native contract: raw structured snapshots survive even while
    // Markdown is empty; only an actually empty note removes the stored row.
    stored = !args.markdown.trim() && structured.length === 0
      ? null : {markdown:args.markdown,notes_json:args.notesJson};
    return;
  }
  throw Error(command);
}}));
const { useMeetingNotes } = await import('../../src/hooks/meeting-details/useMeetingNotes');
const { NotesPanel } = await import('../../src/components/MeetingNotes/NotesPanel');
const { createDocumentDraftStore } = await import('../../src/services/documentDraft');
const draftStorage = {getItem: (key:string) => storage.get(key) ?? null, setItem: (key:string,value:string) => storage.set(key,value), removeItem: (key:string) => storage.delete(key)};
let latestNotes: ReturnType<typeof useMeetingNotes>;
function Harness() {
  const notes = useMeetingNotes('document', 10000);
  latestNotes=notes;
  return <NotesPanel loadState={notes.loadState} saveState={notes.saveState} initialBlocks={notes.initialBlocks} initialMarkdown={notes.initialMarkdown} onChange={notes.handleChange}/>;
}
let renderer: ReactTestRenderer | undefined;
beforeEach(() => { stored={markdown:'base',notes_json:JSON.stringify(initial)}; });
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; globalThis.window = oldWindow; storage.clear(); releases.length=0; });
afterAll(() => { mock.module('next/dynamic', () => originalDynamic); mock.module('../../src/lib/blocknote-markdown', () => originalMarkdown); mock.module('@tauri-apps/api/core', () => originalCore); });
test('real NotesPanel synchronously retains raw editor blocks before a deferred Markdown conversion', async () => {
  globalThis.window = {localStorage: draftStorage, addEventListener(){}, removeEventListener(){}} as any;
  await act(async () => { renderer=create(<Harness/>); });
  const blocks=[{...initial[0], id:'typed', content:[{type:'text',text:'last key',styles:{bold:true}}]}];
  act(() => editorChange(blocks));
  expect(releases.length).toBe(1);
  const draft=createDocumentDraftStore(draftStorage).recover('document',{blocks:initial as any,markdown:'base'});
  expect(draft).toMatchObject({status:'restore',content:{blocks,markdown:'last key'}});
  const second=[{...blocks[0],id:'newer',content:[{type:'text',text:'newer key',styles:{}}]}];
  act(() => editorChange(second));
  await act(async () => { releases[0]({markdown:'**last key**'}); });
  expect(createDocumentDraftStore(draftStorage).recover('document',{blocks:initial as any,markdown:'base'})).toMatchObject({content:{markdown:'newer key',blocks:second}});
  await act(async () => { releases[1]({markdown:'newer **key**'}); });
  expect(createDocumentDraftStore(draftStorage).recover('document',{blocks:initial as any,markdown:'base'})).toMatchObject({content:{markdown:'newer **key**',blocks:second}});
});
test('closing the real editor invalidates deferred Markdown enrichment', async () => {
  globalThis.window = {localStorage: draftStorage, addEventListener(){}, removeEventListener(){}} as any;
  await act(async () => { renderer=create(<Harness/>); });
  const blocks=[{...initial[0], id:'last', content:[{type:'text',text:'typed before close',styles:{}}]}];
  act(() => editorChange(blocks));
  expect(storage.size).toBe(1);
  await act(async () => renderer!.unmount());
  renderer=undefined;
  expect(storage.size).toBe(0); // the synchronous snapshot was acknowledged by the save
  await act(async () => { releases[0]({markdown:'**typed before close**'}); });
  expect(storage.size).toBe(0); // no stale callback recreated a draft after leaving
});

test('nontext blocks survive close before Markdown conversion and reopen from structured native notes', async () => {
  globalThis.window = {localStorage: draftStorage, addEventListener(){}, removeEventListener(){}} as any;
  await act(async () => { renderer=create(<Harness/>); });
  const image=[{id:'image',type:'image',props:{url:'local-image'},children:[]}];
  act(() => editorChange(image));
  expect(createDocumentDraftStore(draftStorage).recover('document',{blocks:initial as any,markdown:'base'})).toMatchObject({content:{blocks:image,markdown:''}});
  await act(async () => renderer!.unmount());
  renderer=undefined;
  expect(stored).toEqual({markdown:'',notes_json:JSON.stringify(image)});
  await act(async () => { renderer=create(<Harness/>); });
  expect(latestNotes.loadState).toBe('ready');
  expect(latestNotes.initialBlocks).toEqual(image as any);
  expect(latestNotes.initialMarkdown).toBe('');
});

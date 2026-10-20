import type { NotesContent } from '@/lib/meeting-notes';
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
let sequence = 0;
interface Draft { version: string; base: string; content: NotesContent }
const key = (id: string) => `meetily.document-draft.v1:${id}`;
const fingerprint = (content: NotesContent) => JSON.stringify([content.markdown, content.blocks]);
export function createDocumentDraftStore(storage: StorageLike) {
  const read = (id: string): Draft | null => {
    const raw = storage.getItem(key(id));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    if (typeof draft.base !== 'string' || typeof draft.content?.markdown !== 'string' || !Array.isArray(draft.content.blocks)) throw Error('Invalid local notes draft');
    return draft;
  };
  return {
    write(id: string, base: NotesContent, content: NotesContent) {
      const version = `${Date.now()}:${++sequence}`;
      storage.setItem(key(id), JSON.stringify({version, base: fingerprint(base), content}));
      return version;
    },
    acknowledge(id: string, content: NotesContent, version?: string) {
      const draft = read(id);
      if (!draft) return;
      if ((version === undefined || draft.version === version) && fingerprint(draft.content) === fingerprint(content)) storage.removeItem(key(id));
      else storage.setItem(key(id), JSON.stringify({...draft,base:fingerprint(content)}));
    },
    recover(id: string, stored: NotesContent): {status:'none'} | {status:'restore'|'conflict';content:NotesContent;version:string} {
      const draft = read(id);
      if (!draft) return {status:'none'};
      if (fingerprint(draft.content) === fingerprint(stored)) {storage.removeItem(key(id));return {status:'none'};}
      return {status: draft.base === fingerprint(stored) ? 'restore' : 'conflict',content:draft.content,version:draft.version};
    },
    discard(id: string) { storage.removeItem(key(id)); },
  };
}
export function documentDraftStore() { return createDocumentDraftStore(window.localStorage); }

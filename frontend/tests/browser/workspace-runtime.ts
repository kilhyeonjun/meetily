import type { DocumentProperty, PropertyInput } from '../../src/services/documentService';
// In-memory IPC boundary for repeatable UI tests. Never reads the installed app.
const stamp = '2026-10-22T07:00:00Z';
let folders = [
  { id: 'research', name: 'Research', parent_id: null, created_at: stamp, updated_at: stamp },
  {
    id: 'weekly',
    name: 'Weekly planning',
    parent_id: 'research',
    created_at: stamp,
    updated_at: stamp,
  },
  { id: 'design', name: 'Design', parent_id: null, created_at: stamp, updated_at: stamp },
  {
    id: 'long',
    name: '프로젝트 일정과 회의 자료 · Product delivery planning',
    parent_id: null,
    created_at: stamp,
    updated_at: stamp,
  },
];
let documents: Array<{
  id: string;
  title: string;
  document_type: string;
  folder_id: string | null;
  scheduled_at: string | null;
  updated_at: string;
}> = [
  {
    id: 'agenda',
    title: 'API and deployment planning',
    document_type: 'meeting',
    folder_id: 'research',
    scheduled_at: null,
    updated_at: stamp,
  },
  {
    id: 'ideas',
    title: '제품 개선 아이디어 · Product ideas',
    document_type: 'note',
    folder_id: 'research',
    scheduled_at: null,
    updated_at: stamp,
  },
];
// Storage is scoped to each isolated Playwright browser context, not app data.
const persisted = sessionStorage.getItem('workspace-fixture');
if (persisted) ({folders, documents} = JSON.parse(persisted));
let properties: Record<string, DocumentProperty[]> = JSON.parse(sessionStorage.getItem('workspace-properties') || '{}');
function persist() {
  sessionStorage.setItem('workspace-fixture', JSON.stringify({folders, documents}));
  sessionStorage.setItem('workspace-properties', JSON.stringify(properties));
}
export async function invoke(command: string, args: Record<string, any> = {}) {
  switch (command) {
    case 'api_get_document':
      return { ...structuredClone(documents.find(doc => doc.id === args.documentId)), created_at: stamp, folder_path: null, recording_session_id: null, has_recording: false };
    case 'api_get_document_properties':
      return structuredClone(properties[args.documentId] ?? []);
    case 'api_set_document_properties': {
      const previous = new Map((properties[args.documentId] ?? []).map(property => [property.id, property]));
      properties[args.documentId] = args.properties.map((property: PropertyInput, position: number) => {
        const owned = property.id ? previous.get(property.id) : undefined;
        if (owned) previous.delete(owned.id);
        return {...property, id: owned?.id ?? crypto.randomUUID(), meeting_id: args.documentId, position, created_at: owned?.created_at ?? stamp, updated_at: stamp};
      });
      persist();
      return structuredClone(properties[args.documentId]);
    }
    case 'open_external_url':
      return;
    case 'api_get_folders':
      return structuredClone(folders);
    case 'api_get_documents':
      return structuredClone(documents);
    case 'api_create_document': {
      const doc = {
        id: `created-${documents.length}`,
        title: args.title,
        document_type: args.documentType,
        folder_id: args.folderId,
        scheduled_at: args.scheduledAt,
        updated_at: stamp,
      };
      documents.push(doc);
      return doc;
    }
    case 'api_create_folder':
      folders.push({
        id: `folder-${folders.length}`,
        name: args.name,
        parent_id: args.parentId,
        created_at: stamp,
        updated_at: stamp,
      });
      return;
    case 'api_update_document':
      documents = documents.map((doc) =>
        doc.id === args.documentId ? { ...doc, title: args.title, scheduled_at: args.scheduledAt } : doc,
      );
      persist();
      return;
    case 'api_move_document':
      documents = documents.map((doc) =>
        doc.id === args.documentId ? { ...doc, folder_id: args.folderId } : doc,
      );
      persist();
      return;
    case 'api_rename_folder':
      folders = folders.map((folder) =>
        folder.id === args.folderId ? { ...folder, name: args.name } : folder,
      );
      return;
    case 'api_move_folder':
      folders = folders.map((folder) =>
        folder.id === args.folderId ? { ...folder, parent_id: args.parentId } : folder,
      );
      return;
    case 'api_remove_folder':
      folders = folders.filter((folder) => folder.id !== args.folderId);
      documents = documents.map((doc) =>
        doc.folder_id === args.folderId ? { ...doc, folder_id: null } : doc,
      );
      return;
    default:
      throw new Error(`Unexpected fixture IPC: ${command}`);
  }
}
export const listen = async () => () => {};
export const router = {
  push(href: string) {
    history.pushState({}, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  },
  back() {
    history.back();
  },
};
export const useRouter = () => router;
export const useSidebar = () => ({refetchMeetings: async () => {}});
export const useRecordingState = () => ({isRecording: false});

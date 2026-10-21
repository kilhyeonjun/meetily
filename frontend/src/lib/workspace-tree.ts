import type { DocumentFolder, DocumentInfo } from '@/services/documentService';
export type WorkspaceDestination = string;
export function folderAncestors(id: string, folders: DocumentFolder[]): DocumentFolder[] {
  const result: DocumentFolder[] = [];
  const seen = new Set<string>();
  let current = folders.find(folder => folder.id === id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id); result.unshift(current);
    current = folders.find(folder => folder.id === current!.parent_id);
  }
  return result;
}
export const folderPath = (id: string, folders: DocumentFolder[]) => '/' + folderAncestors(id, folders).map(folder => folder.name).join('/');
export function folderMoveTargets(folderId: string | null, folders: DocumentFolder[]) {
  return folders.filter(folder => !folderId || !folderAncestors(folder.id, folders).some(ancestor => ancestor.id === folderId));
}
export function workspaceContents(id: WorkspaceDestination, folders: DocumentFolder[], documents: DocumentInfo[], query: string, sort: 'title' | 'updated') {
  const matches = (name: string) => name.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const children = id === 'unfiled' ? [] : folders.filter(folder => (folder.parent_id ?? null) === (id === 'all' ? null : id) && matches(folder.name));
  const docs = documents.filter(document => (id === 'all' || document.folder_id === (id === 'unfiled' ? null : id)) && matches(document.title));
  return {
    folders: [...children].sort((a,b) => a.name.localeCompare(b.name)),
    documents: [...docs].sort((a,b) => sort === 'title' ? a.title.localeCompare(b.title) : b.updated_at.localeCompare(a.updated_at)),
  };
}
export const workspaceHref = (id: string) => `/workspace?folderId=${encodeURIComponent(id)}`;
export const realFolderId = (id: string) => id === 'all' || id === 'unfiled' ? null : id;

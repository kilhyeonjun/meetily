import { invoke } from '@tauri-apps/api/core';
export interface DocumentInfo {
  id: string; title: string; document_type: 'meeting' | 'note'; scheduled_at: string | null;
  folder_id: string | null; folder_path: string | null; recording_session_id: string | null;
  has_recording: boolean;
  created_at: string; updated_at: string;
}
export interface DocumentFolder {id:string;name:string;parent_id:string|null;created_at:string;updated_at:string}
export const isUnrecordedDocument = (document: DocumentInfo) => !document.has_recording;
export const canRecordDocument = (document: DocumentInfo) => document.document_type === 'meeting' && isUnrecordedDocument(document);
export const documentService = {
  list: () => invoke<DocumentInfo[]>('api_get_documents'),
  get: (documentId:string) => invoke<DocumentInfo>('api_get_document',{documentId}),
  create: (title:string,documentType:'meeting'|'note', scheduledAt:string|null = null,folderId:string|null = null) => invoke<DocumentInfo>('api_create_document',{title,documentType,scheduledAt,folderId}),
  update: (documentId:string,title:string,scheduledAt:string|null) => invoke('api_update_document',{documentId,title,scheduledAt}),
  folders: () => invoke<DocumentFolder[]>('api_get_folders'),
  createFolder: (name:string,parentId?:string|null) => invoke('api_create_folder',{name,...(parentId !== undefined ? {parentId} : {})}),
  moveFolder: (folderId:string,parentId:string|null) => invoke('api_move_folder',{folderId,parentId}),
  renameFolder: (folderId:string,name:string) => invoke('api_rename_folder',{folderId,name}),
  removeFolder: (folderId:string) => invoke('api_remove_folder',{folderId}),
  move: (documentId:string,folderId:string|null) => invoke('api_move_document',{documentId,folderId}),
};

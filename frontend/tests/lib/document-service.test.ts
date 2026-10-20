import { afterAll, expect, mock, test } from 'bun:test';
const original = {...await import('@tauri-apps/api/core')};
const calls:Array<[string,unknown]>=[];
mock.module('@tauri-apps/api/core',()=>({...original,invoke:async(command:string,args:unknown)=>{calls.push([command,args]);return {id:'prepared'};}}));
afterAll(()=>mock.module('@tauri-apps/api/core',()=>original));
const {documentService,canRecordDocument,isUnrecordedDocument}=await import('../../src/services/documentService');
const doc={id:'prepared',title:'Plan',document_type:'meeting' as const,scheduled_at:null,folder_id:'folder',folder_path:null,recording_session_id:null,has_recording:false,created_at:'now',updated_at:'now'};
test('prepared meeting records once; standalone notes never offer recording',()=>{expect(canRecordDocument(doc)).toBe(true);expect(canRecordDocument({...doc,document_type:'note'})).toBe(false);expect(canRecordDocument({...doc,recording_session_id:'recorded',has_recording:true})).toBe(false);expect(isUnrecordedDocument({...doc,folder_path:'/existing/audio',has_recording:true})).toBe(false);});
test('create document passes metadata without starting recording or loading a model',async()=>{calls.length=0;await documentService.create('Agenda','meeting','2026-10-20T00:00:00Z','folder');expect(calls).toEqual([['api_create_document',{title:'Agenda',documentType:'meeting',scheduledAt:'2026-10-20T00:00:00Z',folderId:'folder'}]]);});
test('folder move and removal use logical commands without document deletion',async()=>{calls.length=0;await documentService.move('prepared',null);await documentService.removeFolder('folder');expect(calls).toEqual([['api_move_document',{documentId:'prepared',folderId:null}],['api_remove_folder',{folderId:'folder'}]]);});

test('legacy transcript-only and summary-only meetings remain recorded with no path/session ID',()=>{for(const title of ['Legacy transcript','Legacy summary']){const legacy={...doc,title,folder_path:null,recording_session_id:null,has_recording:true};expect(isUnrecordedDocument(legacy)).toBe(false);expect(canRecordDocument(legacy)).toBe(false);}});

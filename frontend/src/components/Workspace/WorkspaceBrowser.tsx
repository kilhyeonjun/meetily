'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Folder, FolderPlus, FileText, NotebookPen, CalendarPlus, Inbox, Search, ArrowLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { documentService } from '@/services/documentService';
import { folderAncestors, realFolderId, workspaceContents, workspaceHref } from '@/lib/workspace-tree';
import { useWorkspace } from './WorkspaceProvider';
import { WorkspaceActions, dragItem, droppedItem } from './WorkspaceActions';

export function WorkspaceBrowser({folderId}:{folderId?:string}) {
  const router=useRouter();const workspace=useWorkspace();
  const selected=folderId??workspace.selectedId;
  const [query,setQuery]=useState('');const [sort,setSort]=useState<'title'|'updated'>('title');
  const [form,setForm]=useState<'meeting'|'note'|'folder'|null>(null);const [name,setName]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  const current=realFolderId(selected);
  const updated=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'—';
  const control='inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  useEffect(()=>{if(folderId)workspace.select(folderId);},[folderId,workspace.select]);
  const {folders,documents}=workspaceContents(selected,workspace.folders,workspace.documents,query,sort);
  const navigate=(id:string)=>{workspace.select(id);router.push(workspaceHref(id));};
  const create=async(event:FormEvent)=>{
    event.preventDefault();if(!name.trim()||!form)return;setBusy(true);setError(null);
    try {
      await workspace.mutate(async()=>{if(form==='folder')await documentService.createFolder(name.trim(),current);else{const doc=await documentService.create(name.trim(),form,null,current);router.push(`/meeting-details?id=${encodeURIComponent(doc.id)}`);}});
      setForm(null);setName('');
    }catch(cause){setError(String(cause));}finally{setBusy(false);}
  };
  if(workspace.loading)return <p role="status">Loading workspace…</p>;
  if(workspace.error)return <p role="alert">{workspace.error}<button onClick={()=>void workspace.reload()}>Retry</button></p>;
  if(current&&!workspace.folders.some(folder=>folder.id===current))return <p role="alert">This folder is unavailable. <button className="text-sm text-blue-700 hover:underline" onClick={()=>navigate('all')}>All documents</button></p>;
  return <section aria-label="Workspace browser" className="p-4 space-y-4">
    <nav aria-label="Folder breadcrumbs" className="flex flex-wrap gap-2"><button className={control} onClick={()=>router.back()}><ArrowLeft className="h-4 w-4"/>Back</button><button className="text-sm text-blue-700 hover:underline" onClick={()=>navigate('all')}>All documents</button>{selected==='unfiled'?<span>/ Unfiled</span>:current&&folderAncestors(current,workspace.folders).map(folder=><button key={folder.id} onClick={()=>navigate(folder.id)}>/ {folder.name}</button>)}</nav>
    <h1 className="text-2xl font-semibold">{current?workspace.folders.find(folder=>folder.id===current)?.name:selected==='unfiled'?'Unfiled':'All documents'}</h1>
    <div className="flex flex-wrap gap-2">{(['meeting','note','folder'] as const).map(type=><button className={control} key={type} onClick={()=>{setForm(type);setName('');setError(null);}}>{type==='folder'?<FolderPlus className="h-4 w-4"/>:type==='note'?<NotebookPen className="h-4 w-4"/>:<CalendarPlus className="h-4 w-4"/>}{type==='folder'?(current?'New subfolder':'New folder'):`New ${type}`}</button>)}<button className={control} onClick={()=>navigate('unfiled')}><Inbox className="h-4 w-4"/>Unfiled</button></div>
    {form&&<form onSubmit={create} className="flex gap-2"><input autoFocus aria-label="Name" className="rounded border p-2" value={name} onChange={event=>setName(event.target.value)}/><button type="submit" disabled={busy||!name.trim()}>{busy?'Saving…':'Save'}</button><button type="button" onClick={()=>setForm(null)}>Cancel</button></form>}
    <div className="flex gap-3"><input aria-label="Search this folder" placeholder="Search this folder" className="rounded border p-2" value={query} onChange={event=>setQuery(event.target.value)}/><label>Sort <select value={sort} onChange={event=>setSort(event.target.value as typeof sort)}><option value="title">Name</option><option value="updated">Recently updated</option></select></label></div>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    <div className="grid grid-cols-[minmax(0,1fr)_6rem_8rem_2rem] gap-3 px-3 text-xs font-medium uppercase tracking-wide text-gray-500"><span>Name</span><span>Kind</span><span>Updated</span><span className="sr-only">Actions</span></div>
    <div className="divide-y rounded-lg border border-gray-200 bg-white" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const item=droppedItem(event);if(item)void workspace.move(item,current).catch(cause=>setError(String(cause)));}}>
      {folders.map(folder=><div data-folder-row={folder.id} className="grid grid-cols-[minmax(0,1fr)_6rem_8rem_2rem] gap-3 items-center p-3 hover:bg-gray-50" key={folder.id} draggable onDragStart={event=>dragItem(event,{type:'folder',id:folder.id})} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();event.stopPropagation();const item=droppedItem(event);if(item)void workspace.move(item,folder.id).catch(cause=>setError(String(cause)));}}><button className="inline-flex items-center gap-2 truncate text-left rounded focus-visible:ring-2 focus-visible:ring-blue-500" onClick={()=>navigate(folder.id)}><Folder className="h-5 w-5 shrink-0 text-blue-600"/><span className="truncate">{folder.name}</span></button><span className="text-sm text-gray-500">Folder</span><time className="text-xs text-gray-500" dateTime={folder.updated_at}>{updated(folder.updated_at)}</time><WorkspaceActions item={{type:'folder',id:folder.id}} label={folder.name}/></div>)}
      {documents.map(doc=><div className="grid grid-cols-[minmax(0,1fr)_6rem_8rem_2rem] gap-3 items-center p-3 hover:bg-gray-50" key={doc.id} draggable onDragStart={event=>dragItem(event,{type:'document',id:doc.id})}><button className="inline-flex items-center gap-2 truncate text-left rounded focus-visible:ring-2 focus-visible:ring-blue-500" onClick={()=>router.push(`/meeting-details?id=${encodeURIComponent(doc.id)}`)}>{doc.document_type==='note'?<NotebookPen className="h-5 w-5 shrink-0 text-gray-500"/>:<FileText className="h-5 w-5 shrink-0 text-gray-500"/>}<span className="truncate">{doc.title}</span></button><span className="text-sm text-gray-500">{doc.document_type==='note'?'Personal note':'Meeting'}</span><time className="text-xs text-gray-500" dateTime={doc.updated_at}>{updated(doc.updated_at)}</time><WorkspaceActions item={{type:'document',id:doc.id}} label={doc.title}/></div>)}
      {!folders.length&&!documents.length&&<p className="p-6 text-gray-500">{query?'No matching items.':'This destination is empty. Create a note, meeting or folder to get started.'}</p>}
    </div>
  </section>;
}

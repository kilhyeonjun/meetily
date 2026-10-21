'use client';
import { useState, type DragEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { documentService } from '@/services/documentService';
import { folderMoveTargets, folderPath } from '@/lib/workspace-tree';
import { useWorkspace } from './WorkspaceProvider';
export interface WorkspaceItem {type:'folder'|'document';id:string}
const MIME='application/x-meetily-item';
export function dragItem(event:DragEvent,item:WorkspaceItem) {event.dataTransfer.setData(MIME,JSON.stringify(item));event.dataTransfer.effectAllowed='move';}
export function droppedItem(event:DragEvent):WorkspaceItem|null {
  try {const item=JSON.parse(event.dataTransfer.getData(MIME));return (item.type==='folder'||item.type==='document')&&typeof item.id==='string'?item:null;}catch{return null;}
}
export function WorkspaceActions({item,label}:{item:WorkspaceItem;label:string}) {
  const {folders,documents,mutate,move}=useWorkspace();
  const [action,setAction]=useState<'rename'|'move'|'remove'|null>(null);
  const [name,setName]=useState(label);const [query,setQuery]=useState('');const [target,setTarget]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  const children=folders.some(folder=>folder.parent_id===item.id);
  const targets=folderMoveTargets(item.type==='folder'?item.id:null,folders).filter(folder=>folderPath(folder.id,folders).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const commit=async()=>{
    setBusy(true);setError(null);
    try {
      if(action==='move')await move(item,target);
      if(action==='rename')await mutate(()=>item.type==='folder'?documentService.renameFolder(item.id,name.trim()):documentService.update(item.id,name.trim(),documents.find(doc=>doc.id===item.id)?.scheduled_at??null));
      if(action==='remove')await mutate(()=>documentService.removeFolder(item.id));
      setAction(null);
    }catch(cause){setError(String(cause));}finally{setBusy(false);}
  };
  const open=(next:typeof action)=>{setName(label);setError(null);setAction(next);};
  return <span onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
    <details className="relative inline-block"><summary aria-label={`Actions for ${label}`} className="cursor-pointer rounded p-1 hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500"><MoreHorizontal className="h-4 w-4"/></summary><div className="absolute right-0 z-20 min-w-32 rounded border bg-white p-2 shadow"><button className="block py-1" onClick={()=>open('rename')}>Rename</button><button className="block py-1" onClick={()=>open('move')}>Move</button>{item.type==='folder'&&<button className="block py-1" onClick={()=>open('remove')}>Remove folder</button>}</div></details>
    {action&&<div role="dialog" aria-label={`${action} ${label}`} aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"><div className="w-full max-w-md rounded bg-white p-5 shadow-xl space-y-3">
      <h2 className="font-semibold">{action} {label}</h2>
      {action==='rename'&&<label>Name<input aria-label="New name" autoFocus className="block w-full border p-2" value={name} onChange={event=>setName(event.target.value)}/></label>}
      {action==='move'&&<><label>Search destinations<input aria-label="Search destinations" className="block w-full border p-2" value={query} onChange={event=>setQuery(event.target.value)}/></label><div className="max-h-64 overflow-y-auto" role="radiogroup" aria-label="Move destination"><label className="block"><input type="radio" checked={target===null} onChange={()=>setTarget(null)}/>{item.type==='folder'?'Root folders':'Unfiled'}</label>{targets.map(folder=><label key={folder.id} className="block"><input type="radio" checked={target===folder.id} onChange={()=>setTarget(folder.id)}/>{folderPath(folder.id,folders)}</label>)}</div></>}
      {action==='remove'&&<p>{children?'Move child folders elsewhere before removing this folder.':'Its documents will return to Unfiled. Notes and recordings will be kept.'}</p>}
      {error&&<p role="alert" className="text-red-700">{error}</p>}
      <button className="border px-3 py-1 mr-3" disabled={busy||(action==='remove'&&children)||(action==='rename'&&!name.trim())} onClick={()=>void commit()}>{busy?'Saving…':error?'Retry':'Confirm'}</button><button disabled={busy} onClick={()=>setAction(null)}>Cancel</button>
    </div></div>}
  </span>;
}

'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { documentService, type DocumentFolder, type DocumentInfo } from '@/services/documentService';

function useWorkspaceState() {
  const [documents,setDocuments] = useState<DocumentInfo[]>([]);
  const [folders,setFolders] = useState<DocumentFolder[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string|null>(null);
  const request = useRef(0);
  const [selectedId,setSelectedId]=useState('all');
  const select=useCallback((id:string)=>{setSelectedId(id);try{window.localStorage.setItem('meetily.workspace.destination',id);}catch{}},[]);
  useEffect(()=>{try{setSelectedId(window.localStorage.getItem('meetily.workspace.destination')||'all');}catch{}},[]);
  const reload = useCallback(async () => {
    const current = ++request.current;
    try {
      const [docs,groups] = await Promise.all([documentService.list(),documentService.folders()]);
      if (current !== request.current) return;
      setDocuments(docs);setFolders(groups);setError(null);
    } catch(cause) {
      if(current === request.current) setError(String(cause));
    } finally { if(current === request.current) setLoading(false); }
  },[]);
  useEffect(() => {
    void reload();
    const changed = () => void reload();
    window.addEventListener('documents-changed',changed);
    let cancelled=false;let unlisten:(()=>void)|undefined;
    void listen('documents-updated',changed).then(fn => {if(cancelled)fn();else unlisten=fn;}).catch(cause=>setError(String(cause)));
    return () => {cancelled=true;request.current++;unlisten?.();window.removeEventListener('documents-changed',changed);};
  },[reload]);
  const mutate = useCallback(async (work:()=>Promise<unknown>) => {
    await work();
    await reload();
    window.dispatchEvent(new Event('documents-changed'));
  },[reload]);
  const move=useCallback(async(item:{type:'folder'|'document';id:string},target:string|null)=>{await mutate(()=>item.type==='folder'?documentService.moveFolder(item.id,target):documentService.move(item.id,target));},[mutate]);
  return {documents,folders,loading,error,reload,mutate,move,selectedId,select};
}
const WorkspaceContext=createContext<ReturnType<typeof useWorkspaceState>|null>(null);
export function WorkspaceProvider({children}:{children:ReactNode}) {
  const state=useWorkspaceState();
  return <WorkspaceContext.Provider value={state}>{children}</WorkspaceContext.Provider>;
}
export function useWorkspace() {
  const context=useContext(WorkspaceContext);
  if(!context)throw Error('WorkspaceProvider is required');
  return context;
}

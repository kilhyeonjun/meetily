'use client';
import { toast } from 'sonner';
import { useMeetingNotes } from '@/hooks/meeting-details/useMeetingNotes';
import { NotesPanel } from './NotesPanel';
export function NotesRecovery({notes}: {notes:ReturnType<typeof useMeetingNotes>}) {
  return <>
    {notes.draftError && <p role="alert" className="p-3 text-sm text-red-700">Local recovery storage is unavailable. Keep this document open until Saved appears, or copy your notes.</p>}
    {notes.conflict && <div role="alert" className="p-3 text-sm bg-amber-50"><p>Recovered edits conflict with newer saved notes. Your saved notes have been kept.</p><pre className="max-h-32 overflow-auto whitespace-pre-wrap">{notes.conflict.markdown}</pre><button className="mr-4 underline" onClick={() => void navigator.clipboard.writeText(notes.conflict!.markdown)}>Copy recovered edits</button><button className="underline" onClick={notes.discardConflict}>Discard recovered edits</button></div>}
  </>;
}
export function exportNotes(markdown:string,title='Notes') {
  const url=URL.createObjectURL(new Blob([markdown],{type:'text/markdown;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`${title.replace(/[\\/:*?"<>|]/g,'_')}.md`;link.click();URL.revokeObjectURL(url);
}
export function DocumentNotes({documentId,editable=true,className}:{documentId:string;editable?:boolean;className?:string}) {
  const notes=useMeetingNotes(documentId);
  return <div className={`flex min-h-0 flex-1 flex-col ${className??''}`}><NotesRecovery notes={notes}/><NotesPanel loadState={notes.loadState} initialBlocks={notes.initialBlocks} initialMarkdown={notes.initialMarkdown} saveState={notes.saveState} onChange={notes.handleChange} onRetryLoad={notes.reload} onRetrySave={notes.retrySave} onCopy={() => {void navigator.clipboard.writeText(notes.getMarkdown()).then(()=>toast.success('Notes copied'),()=>toast.error('Could not copy notes'));}} onExport={()=>exportNotes(notes.getMarkdown())} editable={editable && !notes.conflict}/></div>;
}

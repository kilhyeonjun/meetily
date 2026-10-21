'use client';
import { useState } from 'react';
import { useSummaryContext } from '@/hooks/meeting-details/useSummaryContext';
import { contextLength } from '@/services/summaryContextService';
export function SummaryContextBox({meetingId}:{meetingId?:string}) {
  const context=useSummaryContext(meetingId);const [validation,setValidation]=useState<string|null>(null);
  if(!context.ready)return <p role={context.error?'alert':'status'}>{context.error??'Loading summary context…'}{context.error&&<button onClick={()=>void context.reload().catch(()=>{})}>Retry</button>}</p>;
  return <section className="space-y-2 rounded border p-3" aria-label={meetingId?'Meeting summary context':'Global summary context'}>
    <h2 className="font-semibold">{meetingId?'Meeting summary context':'Global summary context'}</h2>
    <p className="text-xs text-gray-500">Background for AI summaries. Your manual notes stay separate.</p>
    <textarea aria-label={meetingId?'Meeting context':'Global context'} className="w-full min-h-24 border rounded p-2" disabled={!!context.conflict} value={context.value.context} onChange={event=>{try{context.edit({...context.value,context:event.target.value});setValidation(null);}catch(cause){setValidation(String(cause));}}}/>
    <div className="text-xs" aria-live="polite">{contextLength(context.value.context)}/4000 · {context.status==='saving'?'Saving…':context.status==='saved'?'Saved':context.error?'Could not save':'Autosave'}</div>
    {meetingId&&<label className="block text-sm"><input type="checkbox" checked={context.value.useInherited} disabled={!!context.conflict} onChange={event=>context.edit({...context.value,useInherited:event.target.checked})}/> Use global context</label>}
    {meetingId&&context.inherited.filter(level=>level.context.trim()).map((level,index)=><details key={index}><summary>Inherited global context{context.value.useInherited?'':' (excluded)'}</summary><p className="whitespace-pre-wrap text-sm">{level.context}</p></details>)}
    {(validation||context.error)&&<p role="alert" className="text-sm text-red-700">{validation||context.error}<button className="ml-2 underline" onClick={()=>void context.flush().catch(()=>{})}>Retry save</button></p>}
    {context.storageError&&<p role="alert" className="text-sm text-red-700">Local recovery storage is unavailable. Keep this view open until Saved appears.</p>}
    {context.conflict&&<div role="alert"><p>Recovered context conflicts with newer saved context. Saved context has been kept.</p><pre className="max-h-32 overflow-auto whitespace-pre-wrap">{context.conflict.context}</pre><button onClick={()=>void navigator.clipboard.writeText(context.conflict!.context)}>Copy recovered context</button><button className="ml-3" onClick={context.discardConflict}>Discard recovered context</button></div>}
  </section>;
}

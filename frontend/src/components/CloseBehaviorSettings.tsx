'use client';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
export function CloseBehaviorSettings() {
  const [value,setValue]=useState<boolean|null>(null);const [attempt,setAttempt]=useState<boolean|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  const load=async()=>{setError(null);try{setValue(await invoke<boolean>('get_close_to_tray'));}catch(cause){setError(String(cause));}};
  useEffect(()=>{void load();},[]);
  const save=async(enabled:boolean)=>{setAttempt(enabled);setBusy(true);setError(null);try{await invoke('set_close_to_tray',{enabled});setValue(enabled);setAttempt(null);}catch(cause){setError(String(cause));}finally{setBusy(false);}};
  return <section className="rounded-lg border bg-white p-6 space-y-2"><h2 className="text-lg font-semibold">Window close behavior</h2><label className="flex gap-3 items-center"><input aria-label="Keep running in tray" type="checkbox" checked={value??true} disabled={value===null||busy} onChange={event=>void save(event.target.checked)}/> Keep running in tray when closing the window</label><p className="text-sm text-gray-600">Turn off to quit when closing an idle window. Recording startup, active capture and final saving always keep the app running.</p>{error&&<p role="alert" className="text-sm text-red-700">{error}<button className="ml-3 underline" disabled={busy} onClick={()=>void(attempt===null?load():save(attempt))}>Retry</button></p>}</section>;
}

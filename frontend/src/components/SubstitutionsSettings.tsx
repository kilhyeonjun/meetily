'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { vocabularyService, type SubstitutionRule } from '@/services/vocabularyService';
export function SubstitutionsSettings() {
  const [rules,setRules]=useState<SubstitutionRule[]>([]);const [loaded,setLoaded]=useState(false);const [path,setPath]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [saved,setSaved]=useState(false);
  const [sample,setSample]=useState('');const [result,setResult]=useState('');
  const load=async()=>{setError(null);try{const values=await vocabularyService.list();setRules(values);setLoaded(true);setPath(await vocabularyService.path());}catch(cause){setError(String(cause));}};
  useEffect(()=>{void load();},[]);
  const change=(index:number,patch:Partial<SubstitutionRule>)=>{setRules(previous=>previous.map((rule,i)=>i===index?{...rule,...patch}:rule));setSaved(false);};
  const save=async()=>{setBusy(true);setError(null);try{if(rules.some(rule=>!rule.find.trim()))throw Error('Every rule needs a nonempty Heard as value');await vocabularyService.save(rules);setSaved(true);}catch(cause){setError(String(cause));}finally{setBusy(false);}};
  return <section className="space-y-4 rounded-lg border bg-white p-6" aria-label="Vocabulary and spelling">
    <h2 className="text-lg font-semibold">Vocabulary & spelling</h2><p className="text-sm text-gray-600">Correct names and terminology in new transcriptions. Enabled replacements also supply the Whisper glossary. Saved rules apply to future transcript segments.</p>
    {path&&<p className="break-all text-xs text-gray-500">Local rules: {path}</p>}
    {!loaded&&!error&&<p role="status">Loading vocabulary…</p>}
    {loaded&&<fieldset disabled={busy} className="space-y-3"><legend className="sr-only">Replacement rules</legend>
      {!rules.length&&<p className="rounded bg-gray-50 p-4 text-sm text-gray-500">No rules yet. Transcripts will be kept unchanged.</p>}
      {rules.map((rule,index)=><div key={index} className="flex flex-wrap items-center gap-3 rounded border p-3"><label className="flex-1 min-w-40 text-xs">Heard as<input aria-label={`Heard as ${index+1}`} value={rule.find} onChange={event=>change(index,{find:event.target.value})} className="mt-1 block w-full rounded border p-2 text-sm"/></label><label className="flex-1 min-w-40 text-xs">Replace with<input aria-label={`Replace with ${index+1}`} value={rule.replace} onChange={event=>change(index,{replace:event.target.value})} className="mt-1 block w-full rounded border p-2 text-sm"/></label><label className="text-xs"><input type="checkbox" checked={rule.wholeWord} onChange={event=>change(index,{wholeWord:event.target.checked})}/> Whole word</label><label className="text-xs"><input type="checkbox" checked={rule.caseSensitive} onChange={event=>change(index,{caseSensitive:event.target.checked})}/> Case sensitive</label><label className="text-xs"><input type="checkbox" checked={rule.enabled} onChange={event=>change(index,{enabled:event.target.checked})}/> Enabled</label><button aria-label={`Remove rule ${index+1}`} onClick={()=>{setRules(previous=>previous.filter((_,i)=>i!==index));setSaved(false);}}><Trash2 className="h-4 w-4"/></button></div>)}
      <button className="inline-flex gap-2 items-center rounded border px-3 py-2 text-sm" onClick={()=>{setRules(previous=>[...previous,{find:'',replace:'',wholeWord:true,caseSensitive:false,enabled:true}]);setSaved(false);}}><Plus className="h-4 w-4"/>Add rule</button>
    </fieldset>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {loaded?<button className="rounded bg-gray-900 px-4 py-2 text-white text-sm" disabled={busy} onClick={()=>void save()}>{busy?'Saving…':error?'Retry save':'Save rules'}</button>:error&&<button onClick={()=>void load()}>Retry load</button>}
    {saved&&<p role="status" className="text-sm text-green-700">Rules saved.</p>}
    <div className="border-t pt-4 space-y-2"><label className="text-sm">Test saved rules<textarea aria-label="Vocabulary sample" className="block w-full rounded border p-2" value={sample} onChange={event=>setSample(event.target.value)}/></label><button className="rounded border px-3 py-1 text-sm" disabled={!loaded||busy} onClick={()=>void vocabularyService.test(sample).then(setResult,cause=>setResult(String(cause)))}>Test saved rules</button><p className="whitespace-pre-wrap text-sm" aria-live="polite">{result}</p></div>
  </section>;
}

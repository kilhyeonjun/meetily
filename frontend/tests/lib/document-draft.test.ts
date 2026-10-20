import { describe, expect, test } from 'bun:test';
import { createDocumentDraftStore } from '../../src/services/documentDraft';
const memory = () => { const data = new Map<string,string>(); return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)}}; };
const note = (markdown:string) => ({markdown,blocks:[]});
describe('durable document draft',()=>{
 test('survives immediate restart before debounce and retains failed saves',()=>{const storage=memory();const a=createDocumentDraftStore(storage);a.write('a',note('DB'),note('typed')); const restart=createDocumentDraftStore(storage);expect(restart.recover('a',note('DB'))).toMatchObject({status:'restore',content:note('typed')});expect(restart.recover('a',note('DB')).status).toBe('restore');});
 test('clears only acknowledged content and rebases newer edit',()=>{const d=createDocumentDraftStore(memory());d.write('a',note('DB'),note('first'));d.write('a',note('DB'),note('second'));d.acknowledge('a',note('first'));expect(d.recover('a',note('first'))).toMatchObject({status:'restore',content:note('second')});d.acknowledge('a',note('second'));expect(d.recover('a',note('second')).status).toBe('none');});
 test('clears response-loss replay but retains conflict with newer DB',()=>{const d=createDocumentDraftStore(memory());d.write('a',note('old'),note('edit'));expect(d.recover('a',note('newer')).status).toBe('conflict');expect(d.recover('a',note('edit')).status).toBe('none');});
 test('storage failure is thrown for visible handling',()=>{const d=createDocumentDraftStore({...memory(),setItem(){throw Error('quota')}});expect(()=>d.write('a',note(''),note('typed'))).toThrow('quota');});
});
test('an older acknowledgement cannot clear a newer version containing the same text',()=>{const d=createDocumentDraftStore(memory());const first=d.write('a',note('DB'),note('same'));const latest=d.write('a',note('DB'),note('same'));expect(first).not.toBe(latest);d.acknowledge('a',note('same'),first);expect(d.recover('a',note('DB')).status).not.toBe('none');});

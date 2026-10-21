import {expect,test} from 'bun:test';
import {createSummaryContextController,createContextStorage,contextLength} from '../../src/services/summaryContextService';
const memory=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)}};};
const value=(context:string,useInherited=true)=>({context,useInherited});
test('context retains synchronous scope draft, retries failed save, and restores only matching base',async()=>{const storage=createContextStorage(memory());let db=value('base');let fail=true;const options={storage,read:async()=>({...db,inherited:[]}),save:async(v:any)=>{if(fail)throw Error('locked');db=v;},delayMs:10000};const first=createSummaryContextController('meeting:a',options);await first.load();first.edit(value('typed'));expect(storage.recover('meeting:a',value('base'))).toMatchObject({status:'restore',value:value('typed')});await expect(first.flush()).rejects.toThrow('locked');const restart=createSummaryContextController('meeting:a',options);await restart.load();expect(restart.getSnapshot().value.context).toBe('typed');fail=false;await restart.flush();expect(db.context).toBe('typed');expect(storage.recover('meeting:a',db).status).toBe('none');});
test('stale context conflicts instead of replacing new DB and failed flush blocks generation',async()=>{const storage=createContextStorage(memory());storage.write('meeting:a',value('old'),value('local'));const a=createSummaryContextController('meeting:a',{storage,read:async()=>({...value('new DB'),inherited:[]}),save:async()=>{throw Error('must not save conflict')},delayMs:10000});await a.load();expect(a.getSnapshot().value.context).toBe('new DB');expect(a.getSnapshot().conflict?.context).toBe('local');await expect(a.flush()).rejects.toThrow('conflict');});
test('late save acknowledgement rebases a newer edit, keeps scope IDs, and slow load cannot overwrite edit',async()=>{const storage=createContextStorage(memory());let release!:(v?:unknown)=>void;const writes:any[]=[];let reads=0;let finishRead!:(v:any)=>void;const a=createSummaryContextController('meeting:a',{storage,read:async()=>{if(++reads===2)return new Promise(resolve=>{finishRead=resolve;});return {...value('base'),inherited:[]};},save:async(v:any)=>{writes.push(v);if(writes.length===1)await new Promise(resolve=>{release=resolve;});},delayMs:10000});await a.load();a.edit(value('first'));const saving=a.flush();await new Promise(resolve=>setTimeout(resolve,0));a.edit(value('second'));release();await saving;expect(writes.map(v=>v.context)).toEqual(['first','second']);const reload=a.load();a.edit(value('third'));finishRead({...value('second'),inherited:[]});await reload;expect(a.getSnapshot().value.context).toBe('third');await a.flush();});
test('4000 Unicode codepoints count emoji as one, and reject too-long edits before persistence',()=>{expect(contextLength('가🙂')).toBe(2);const a=createSummaryContextController('global',{storage:createContextStorage(memory()),read:async()=>({...value(''),inherited:[]}),save:async()=>{},delayMs:10000});expect(()=>a.edit(value('🙂'.repeat(4001)))).toThrow('4000');});
test('reload response started during a save cannot roll back acknowledged context or inheritance',async()=>{
  const storage=createContextStorage(memory());let reads=0;let finishRead!:(v:any)=>void;let releaseSave!:()=>void;
  let persisted=value('A');
  const controller=createSummaryContextController('meeting:ack-race',{storage,delayMs:10000,
    read:async()=>++reads===1?{...persisted,inherited:[]}:new Promise(resolve=>{finishRead=resolve;}),
    save:async(next)=>{await new Promise<void>(resolve=>{releaseSave=resolve;});persisted=next;},
  });
  await controller.load();controller.edit(value('A+B',false));const saving=controller.flush();
  await new Promise(resolve=>setTimeout(resolve,0));const reloading=controller.load();
  releaseSave();await saving;
  expect(storage.recover('meeting:ack-race',persisted).status).toBe('none');
  finishRead({...value('A',true),inherited:[]});await reloading;
  expect(controller.getSnapshot().value).toEqual(value('A+B',false));
  expect(persisted).toEqual(value('A+B',false));
});
test('quota failure plus reload before save acknowledgement preserves the in-memory context and opt-out',async()=>{
  const storage=createContextStorage({getItem:()=>null,setItem(){throw Error('quota exceeded');},removeItem(){}});
  let reads=0;let finishRead!:(value:any)=>void;let releaseSave!:()=>void;let persisted=value('A',true);
  const controller=createSummaryContextController('meeting:quota-read-before-ack',{storage,delayMs:10000,
    read:async()=>++reads===1?{...persisted,inherited:[]}:new Promise(resolve=>{finishRead=resolve;}),
    save:async(next)=>{await new Promise<void>(resolve=>{releaseSave=resolve;});persisted=next;},
  });
  await controller.load();controller.edit(value('B',false));expect(controller.getSnapshot().storageError).toBe(true);
  const saving=controller.flush();await new Promise(resolve=>setTimeout(resolve,0));const reloading=controller.load();
  finishRead({...value('A',true),inherited:[]});await reloading;
  expect(controller.getSnapshot().value).toEqual(value('B',false));
  releaseSave();await saving;
  expect(controller.getSnapshot().value).toEqual(persisted);
  expect(persisted).toEqual(value('B',false));
});
test('quota failure and failed-save pending content stay authoritative on reload until explicit retry',async()=>{
  const storage=createContextStorage({getItem:()=>null,setItem(){throw Error('quota exceeded');},removeItem(){}});
  let fail=true;let persisted=value('A',true);
  const controller=createSummaryContextController('meeting:quota-failed-save',{storage,delayMs:10000,
    read:async()=>({...persisted,inherited:[]}),
    save:async(next)=>{if(fail)throw Error('database locked');persisted=next;},
  });
  await controller.load();controller.edit(value('B',false));await expect(controller.flush()).rejects.toThrow('database locked');
  await controller.load();expect(controller.getSnapshot().value).toEqual(value('B',false));expect(controller.getSnapshot().storageError).toBe(true);
  fail=false;await controller.flush();expect(controller.getSnapshot().value).toEqual(persisted);expect(persisted).toEqual(value('B',false));
});

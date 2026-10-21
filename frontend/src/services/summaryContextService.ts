import { invoke } from '@tauri-apps/api/core';
export interface ContextValue {context:string;useInherited:boolean}
export interface InheritedContext {scope:'global';scopeId:string;label:string|null;context:string}
export interface ContextResponse extends ContextValue {inherited:InheritedContext[]}
export const contextLength=(text:string)=>Array.from(text).length;
const same=(a:ContextValue,b:ContextValue)=>a.context===b.context&&a.useInherited===b.useInherited;
let sequence=0;
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
interface Draft {base:ContextValue;value:ContextValue;version:string}
export function createContextStorage(storage:StorageLike) {
  const key=(scope:string)=>`meetily.summary-context-draft.v1:${scope}`;
  const read=(scope:string):Draft|null=>{
    const raw=storage.getItem(key(scope));if(!raw)return null;
    const draft=JSON.parse(raw) as Draft;
    if(typeof draft.value?.context!=='string'||typeof draft.value.useInherited!=='boolean'||typeof draft.base?.context!=='string')throw Error('Invalid context recovery draft');
    return draft;
  };
  return {
    write(scope:string,base:ContextValue,value:ContextValue) {
      const version=`${Date.now()}:${++sequence}`;storage.setItem(key(scope),JSON.stringify({base,value,version}));return version;
    },
    acknowledge(scope:string,value:ContextValue,version?:string) {
      const current=read(scope);if(!current)return;
      if(current.version===version&&same(current.value,value))storage.removeItem(key(scope));
      else storage.setItem(key(scope),JSON.stringify({...current,base:value}));
    },
    recover(scope:string,stored:ContextValue):{status:'none'}|{status:'restore'|'conflict';value:ContextValue;version:string} {
      const current=read(scope);if(!current)return {status:'none'};
      if(same(current.value,stored)){storage.removeItem(key(scope));return {status:'none'};}
      return {status:same(current.base,stored)?'restore':'conflict',value:current.value,version:current.version};
    },
    discard(scope:string){storage.removeItem(key(scope));},
  };
}
interface ControllerOptions {
  storage:ReturnType<typeof createContextStorage>;
  read:()=>Promise<ContextResponse>;
  save:(value:ContextValue)=>Promise<void>;
  delayMs:number;
}
interface ContextState {
  ready:boolean;value:ContextValue;inherited:InheritedContext[];
  status:'loading'|'idle'|'saving'|'saved'|'error';error:string|null;storageError:boolean;conflict:ContextValue|null;
}
export function createSummaryContextController(scope:string,options:ControllerOptions) {
  let state:ContextState={ready:false,value:{context:'',useInherited:true},inherited:[],status:'loading',error:null,storageError:false,conflict:null};
  let base:ContextValue={context:'',useInherited:true};let revision=0;let readSequence=0;let saveEpoch=0;
  let pending:{value:ContextValue;version?:string}|null=null;
  let inFlight=false;
  let running:Promise<void>=Promise.resolve();let loading:Promise<void>|null=null;
  let timer:ReturnType<typeof setTimeout>|null=null;
  const listeners=new Set<()=>void>();
  const update=(patch:Partial<ContextState>)=>{state={...state,...patch};listeners.forEach(listener=>listener());};
  const schedule=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>{void flush().catch(()=>{});},options.delayMs);};
  const load=async()=>{
    if(loading)return loading;
    const request=++readSequence;const atRevision=revision;const atSaveEpoch=saveEpoch;
    const hadUnsaved=pending!==null||inFlight;
    loading=(async()=>{
      try {
        const response=await options.read();if(request!==readSequence)return;
        const stored={context:response.context,useInherited:response.useInherited};
        // RAM remains authoritative while dirty, even if quota prevented a durable draft.
        if(hadUnsaved||pending!==null||inFlight||revision!==atRevision||saveEpoch!==atSaveEpoch){update({inherited:response.inherited});return;}
        base=stored;let restored=stored;let conflict:ContextValue|null=null;let storageError=false;
        try {
          const draft=options.storage.recover(scope,stored);
          if(draft.status==='restore'){restored=draft.value;pending={value:draft.value,version:draft.version};schedule();}
          if(draft.status==='conflict')conflict=draft.value;
        }catch{storageError=true;}
        update({ready:true,value:restored,inherited:response.inherited,status:'idle',error:null,storageError,conflict});
      }catch(cause){update({status:'error',error:String(cause)});throw cause;}
      finally{loading=null;}
    })();
    return loading;
  };
  const flush=async()=>{
    if(timer){clearTimeout(timer);timer=null;}
    if(!state.ready)await load();
    if(state.conflict)throw Error('Resolve the recovered context conflict before generating');
    const operation=running.catch(()=>{}).then(async()=>{
      while(pending){
        const edit=pending;pending=null;inFlight=true;update({status:'saving',error:null});
        try {
          // A read launched before this acknowledgement may still return the old DB value.
          await options.save(edit.value);saveEpoch++;base=edit.value;
          let storageError=false;
          try{options.storage.acknowledge(scope,edit.value,edit.version);}catch{storageError=true;}
          update({status:pending?'saving':'saved',storageError});
        }catch(cause){if(!pending)pending=edit;update({status:'error',error:String(cause)});throw cause;}
        finally{inFlight=false;}
      }
    });
    running=operation;await operation;
  };
  return {
    getSnapshot:()=>state,
    subscribe(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);},
    load,flush,
    edit(value:ContextValue){
      if(contextLength(value.context)>4000)throw Error('Context is limited to 4000 Unicode characters');
      if(state.conflict)throw Error('Resolve the recovered context conflict first');
      revision++;let version:string|undefined;let storageError=false;
      try{version=options.storage.write(scope,base,value);}catch{storageError=true;}
      pending={value,version};update({value,storageError,status:'idle',error:null});schedule();
    },
    discardConflict(){options.storage.discard(scope);update({conflict:null});},
  };
}
const browserStorage:StorageLike={
  getItem:key=>typeof window==='undefined'?null:window.localStorage.getItem(key),
  setItem:(key,value)=>{if(typeof window!=='undefined')window.localStorage.setItem(key,value);},
  removeItem:key=>{if(typeof window!=='undefined')window.localStorage.removeItem(key);},
};
const controllers=new Map<string,ReturnType<typeof createSummaryContextController>>();
export function summaryContextController(meetingId?:string) {
  const scope=meetingId?`meeting:${meetingId}`:'global';
  let controller=controllers.get(scope);
  if(!controller){
    controller=createSummaryContextController(scope,{
      storage:createContextStorage(browserStorage),delayMs:500,
      read:async()=>meetingId?invoke<ContextResponse>('api_get_meeting_summary_context',{meetingId}):{...await invoke<{context:string}>('api_get_global_summary_context'),useInherited:true,inherited:[]},
      save:async value=>{await invoke(meetingId?'api_save_meeting_summary_context':'api_save_global_summary_context',meetingId?{meetingId,context:value.context,useInherited:value.useInherited}:{context:value.context});},
    });controllers.set(scope,controller);
  }
  return controller;
}
export async function prepareSummaryContext(meetingId:string) {
  const meeting=summaryContextController(meetingId);await meeting.flush();
  const {useInherited}=meeting.getSnapshot().value;
  if(useInherited)await summaryContextController().flush();
  return {useInheritedContext:useInherited};
}

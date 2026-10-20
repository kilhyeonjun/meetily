import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const originalCore={...await import('@tauri-apps/api/core')};
const originalToast={...await import('sonner')};
let db={markdown:'base',notes_json:null as string|null};let fail=false;const saved:string[]=[];
mock.module('@tauri-apps/api/core',()=>({...originalCore,invoke:async(command:string,args:Record<string,unknown>)=>{if(command==='api_get_meeting_notes')return db;if(command==='api_save_meeting_notes'){if(fail)throw Error('locked');saved.push(args.markdown as string);db={markdown:args.markdown as string,notes_json:args.notesJson as string|null};return;}throw Error(command);}}));
mock.module('sonner',()=>({toast:{error:()=>{}}}));
const {useMeetingNotes}=await import('../../src/hooks/meeting-details/useMeetingNotes');
const {createDocumentDraftStore}=await import('../../src/services/documentDraft');
let state:ReturnType<typeof useMeetingNotes>;let renderer:ReactTestRenderer|undefined;const previousWindow=globalThis.window;
const data=new Map<string,string>();const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}};
function Harness(){state=useMeetingNotes('document',10000);return null;}
async function mount(){await act(async()=>{renderer=create(<Harness/>);});}
async function close(){await act(async()=>{renderer?.unmount();});renderer=undefined;}
beforeEach(()=>{data.clear();db={markdown:'base',notes_json:null};fail=false;saved.length=0;globalThis.window={localStorage:storage,addEventListener(){},removeEventListener(){}} as any;});
afterEach(async()=>{await close();globalThis.window=previousWindow;});
afterAll(()=>{mock.module('@tauri-apps/api/core',()=>originalCore);mock.module('sonner',()=>originalToast);});
test('last edit is durable synchronously before debounce and restored after failed close',async()=>{await mount();fail=true;const content={markdown:'last edit',blocks:[]};act(()=>state.handleChange(content));expect(saved).toEqual([]);expect(createDocumentDraftStore(storage).recover('document',{markdown:'base',blocks:[]})).toMatchObject({status:'restore',content});const originalError=console.error;console.error=()=>{};try{await close();await mount();expect(state.initialMarkdown).toBe('last edit');expect(state.conflict).toBeNull();fail=false;await act(async()=>state.retrySave());expect(saved).toEqual(['last edit']);expect(data.size).toBe(0);}finally{console.error=originalError;}});
test('stale local edits cannot overwrite newer database notes after restart',async()=>{createDocumentDraftStore(storage).write('document',{markdown:'old',blocks:[]},{markdown:'local',blocks:[]});db={markdown:'newer DB',notes_json:null};await mount();expect(state.initialMarkdown).toBe('newer DB');expect(state.conflict?.markdown).toBe('local');expect(saved).toEqual([]);expect(data.size).toBe(1);});

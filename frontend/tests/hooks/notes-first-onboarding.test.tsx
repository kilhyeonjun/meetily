import {afterAll,afterEach,beforeEach,expect,mock,test} from 'bun:test';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const originalCore={...await import('@tauri-apps/api/core')};
const originalEvents={...await import('@tauri-apps/api/event')};
const calls:Array<{command:string;args?:any}>=[];
let persisted:any;let releaseDB:(()=>void)|undefined;let delayDB=false;
const fresh=()=>({version:'1.0',completed:false,workspace_ready:false,current_step:1,model_status:{parakeet:'not_downloaded',summary:'not_downloaded'},last_updated:'now'});
mock.module('@tauri-apps/api/event',()=>({...originalEvents,listen:async()=>()=>{}}));
mock.module('@tauri-apps/api/core',()=>({...originalCore,invoke:async(command:string,args?:any)=>{calls.push({command,args});switch(command){case 'get_onboarding_status':return {...persisted};case 'check_first_launch':return true;case 'check_homebrew_database':case 'check_default_legacy_database':return null;case 'initialize_fresh_database':if(delayDB)await new Promise<void>(resolve=>{releaseDB=resolve;});return;case 'builtin_ai_get_recommended_model':return 'test-model';case 'builtin_ai_is_model_ready':case 'parakeet_has_available_models':return false;case 'parakeet_init':return;case 'parakeet_get_available_models':return [];case 'enable_notes_workspace':persisted={...persisted,workspace_ready:true};return {...persisted};case 'save_onboarding_status_cmd':persisted={...args.status,workspace_ready:persisted.workspace_ready||args.status.workspace_ready};return;default:throw Error(`Unexpected native call: ${command}`);}}}));
const {OnboardingProvider,useOnboarding}=await import('../../src/contexts/OnboardingContext');
const {WelcomeStep}=await import('../../src/components/onboarding/steps/WelcomeStep');
const {useWorkspaceAccess}=await import('../../src/hooks/useWorkspaceAccess');
let context:ReturnType<typeof useOnboarding>;let access:ReturnType<typeof useWorkspaceAccess>;let renderer:ReactTestRenderer|undefined;let entered=0;
function State(){context=useOnboarding();return <WelcomeStep onWorkspaceReady={()=>{entered++;}}/>;}
function Access(){access=useWorkspaceAccess();return null;}
function text(node:any):string{return typeof node==='string'?node:(node?.children??[]).map(text).join('');}
const entry=()=>renderer!.root.findAllByType('button').find(button=>text(button)==='Use notes first')!;
async function settle(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});}
beforeEach(()=>{persisted=fresh();calls.length=0;entered=0;delayDB=false;releaseDB=undefined;});
afterEach(async()=>{if(renderer)await act(async()=>renderer!.unmount());renderer=undefined;});
afterAll(()=>{mock.module('@tauri-apps/api/core',()=>originalCore);mock.module('@tauri-apps/api/event',()=>originalEvents);});
test('fresh app exposes notes before downloads, waits for DB and enters without models or permissions',async()=>{delayDB=true;await act(async()=>{renderer=create(<OnboardingProvider><State/></OnboardingProvider>);});expect(entry()).toBeDefined();expect(entry().props.disabled).toBe(true);await act(async()=>releaseDB!());await settle();expect(entry().props.disabled).toBe(false);await act(async()=>entry().props.onClick());expect(entered).toBe(1);expect(persisted.workspace_ready).toBe(true);expect(persisted.completed).toBe(false);expect(context.parakeetDownloaded).toBe(false);expect(context.summaryModelDownloaded).toBe(false);expect(calls.filter(({command})=>/download_model|permission|get_audio_devices|complete_onboarding/.test(command))).toEqual([]);expect(calls.filter(({command})=>command==='enable_notes_workspace')).toHaveLength(1);});
test('workspace layout gate respects native notes readiness across restart while leaving onboarding incomplete',async()=>{persisted.workspace_ready=true;await act(async()=>{renderer=create(<Access/>);});expect(access.isChecking).toBe(false);expect(access.showOnboarding).toBe(false);expect(access.onboardingCompleted).toBe(false);await act(async()=>renderer!.unmount());renderer=undefined;await act(async()=>{renderer=create(<Access/>);});expect(access.showOnboarding).toBe(false);expect(calls.every(({command})=>command==='get_onboarding_status')).toBe(true);});
test('fresh gate blocks workspace and preserves normal setup route after notes entry',async()=>{await act(async()=>{renderer=create(<Access/>);});expect(access.showOnboarding).toBe(true);act(()=>access.markWorkspaceReady());expect(access.showOnboarding).toBe(false);act(()=>access.setShowOnboarding(true));expect(access.showOnboarding).toBe(true);});

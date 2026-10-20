import {afterAll,expect,mock,test} from 'bun:test';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const originalCore={...await import('@tauri-apps/api/core')};const originalContext={...await import('../../src/contexts/TranscriptContext')};const originalDraftHook={...await import('../../src/hooks/useRecordingNotesDraft')};const originalPanel={...await import('../../src/components/MeetingNotes/DocumentNotes')};
let db={markdown:'A',notes_json:null as string|null};const writes:Array<Record<string,unknown>>=[];
mock.module('@tauri-apps/api/core',()=>({...originalCore,invoke:async(command:string,args:Record<string,unknown>)=>{if(command==='api_get_meeting_notes')return db;if(command==='api_save_meeting_notes'){writes.push(args);db={markdown:args.markdown as string,notes_json:args.notesJson as string|null};return;}throw Error(command);}}));
mock.module('../../src/contexts/TranscriptContext',()=>({useTranscripts:()=>({currentMeetingId:'native-session',preparedMeetingId:'prepared'})}));
mock.module('../../src/hooks/useRecordingNotesDraft',()=>({useRecordingNotesDraft:()=>{throw Error('Prepared recording must never enter legacy draft path');}}));
const {useMeetingNotes}=await import('../../src/hooks/meeting-details/useMeetingNotes');let notes:ReturnType<typeof useMeetingNotes>;
function DirectNotes({documentId}:{documentId:string}){notes=useMeetingNotes(documentId,10000);return <p>{documentId}:{notes.initialMarkdown}</p>;}
mock.module('../../src/components/MeetingNotes/DocumentNotes',()=>({...originalPanel,DocumentNotes:DirectNotes}));
const {RecordingNotes}=await import('../../src/app/_components/RecordingNotes');
afterAll(()=>{mock.module('@tauri-apps/api/core',()=>originalCore);mock.module('../../src/contexts/TranscriptContext',()=>originalContext);mock.module('../../src/hooks/useRecordingNotesDraft',()=>originalDraftHook);mock.module('../../src/components/MeetingNotes/DocumentNotes',()=>originalPanel);});
test('prepared A enters direct existing-ID editor, saves A+B at stop, and restores A+B after restart',async()=>{let renderer!:ReactTestRenderer;await act(async()=>{renderer=create(<RecordingNotes editable/>);});expect(renderer.toJSON()).toMatchObject({children:['prepared',':','A']});act(()=>notes.handleChange({markdown:'A+B',blocks:[]}));await act(async()=>renderer.unmount());expect(writes).toEqual([{meetingId:'prepared',markdown:'A+B',notesJson:'[]'}]);await act(async()=>{renderer=create(<DirectNotes documentId="prepared"/>);});expect(notes.initialMarkdown).toBe('A+B');await act(async()=>renderer.unmount());});

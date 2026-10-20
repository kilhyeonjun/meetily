import {afterAll,expect,mock,test} from 'bun:test';
const originalCore={...await import('@tauri-apps/api/core')};
const calls:Array<[string,unknown]>=[];
mock.module('@tauri-apps/api/core',()=>({...originalCore,invoke:async(command:string,args:unknown)=>{calls.push([command,args]);return {meeting_id:'prepared',recording_session_id:'native-session',folder_path:'/audio'};}}));
afterAll(()=>mock.module('@tauri-apps/api/core',()=>originalCore));
const {recordingService}=await import('../../src/services/recordingService');const {storageService}=await import('../../src/services/storageService');
test('recording start and transcript save forward stable prepared/native identities',async()=>{await recordingService.startRecordingWithDevices(null,null,'Original title','prepared');await storageService.saveMeeting('Original title',[],'/audio','prepared','native-session');expect(calls).toEqual([['start_recording_with_devices_and_meeting',{micDeviceName:null,systemDeviceName:null,meetingName:'Original title',meetingId:'prepared'}],['api_save_transcript',{meetingTitle:'Original title',transcripts:[],folderPath:'/audio',meetingId:'prepared',recordingSessionId:'native-session'}]]);});
test('native identity can be restored without browser sessionStorage',async()=>{expect(await recordingService.getIdentity()).toEqual({meeting_id:'prepared',recording_session_id:'native-session',folder_path:'/audio'});});

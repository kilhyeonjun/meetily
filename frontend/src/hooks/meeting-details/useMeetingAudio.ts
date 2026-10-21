import { useEffect, useState } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
/** The native command resolves and grants one canonical file for this ID. */
export function useMeetingAudio(meetingId:string) {
  const [result,setResult]=useState<{id:string;audioSrc:string|null;error:string|null;loading:boolean}>({id:meetingId,audioSrc:null,error:null,loading:true});
  useEffect(()=>{
    let cancelled=false;setResult({id:meetingId,audioSrc:null,error:null,loading:true});
    void invoke<string|null>('get_meeting_audio_path',{meetingId}).then(path=>{if(!cancelled)setResult({id:meetingId,audioSrc:path?convertFileSrc(path):null,error:null,loading:false});},cause=>{if(!cancelled)setResult({id:meetingId,audioSrc:null,error:String(cause),loading:false});});
    return()=>{cancelled=true;};
  },[meetingId]);
  return result.id===meetingId?result:{id:meetingId,audioSrc:null,error:null,loading:true};
}

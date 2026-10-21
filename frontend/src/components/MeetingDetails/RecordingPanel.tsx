'use client';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, RotateCw, AudioLines } from 'lucide-react';
export interface RecordingPanelRef {seekTo:(seconds:number)=>void}
export function clampPlaybackTime(seconds:number,duration:number) {
  const target=Number.isFinite(seconds)?Math.max(0,seconds):0;
  return Number.isFinite(duration)&&duration>=0?Math.min(target,duration):target;
}
const format=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
export const RecordingPanel=forwardRef<RecordingPanelRef,{audioSrc:string;meetingTitle:string}>(function RecordingPanel({audioSrc,meetingTitle},ref){
  const mediaRef=useRef<HTMLAudioElement|null>(null);const pending=useRef<number|null>(null);
  const [playing,setPlaying]=useState(false);const [time,setTime]=useState(0);const [duration,setDuration]=useState(0);const [rate,setRate]=useState(1);const [error,setError]=useState<string|null>(null);
  const play=useCallback(()=>{const media=mediaRef.current;if(media)void media.play().catch(cause=>{setError(`Could not play recording: ${String(cause)}`);setPlaying(false);});},[]);
  const seek=useCallback((seconds:number)=>{
    const media=mediaRef.current;if(!media)return;
    if(media.readyState===0||!Number.isFinite(media.duration)){pending.current=Number.isFinite(seconds)?Math.max(0,seconds):0;return;}
    const target=clampPlaybackTime(seconds,media.duration);media.currentTime=target;setTime(target);play();
  },[play]);
  useImperativeHandle(ref,()=>({seekTo:seek}),[seek]);
  useEffect(()=>{
    const media=mediaRef.current;pending.current=null;setPlaying(false);setTime(0);setDuration(0);setRate(1);setError(null);
    return()=>{media?.pause();};
  },[audioSrc]);
  const metadata=()=>{
    const media=mediaRef.current;if(!media)return;
    setDuration(Number.isFinite(media.duration)?media.duration:0);
    if(pending.current!==null&&Number.isFinite(media.duration)){const target=pending.current;pending.current=null;seek(target);}
  };
  return <section aria-label="Meeting recording" className="shrink-0 border-b bg-white p-3 space-y-2">
    <audio ref={mediaRef} src={audioSrc} preload="metadata" onLoadedMetadata={metadata} onDurationChange={metadata} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onTimeUpdate={()=>setTime(mediaRef.current?.currentTime??0)} onError={()=>{setError('This recording could not be loaded. The file may be missing or unsupported.');setPlaying(false);}}/>
    <div className="flex flex-wrap gap-3 items-center"><AudioLines className="h-4 w-4"/><span className="text-sm truncate max-w-48">{meetingTitle}</span><button aria-label={playing?'Pause recording':'Play recording'} onClick={()=>playing?mediaRef.current?.pause():play()}>{playing?<Pause className="h-5 w-5"/>:<Play className="h-5 w-5"/>}</button><button aria-label="Back 10 seconds" onClick={()=>seek(time-10)}><RotateCcw className="h-4 w-4"/></button><button aria-label="Forward 10 seconds" onClick={()=>seek(time+10)}><RotateCw className="h-4 w-4"/></button><input aria-label="Seek recording" type="range" min={0} max={duration} step={0.1} value={Math.min(time,duration)} className="min-w-32 flex-1" onChange={event=>seek(Number(event.target.value))}/><span className="text-xs tabular-nums">{format(time)} / {format(duration)}</span><select aria-label="Playback speed" value={rate} onChange={event=>{const next=Number(event.target.value);setRate(next);if(mediaRef.current)mediaRef.current.playbackRate=next;}}>{[0.75,1,1.25,1.5,2].map(value=><option key={value} value={value}>{value}×</option>)}</select></div>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
});

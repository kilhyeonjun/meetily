import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { summaryContextController } from '@/services/summaryContextService';
export function useSummaryContext(meetingId?:string) {
  const controller=useMemo(()=>summaryContextController(meetingId),[meetingId]);
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  useEffect(()=>{void controller.load().catch(()=>{});return()=>{void controller.flush().catch(()=>{});};},[controller]);
  return {...state,edit:controller.edit,flush:controller.flush,reload:controller.load,discardConflict:controller.discardConflict};
}

'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkspaceBrowser } from '@/components/Workspace/WorkspaceBrowser';
function BrowserRoute() {
  const query=useSearchParams();
  return <WorkspaceBrowser folderId={query.get('folderId')??'all'}/>;
}
export default function NotesWorkspace() {
  return <main className="h-screen overflow-auto"><Suspense fallback={<p>Loading workspace…</p>}><BrowserRoute/></Suspense></main>;
}

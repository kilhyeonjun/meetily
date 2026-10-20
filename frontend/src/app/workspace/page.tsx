'use client';
import { WorkspaceNav } from '@/components/Workspace/WorkspaceNav';

export default function NotesWorkspace() {
  return <main className="max-w-3xl p-6 space-y-4">
    <h1 className="text-2xl font-semibold">Notes workspace</h1>
    <p className="text-gray-600">Create a personal note or prepare a meeting agenda. Your notes stay on this device.</p>
    <WorkspaceNav />
  </main>;
}

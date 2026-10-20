'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { documentService, canRecordDocument, type DocumentInfo, type DocumentFolder } from '@/services/documentService';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';

/** datetime-local expects local wall time, whereas SQLite stores an ISO instant. */
function localSchedule(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DocumentControls({ document, folders, onUpdated }: {
  document: DocumentInfo;
  folders: DocumentFolder[];
  onUpdated: () => Promise<void>;
}) {
  const [title, setTitle] = useState(document.title);
  const [schedule, setSchedule] = useState(() => localSchedule(document.scheduled_at));
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const { isRecording } = useRecordingState();
  const { refetchMeetings } = useSidebar();

  const save = async (work: () => Promise<unknown>) => {
    setSaving(true);
    try {
      await work();
      await onUpdated();
      await refetchMeetings();
      window.dispatchEvent(new Event('documents-changed'));
      toast.success('Document saved');
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const saveDetails = () => save(() => {
    // Preserve seconds, milliseconds and the exact original ISO representation
    // when only the title changed; the control displays minute precision.
    const scheduledAt = schedule === localSchedule(document.scheduled_at)
      ? document.scheduled_at
      : schedule ? new Date(schedule).toISOString() : null;
    return documentService.update(document.id, title.trim(), scheduledAt);
  });

  return (
    <header className="flex flex-wrap gap-3 items-center border-b p-4 bg-white">
      <label>
        Title <input aria-label="Document title" className="border rounded px-2" value={title} onChange={event => setTitle(event.target.value)} />
      </label>
      {document.document_type === 'meeting' && (
        <label>
          Scheduled <input aria-label="Scheduled time" type="datetime-local" className="border rounded" value={schedule} onChange={event => setSchedule(event.target.value)} />
        </label>
      )}
      <button className="border rounded px-3" disabled={saving || !title.trim()} onClick={() => void saveDetails()}>
        {saving ? 'Saving…' : 'Save details'}
      </button>
      <label>
        Folder <select aria-label="Document folder" className="border rounded" disabled={saving} value={document.folder_id ?? ''} onChange={event => void save(() => documentService.move(document.id, event.target.value || null))}>
          <option value="">Unfiled</option>
          {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
      </label>
      {canRecordDocument(document) && (
        <button className="rounded bg-red-600 text-white px-3 py-1" disabled={isRecording || saving} onClick={() => {
          sessionStorage.setItem('preparedRecordingMeetingId', document.id);
          sessionStorage.setItem('autoStartRecording', 'true');
          router.push('/');
        }}>
          Start Recording
        </button>
      )}
    </header>
  );
}

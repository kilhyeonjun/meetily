'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { CalendarDays, Check, ChevronDown, Clock, ExternalLink, FileText, Folder, Link as LinkIcon, Pencil, Plus, Trash2, Type, X } from 'lucide-react';
import { toast } from 'sonner';
import { documentService, canRecordDocument, type DocumentInfo, type DocumentFolder, type DocumentProperty, type PropertyInput } from '@/services/documentService';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { folderAncestors } from '@/lib/workspace-tree';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '@/components/ui/command';

/** datetime-local expects local wall time, whereas SQLite stores an ISO instant. */
function localSchedule(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function hostname(value: string) {
  try { return new URL(value).hostname; } catch { return value; }
}
function propertyError(property: PropertyInput): string | null {
  if (!property.label.trim() || [...property.label.trim()].length > 80) return 'Use a label of 1–80 characters.';
  if (!property.value.trim() || [...property.value.trim()].length > 2048) return 'Use a value of 1–2048 characters.';
  if (property.kind === 'url') {
    try { if (!['http:', 'https:'].includes(new URL(property.value.trim()).protocol)) throw new Error(); }
    catch { return 'Enter a valid HTTP or HTTPS URL.'; }
  }
  return null;
}
function PropertyEditor({ property, disabled, onSave, children }: {
  property?: DocumentProperty; disabled: boolean; onSave: (value: PropertyInput) => Promise<boolean>; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PropertyInput['kind']>(property?.kind ?? 'url');
  const [label, setLabel] = useState(property?.label ?? '');
  const [value, setValue] = useState(property?.value ?? '');
  const [error, setError] = useState<string | null>(null);
  return <Popover open={open} onOpenChange={next => {
    setOpen(next);
    if (next) { setKind(property?.kind ?? 'url'); setLabel(property?.label ?? ''); setValue(property?.value ?? ''); setError(null); }
  }}>
    <PopoverTrigger asChild>{children}</PopoverTrigger>
    <PopoverContent align="start" className="w-80">
      <form className="space-y-3" aria-label={property ? 'Edit property' : 'Add property'} onSubmit={async event => {
        event.preventDefault();
        const input = {id: property?.id, kind, label: label.trim(), value: value.trim()};
        const message = propertyError(input);
        setError(message);
        if (!message && await onSave(input)) setOpen(false);
      }}>
        <p className="text-sm font-medium">{property ? 'Edit property' : 'Add property'}</p>
        <div role="group" aria-label="Property kind" className="flex gap-2">
          <Button type="button" size="sm" variant={kind === 'url' ? 'secondary' : 'ghost'} aria-pressed={kind === 'url'} onClick={() => setKind('url')}><LinkIcon className="mr-2 h-4 w-4"/>Link</Button>
          <Button type="button" size="sm" variant={kind === 'text' ? 'secondary' : 'ghost'} aria-pressed={kind === 'text'} onClick={() => setKind('text')}><Type className="mr-2 h-4 w-4"/>Text</Button>
        </div>
        <label className="block text-sm">Label<Input autoFocus className="mt-1" aria-label="Property label" value={label} maxLength={80} onChange={event => setLabel(event.target.value)}/></label>
        <label className="block text-sm">{kind === 'url' ? 'URL' : 'Value'}<Input className="mt-1" aria-label="Property value" value={value} maxLength={2048} placeholder={kind === 'url' ? 'https://notion.so/…' : 'Enter a value'} onPaste={event => {
          if (kind === 'url' && !label.trim()) {
            try { const host = new URL(event.clipboardData.getData('text').trim()).hostname; if (host === 'notion.so' || host.endsWith('.notion.so') || host === 'notion.site' || host.endsWith('.notion.site')) setLabel('Notion'); } catch { /* Normal editing continues for non-URL text. */ }
          }
        }} onChange={event => setValue(event.target.value)}/></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="sm" disabled={disabled}>{property ? 'Save property' : 'Add property'}</Button>
      </form>
    </PopoverContent>
  </Popover>;
}
function PropertyRow({ icon, label, children }: {icon: ReactNode; label: ReactNode; children: ReactNode}) {
  return <div className="group grid min-h-9 grid-cols-[140px_minmax(0,1fr)] items-center gap-3 text-sm">
    <div className="flex min-w-0 items-center gap-2 text-muted-foreground">{icon}<span className="truncate">{label}</span></div>
    <div className="min-w-0">{children}</div>
  </div>;
}

export function DocumentControls({ document, folders, onUpdated }: {
  document: DocumentInfo; folders: DocumentFolder[]; onUpdated: () => Promise<void>;
}) {
  const [title, setTitle] = useState(document.title);
  const [schedule, setSchedule] = useState(() => localSchedule(document.scheduled_at));
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [properties, setProperties] = useState<DocumentProperty[]>([]);
  const [loaded, setLoaded] = useState(false);
  const currentProperties = useRef(properties);
  const busy = useRef(false);
  const mounted = useRef(false);
  const undoToasts = useRef(new Set<string | number>());
  const cancelScheduleBlur = useRef(false);
  const committed = useRef({title: document.title, scheduled_at: document.scheduled_at});
  const router = useRouter();
  const { isRecording } = useRecordingState();
  const { refetchMeetings } = useSidebar();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      undoToasts.current.forEach(id => toast.dismiss(id));
      undoToasts.current.clear();
    };
  }, []);
  useEffect(() => {
    committed.current = {title: document.title, scheduled_at: document.scheduled_at};
    setTitle(document.title); setSchedule(localSchedule(document.scheduled_at));
  }, [document.id, document.title, document.scheduled_at]);
  useEffect(() => {
    let active = true;
    setLoaded(false); setProperties([]); currentProperties.current = [];
    documentService.getProperties(document.id).then(rows => {
      if (active) { setProperties(rows); currentProperties.current = rows; setLoaded(true); }
    }).catch(error => { if (active) toast.error(`Could not load properties: ${String(error)}`); });
    return () => { active = false; };
  }, [document.id]);

  const save = async (work: () => Promise<unknown>, revert: () => void = () => {}) => {
    if (!mounted.current) return false;
    if (busy.current) {
      revert();
      toast.error('A save is in progress. Please try again when it finishes.');
      return false;
    }
    busy.current = true; setSaving(true); setSaved(false);
    try {
      try { await work(); }
      catch (error) { if (mounted.current) { revert(); toast.error(String(error)); } return false; }
      if (!mounted.current) return false;
      setSaved(true);
      // Refresh errors must not misrepresent a committed write as a failed save.
      try { await onUpdated(); if (mounted.current) { await refetchMeetings(); window.dispatchEvent(new Event('documents-changed')); } }
      catch (error) { if (mounted.current) toast.error(`Saved, but could not refresh: ${String(error)}`); }
      return true;
    } finally { busy.current = false; if (mounted.current) setSaving(false); }
  };
  const saveTitle = async () => {
    const next = title.trim();
    if (!next) { setTitleError('Title cannot be empty.'); return; }
    setTitleError(null);
    if (next === committed.current.title) { setTitle(next); return; }
    const previous = committed.current.title;
    await save(async () => {
      await documentService.update(document.id, next, committed.current.scheduled_at);
      if (mounted.current) { committed.current.title = next; setTitle(next); }
    }, () => setTitle(previous));
  };
  const saveSchedule = async (value: string | null) => {
    const previous = committed.current.scheduled_at;
    setEditingSchedule(false);
    if (cancelScheduleBlur.current) { cancelScheduleBlur.current = false; return; }
    // Native segmented editors emit an empty value for incomplete drafts.
    // Only the explicit clear action passes null and is allowed to clear storage.
    let next: string | null = null;
    if (value !== null) {
      const date = new Date(value);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value) || Number.isNaN(date.getTime())) {
        setSchedule(localSchedule(previous)); return;
      }
      next = date.toISOString();
      if (localSchedule(next) !== value.slice(0, 16)) {
        setSchedule(localSchedule(previous)); return;
      }
      if (value === localSchedule(previous)) { setSchedule(value); return; }
    }
    setSchedule(value ?? '');
    await save(async () => {
      await documentService.update(document.id, committed.current.title, next);
      if (mounted.current) committed.current.scheduled_at = next;
    }, () => setSchedule(localSchedule(previous)));
  };
  const saveProperties = (next: PropertyInput[]) => save(async () => {
    const rows = await documentService.setProperties(document.id, next);
    if (mounted.current) { currentProperties.current = rows; setProperties(rows); }
  });
  const iconClass = 'h-4 w-4 shrink-0';
  const folderOptions = [{id: '', path: 'Unfiled'}, ...folders.map(folder => ({
    id: folder.id, path: folderAncestors(folder.id, folders).map(ancestor => ancestor.name).join(' / '),
  }))];
  return <header aria-label="Document properties" className="border-b bg-background px-6 py-5 text-foreground">
    <div className="mb-4 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <Input aria-label="Document title" aria-invalid={!!titleError} aria-describedby={titleError ? 'document-title-error' : undefined} disabled={saving} className="h-auto border-transparent bg-transparent px-0 py-1 text-3xl font-semibold shadow-none hover:border-input focus-visible:px-2 md:text-3xl" value={title} onChange={event => {setTitle(event.target.value); setTitleError(null);}} onBlur={() => void saveTitle()} onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === 'Escape') { event.preventDefault(); setTitle(committed.current.title); setTitleError(null); }
        }}/>
        {titleError && <p id="document-title-error" role="alert" className="text-sm text-destructive">{titleError}</p>}
      </div>
      <span role="status" className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">{saving ? 'Saving…' : saved ? <><Check className="h-3 w-3"/>Saved</> : null}</span>
    </div>
    <div className="max-w-3xl space-y-1">
      <PropertyRow icon={<FileText className={iconClass}/>} label="Type"><span className="rounded bg-muted px-2 py-1 text-xs">{document.document_type === 'meeting' ? 'Meeting' : 'Note'}</span></PropertyRow>
      <PropertyRow icon={<Folder className={iconClass}/>} label="Folder">
        <Popover open={folderOpen} onOpenChange={setFolderOpen}><PopoverTrigger asChild><Button aria-label="Document folder" variant="ghost" size="sm" disabled={saving} className="h-8 max-w-full justify-start px-2 font-normal"><span className="truncate">{folderOptions.find(folder => folder.id === (document.folder_id ?? ''))?.path ?? 'Unfiled'}</span><ChevronDown className="ml-2 h-3 w-3 shrink-0"/></Button></PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-0"><Command><CommandInput placeholder="Search folders…" aria-label="Search folders"/><CommandList><CommandEmpty>No folders found.</CommandEmpty>{folderOptions.map(folder => <CommandItem key={folder.id} value={folder.path} onSelect={() => {setFolderOpen(false); void save(() => documentService.move(document.id, folder.id || null));}}><Check className={`${iconClass} ${folder.id === (document.folder_id ?? '') ? '' : 'opacity-0'}`}/>{folder.path}</CommandItem>)}</CommandList></Command></PopoverContent>
        </Popover>
      </PropertyRow>
      {document.document_type === 'meeting' && <PropertyRow icon={<CalendarDays className={iconClass}/>} label="Scheduled">
        <div className="flex items-center gap-1">
          {editingSchedule ? <Input autoFocus aria-label="Scheduled time" type="datetime-local" disabled={saving} className="h-8 w-auto max-w-full border-transparent shadow-none hover:border-input dark:[color-scheme:dark]" value={schedule} onBlur={() => void saveSchedule(schedule)} onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === 'Escape') {
              event.preventDefault(); cancelScheduleBlur.current = true;
              setSchedule(localSchedule(committed.current.scheduled_at)); setEditingSchedule(false);
            }
          }} onChange={event => setSchedule(event.target.value)}/> : <Button variant="ghost" size="sm" aria-label="Edit scheduled time" disabled={saving} className={`h-8 px-2 font-normal ${schedule ? '' : 'text-muted-foreground'}`} onClick={() => {
            cancelScheduleBlur.current = false; setSchedule(localSchedule(committed.current.scheduled_at)); setEditingSchedule(true);
          }}>
            {localSchedule(committed.current.scheduled_at).replace('T', ' ') || 'Empty'}
          </Button>}
          {committed.current.scheduled_at && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Clear scheduled time" disabled={saving} onMouseDown={event => event.preventDefault()} onClick={() => {
            cancelScheduleBlur.current = false; void saveSchedule(null);
          }}><X className="h-3 w-3"/></Button>}
        </div>
      </PropertyRow>}
      <PropertyRow icon={<Clock className={iconClass}/>} label="Created"><time dateTime={document.created_at} className="px-2 text-muted-foreground">{localSchedule(document.created_at).replace('T', ' ') || '—'}</time></PropertyRow>
      {properties.map((property, index) => <PropertyRow key={property.id} icon={property.kind === 'url' ? <LinkIcon className={iconClass}/> : <Type className={iconClass}/>} label={<span title={property.label}>{property.label}</span>}>
        <div className="flex min-w-0 items-center gap-1">
          {property.kind === 'url' ? <button className="flex min-w-0 items-center gap-1 rounded px-2 py-1 text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-ring" title={property.value} onClick={() => void invoke('open_external_url', {url: property.value}).catch(error => toast.error(String(error)))}><span className="truncate">{hostname(property.value)}</span><ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0"/></button> : <span className="min-w-0 whitespace-pre-wrap px-2 py-1 [overflow-wrap:anywhere]">{property.value}</span>}
          <div className="ml-auto flex shrink-0 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
            <PropertyEditor property={property} disabled={saving} onSave={value => saveProperties(currentProperties.current.map((row, i) => i === index ? value : row))}><Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${property.label}`} disabled={saving}><Pencil className="h-3 w-3"/></Button></PropertyEditor>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Delete ${property.label}`} disabled={saving} onClick={async () => {
              if (await saveProperties(currentProperties.current.filter(row => row.id !== property.id)) && mounted.current) {
                const toastId = toast('Property deleted', {action: {label: 'Undo', onClick: () => {
                  if (!mounted.current) return;
                  const next: PropertyInput[] = [...currentProperties.current]; next.splice(Math.min(index, next.length), 0, property); void saveProperties(next);
                }}});
                undoToasts.current.add(toastId);
              }
            }}><Trash2 className="h-3 w-3"/></Button>
          </div>
        </div>
      </PropertyRow>)}
      <PropertyEditor disabled={saving} onSave={value => saveProperties([...currentProperties.current, value])}><Button variant="ghost" size="sm" className="mt-2 text-muted-foreground" disabled={saving || !loaded || properties.length >= 50}><Plus className="mr-2 h-4 w-4"/>Add property</Button></PropertyEditor>
    </div>
    {canRecordDocument(document) && <Button className="mt-4" variant="destructive" disabled={isRecording || saving} onClick={() => {
      sessionStorage.setItem('preparedRecordingMeetingId', document.id); sessionStorage.setItem('autoStartRecording', 'true'); router.push('/');
    }}>Start Recording</Button>}
  </header>;
}

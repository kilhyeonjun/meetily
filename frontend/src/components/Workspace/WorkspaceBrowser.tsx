'use client';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Folder,
  FolderPlus,
  FileText,
  NotebookPen,
  CalendarPlus,
  Inbox,
  Search,
  ArrowLeft,
  ChevronRight,
  SlidersHorizontal,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { documentService } from '@/services/documentService';
import {
  folderAncestors,
  realFolderId,
  workspaceContents,
  workspaceHref,
} from '@/lib/workspace-tree';
import { useWorkspace } from './WorkspaceProvider';
import { WorkspaceActions, dragItem, droppedItem } from './WorkspaceActions';

export function WorkspaceBrowser({ folderId }: { folderId?: string }) {
  const router = useRouter();
  const workspace = useWorkspace();
  const selected = folderId ?? workspace.selectedId;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'title' | 'updated'>('title');
  const [form, setForm] = useState<'meeting' | 'note' | 'folder' | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = realFolderId(selected);
  const updated = (value?: string) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '—';
  const control =
    'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  useEffect(() => {
    if (folderId) workspace.select(folderId);
  }, [folderId, workspace.select]);
  const { folders, documents } = workspaceContents(
    selected,
    workspace.folders,
    workspace.documents,
    query,
    sort,
  );
  const navigate = (id: string) => {
    workspace.select(id);
    router.push(workspaceHref(id));
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !form) return;
    setBusy(true);
    setError(null);
    try {
      await workspace.mutate(async () => {
        if (form === 'folder') await documentService.createFolder(name.trim(), current);
        else {
          const doc = await documentService.create(name.trim(), form, null, current);
          router.push(`/meeting-details?id=${encodeURIComponent(doc.id)}`);
        }
      });
      setForm(null);
      setName('');
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (workspace.loading) return <p role="status">Loading workspace…</p>;
  if (workspace.error)
    return (
      <p role="alert">
        {workspace.error}
        <button onClick={() => void workspace.reload()}>Retry</button>
      </p>
    );
  if (current && !workspace.folders.some((folder) => folder.id === current))
    return (
      <p role="alert">
        This folder is unavailable.{' '}
        <button className="text-sm text-blue-700 hover:underline" onClick={() => navigate('all')}>
          All documents
        </button>
      </p>
    );
  const title = current
    ? workspace.folders.find((folder) => folder.id === current)?.name
    : selected === 'unfiled'
      ? 'Unfiled'
      : 'All documents';
  const itemCount = folders.length + documents.length;
  return (
    <section
      aria-label="Workspace browser"
      className="min-h-full bg-slate-50 px-5 py-6 text-slate-900 sm:px-8"
    >
      <div className="@container mx-auto max-w-6xl space-y-5">
        <nav
          aria-label="Folder breadcrumbs"
          className="flex min-h-8 flex-wrap items-center gap-1.5 text-sm text-slate-500"
        >
          <button
            className="mr-2 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 font-medium text-slate-600 transition hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <button
            className="rounded px-1.5 py-1 hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            onClick={() => navigate('all')}
          >
            All documents
          </button>
          {selected === 'unfiled' ? (
            <>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="font-medium text-slate-900">Unfiled</span>
            </>
          ) : (
            current &&
            folderAncestors(current, workspace.folders).map((folder) => (
              <span className="contents" key={folder.id}>
                <ChevronRight className="h-3.5 w-3.5" />
                <button
                  className="rounded px-1.5 py-1 hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  onClick={() => navigate(folder.id)}
                >
                  {folder.name}
                </button>
              </span>
            ))
          )}
        </nav>
        <header className="flex flex-col gap-5 border-b border-slate-200 pb-5 @3xl:flex-row @3xl:items-center @3xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600">
              <Folder className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-950">
                {title}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {query.trim()
                  ? `${itemCount} search result${itemCount === 1 ? '' : 's'}`
                  : itemCount
                    ? `${itemCount} item${itemCount === 1 ? '' : 's'} in this location`
                    : 'Keep meeting material together.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              onClick={() => {
                setForm('meeting');
                setName('');
                setError(null);
              }}
            >
              <CalendarPlus className="h-4 w-4" />
              New meeting
            </button>
            <button
              className={control}
              onClick={() => {
                setForm('note');
                setName('');
                setError(null);
              }}
            >
              <NotebookPen className="h-4 w-4" />
              New note
            </button>
            <button
              className={control}
              onClick={() => {
                setForm('folder');
                setName('');
                setError(null);
              }}
            >
              <FolderPlus className="h-4 w-4" />
              {current ? 'New subfolder' : 'New folder'}
            </button>
          </div>
        </header>
        {form && (
          <form
            onSubmit={create}
            className="flex flex-col gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 @xl:flex-row @xl:items-end"
          >
            <label className="flex-1 text-sm font-medium text-slate-700">
              {form === 'meeting'
                ? 'Name your meeting'
                : form === 'note'
                  ? 'Name your note'
                  : 'Name your folder'}
              <input
                autoFocus
                aria-label="Name"
                placeholder={
                  form === 'meeting'
                    ? 'e.g. Weekly planning'
                    : form === 'note'
                      ? 'e.g. Decisions and ideas'
                      : 'e.g. Product'
                }
                className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <span className="mt-2 block text-xs font-normal text-slate-500">
                Created in {current ? title : form === 'folder' ? 'Top level' : 'Unfiled'}
              </span>
            </label>
            <div className="flex gap-2">
              <button
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                type="submit"
                disabled={busy || !name.trim()}
              >
                {busy ? 'Saving…' : 'Create'}
              </button>
              <button
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-white"
                type="button"
                onClick={() => setForm(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between">
          <label className="relative block max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              aria-label="Search this folder"
              placeholder="Search in this folder"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600 shadow-sm">
            <SlidersHorizontal className="h-4 w-4" />
            <span className="sr-only">Sort</span>
            <select
              className="bg-transparent font-medium outline-none"
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
            >
              <option value="title">Name</option>
              <option value="updated">Recently updated</option>
            </select>
          </label>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}
        <div
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const item = droppedItem(event);
            if (item) void workspace.move(item, current).catch((cause) => setError(String(cause)));
          }}
        >
          <div className="hidden grid-cols-[minmax(0,1fr)_7rem_9rem_4rem] gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 @xl:grid">
            <span>Name</span>
            <span>Type</span>
            <span>Updated</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-slate-100">
            {folders.map((folder) => (
              <div
                data-folder-row={folder.id}
                className="group grid grid-cols-[minmax(0,1fr)_2.5rem] gap-3 items-center px-4 py-3 transition hover:bg-blue-50/40 @xl:grid-cols-[minmax(0,1fr)_7rem_9rem_4rem] @xl:px-5"
                key={folder.id}
                draggable
                onDragStart={(event) => dragItem(event, { type: 'folder', id: folder.id })}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const item = droppedItem(event);
                  if (item)
                    void workspace.move(item, folder.id).catch((cause) => setError(String(cause)));
                }}
              >
                <button
                  className="inline-flex min-w-0 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  onClick={() => navigate(folder.id)}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
                    <Folder className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">{folder.name}</span>
                    <span className="mt-0.5 block text-xs text-slate-400 @xl:hidden">
                      Folder · {updated(folder.updated_at)}
                    </span>
                  </span>
                </button>
                <span className="hidden text-sm text-slate-500 @xl:block">Folder</span>
                <time
                  className="hidden text-sm text-slate-500 @xl:block"
                  dateTime={folder.updated_at}
                >
                  {updated(folder.updated_at)}
                </time>
                <WorkspaceActions item={{ type: 'folder', id: folder.id }} label={folder.name} />
              </div>
            ))}
            {documents.map((doc) => (
              <div
                className="group grid grid-cols-[minmax(0,1fr)_2.5rem] gap-3 items-center px-4 py-3 transition hover:bg-blue-50/40 @xl:grid-cols-[minmax(0,1fr)_7rem_9rem_4rem] @xl:px-5"
                key={doc.id}
                draggable
                onDragStart={(event) => dragItem(event, { type: 'document', id: doc.id })}
              >
                <button
                  className="inline-flex min-w-0 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  onClick={() => router.push(`/meeting-details?id=${encodeURIComponent(doc.id)}`)}
                >
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${doc.document_type === 'note' ? 'bg-amber-50 text-amber-600' : 'bg-violet-50 text-violet-600'}`}
                  >
                    {doc.document_type === 'note' ? (
                      <NotebookPen className="h-5 w-5" />
                    ) : (
                      <FileText className="h-5 w-5" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">{doc.title}</span>
                    <span className="mt-0.5 block text-xs text-slate-400 @xl:hidden">
                      {doc.document_type === 'note' ? 'Personal note' : 'Meeting'} ·{' '}
                      {updated(doc.updated_at)}
                    </span>
                  </span>
                </button>
                <span className="hidden text-sm text-slate-500 @xl:block">
                  {doc.document_type === 'note' ? 'Personal note' : 'Meeting'}
                </span>
                <time className="hidden text-sm text-slate-500 @xl:block" dateTime={doc.updated_at}>
                  {updated(doc.updated_at)}
                </time>
                <WorkspaceActions item={{ type: 'document', id: doc.id }} label={doc.title} />
              </div>
            ))}
            {!folders.length && !documents.length && (
              <div className="px-6 py-14 text-center">
                <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-500">
                  <Folder className="h-5 w-5" />
                </span>
                <p className="font-medium text-slate-700">
                  {query ? 'No matching items.' : 'This folder is ready for your work.'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {query
                    ? 'Try a different search term.'
                    : 'Create a meeting, note or subfolder to get started.'}
                </p>
              </div>
            )}
          </div>
        </div>
        <button
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900"
          onClick={() => navigate('unfiled')}
        >
          <Inbox className="h-4 w-4" />
          View Unfiled items
        </button>
      </div>
    </section>
  );
}

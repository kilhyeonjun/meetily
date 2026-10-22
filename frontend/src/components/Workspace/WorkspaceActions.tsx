'use client';

import { useRef, useState, type DragEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { MoreHorizontal, Pencil, FolderInput, Folder, Inbox, Trash2, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { documentService } from '@/services/documentService';
import { folderAncestors, folderMoveTargets } from '@/lib/workspace-tree';
import { useWorkspace } from './WorkspaceProvider';

export interface WorkspaceItem {
  type: 'folder' | 'document';
  id: string;
}
const MIME = 'application/x-meetily-item';
export function dragItem(event: DragEvent, item: WorkspaceItem) {
  event.dataTransfer.setData(MIME, JSON.stringify(item));
  event.dataTransfer.effectAllowed = 'move';
}
export function droppedItem(event: DragEvent): WorkspaceItem | null {
  try {
    const item = JSON.parse(event.dataTransfer.getData(MIME));
    return (item.type === 'folder' || item.type === 'document') && typeof item.id === 'string'
      ? item
      : null;
  } catch {
    return null;
  }
}

export function WorkspaceActions({ item, label }: { item: WorkspaceItem; label: string }) {
  const { folders, documents, mutate, move } = useWorkspace();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [action, setAction] = useState<'rename' | 'move' | 'remove' | null>(null);
  const [name, setName] = useState(label);
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasChildren = folders.some((folder) => folder.parent_id === item.id);
  const current =
    item.type === 'folder'
      ? (folders.find((folder) => folder.id === item.id)?.parent_id ?? null)
      : (documents.find((doc) => doc.id === item.id)?.folder_id ?? null);
  const pathLabel = (id: string) =>
    folderAncestors(id, folders)
      .map((folder) => folder.name)
      .join(' / ');
  const targets = folderMoveTargets(item.type === 'folder' ? item.id : null, folders).filter(
    (folder) => pathLabel(folder.id).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const open = (next: typeof action) => {
    setName(label);
    setQuery('');
    setTarget(current);
    setError(null);
    setAction(next);
  };
  const commit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'move') await move(item, target);
      if (action === 'rename')
        await mutate(() =>
          item.type === 'folder'
            ? documentService.renameFolder(item.id, name.trim())
            : documentService.update(
                item.id,
                name.trim(),
                documents.find((doc) => doc.id === item.id)?.scheduled_at ?? null,
              ),
        );
      if (action === 'remove') await mutate(() => documentService.removeFolder(item.id));
      setAction(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const destination = target ? pathLabel(target) : item.type === 'folder' ? 'Top level' : 'Unfiled';
  const inputClass =
    'mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

  return (
    <span
      className="shrink-0 justify-self-end"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            ref={trigger}
            type="button"
            aria-label={`Actions for ${label}`}
            title="Rename, move and organize"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 data-[state=open]:bg-slate-100"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-44 rounded-xl border-slate-200 bg-white p-1.5 text-slate-700 shadow-lg data-[state=closed]:animate-none"
          onInteractOutside={(event) => {
            // The trigger owns toggling; an outgoing layer must not dismiss a
            // newly reopened menu for the same trigger's pointer/focus event.
            if (trigger.current?.contains(event.target as Node)) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (action) event.preventDefault();
          }}
        >
          <DropdownMenuItem className="rounded-lg px-3 py-2" onSelect={() => open('rename')}>
            <Pencil className="text-slate-400" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem className="rounded-lg px-3 py-2" onSelect={() => open('move')}>
            <FolderInput className="text-slate-400" />
            Move
          </DropdownMenuItem>
          {item.type === 'folder' && (
            <>
              <DropdownMenuSeparator className="bg-slate-100" />
              <DropdownMenuItem
                className="rounded-lg px-3 py-2 text-red-600 focus:bg-red-50 focus:text-red-700"
                onSelect={() => open('remove')}
              >
                <Trash2 />
                Remove folder
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog.Root
        open={action !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setAction(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/30" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl outline-none"
            onOpenAutoFocus={(event) => {
              if (input.current) {
                event.preventDefault();
                input.current.focus();
              }
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              trigger.current?.focus();
            }}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            <Dialog.Close
              disabled={busy}
              aria-label="Close dialog"
              className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
            <Dialog.Title className="pr-8 text-xl font-semibold tracking-tight">
              {action === 'move'
                ? 'Move item'
                : action === 'remove'
                  ? 'Remove folder?'
                  : 'Rename item'}
            </Dialog.Title>
            <Dialog.Description className="mt-2 break-words text-sm leading-6 text-slate-500">
              {label}
            </Dialog.Description>
            <form
              className="mt-5 space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                void commit();
              }}
            >
              {action === 'rename' && (
                <label className="block text-sm font-medium text-slate-700">
                  Name
                  <input
                    ref={input}
                    aria-label="New name"
                    disabled={busy}
                    className={inputClass}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              )}
              {action === 'move' && (
                <>
                  <label className="block text-sm font-medium text-slate-700">
                    Choose a folder
                    <input
                      ref={input}
                      aria-label="Search destinations"
                      disabled={busy}
                      placeholder="Search destinations"
                      className={inputClass}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <div
                    className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2"
                    role="radiogroup"
                    aria-label="Move destination"
                  >
                    {[
                      { id: null, name: item.type === 'folder' ? 'Top level' : 'Unfiled' },
                      ...targets.map((folder) => ({ id: folder.id, name: pathLabel(folder.id) })),
                    ].map((folder) => (
                      <label
                        key={folder.id ?? 'root'}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${target === folder.id ? 'bg-blue-50 text-blue-800' : 'hover:bg-slate-50'}`}
                      >
                        <input
                          type="radio"
                          name="move-destination"
                          disabled={busy}
                          checked={target === folder.id}
                          onChange={() => setTarget(folder.id)}
                          className="accent-blue-600"
                        />
                        {folder.id ? (
                          <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                        ) : (
                          <Inbox className="h-4 w-4 shrink-0 text-slate-400" />
                        )}
                        <span className="min-w-0 break-words">{folder.name}</span>
                      </label>
                    ))}
                    {query && !targets.length && (
                      <p className="px-3 py-3 text-sm text-slate-500">No matching folders.</p>
                    )}
                  </div>
                  <p className="break-words text-xs text-slate-500">
                    Destination: <span className="font-medium text-slate-700">{destination}</span>
                  </p>
                </>
              )}
              {action === 'remove' && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                  {hasChildren
                    ? 'Move child folders elsewhere before removing this folder.'
                    : 'Documents will return to Unfiled. Notes and recordings are kept.'}
                </p>
              )}
              {error && (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Dialog.Close
                  disabled={busy}
                  className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  Cancel
                </Dialog.Close>
                <button
                  type="submit"
                  className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 ${action === 'remove' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                  disabled={
                    busy ||
                    (action === 'remove' && hasChildren) ||
                    (action === 'rename' && !name.trim()) ||
                    (action === 'move' && target === current)
                  }
                >
                  {busy
                    ? 'Saving…'
                    : error
                      ? 'Retry'
                      : action === 'remove'
                        ? 'Remove'
                        : action === 'move'
                          ? 'Move here'
                          : 'Save name'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </span>
  );
}

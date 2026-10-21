'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Folder, FolderOpen, Files, Inbox, ChevronRight, ChevronDown } from 'lucide-react';
import { folderAncestors, workspaceHref } from '@/lib/workspace-tree';
import { useWorkspace } from './WorkspaceProvider';
import { WorkspaceActions, dragItem, droppedItem } from './WorkspaceActions';

const KEY = 'meetily.workspace.expandedFolders';
interface TreeRow { id: string; name: string; depth: number; parent: string | null; children: boolean }

export function WorkspaceTree() {
  const { folders, selectedId, select, move, error, reload } = useWorkspace();
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState('all');
  const [failure, setFailure] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());

  const remember = (value: Set<string>) => {
    try { window.localStorage.setItem(KEY, JSON.stringify([...value])); } catch { /* Optional layout persistence. */ }
  };
  useEffect(() => {
    try { setExpanded(new Set(JSON.parse(window.localStorage.getItem(KEY) || '[]'))); } catch { /* Keep roots visible. */ }
  }, []);
  useEffect(() => {
    const ancestors = folderAncestors(selectedId, folders).slice(0, -1);
    setExpanded(previous => {
      const next = new Set(previous);
      ancestors.forEach(folder => next.add(folder.id));
      if (next.size === previous.size) return previous;
      remember(next);
      return next;
    });
    setFocused(selectedId);
  }, [selectedId, folders]);

  const toggle = (id: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    remember(next);
    return next;
  });
  const rows: TreeRow[] = [];
  const visit = (parent: string | null, depth: number, seen: Set<string>) => {
    const children = folders.filter(folder => (folder.parent_id ?? null) === parent).sort((a, b) => a.name.localeCompare(b.name));
    for (const folder of children) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      rows.push({ id: folder.id, name: folder.name, depth, parent, children: folders.some(child => child.parent_id === folder.id) });
      if (expanded.has(folder.id)) visit(folder.id, depth + 1, seen);
    }
  };
  visit(null, 1, new Set());
  const visible: TreeRow[] = [
    { id: 'all', name: 'All documents', depth: 1, parent: null, children: false },
    { id: 'unfiled', name: 'Unfiled', depth: 1, parent: null, children: false },
    ...rows,
  ];
  const go = (id: string) => { select(id); router.push(workspaceHref(id)); };
  const focus = (id: string) => { setFocused(id); refs.current.get(id)?.focus(); };
  const handleKey = (event: KeyboardEvent, row: TreeRow, index: number) => {
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) event.preventDefault();
    let next: string | undefined;
    if (event.key === 'ArrowDown') next = visible[index + 1]?.id;
    if (event.key === 'ArrowUp') next = visible[index - 1]?.id;
    if (event.key === 'Home') next = visible[0].id;
    if (event.key === 'End') next = visible.at(-1)?.id;
    if (event.key === 'ArrowRight' && row.children) {
      if (!expanded.has(row.id)) toggle(row.id); else next = visible[index + 1]?.id;
    }
    if (event.key === 'ArrowLeft') {
      if (expanded.has(row.id)) toggle(row.id); else next = row.parent ?? undefined;
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(row.id); }
    if (next) focus(next);
  };

  return (
    <nav aria-label="Workspace folders" className="overflow-auto p-2 text-sm">
      <button className="mb-2 rounded px-2 py-1 text-blue-700 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => go(selectedId)}>Open workspace</button>
      {(failure || error) && <p role="alert">{failure || error}<button onClick={() => void reload()}>Retry</button></p>}
      <div role="tree" aria-label="Folders">
        {visible.map((row, index) => {
          const virtual = row.id === 'all' || row.id === 'unfiled';
          const Icon = row.id === 'all' ? Files : row.id === 'unfiled' ? Inbox : expanded.has(row.id) ? FolderOpen : Folder;
          return (
            <div role="treeitem" key={row.id} data-folder-id={row.id}
              ref={node => { if (node) refs.current.set(row.id, node); else refs.current.delete(row.id); }}
              aria-level={row.depth} aria-selected={selectedId === row.id} aria-expanded={row.children ? expanded.has(row.id) : undefined}
              tabIndex={focused === row.id ? 0 : -1}
              className={`flex cursor-pointer items-center rounded py-1 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selectedId === row.id ? 'bg-blue-50 text-blue-800' : ''}`}
              style={{ paddingLeft: row.depth * 10 }} onFocus={() => setFocused(row.id)} onClick={() => go(row.id)} onKeyDown={event => handleKey(event, row, index)}
              draggable={!virtual} onDragStart={event => dragItem(event, { type: 'folder', id: row.id })} onDragOver={event => event.preventDefault()}
              onDrop={event => {
                event.preventDefault(); event.stopPropagation();
                const item = droppedItem(event);
                if (item) void move(item, virtual ? null : row.id).catch(cause => setFailure(String(cause)));
              }}
            >
              {row.children && <button aria-label={`${expanded.has(row.id) ? 'Collapse' : 'Expand'} ${row.name}`} aria-expanded={expanded.has(row.id)}
                onClick={event => { event.stopPropagation(); toggle(row.id); }} className="rounded px-1 focus-visible:ring-2 focus-visible:ring-blue-500">
                {expanded.has(row.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>}
              <span className="flex flex-1 items-center gap-2 truncate"><Icon className={`h-4 w-4 shrink-0 ${virtual ? '' : 'text-blue-600'}`} /><span className="truncate">{row.name}</span></span>
              {!virtual && <WorkspaceActions item={{ type: 'folder', id: row.id }} label={row.name} />}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

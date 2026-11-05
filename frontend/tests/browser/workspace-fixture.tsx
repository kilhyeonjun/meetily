import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceProvider } from '../../src/components/Workspace/WorkspaceProvider';
import { WorkspaceBrowser } from '../../src/components/Workspace/WorkspaceBrowser';
import { WorkspaceTree } from '../../src/components/Workspace/WorkspaceTree';
import { DocumentControls } from '../../src/components/Workspace/DocumentControls';
import { documentService, type DocumentInfo, type DocumentFolder } from '../../src/services/documentService';
import { Toaster } from 'sonner';

function DetailFixture({ id }: {id: string}) {
  const [document, setDocument] = useState<DocumentInfo | null>(null);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const refresh = async () => {
    setDocument(await documentService.get(id));
    setFolders(await documentService.folders());
  };
  useEffect(() => { void refresh(); }, [id]);
  return document ? <DocumentControls key={id} document={document} folders={folders} onUpdated={refresh}/> : null;
}

function Fixture() {
  const [documentId, setDocumentId] = useState(new URLSearchParams(location.search).get('id'));
  const [folderId, setFolderId] = useState(
    new URLSearchParams(location.search).get('folderId') || 'all',
  );
  useEffect(() => {
    const navigate = () => {
      setFolderId(new URLSearchParams(location.search).get('folderId') || 'all');
      setDocumentId(new URLSearchParams(location.search).get('id'));
    };
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, []);
  return (
    <WorkspaceProvider>
      <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <aside
          style={{
            width: Number(new URLSearchParams(location.search).get('sidebar')) || 232,
            flexShrink: 0,
            borderRight: '1px solid #e2e8f0',
            overflow: 'auto',
          }}
        >
          <WorkspaceTree />
        </aside>
        <main style={{ minWidth: 0, flex: 1, overflow: 'auto' }}>
          {documentId ? <DetailFixture id={documentId}/> : <WorkspaceBrowser folderId={folderId} />}
        </main>
      </div>
      <Toaster />
    </WorkspaceProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceProvider } from '../../src/components/Workspace/WorkspaceProvider';
import { WorkspaceBrowser } from '../../src/components/Workspace/WorkspaceBrowser';
import { WorkspaceTree } from '../../src/components/Workspace/WorkspaceTree';

function Fixture() {
  const [folderId, setFolderId] = useState(
    new URLSearchParams(location.search).get('folderId') || 'all',
  );
  useEffect(() => {
    const navigate = () =>
      setFolderId(new URLSearchParams(location.search).get('folderId') || 'all');
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
          <WorkspaceBrowser folderId={folderId} />
        </main>
      </div>
    </WorkspaceProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);

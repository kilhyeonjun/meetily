import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useOnboarding } from '@/contexts/OnboardingContext';

export function UseNotesFirstButton({ onReady }: { onReady?: () => void }) {
  const { databaseExists, enableNotesWorkspace } = useOnboarding();
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState(false);
  const enter = async () => {
    if (!databaseExists || entering) return;
    setEntering(true);
    setError(false);
    try {
      await enableNotesWorkspace();
      onReady?.();
    } catch (cause) {
      console.error('Could not enable notes workspace', cause);
      setError(true);
    } finally {
      setEntering(false);
    }
  };
  return <div className="space-y-2">
    <Button variant="outline" className="w-full h-11" disabled={!databaseExists || entering} onClick={enter}>Use notes first</Button>
    <p className="text-xs text-center text-gray-500">Create notes and prepare meetings without downloading models or granting recording permissions.</p>
    {!databaseExists && <p className="text-xs text-center text-gray-500">Preparing your local database…</p>}
    {error && <p role="alert" className="text-xs text-center text-red-600">Could not open the notes workspace. Please try again.</p>}
  </div>;
}

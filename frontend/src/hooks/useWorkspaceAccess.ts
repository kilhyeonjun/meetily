import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/** Notes readiness is independent of recording/model setup completion. */
export function useWorkspaceAccess() {
  const [isChecking, setIsChecking] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void invoke<{ completed: boolean; workspace_ready?: boolean } | null>('get_onboarding_status')
      .then(status => {
        if (cancelled) return;
        setOnboardingCompleted(status?.completed ?? false);
        setShowOnboarding(!(status?.completed || status?.workspace_ready));
      })
      .catch(error => {
        console.error('Could not check workspace readiness', error);
        if (!cancelled) setShowOnboarding(true);
      })
      .finally(() => { if (!cancelled) setIsChecking(false); });
    return () => { cancelled = true; };
  }, []);

  return {
    isChecking, showOnboarding, setShowOnboarding, onboardingCompleted,
    markWorkspaceReady: () => setShowOnboarding(false),
  };
}

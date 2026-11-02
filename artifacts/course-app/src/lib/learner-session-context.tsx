import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  clearLearnerSession,
  readLearnerSession,
  type LearnerIdentity,
  type LearnerRpcReply,
} from '@/lib/learner-session';
import { callRpc, hasSupabaseConfig } from '@/lib/supabase';

type LearnerSessionStatus = 'checking' | 'signed-in' | 'signed-out' | 'error';

type LearnerSessionContextValue = {
  learner: LearnerIdentity | null;
  status: LearnerSessionStatus;
  refresh: () => Promise<void>;
};

const LearnerSessionContext =
  createContext<LearnerSessionContextValue | null>(null);

export function LearnerSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [learner, setLearner] = useState<LearnerIdentity | null>(null);
  const [status, setStatus] = useState<LearnerSessionStatus>('checking');

  const refresh = useCallback(async () => {
    const sessionSecret = readLearnerSession();
    if (!sessionSecret) {
      setLearner(null);
      setStatus('signed-out');
      return;
    }

    if (!hasSupabaseConfig) {
      setStatus('error');
      return;
    }

    try {
      const reply = await callRpc<LearnerRpcReply>(
        'validate_learner_session',
        { p_session_secret: sessionSecret },
      );

      if (reply.ok && reply.learner) {
        setLearner(reply.learner);
        setStatus('signed-in');
        return;
      }

      clearLearnerSession();
      setLearner(null);
      setStatus('signed-out');
    } catch {
      // Keep the local session during a temporary network failure. The next
      // check can still learn that an administrator revoked it.
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 45_000);
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const refreshOnStorage = () => void refresh();

    document.addEventListener('visibilitychange', refreshOnFocus);
    window.addEventListener('storage', refreshOnStorage);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshOnFocus);
      window.removeEventListener('storage', refreshOnStorage);
    };
  }, [refresh]);

  return (
    <LearnerSessionContext.Provider value={{ learner, status, refresh }}>
      {children}
    </LearnerSessionContext.Provider>
  );
}

export function useLearnerSession() {
  const value = useContext(LearnerSessionContext);
  if (!value) {
    throw new Error(
      'useLearnerSession must be used inside LearnerSessionProvider',
    );
  }
  return value;
}

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Link, Route, Switch, useLocation } from 'wouter';
import {
  InlineAlert,
  LoadingState,
  SetupNotice,
} from '@/components/app-shell';
import {
  AdminCommunityPage,
  AdminContentPage,
  AdminLearnersPage,
  AdminOverview,
} from '@/pages/admin';
import { AdminSignInPage, LearnerAccessPage } from '@/pages/auth-pages';
import {
  LearnerCommunityPage,
  LearnerContentPage,
  LearnerHomePage,
} from '@/pages/learner';
import {
  AdminCoursesIndexPage,
  CourseBuilderPage,
} from '@/pages/course-admin';
import { LearnerCoursePage } from '@/pages/course-player';
import { LearnerSessionProvider, useLearnerSession } from '@/lib/learner-session-context';
import {
  errorCode,
  hasSupabaseConfig,
  requireSupabase,
} from '@/lib/supabase';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LearnerSessionProvider>
        <Switch>
          <Route path="/" component={LearnerAccessPage} />
          <Route path="/admin/sign-in" component={AdminSignInPage} />

          <Route path="/admin">
            <RequireAdmin>
              <AdminOverview />
            </RequireAdmin>
          </Route>
          <Route path="/admin/students">
            <RequireAdmin>
              <AdminLearnersPage />
            </RequireAdmin>
          </Route>
          <Route path="/admin/courses">
            <RequireAdmin>
              <AdminCoursesIndexPage />
            </RequireAdmin>
          </Route>
          <Route path="/admin/courses/:courseId">
            <RequireAdmin>
              <CourseBuilderPage />
            </RequireAdmin>
          </Route>
          <Route path="/admin/content">
            <RequireAdmin>
              <AdminContentPage />
            </RequireAdmin>
          </Route>
          <Route path="/admin/community">
            <RequireAdmin>
              <AdminCommunityPage />
            </RequireAdmin>
          </Route>

          <Route path="/learn">
            <RequireLearner>
              <LearnerHomePage />
            </RequireLearner>
          </Route>
          <Route path="/learn/course">
            <RequireLearner>
              <LearnerCoursePage />
            </RequireLearner>
          </Route>
          <Route path="/learn/course/:courseId">
            <RequireLearner>
              <LearnerCoursePage />
            </RequireLearner>
          </Route>
          <Route path="/learn/content">
            <RequireLearner>
              <LearnerContentPage />
            </RequireLearner>
          </Route>
          <Route path="/learn/community">
            <RequireLearner>
              <LearnerCommunityPage />
            </RequireLearner>
          </Route>

          <Route>
            <NotFound />
          </Route>
        </Switch>
      </LearnerSessionProvider>
    </QueryClientProvider>
  );
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const [state, setState] = useState<
    'checking' | 'ready' | 'forbidden' | 'error' | 'config'
  >('checking');
  const [message, setMessage] = useState('');

  const checkAdmin = useCallback(async () => {
    if (!hasSupabaseConfig) {
      setState('config');
      return;
    }

    setState('checking');
    setMessage('');
    try {
      const client = requireSupabase();
      const { data, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!data.session) {
        setLocation('/admin/sign-in');
        return;
      }

      const { error: roleError } = await client.rpc('admin_list_learners');
      if (roleError) {
        if (errorCode(roleError) === '42501') {
          await client.auth.signOut();
          setState('forbidden');
        } else {
          setMessage(
            'تعذّر التحقق من صلاحية الإدارة. تأكد من تشغيل ملف SQL ثم أعد المحاولة.',
          );
          setState('error');
        }
        return;
      }
      setState('ready');
    } catch {
      setMessage('تعذّر الاتصال بـ Supabase للتحقق من الجلسة.');
      setState('error');
    }
  }, [setLocation]);

  useEffect(() => {
    void checkAdmin();
  }, [checkAdmin]);

  if (state === 'ready') return <>{children}</>;
  if (state === 'checking') {
    return <LoadingState label="جارٍ التحقق من صلاحية المشرف…" />;
  }
  if (state === 'config') {
    return (
      <GateMessage
        title="إعداد الاتصال مطلوب"
        onRetry={() => void checkAdmin()}
      >
        <SetupNotice />
        <Link className="button-soft" href="/admin/sign-in">
          صفحة دخول المشرف
          <ArrowLeft size={15} aria-hidden="true" />
        </Link>
      </GateMessage>
    );
  }
  if (state === 'forbidden') {
    return (
      <GateMessage title="هذا الحساب ليس مشرفًا">
        <InlineAlert>{'تم إنهاء جلسة هذا الحساب.'}</InlineAlert>
        <Link className="button-primary" href="/admin/sign-in">
          العودة إلى تسجيل الدخول
          <ArrowLeft size={15} aria-hidden="true" />
        </Link>
      </GateMessage>
    );
  }
  return (
    <GateMessage title="تعذّر فتح لوحة الإدارة" onRetry={() => void checkAdmin()}>
      <InlineAlert>{message}</InlineAlert>
      <Link className="button-soft" href="/admin/sign-in">
        صفحة دخول المشرف
        <ArrowLeft size={15} aria-hidden="true" />
      </Link>
    </GateMessage>
  );
}

function RequireLearner({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { status, refresh } = useLearnerSession();

  useEffect(() => {
    if (status === 'signed-out') setLocation('/');
  }, [setLocation, status]);

  if (status === 'signed-in') return <>{children}</>;
  if (status === 'error') {
    return (
      <GateMessage title="تعذّر التحقق من جلسة الدخول">
        <InlineAlert>
          لا يمكن الاتصال بخدمة الدخول الآن. ستبقى جلستك محفوظة، ويمكنك إعادة
          المحاولة.
        </InlineAlert>
        <button
          type="button"
          className="button-primary"
          onClick={() => void refresh()}
          data-testid="button-retry-learner-session"
        >
          <RefreshCw size={15} aria-hidden="true" />
          إعادة المحاولة
        </button>
      </GateMessage>
    );
  }
  return <LoadingState label="جارٍ التحقق من جلسة المتعلّم…" />;
}

function GateMessage({
  title,
  children,
  onRetry,
}: {
  title: string;
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <main className="gate-page">
      <div className="panel gate-card">
        <div className="eyebrow">لُغتي بثقة</div>
        <h1>{title}</h1>
        <div className="gate-content">{children}</div>
        {onRetry && (
          <button
            type="button"
            className="button-soft"
            onClick={onRetry}
            data-testid="button-retry-admin-check"
          >
            <RefreshCw size={15} aria-hidden="true" />
            إعادة المحاولة
          </button>
        )}
      </div>
    </main>
  );
}

function NotFound() {
  return (
    <main className="gate-page">
      <div className="panel gate-card">
        <div className="eyebrow">لُغتي بثقة</div>
        <h1>الصفحة غير موجودة</h1>
        <Link href="/" className="button-primary">
          العودة إلى تسجيل الدخول
          <ArrowLeft size={15} aria-hidden="true" />
        </Link>
      </div>
    </main>
  );
}

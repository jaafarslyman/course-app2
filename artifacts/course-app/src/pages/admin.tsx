import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  BookOpen,
  Check,
  Clock3,
  Copy,
  KeyRound,
  LibraryBig,
  LogIn,
  MessagesSquare,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'wouter';
import { z } from 'zod';
import { Form } from '@/components/ui/form';
import {
  AppShell,
  EmptyState,
  InlineAlert,
  LoadingState,
  PageHeading,
} from '@/components/app-shell';
import { createAccessCode } from '@/lib/learner-session';
import { callRpc } from '@/lib/supabase';

export type LearnerRecord = {
  id: string;
  name: string;
  email: string;
  created_at: string;
  active_session: boolean;
  pending_code: boolean;
  last_seen_at: string | null;
};

type RpcActionReply = {
  ok: boolean;
  error?: string;
  learner?: LearnerRecord;
  revoked_sessions?: number;
};

type OneTimeCode = {
  name: string;
  email: string;
  code: string;
};

const learnerSchema = z.object({
  name: z.string().trim().min(1, 'أدخل اسم المتعلّم').max(120),
  email: z.string().trim().email('أدخل بريدًا إلكترونيًا صحيحًا').max(254),
});

type LearnerFormValues = z.infer<typeof learnerSchema>;

async function loadLearners(): Promise<LearnerRecord[]> {
  const result = await callRpc<unknown>('admin_list_learners');
  if (!Array.isArray(result)) {
    throw new Error('invalid_learner_response');
  }
  return result as LearnerRecord[];
}

function useLearners() {
  return useQuery({
    queryKey: ['admin', 'learners'],
    queryFn: loadLearners,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

function formatCount(value: number) {
  return new Intl.NumberFormat('ar').format(value);
}

function formatDate(value: string | null) {
  if (!value) return 'لا يوجد نشاط بعد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof UsersRound;
  color: string;
}) {
  return (
    <article className="panel stat-card" data-testid={`stat-${label}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{formatCount(value)}</div>
      <div className="stat-note">{detail}</div>
      <div className="stat-icon" style={{ background: color }}>
        <Icon size={17} aria-hidden="true" />
      </div>
    </article>
  );
}

export function AdminOverview() {
  const query = useLearners();
  const learners = query.data ?? [];
  const activeCount = learners.filter((learner) => learner.active_session).length;
  const pendingCount = learners.filter((learner) => learner.pending_code).length;

  return (
    <AppShell title="نظرة عامة">
      <PageHeading
        eyebrow="إدارة التعلّم"
        title="لوحة الإدارة"
        subtitle="ملخّص حقيقي لحسابات المتعلمين وحالة الدخول."
      >
        <Link
          className="button-primary"
          href="/admin/students"
          data-testid="link-manage-learners"
        >
          <UsersRound size={16} aria-hidden="true" />
          إدارة المتعلمين
        </Link>
      </PageHeading>

      {query.isLoading ? (
        <LoadingState label="جارٍ تحميل بيانات المتعلمين…" />
      ) : query.isError ? (
        <InlineAlert>
          تعذّر تحميل البيانات. تأكد من تشغيل ملف إعداد Supabase ثم أعد المحاولة.
        </InlineAlert>
      ) : (
        <>
          <section className="stat-grid" aria-label="إحصاءات المتعلمين">
            <Metric
              label="إجمالي المتعلمين"
              value={learners.length}
              detail="حسابات محفوظة في Supabase"
              icon={UsersRound}
              color="#e7f2ed"
            />
            <Metric
              label="جلسات نشطة"
              value={activeCount}
              detail="يمكن إنهاؤها من إدارة المتعلمين"
              icon={LogIn}
              color="#e8eef9"
            />
            <Metric
              label="رموز بانتظار الاستخدام"
              value={pendingCount}
              detail="لا تنتهي قبل استخدامها"
              icon={KeyRound}
              color="#fff1d9"
            />
            <Metric
              label="بدون جلسة نشطة"
              value={learners.length - activeCount}
              detail="يشمل من لم يستخدموا رمزهم بعد"
              icon={Clock3}
              color="#fdeae4"
            />
          </section>

          <section className="panel dashboard-next-step">
            <div className="dashboard-next-icon">
              <ShieldCheck size={21} aria-hidden="true" />
            </div>
            <div>
              <h2>التحكم في الوصول</h2>
              <p>
                أنشئ حساب المتعلّم ورمزًا لمرة واحدة، أو أنهِ جلسة جهازه من
                صفحة المتعلمين.
              </p>
            </div>
            <Link
              className="button-soft"
              href="/admin/students"
              data-testid="link-open-user-management"
            >
              فتح الصفحة
            </Link>
          </section>
        </>
      )}
    </AppShell>
  );
}

export function AdminLearnersPage() {
  const queryClient = useQueryClient();
  const query = useLearners();
  const learners = query.data ?? [];
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<OneTimeCode | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  );
  const [pageError, setPageError] = useState('');

  const filteredLearners = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    if (!normalized) return learners;
    return learners.filter(
      (learner) =>
        learner.name.toLocaleLowerCase().includes(normalized) ||
        learner.email.toLocaleLowerCase().includes(normalized),
    );
  }, [learners, search]);

  const createMutation = useMutation({
    mutationFn: async (values: LearnerFormValues) => {
      const code = createAccessCode();
      const reply = await callRpc<RpcActionReply>('admin_create_learner', {
        p_name: values.name.trim(),
        p_email: values.email.trim().toLowerCase(),
        p_code: code,
      });
      if (!reply.ok || !reply.learner) {
        throw new Error(reply.error ?? 'create_failed');
      }
      return { learner: reply.learner, code };
    },
    onSuccess: async ({ learner, code }) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'learners'] });
      setCreateOpen(false);
      setGeneratedCode({ name: learner.name, email: learner.email, code });
      setCopyState('idle');
      setPageError('');
    },
    onError: (error) => setPageError(getLearnerActionError(error)),
  });

  const generateMutation = useMutation({
    mutationFn: async ({
      learner,
    }: {
      learner: LearnerRecord;
    }) => {
      const code = createAccessCode();
      const reply = await callRpc<RpcActionReply>(
        'admin_generate_learner_code',
        { p_learner_id: learner.id, p_code: code },
      );
      if (!reply.ok) throw new Error(reply.error ?? 'code_generation_failed');
      return { learner, code };
    },
    onSuccess: async ({ learner, code }) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'learners'] });
      setGeneratedCode({ name: learner.name, email: learner.email, code });
      setCopyState('idle');
      setPageError('');
    },
    onError: (error) => setPageError(getLearnerActionError(error)),
  });

  const revokeMutation = useMutation({
    mutationFn: async (learner: LearnerRecord) => {
      const reply = await callRpc<RpcActionReply>(
        'admin_revoke_learner_sessions',
        { p_learner_id: learner.id },
      );
      if (!reply.ok) throw new Error(reply.error ?? 'session_revoke_failed');
      return reply;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'learners'] });
      setPageError('');
    },
    onError: (error) => setPageError(getLearnerActionError(error)),
  });

  function issueCode(learner: LearnerRecord) {
    if (
      learner.pending_code &&
      !window.confirm(
        'يوجد رمز غير مستخدم لهذا المتعلّم. سيؤدي إصدار رمز جديد إلى إبطال الرمز السابق.',
      )
    ) {
      return;
    }
    setPageError('');
    generateMutation.mutate({ learner });
  }

  function revokeSession(learner: LearnerRecord) {
    if (
      !window.confirm(
        `هل تريد إنهاء جلسة ${learner.name}؟ سيتم إخراجه من التطبيق خلال أقل من دقيقة.`,
      )
    ) {
      return;
    }
    setPageError('');
    revokeMutation.mutate(learner);
  }

  async function copyGeneratedCode() {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode.code);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  return (
    <AppShell title="المتعلمون">
      <PageHeading
        eyebrow="إدارة الوصول"
        title="المتعلمون"
        subtitle="أضف المتعلمين وأصدر رموز دخولهم لمرة واحدة."
      >
        <button
          type="button"
          className="button-primary"
          onClick={() => {
            setPageError('');
            setCreateOpen(true);
          }}
          data-testid="button-add-learner"
        >
          <Plus size={17} aria-hidden="true" />
          إضافة متعلّم
        </button>
      </PageHeading>

      {pageError && <InlineAlert>{pageError}</InlineAlert>}

      <div className="learner-toolbar">
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">البحث بالاسم أو البريد الإلكتروني</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث بالاسم أو البريد الإلكتروني"
            data-testid="input-search-learners"
          />
        </label>
        <div className="learner-count" data-testid="text-learner-count">
          {formatCount(learners.length)} متعلّم
        </div>
      </div>

      {query.isLoading ? (
        <LoadingState label="جارٍ تحميل قائمة المتعلمين…" />
      ) : query.isError ? (
        <div className="panel">
          <EmptyState
            title="تعذّر تحميل القائمة"
            description="تأكد من تشغيل إعداد Supabase ومن أن حسابك مخوّل كمسؤول، ثم أعد تحميل الصفحة."
            icon={UsersRound}
          />
          <div className="empty-state-action">
            <button
              type="button"
              className="button-soft"
              onClick={() => void query.refetch()}
              data-testid="button-retry-learners"
            >
              <RefreshCw size={15} aria-hidden="true" />
              إعادة المحاولة
            </button>
          </div>
        </div>
      ) : filteredLearners.length === 0 ? (
        <div className="panel">
          <EmptyState
            title={search ? 'لا توجد نتائج مطابقة' : 'لا يوجد متعلمون بعد'}
            description={
              search
                ? 'جرّب البحث باسم أو بريد إلكتروني مختلف.'
                : 'أضف الاسم والبريد الإلكتروني لإصدار رمز الدخول الأول.'
            }
            icon={UsersRound}
          />
          {!search && (
            <div className="empty-state-action">
              <button
                type="button"
                className="button-primary"
                onClick={() => setCreateOpen(true)}
                data-testid="button-add-first-learner"
              >
                <Plus size={16} aria-hidden="true" />
                إضافة أول متعلّم
              </button>
            </div>
          )}
        </div>
      ) : (
        <section className="panel table-wrap">
          <table className="data-table learner-table">
            <thead>
              <tr>
                <th scope="col">المتعلّم</th>
                <th scope="col">حالة الدخول</th>
                <th scope="col">آخر نشاط</th>
                <th scope="col">تاريخ الإضافة</th>
                <th scope="col">إجراءات الوصول</th>
              </tr>
            </thead>
            <tbody>
              {filteredLearners.map((learner) => (
                <tr
                  key={learner.id}
                  data-testid={`row-learner-${learner.id}`}
                >
                  <td>
                    <div className="person">
                      <span className="person-avatar" aria-hidden="true">
                        {learner.name.slice(0, 1)}
                      </span>
                      <span>
                        <span className="person-name">{learner.name}</span>
                        <span className="person-email ltr">{learner.email}</span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <LearnerStatus learner={learner} />
                  </td>
                  <td>{formatDate(learner.last_seen_at)}</td>
                  <td>{formatDate(learner.created_at)}</td>
                  <td>
                    <div className="learner-row-actions">
                      <button
                        type="button"
                        className="button-soft compact-action"
                        onClick={() => issueCode(learner)}
                        disabled={generateMutation.isPending}
                        data-testid={`button-generate-code-${learner.id}`}
                      >
                        <KeyRound size={14} aria-hidden="true" />
                        {learner.pending_code ? 'تجديد الرمز' : 'إصدار رمز'}
                      </button>
                      {learner.active_session && (
                        <button
                          type="button"
                          className="button-danger compact-action"
                          onClick={() => revokeSession(learner)}
                          disabled={revokeMutation.isPending}
                          data-testid={`button-revoke-session-${learner.id}`}
                        >
                          إنهاء الجلسة
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="inline-note">
        الرمز مكوّن من ١٠ أحرف وأرقام، ولا ينتهي بمرور الوقت. يظهر مرة واحدة
        عند إصداره؛ احتفظ به لإرساله إلى المتعلّم.
      </p>

      {createOpen && (
        <CreateLearnerDialog
          pending={createMutation.isPending}
          error={getLearnerActionError(createMutation.error)}
          onClose={() => {
            setCreateOpen(false);
            createMutation.reset();
          }}
          onSubmit={(values) => createMutation.mutate(values)}
        />
      )}

      {generatedCode && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="panel modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="generated-code-title"
            data-testid="dialog-generated-code"
          >
            <button
              type="button"
              className="icon-button modal-close"
              onClick={() => setGeneratedCode(null)}
              aria-label="إغلاق"
              data-testid="button-close-generated-code"
            >
              <X size={18} aria-hidden="true" />
            </button>
            <div className="dialog-icon">
              <KeyRound size={22} aria-hidden="true" />
            </div>
            <div className="eyebrow">رمز دخول لمرة واحدة</div>
            <h2 id="generated-code-title">أرسل الرمز إلى المتعلّم</h2>
            <p className="dialog-description">
              {generatedCode.name} · <span className="ltr">{generatedCode.email}</span>
            </p>
            <div className="generated-code-box ltr" data-testid="text-generated-code">
              {generatedCode.code}
            </div>
            <p className="inline-note">
              لن يُحفظ الرمز بصيغته الأصلية ولن يظهر مجددًا. بعد تسجيل الدخول
              يصبح غير صالح للاستخدام مرة أخرى.
            </p>
            {copyState === 'copied' && (
              <InlineAlert tone="success">تم نسخ الرمز.</InlineAlert>
            )}
            {copyState === 'error' && (
              <InlineAlert>تعذّر النسخ. حدّد الرمز وانسخه يدويًا.</InlineAlert>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="button-primary"
                onClick={() => void copyGeneratedCode()}
                data-testid="button-copy-code"
              >
                {copyState === 'copied' ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <Copy size={16} aria-hidden="true" />
                )}
                نسخ الرمز
              </button>
              <button
                type="button"
                className="button-soft"
                onClick={() => setGeneratedCode(null)}
                data-testid="button-dismiss-code"
              >
                انتهيت
              </button>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}

function CreateLearnerDialog({
  pending,
  error,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (values: LearnerFormValues) => void;
}) {
  const form = useForm<LearnerFormValues>({
    resolver: zodResolver(learnerSchema),
    defaultValues: { name: '', email: '' },
  });

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="panel modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-learner-title"
        data-testid="dialog-create-learner"
      >
        <button
          type="button"
          className="icon-button modal-close"
          onClick={onClose}
          aria-label="إغلاق"
          data-testid="button-close-create-learner"
        >
          <X size={18} aria-hidden="true" />
        </button>
        <div className="dialog-icon">
          <UsersRound size={22} aria-hidden="true" />
        </div>
        <div className="eyebrow">حساب متعلّم جديد</div>
        <h2 id="create-learner-title">أضف متعلّمًا</h2>
        <p className="dialog-description">
          أدخل بياناته ليُنشأ الحساب ويصدر له رمز خاص من ١٠ خانات.
        </p>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="dialog-form"
            noValidate
          >
            <label className="field">
              اسم المتعلّم
              <input
                autoComplete="name"
                {...form.register('name')}
                data-testid="input-new-learner-name"
              />
              {form.formState.errors.name && (
                <span className="form-error">
                  {form.formState.errors.name.message}
                </span>
              )}
            </label>
            <label className="field">
              البريد الإلكتروني
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                className="ltr"
                {...form.register('email')}
                data-testid="input-new-learner-email"
              />
              {form.formState.errors.email && (
                <span className="form-error">
                  {form.formState.errors.email.message}
                </span>
              )}
            </label>
            {error && <InlineAlert>{error}</InlineAlert>}
            <div className="dialog-actions">
              <button
                type="submit"
                className="button-primary"
                disabled={pending}
                data-testid="button-create-learner"
              >
                <KeyRound size={16} aria-hidden="true" />
                {pending ? 'جارٍ الحفظ وإصدار الرمز…' : 'إنشاء وإصدار الرمز'}
              </button>
              <button
                type="button"
                className="button-soft"
                onClick={onClose}
                disabled={pending}
                data-testid="button-cancel-create-learner"
              >
                إلغاء
              </button>
            </div>
          </form>
        </Form>
      </section>
    </div>
  );
}

function LearnerStatus({ learner }: { learner: LearnerRecord }) {
  if (learner.active_session) {
    return <span className="badge">مسجّل الدخول</span>;
  }
  if (learner.pending_code) {
    return <span className="badge amber">بانتظار الاستخدام</span>;
  }
  return <span className="badge coral">لا يوجد رمز فعّال</span>;
}

function getLearnerActionError(error: unknown) {
  if (!error) return '';
  const message = error instanceof Error ? error.message : '';
  if (message === 'email_exists' || errorCodeFrom(error) === '23505') {
    return 'يوجد متعلّم مسجّل بهذا البريد الإلكتروني.';
  }
  if (message === 'learner_not_found') {
    return 'لم يتم العثور على هذا المتعلّم. حدّث الصفحة وحاول مرة أخرى.';
  }
  if (message === 'secure_random_unavailable') {
    return 'تعذّر إنشاء رمز آمن على هذا الجهاز. افتح التطبيق عبر اتصال آمن وحاول مجددًا.';
  }
  return 'لم يكتمل الطلب. تحقق من اتصال Supabase ثم حاول مرة أخرى.';
}

function errorCodeFrom(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return '';
}

export function AdminCoursesPage() {
  return (
    <AppShell title="هيكل الدورة">
      <PageHeading
        eyebrow="المحتوى التعليمي"
        title="هيكل الدورة"
        subtitle="إدارة المستويات والأقسام ستُضاف في خطوة لاحقة."
      />
      <section className="panel">
        <EmptyState
          title="لا توجد مستويات بعد"
          description="لم تتم إضافة أي بيانات تجريبية. ستظهر بنية الدورة هنا عند ربط إدارة المحتوى."
          icon={BookOpen}
        />
      </section>
    </AppShell>
  );
}

export function AdminContentPage() {
  return (
    <AppShell title="مكتبة المحتوى">
      <PageHeading
        eyebrow="إدارة المحتوى"
        title="مكتبة المحتوى"
        subtitle="ستظهر هنا المواد المرفوعة للدروس."
      />
      <section className="panel">
        <EmptyState
          title="مكتبة المحتوى فارغة"
          description="لا توجد ملفات أو دروس مضافة بعد."
          icon={LibraryBig}
        />
      </section>
    </AppShell>
  );
}

export function AdminCommunityPage() {
  return (
    <AppShell title="مساحة المجموعة">
      <PageHeading
        eyebrow="تواصل المتعلمين"
        title="مساحة المجموعة"
        subtitle="ستظهر الرسائل وحالة النشر عند بناء ميزات المجموعة."
      />
      <section className="panel">
        <EmptyState
          title="لا توجد رسائل بعد"
          description="لا توجد رسائل تجريبية أو محادثات محفوظة."
          icon={MessagesSquare}
        />
      </section>
    </AppShell>
  );
}

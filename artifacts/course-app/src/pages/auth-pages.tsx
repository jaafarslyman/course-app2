import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, KeyRound, LockKeyhole } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'wouter';
import { z } from 'zod';
import { AppLogo, InlineAlert, SetupNotice } from '@/components/app-shell';
import { Form } from '@/components/ui/form';
import {
  createSessionSecret,
  saveLearnerSession,
  type LearnerRpcReply,
} from '@/lib/learner-session';
import { useLearnerSession } from '@/lib/learner-session-context';
import {
  callRpc,
  errorCode,
  hasSupabaseConfig,
  requireSupabase,
} from '@/lib/supabase';

const adminLoginSchema = z.object({
  email: z.string().trim().email('أدخل بريدًا إلكترونيًا صحيحًا'),
  password: z.string().min(1, 'أدخل كلمة المرور'),
});

type AdminLoginValues = z.infer<typeof adminLoginSchema>;

const learnerLoginSchema = z.object({
  email: z.string().trim().email('أدخل بريدًا إلكترونيًا صحيحًا'),
  code: z.string(),
});

type LearnerLoginValues = z.infer<typeof learnerLoginSchema>;

export function AdminSignInPage() {
  const [, setLocation] = useLocation();
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<AdminLoginValues>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function signIn(values: AdminLoginValues) {
    setFormError('');
    if (!hasSupabaseConfig) {
      setFormError('أضف إعدادات Supabase أولًا ثم أعد تشغيل التطبيق.');
      return;
    }

    setSubmitting(true);
    const client = requireSupabase();
    const { error: signInError } = await client.auth.signInWithPassword({
      email: values.email.trim(),
      password: values.password,
    });

    if (signInError) {
      setSubmitting(false);
      setFormError('تعذّر تسجيل الدخول. تحقق من البريد وكلمة المرور.');
      return;
    }

    try {
      await callRpc('admin_list_learners');
      setLocation('/admin');
    } catch (error) {
      await client.auth.signOut();
      setFormError(
        errorCode(error) === '42501'
          ? 'هذا الحساب غير مخوّل لإدارة الدورة.'
          : 'تعذّر التحقق من صلاحية الإدارة. تأكد من تشغيل ملف SQL وإضافة بريد المشرف.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-visual">
        <AppLogo />
        <div className="auth-visual-copy">
          <div className="eyebrow">مساحة فريق الدورة</div>
          <h1>إدارة الوصول<br />بكل وضوح.</h1>
          <p>
            سجّل الدخول بحساب المشرف الموجود في Supabase لإدارة حسابات
            المتعلمين ورموزهم.
          </p>
        </div>
        <div className="auth-visual-footer">لوحة إدارة الدورة · لُغتي بثقة</div>
      </section>
      <section className="auth-form-area">
        <div className="panel auth-card">
          <div className="dialog-icon">
            <LockKeyhole size={21} aria-hidden="true" />
          </div>
          <div className="eyebrow">الإدارة</div>
          <h2>تسجيل دخول المشرف</h2>
          <p className="auth-copy">
            استخدم بيانات حساب المشرف الذي أضفته في Supabase Auth.
          </p>
          {!hasSupabaseConfig && <SetupNotice />}

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(signIn)}
              className="auth-form"
              noValidate
            >
              <label className="field">
                البريد الإلكتروني
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  className="ltr"
                  {...form.register('email')}
                  data-testid="input-admin-email"
                />
                {form.formState.errors.email && (
                  <span className="form-error">
                    {form.formState.errors.email.message}
                  </span>
                )}
              </label>
              <label className="field">
                كلمة المرور
                <input
                  type="password"
                  autoComplete="current-password"
                  {...form.register('password')}
                  data-testid="input-admin-password"
                />
                {form.formState.errors.password && (
                  <span className="form-error">
                    {form.formState.errors.password.message}
                  </span>
                )}
              </label>
              {formError && <InlineAlert>{formError}</InlineAlert>}
              <button
                type="submit"
                className="button-primary auth-submit"
                disabled={submitting || !hasSupabaseConfig}
                data-testid="button-admin-signin"
              >
                {submitting ? 'جارٍ التحقق…' : 'تسجيل الدخول'}
                <ArrowLeft size={16} aria-hidden="true" />
              </button>
            </form>
          </Form>

          <div className="auth-links">
            <Link href="/" data-testid="link-learner-signin">
              <ArrowRight size={15} aria-hidden="true" />
              العودة إلى دخول المتعلّمين
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export function LearnerAccessPage() {
  const [, setLocation] = useLocation();
  const { learner, status, refresh } = useLearnerSession();
  const [step, setStep] = useState<1 | 2>(1);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<LearnerLoginValues>({
    resolver: zodResolver(learnerLoginSchema),
    defaultValues: { email: '', code: '' },
  });

  useEffect(() => {
    if (status === 'signed-in' && learner) setLocation('/learn');
  }, [learner, setLocation, status]);

  async function continueToCode() {
    setFormError('');
    const valid = await form.trigger('email');
    if (valid) {
      form.setValue('code', '');
      setStep(2);
    }
  }

  async function redeem(values: LearnerLoginValues) {
    setFormError('');
    const code = values.code.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{10}$/.test(code)) {
      setFormError('أدخل رمز الدخول المكوّن من ١٠ أحرف وأرقام.');
      return;
    }

    if (!hasSupabaseConfig) {
      setFormError('أضف إعدادات Supabase أولًا ثم أعد تشغيل التطبيق.');
      return;
    }

    setSubmitting(true);
    try {
      const sessionSecret = createSessionSecret();
      const reply = await callRpc<LearnerRpcReply>('redeem_learner_access', {
        p_email: values.email.trim().toLowerCase(),
        p_code: code,
        p_session_secret: sessionSecret,
      });

      if (!reply.ok || !reply.learner) {
        setFormError(
          reply.error === 'too_many_attempts'
            ? 'تجاوزت عدد المحاولات المسموح. انتظر ١٥ دقيقة ثم حاول مرة أخرى.'
            : 'تعذّر التحقق من البريد أو الرمز. راجع بياناتك أو اطلب رمزًا جديدًا من المشرف.',
        );
        return;
      }

      saveLearnerSession(sessionSecret);
      await refresh();
      setLocation('/learn');
    } catch (error) {
      setFormError(
        error instanceof Error &&
          error.message === 'secure_random_unavailable'
          ? 'تعذّر إنشاء جلسة آمنة على هذا الجهاز. افتح التطبيق عبر اتصال آمن ثم حاول مجددًا.'
          : 'تعذّر الاتصال بخدمة الدخول. تحقق من إعداد Supabase ثم حاول مرة أخرى.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-visual">
        <AppLogo />
        <div className="auth-visual-copy">
          <div className="eyebrow">مساحتك لتتعلّمي بطريقتك</div>
          <h1>كل كلمة جديدة،<br />تفتح لك بابًا.</h1>
          <p>
            رحلة ممتعة وعملية تساعدك على التحدث بالإنجليزية بثقة، خطوة
            بخطوة.
          </p>
          <div className="auth-pills">
            <span>تعلّم بخطوات واضحة</span>
            <span>رمز خاص بك</span>
            <span>دخول دائم</span>
          </div>
        </div>
        <div className="auth-visual-footer">لُغتي بثقة · English, one step at a time</div>
      </section>
      <section className="auth-form-area">
        <div className="panel auth-card">
          <div className="dialog-icon">
            <KeyRound size={21} aria-hidden="true" />
          </div>
          <div className="eyebrow">مساحة المتعلّم</div>
          <h2>{step === 1 ? 'أهلًا بكِ في رحلتك' : 'أدخلي رمز الدخول'}</h2>
          <p className="auth-copy">
            {step === 1
              ? 'اكتبي البريد الإلكتروني الذي أضافه المشرف.'
              : 'استخدمي الرمز المكوّن من ١٠ خانات الذي استلمتِه من المشرف.'}
          </p>
          {!hasSupabaseConfig && <SetupNotice />}

          <Form {...form}>
            <form
              onSubmit={
                step === 1
                  ? (event) => {
                      event.preventDefault();
                      void continueToCode();
                    }
                  : form.handleSubmit(redeem)
              }
              className="auth-form"
              noValidate
            >
              {step === 1 ? (
                <label className="field">
                  البريد الإلكتروني
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    className="ltr"
                    {...form.register('email')}
                    data-testid="input-learner-email"
                  />
                  {form.formState.errors.email && (
                    <span className="form-error">
                      {form.formState.errors.email.message}
                    </span>
                  )}
                </label>
              ) : (
                <>
                  <div className="email-confirmation">
                    <span className="ltr">{form.getValues('email')}</span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setFormError('');
                        setStep(1);
                      }}
                      data-testid="button-edit-learner-email"
                    >
                      تغيير
                    </button>
                  </div>
                  <label className="field">
                    رمز الدخول لمرة واحدة
                    <input
                      type="text"
                      autoComplete="one-time-code"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={10}
                      className="ltr access-code-input"
                      placeholder="XXXXXXXXXX"
                      {...form.register('code')}
                      data-testid="input-access-code"
                    />
                  </label>
                </>
              )}

              {formError && <InlineAlert>{formError}</InlineAlert>}

              <button
                type="submit"
                className="button-primary auth-submit"
                disabled={submitting || !hasSupabaseConfig}
                data-testid={
                  step === 1 ? 'button-request-code' : 'button-learner-login'
                }
              >
                {submitting
                  ? 'جارٍ التحقق…'
                  : step === 1
                    ? 'متابعة إلى رمز الدخول'
                    : 'دخول إلى التطبيق'}
                <ArrowLeft size={16} aria-hidden="true" />
              </button>
            </form>
          </Form>

          {step === 2 && (
            <p className="inline-note access-expiry-note">
              الرمز لا ينتهي بمرور الوقت؛ يصبح غير صالح بعد تسجيل الدخول
            </p>
          )}
          <div className="auth-links">
            <Link href="/admin/sign-in" data-testid="link-admin-signin">
              دخول المشرف
              <ArrowLeft size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

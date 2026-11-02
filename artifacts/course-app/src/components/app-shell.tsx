import type { ReactNode } from 'react';
import {
  BookOpen,
  KeyRound,
  LayoutDashboard,
  LibraryBig,
  LogOut,
  MessagesSquare,
  UsersRound,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { requireSupabase } from '@/lib/supabase';

const adminNavigation = [
  { href: '/admin', label: 'نظرة عامة', icon: LayoutDashboard },
  { href: '/admin/students', label: 'الطلاب', icon: UsersRound },
  { href: '/admin/courses', label: 'هيكل الدورة', icon: BookOpen },
  { href: '/admin/content', label: 'مكتبة المحتوى', icon: LibraryBig },
  { href: '/admin/community', label: 'مساحة المجموعة', icon: MessagesSquare },
];

const learnerNavigation = [
  { href: '/learn', label: 'الرئيسية', icon: LayoutDashboard },
  { href: '/learn/course', label: 'دورتي', icon: BookOpen },
  { href: '/learn/content', label: 'المحتوى', icon: LibraryBig },
  { href: '/learn/community', label: 'مساحة المجموعة', icon: MessagesSquare },
];

type AppShellProps = {
  children: ReactNode;
  title: string;
  audience?: 'admin' | 'learner';
  onSignOut?: () => void;
};

export function AppShell({
  children,
  title,
  audience = 'admin',
  onSignOut,
}: AppShellProps) {
  const [location, setLocation] = useLocation();
  const navigation =
    audience === 'learner' ? learnerNavigation : adminNavigation;
  const handleSignOut =
    audience === 'admin'
      ? onSignOut ??
        (async () => {
          await requireSupabase().auth.signOut();
          setLocation('/admin/sign-in');
        })
      : undefined;

  return (
    <div className="app-shell admin-layout">
      <aside className="sidebar">
        <AppLogo />
        <nav className="nav-list" aria-label="التنقّل الرئيسي">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-link ${location === href ? 'active' : ''}`}
              data-testid={`link-${href.replaceAll('/', '-').slice(1)}`}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="side-bottom-title">
            {audience === 'admin' ? (
              <KeyRound size={17} aria-hidden="true" />
            ) : (
              <BookOpen size={17} aria-hidden="true" />
            )}
            {audience === 'admin' ? 'إدارة آمنة' : 'رحلتك التعليمية'}
          </div>
          <div>
            {audience === 'admin'
              ? 'رموز الدخول لا تظهر مجددًا بعد إصدارها.'
              : 'يتم إنهاء الجلسة من لوحة الإدارة فقط.'}
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div>
            <div className="eyebrow">
              {audience === 'admin' ? 'مساحة الإدارة' : 'مساحة المتعلّم'}
            </div>
            <div className="topbar-title">{title}</div>
          </div>
          {handleSignOut && (
            <button
              type="button"
              className="button-soft signout-button"
              onClick={() => void handleSignOut()}
              data-testid="button-admin-signout"
            >
              <LogOut size={16} aria-hidden="true" />
              تسجيل الخروج
            </button>
          )}
        </header>
        <main className="content-wrap animate-in">{children}</main>
      </div>

      <nav className="mobile-nav" aria-label="التنقّل الرئيسي">
        {navigation.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`nav-link ${location === href ? 'active' : ''}`}
            data-testid={`mobile-link-${href.replaceAll('/', '-').slice(1)}`}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function AppLogo() {
  return (
    <div className="brand" data-testid="brand-logo">
      <span className="brand-mark" aria-hidden="true">
        L.
      </span>
      <span>
        لُغتي <span className="brand-accent">بثقة</span>
      </span>
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-head page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = BookOpen,
}: {
  title: string;
  description: string;
  icon?: typeof BookOpen;
}) {
  return (
    <div className="empty-state" data-testid="empty-state">
      <div className="empty-state-icon">
        <Icon size={22} aria-hidden="true" />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function SetupNotice() {
  return (
    <div className="config-notice" role="status" data-testid="status-supabase-config">
      <KeyRound size={17} aria-hidden="true" />
      <span>
        أضف <code>VITE_SUPABASE_URL</code> و
        <code> VITE_SUPABASE_ANON_KEY</code> إلى إعدادات البيئة لربط Supabase.
      </span>
    </div>
  );
}

export function InlineAlert({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'success' | 'info';
}) {
  return (
    <div
      className={`inline-alert ${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
      data-testid={`status-${tone}`}
    >
      {children}
    </div>
  );
}

export function LoadingState({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div className="loading-state" role="status" data-testid="status-loading">
      <span className="loading-spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

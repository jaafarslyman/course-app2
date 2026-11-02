import { BookOpen, LibraryBig } from 'lucide-react';
import { AppShell, EmptyState, PageHeading } from '@/components/app-shell';
import { useLearnerSession } from '@/lib/learner-session-context';
import { GroupChatPage } from '@/pages/group-chat';

export function LearnerHomePage() {
  const { learner } = useLearnerSession();

  return (
    <AppShell title="رحلتي التعليمية" audience="learner">
      <PageHeading
        eyebrow="أهلًا بعودتك"
        title={learner ? `مرحبًا، ${learner.name}` : 'مساحة المتعلّم'}
        subtitle="تم تسجيل الدخول باستخدام رمز الوصول الخاص بك."
      />
      <section className="panel learner-welcome">
        <div className="dialog-icon">
          <BookOpen size={22} aria-hidden="true" />
        </div>
        <div>
          <div className="eyebrow">الحساب المرتبط</div>
          <div className="learner-account-name" data-testid="text-learner-name">
            {learner?.name}
          </div>
          <div className="person-email ltr" data-testid="text-learner-email">
            {learner?.email}
          </div>
        </div>
      </section>
      <section className="panel learner-empty-panel">
        <EmptyState
          title="لا توجد دروس متاحة بعد"
          description="تم تجهيز دخولك. ستظهر الدورة ومحتواها هنا عند إضافتهما."
          icon={LibraryBig}
        />
      </section>
    </AppShell>
  );
}

export function LearnerCoursePage() {
  return (
    <AppShell title="دورتي" audience="learner">
      <PageHeading
        eyebrow="دليلك الدراسي"
        title="المستويات والدروس"
        subtitle="ستظهر هنا مستويات الدورة وأقسامها وموادها."
      />
      <section className="panel">
        <EmptyState
          title="لم تتم إضافة محتوى بعد"
          description="سيظهر تقدمك والدروس المتاحة بعد تجهيز هيكل الدورة."
          icon={BookOpen}
        />
      </section>
    </AppShell>
  );
}

export function LearnerCommunityPage() {
  return <GroupChatPage audience="learner" />;
}

export function LearnerContentPage() {
  return (
    <AppShell title="الدرس" audience="learner">
      <PageHeading
        eyebrow="محتوى الدورة"
        title="مشاهدة الدرس"
        subtitle="لم تتم إضافة ملفات وسائط بعد."
      />
      <section className="panel">
        <EmptyState
          title="لا يوجد درس للعرض"
          description="ستظهر هنا ملفات الفيديو والصوت والصور بعد رفعها."
          icon={LibraryBig}
        />
      </section>
    </AppShell>
  );
}

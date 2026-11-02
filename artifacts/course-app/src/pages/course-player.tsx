import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  FileAudio2,
  FileImage,
  FileText,
  LockKeyhole,
  RefreshCw,
  Video,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useCreateCourseMediaSignedUrl } from '@workspace/api-client-react';
import {
  AppShell,
  EmptyState,
  InlineAlert,
  LoadingState,
  PageHeading,
} from '@/components/app-shell';
import {
  learnerCourseQueryKey,
  useLearnerCourses,
  useSaveLearnerProgress,
} from '@/lib/course-api';
import { readLearnerSession } from '@/lib/learner-session';
import type { Course, CourseContentItem, CourseContentKind } from '@/lib/course-types';
import './course-pages.css';

const kindLabels: Record<CourseContentKind, string> = {
  video: 'فيديو',
  image: 'صورة',
  text: 'نص تعليمي',
  note: 'ملاحظة',
  audio: 'صوت',
};

const kindIcons = {
  video: Video,
  image: FileImage,
  text: FileText,
  note: FileText,
  audio: FileAudio2,
};

type FlatItem = {
  item: CourseContentItem;
  group: string;
};

function formatCount(value: number) {
  return new Intl.NumberFormat('ar').format(value);
}

function flattenCourse(course: Course): FlatItem[] {
  const result: FlatItem[] = [];
  [...course.items].sort((a, b) => a.sortOrder - b.sortOrder).forEach((item) => result.push({ item, group: 'مواد الدورة' }));
  [...course.levels].sort((a, b) => a.sortOrder - b.sortOrder).forEach((level) => {
    [...level.items].sort((a, b) => a.sortOrder - b.sortOrder).forEach((item) => result.push({ item, group: level.title }));
    [...level.sections].sort((a, b) => a.sortOrder - b.sortOrder).forEach((section) => {
      [...section.items].sort((a, b) => a.sortOrder - b.sortOrder).forEach((item) => result.push({ item, group: `${level.title} · ${section.title}` }));
    });
  });
  return result;
}

function allItems(course: Course) {
  return flattenCourse(course).map(({ item }) => item);
}

function coursePercent(course: Course) {
  const items = allItems(course);
  if (!items.length) return 0;
  return Math.round(items.filter((item) => item.progress?.completed).length / items.length * 100);
}

function updateItemProgress(
  courses: Course[],
  contentId: string,
  positionSeconds: number,
  durationSeconds: number | null,
  markDone: boolean,
): Course[] {
  const now = new Date().toISOString();
  const patchItems = (items: CourseContentItem[]) => items.map((item) => {
    if (item.id !== contentId) return item;
    const completed = markDone || Boolean(item.progress?.completed);
    return {
      ...item,
      progress: {
        positionSeconds,
        durationSeconds,
        progressPercent: completed ? 100 : durationSeconds ? Math.min(100, Math.round(positionSeconds / durationSeconds * 100)) : item.progress?.progressPercent ?? 0,
        completed,
        completedAt: markDone ? now : item.progress?.completedAt ?? null,
        updatedAt: now,
      },
    };
  });
  return courses.map((course) => ({
    ...course,
    items: patchItems(course.items),
    levels: course.levels.map((level) => ({
      ...level,
      items: patchItems(level.items),
      sections: level.sections.map((section) => ({ ...section, items: patchItems(section.items) })),
    })),
  }));
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export function LearnerCoursePage() {
  const { courseId } = useParams<{ courseId?: string }>();
  const query = useLearnerCourses();
  const queryClient = useQueryClient();
  const saveProgress = useSaveLearnerProgress();
  const secret = readLearnerSession();
  const signedMedia = useCreateCourseMediaSignedUrl();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSavedPosition = useRef(-1);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [savingError, setSavingError] = useState('');

  useEffect(() => {
    const blockContextMenu = (event: MouseEvent) => event.preventDefault();
    const blockCopyShortcuts = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (['c', 'p', 's', 'u'].includes(event.key.toLowerCase())) {
        event.preventDefault();
      }
    };

    document.addEventListener('contextmenu', blockContextMenu);
    window.addEventListener('keydown', blockCopyShortcuts);
    return () => {
      document.removeEventListener('contextmenu', blockContextMenu);
      window.removeEventListener('keydown', blockCopyShortcuts);
    };
  }, []);

  const courses = useMemo(() => [...(query.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [query.data]);
  const course = courseId ? courses.find((entry) => entry.id === courseId) : courses[0];
  const flatItems = useMemo(() => course ? flattenCourse(course) : [], [course]);
  const selected = flatItems.find(({ item }) => item.id === selectedId)?.item ?? flatItems[0]?.item;
  const completedCount = course ? allItems(course).filter((item) => item.progress?.completed).length : 0;
  const percent = course ? coursePercent(course) : 0;

  useEffect(() => {
    setSelectedId('');
  }, [course?.id]);

  useEffect(() => {
    setMediaUrl('');
    setMediaError('');
    lastSavedPosition.current = -1;
    if (!selected || !['video', 'audio', 'image'].includes(selected.kind)) return;
    if (!secret) {
      setMediaError('انتهت جلسة التعلّم. سجّل الدخول مجددًا لفتح هذا المحتوى.');
      return;
    }
    let cancelled = false;
    signedMedia.mutateAsync({
      data: { contentId: selected.id, learnerSessionSecret: secret },
    }).then((result) => {
      if (!cancelled) setMediaUrl(result.signedUrl);
    }).catch(() => {
      if (!cancelled) setMediaError('تعذّر فتح الملف المحمي. تحقق من اتصالك ثم حاول مجددًا.');
    });
    return () => { cancelled = true; };
  }, [selected?.id, selected?.kind, selected?.storagePath, secret]);

  const savePosition = useCallback((positionSeconds: number, durationSeconds: number | null, markDone = false) => {
    if (!selected) return;
    if (!markDone && Math.abs(positionSeconds - lastSavedPosition.current) < 8) return;
    lastSavedPosition.current = positionSeconds;
    saveProgress.mutate({ contentId: selected.id, positionSeconds, durationSeconds, markDone }, {
      onError: () => setSavingError('تعذّر حفظ التقدم الآن. سيُحفظ عند المحاولة التالية.'),
      onSuccess: () => {
        setSavingError('');
        queryClient.setQueryData<Course[]>(learnerCourseQueryKey, (old) => old ? updateItemProgress(old, selected.id, positionSeconds, durationSeconds, markDone) : old);
      },
    });
  }, [selected?.id, saveProgress.mutate, queryClient]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      videoRef.current?.pause();
      audioRef.current?.pause();
      const media = videoRef.current ?? audioRef.current;
      if (media && selected) savePosition(media.currentTime, Number.isFinite(media.duration) ? media.duration : selected.durationSeconds, false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [selected?.id, savePosition]);

  function markComplete(item: CourseContentItem) {
    const media = item.id === selected?.id ? videoRef.current ?? audioRef.current : null;
    const duration = media && Number.isFinite(media.duration) ? media.duration : item.durationSeconds;
    const position = duration ?? item.progress?.positionSeconds ?? 0;
    saveProgress.mutate({ contentId: item.id, positionSeconds: position, durationSeconds: duration, markDone: true }, {
      onError: () => setSavingError('لم يتم حفظ الإكمال. حاول مرة أخرى.'),
      onSuccess: () => {
        setSavingError('');
        queryClient.setQueryData<Course[]>(learnerCourseQueryKey, (old) => old ? updateItemProgress(old, item.id, position, duration, true) : old);
      },
    });
  }

  function retryMedia() {
    if (!selected || !secret) return;
    setMediaError('');
    signedMedia.mutateAsync({ data: { contentId: selected.id, learnerSessionSecret: secret } }).then((result) => setMediaUrl(result.signedUrl)).catch(() => setMediaError('تعذّر فتح الملف المحمي. حاول مرة أخرى.'));
  }

  if (query.isLoading) {
    return <AppShell title="دورتي" audience="learner"><div className="course-pages" dir="rtl"><div className="course-skeleton" /><div className="course-skeleton" /><LoadingState label="جارٍ تجهيز مسارك التعليمي…" /></div></AppShell>;
  }

  if (query.isError) {
    return <AppShell title="دورتي" audience="learner"><div className="course-pages" dir="rtl"><PageHeading eyebrow="رحلتك التعليمية" title="دورتي" subtitle="سنحاول تحميل محتواك مرة أخرى." /><section className="panel"><EmptyState title="تعذّر تحميل الدورة" description="تحقق من اتصالك ثم أعد تحميل محتوى الدورة." icon={BookOpen} /><div className="empty-state-action"><button type="button" className="button-soft" onClick={() => void query.refetch()}><RefreshCw size={15} /> إعادة المحاولة</button></div></section></div></AppShell>;
  }

  if (!courseId && courses.length > 1) {
    return <AppShell title="دورتي" audience="learner"><div className="course-pages" dir="rtl">
      <PageHeading eyebrow="دليلك الدراسي" title="اختر دورة" subtitle="تابع من حيث توقفت، أو استكشف خطوة جديدة في مسارك." />
      <div className="learner-course-picker">{courses.map((entry) => <Link key={entry.id} className="panel learner-course-card" href={`/learn/course/${encodeURIComponent(entry.id)}`}>
        <div className="course-summary-number">{formatCount(coursePercent(entry))}٪</div><div><h2>{entry.name}</h2><p>{formatCount(allItems(entry).filter((item) => item.progress?.completed).length)} من {formatCount(allItems(entry).length)} مواد مكتملة</p><div className="course-progress-track"><span style={{ width: `${coursePercent(entry)}%` }} /></div></div><ChevronLeft size={18} />
      </Link>)}</div>
    </div></AppShell>;
  }

  if (!course) {
    return <AppShell title="دورتي" audience="learner"><div className="course-pages" dir="rtl"><PageHeading eyebrow="دليلك الدراسي" title="دورتي" subtitle="سيظهر مسارك التعليمي هنا عند إتاحة دورة لك." /><section className="panel"><EmptyState title="لا توجد دورة متاحة بعد" description="لم تُنشر دورة لحسابك بعد. ستظهر هنا المواد فور إتاحتها." icon={BookOpen} /></section></div></AppShell>;
  }

  const currentFlat = flatItems.find(({ item }) => item.id === selected?.id);
  const KindIcon = selected ? kindIcons[selected.kind] : FileText;

  return (
    <AppShell title="دورتي" audience="learner">
      <div className="course-pages" dir="rtl">
        <div className="course-breadcrumbs"><Link href="/learn">الرئيسية</Link><ChevronLeft size={14} /><span>دورتي</span></div>
        <section className="learner-course-hero">
          <div className="learner-course-hero-copy"><div className="eyebrow">مسارك بخطوات صغيرة</div><h1>{course.name}</h1><p>{completedCount ? `أكملت ${formatCount(completedCount)} من ${formatCount(flatItems.length)} مواد. تقدّمك يتراكم مع كل خطوة.` : 'ابدأ من أي مادة تناسبك. يمكنك التعلّم بترتيبك الخاص.'}</p></div>
          <div className="learner-course-progress" aria-label={`التقدم ${percent} بالمئة`}><span>{formatCount(percent)}٪</span><small>مكتمل</small></div>
        </section>
        {savingError && <InlineAlert>{savingError}</InlineAlert>}
        {flatItems.length === 0 ? (
          <section className="panel"><EmptyState title="المحتوى قيد التجهيز" description="لم تتم إضافة مواد لهذه الدورة بعد. ستظهر هنا بمجرد أن تصبح جاهزة." icon={BookOpen} /></section>
        ) : (
          <div
            className="learner-content-layout"
            onCopy={(event) => event.preventDefault()}
            onCut={(event) => event.preventDefault()}
            onDragStart={(event) => event.preventDefault()}
          >
            <section className="panel learner-material">
              <div className="learner-material-header"><div><div className="eyebrow">{currentFlat?.group} · {selected ? kindLabels[selected.kind] : ''}</div><h2>{selected?.title}</h2></div>{selected?.progress?.completed && <span className="course-status"><Check size={14} /> مكتملة</span>}</div>
              {selected && ['video', 'audio', 'image'].includes(selected.kind) ? (
                mediaError ? <div className="learner-media-frame"><div className="learner-media-placeholder"><LockKeyhole size={25} /><strong>{mediaError}</strong><button type="button" className="button-soft" onClick={retryMedia}><RefreshCw size={14} /> إعادة المحاولة</button></div></div> :
                !mediaUrl ? <div className="learner-media-frame"><div className="learner-media-placeholder"><LockKeyhole size={23} /><strong>جارٍ فتح المحتوى بأمان…</strong></div></div> :
                <div className="learner-media-frame" onContextMenu={(event) => event.preventDefault()}>
                   {selected.kind === 'video' && <video ref={videoRef} src={mediaUrl} controls controlsList="nodownload noremoteplayback" disablePictureInPicture disableRemotePlayback playsInline preload="metadata" onLoadedMetadata={(event) => { const progress = selected.progress?.positionSeconds ?? 0; if (progress > 0) event.currentTarget.currentTime = progress; }} onTimeUpdate={(event) => savePosition(event.currentTarget.currentTime, Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null)} onPause={(event) => savePosition(event.currentTarget.currentTime, Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null)} onEnded={(event) => savePosition(event.currentTarget.duration, event.currentTarget.duration, true)} />}
                  {selected.kind === 'audio' && <audio ref={audioRef} src={mediaUrl} controls controlsList="nodownload noremoteplayback" preload="metadata" onLoadedMetadata={(event) => { const progress = selected.progress?.positionSeconds ?? 0; if (progress > 0) event.currentTarget.currentTime = progress; }} onTimeUpdate={(event) => savePosition(event.currentTarget.currentTime, Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null)} onPause={(event) => savePosition(event.currentTarget.currentTime, Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null)} onEnded={(event) => savePosition(event.currentTarget.duration, event.currentTarget.duration, true)} />}
                  {selected.kind === 'image' && <img src={mediaUrl} alt={selected.title} draggable={false} />}
                </div>
              ) : <div className="learner-material-body">{selected?.body || 'ابدأ بالقراءة بهدوء، ثم علّم المادة مكتملة عندما تنتهي.'}</div>}
              {selected?.kind === 'video' && selected.progress?.positionSeconds ? <p className="course-muted-note">آخر موضع وصلت إليه: {formatTime(selected.progress.positionSeconds)}{selected.progress.durationSeconds ? ` من ${formatTime(selected.progress.durationSeconds)}` : ''}</p> : null}
              <div className="learner-material-actions"><span className="course-muted-note">تعلّم بترتيبك، وتقدّمك محفوظ تلقائيًا.</span><button type="button" className={`button-primary learner-done-button ${selected?.progress?.completed ? 'done' : ''}`} disabled={!selected || saveProgress.isPending} onClick={() => selected && markComplete(selected)}>{selected?.progress?.completed ? <><CheckCircle2 size={16} /> مكتملة</> : <><Check size={16} /> علّمها مكتملة</>}</button></div>
            </section>
            <aside className="panel learner-tree" aria-label="محتويات الدورة">
              <h2>محتوى الدورة <span className="course-muted-note">({formatCount(flatItems.length)})</span></h2>
              {flatItems.map(({ item, group }, index) => {
                const Icon = kindIcons[item.kind];
                const isSelected = selected?.id === item.id;
                return <div key={item.id}>
                  {(index === 0 || flatItems[index - 1].group !== group) && <div className="learner-tree-label">{group}</div>}
                  <button type="button" className={`learner-tree-item ${isSelected ? 'active' : ''} ${item.progress?.completed ? 'completed' : ''}`} onClick={() => { setSelectedId(item.id); setMediaUrl(''); setMediaError(''); }}>
                    <span className="tree-check">{item.progress?.completed ? <Check size={13} /> : <Icon size={13} />}</span><span>{item.title}</span><ChevronLeft size={13} />
                  </button>
                </div>;
              })}
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}

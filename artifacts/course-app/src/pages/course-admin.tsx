import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DraggableAttributes,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BookOpen,
  Check,
  ChevronLeft,
  FileAudio2,
  FileImage,
  FileText,
  GripVertical,
  Layers3,
  Mic,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import {
  AppShell,
  EmptyState,
  InlineAlert,
  LoadingState,
  PageHeading,
} from '@/components/app-shell';
import {
  useAdminCourseMutation,
  useAdminCourseReorder,
  useAdminCourses,
} from '@/lib/course-api';
import { removeCourseMedia, uploadCourseMedia } from '@/lib/course-upload';
import type {
  Course,
  CourseContentItem,
  CourseContentKind,
  CourseLevel,
  CourseSection,
} from '@/lib/course-types';
import './course-pages.css';

type Scope = { levelId: string | null; sectionId: string | null };
type SortListeners = Record<string, any> | undefined;
type ContentDraft = {
  id?: string;
  kind: CourseContentKind;
  title: string;
  body: string;
  storagePath: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  durationSeconds: number | null;
};

const kindNames: Record<CourseContentKind, string> = {
  video: 'فيديو',
  image: 'صورة',
  text: 'نص تعليمي',
  note: 'ملاحظة',
  audio: 'ملف صوتي',
};

const kindIcons = {
  video: Video,
  image: FileImage,
  text: FileText,
  note: FileText,
  audio: FileAudio2,
};

function formatCount(value: number) {
  return new Intl.NumberFormat('ar').format(value);
}

function countCourseItems(course: Course) {
  return course.items.length + course.levels.reduce(
    (sum, level) => sum + level.items.length + level.sections.reduce((inner, section) => inner + section.items.length, 0),
    0,
  );
}

function courseMediaPaths(course: Course) {
  return [
    ...course.items,
    ...course.levels.flatMap((level) => [
      ...level.items,
      ...level.sections.flatMap((section) => section.items),
    ]),
  ]
    .map((item) => item.storagePath)
    .filter((path): path is string => Boolean(path));
}

function levelMediaPaths(level: CourseLevel) {
  return [
    ...level.items,
    ...level.sections.flatMap((section) => section.items),
  ]
    .map((item) => item.storagePath)
    .filter((path): path is string => Boolean(path));
}

function SortableList<T extends { id: string }>({
  items,
  onReorder,
  render,
  label,
}: {
  items: T[];
  onReorder: (items: T[]) => void;
  render: (item: T) => (props: { attributes: DraggableAttributes; listeners: SortListeners }) => ReactNode;
  label: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);
    if (oldIndex >= 0 && newIndex >= 0) onReorder(arrayMove(items, oldIndex, newIndex));
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div aria-label={label}>{items.map((item) => <SortableItem key={item.id} id={item.id}>{render(item)}</SortableItem>)}</div>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({ id, children }: { id: string; children: (props: { attributes: DraggableAttributes; listeners: SortListeners }) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.52 : 1 }}
      className="sortable-course-item"
    >
      {children({ attributes, listeners })}
    </div>
  );
}

function DragHandle({ attributes, listeners }: { attributes: DraggableAttributes; listeners: SortListeners }) {
  return (
    <button type="button" className="course-tool drag-handle" aria-label="اسحب لإعادة الترتيب" {...attributes} {...listeners}>
      <GripVertical size={16} aria-hidden="true" />
    </button>
  );
}

export function AdminCoursesIndexPage() {
  const query = useAdminCourses();
  const mutation = useAdminCourseMutation();
  const reorder = useAdminCourseReorder();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Course | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const courses = useMemo(() => [...(query.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [query.data]);

  async function run(action: Parameters<typeof mutation.mutateAsync>[0]['action'], payload: Record<string, string | number | boolean | null>, cleanupPaths: string[] = []) {
    setError('');
    setWorking(true);
    try {
      await mutation.mutateAsync({ action, payload });
      setName('');
      setEditing(null);
      if (cleanupPaths.length) {
        try {
          await removeCourseMedia(cleanupPaths);
        } catch {
          setError('تم حفظ التغيير، لكن تعذّر تنظيف بعض الملفات الخاصة من التخزين.');
        }
      }
    } catch {
      setError('لم يكتمل التغيير. تحقق من الاتصال ثم حاول مجددًا.');
    } finally {
      setWorking(false);
    }
  }

  async function reorderCourses(next: Course[]) {
    try {
      await reorder.mutateAsync({ kind: 'courses', parentType: 'none', parentId: null, ids: next.map((item) => item.id) });
    } catch {
      setError('تعذّر حفظ الترتيب الجديد. أعد المحاولة.');
    }
  }

  function deleteCourse(course: Course) {
    if (window.confirm(`حذف دورة «${course.name}»؟ سيُحذف معها محتواها ومستوياتها.`)) {
      void run('delete_course', { courseId: course.id }, courseMediaPaths(course));
    }
  }

  return (
    <AppShell title="هيكل الدورة">
      <div className="course-pages" dir="rtl">
        <PageHeading eyebrow="مسار التعلّم" title="الدورات" subtitle="رتّب رحلة التعلّم من أول خطوة، ثم افتح أي دورة لبناء مستوياتها ومحتواها.">
          <div className="course-page-actions">
            <button type="button" className="button-primary" onClick={() => setEditing({ id: '', name: '', published: false } as Course)}>
              <Plus size={17} aria-hidden="true" /> إنشاء دورة
            </button>
          </div>
        </PageHeading>
        <section className="course-summary-band">
          <div>
            <h2 className="course-summary-title">كل درس في مكانه، وكل خطوة لها معنى.</h2>
            <p className="course-summary-copy">ابنِ مسارًا واضحًا من محتوى صغير ومتدرّج. يمكنك إعادة ترتيب أي مجموعة بالسحب أو باستخدام لوحة المفاتيح.</p>
          </div>
          <div className="course-summary-number">{formatCount(courses.length)}</div>
        </section>
        {error && <InlineAlert>{error}</InlineAlert>}
        {query.isLoading ? (
          <div aria-label="جارٍ تحميل الدورات"><div className="course-skeleton" /><div className="course-skeleton" /><div className="course-skeleton" /></div>
        ) : query.isError ? (
          <section className="panel">
            <EmptyState title="تعذّر تحميل الدورات" description="تحقق من الاتصال ثم أعد تحميل قائمة الدورات." icon={BookOpen} />
            <div className="empty-state-action"><button type="button" className="button-soft" onClick={() => void query.refetch()}><RefreshCw size={15} /> إعادة المحاولة</button></div>
          </section>
        ) : courses.length === 0 ? (
          <section className="panel">
            <EmptyState title="ابدأ بأول دورة" description="أنشئ دورة لتضيف إليها المستويات والأقسام والدروس التي سيكملها المتعلمون." icon={BookOpen} />
            <div className="empty-state-action"><button type="button" className="button-primary" onClick={() => setEditing({ id: '', name: '', published: false } as Course)}><Plus size={16} /> إنشاء أول دورة</button></div>
          </section>
        ) : (
          <SortableList
            items={courses}
            label="ترتيب الدورات"
            onReorder={(next) => void reorderCourses(next)}
            render={(course) => ({ attributes, listeners }) => (
              <article className="panel course-list-card">
                <div className="course-list-mark"><BookOpen size={23} aria-hidden="true" /></div>
                <div className="course-list-copy">
                  <h2>{course.name}</h2>
                  <p>{formatCount(course.levels.length)} مستويات · {formatCount(countCourseItems(course))} مادة تعليمية</p>
                </div>
                <div className="course-list-tools">
                  <span className={`course-status ${course.published ? '' : 'draft'}`}>{course.published ? 'منشورة' : 'مسودة'}</span>
                  <Link className="button-primary compact-action" href={`/admin/courses/${encodeURIComponent(course.id)}`}>فتح البناء <ChevronLeft size={15} aria-hidden="true" /></Link>
                  <button className="course-tool" type="button" onClick={() => void run('set_course_published', { courseId: course.id, published: !course.published })} aria-label={course.published ? 'إلغاء النشر' : 'نشر الدورة'}>
                    {course.published ? <Check size={16} /> : <Radio size={16} />}
                  </button>
                  <button className="course-tool" type="button" onClick={() => { setName(course.name); setEditing(course); }} aria-label="تعديل اسم الدورة"><Pencil size={15} /></button>
                  <button className="course-tool" type="button" onClick={() => deleteCourse(course)} aria-label="حذف الدورة"><Trash2 size={15} /></button>
                  <DragHandle attributes={attributes} listeners={listeners} />
                </div>
              </article>
            )}
          />
        )}
        {editing && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setEditing(null); }}>
            <section className="panel modal-card course-modal-card" role="dialog" aria-modal="true" aria-labelledby="course-name-title">
              <button type="button" className="icon-button modal-close" aria-label="إغلاق" onClick={() => setEditing(null)}><X size={18} /></button>
              <div className="dialog-icon"><BookOpen size={22} /></div>
              <div className="eyebrow">مسار تعلّم جديد</div>
              <h2 id="course-name-title">{editing.id ? 'تعديل اسم الدورة' : 'إنشاء دورة'}</h2>
              <form className="course-form" onSubmit={(event) => { event.preventDefault(); const trimmed = name.trim(); if (!trimmed) return; void run(editing.id ? 'rename_course' : 'create_course', editing.id ? { courseId: editing.id, name: trimmed } : { name: trimmed }); }}>
                <label className="field">اسم الدورة<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={140} placeholder="مثال: الإنجليزية في الحياة اليومية" required /></label>
                {error && <InlineAlert>{error}</InlineAlert>}
                <div className="course-form-actions"><button className="button-primary" type="submit" disabled={working || !name.trim()}>{working ? 'جارٍ الحفظ…' : editing.id ? 'حفظ الاسم' : 'إنشاء الدورة'}</button><button className="button-soft" type="button" onClick={() => setEditing(null)} disabled={working}>إلغاء</button></div>
              </form>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export function CourseBuilderPage() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const query = useAdminCourses();
  const mutation = useAdminCourseMutation();
  const reorder = useAdminCourseReorder();
  const [dialog, setDialog] = useState<{ type: 'level' | 'section' | 'content'; scope: Scope; item?: CourseContentItem } | null>(null);
  const [editingName, setEditingName] = useState<{ type: 'course' | 'level' | 'section'; id: string; title: string } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const course = query.data?.find((item) => item.id === courseId);
  const levels = useMemo(() => [...(course?.levels ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [course?.levels]);

  async function reorderGroup(kind: 'levels' | 'sections' | 'content', parentType: 'course' | 'level' | 'section', parentId: string, ids: string[]) {
    try {
      await reorder.mutateAsync({ kind, parentType, parentId, ids });
    } catch {
      setError('لم نتمكن من حفظ ترتيب هذه المجموعة. حاول مرة أخرى.');
    }
  }

  async function run(action: Parameters<typeof mutation.mutateAsync>[0]['action'], payload: Record<string, string | number | boolean | null>, cleanupPaths: string[] = []): Promise<boolean> {
    setSaving(true); setError('');
    try {
      await mutation.mutateAsync({ action, payload });
      setDialog(null);
      setEditingName(null);
      if (cleanupPaths.length) {
        try {
          await removeCourseMedia(cleanupPaths);
        } catch {
          setError('تم حفظ التغيير، لكن تعذّر تنظيف بعض الملفات الخاصة من التخزين.');
        }
      }
      return true;
    } catch {
      setError('لم يكتمل التغيير. حاول مجددًا بعد التحقق من الاتصال.');
      return false;
    } finally { setSaving(false); }
  }

  function confirmDelete(label: string, action: Parameters<typeof mutation.mutateAsync>[0]['action'], payload: Record<string, string | number | boolean | null>, cleanupPaths: string[] = []) {
    const consequence = action === 'delete_level'
      ? ' سيُحذف معه محتوى المستوى وأقسامه.'
      : action === 'delete_section'
        ? ' سيُحذف معه محتوى القسم.'
        : '';
    if (window.confirm(`هل تريد حذف «${label}»؟${consequence}`)) void run(action, payload, cleanupPaths);
  }

  function doRename() {
    if (!editingName?.title.trim()) return;
    const { type, id, title } = editingName;
    void run(type === 'course' ? 'rename_course' : type === 'level' ? 'rename_level' : 'rename_section', {
      ...(type === 'course' ? { courseId: id } : type === 'level' ? { levelId: id } : { sectionId: id }),
      ...(type === 'course' ? { name: title.trim() } : { title: title.trim() }),
    });
  }

  return (
    <AppShell title="بناء الدورة">
      <div className="course-pages" dir="rtl">
        <div className="course-tree-toolbar">
          <div className="course-breadcrumbs"><Link href="/admin/courses">الدورات</Link><ChevronLeft size={14} /><span>{course?.name ?? 'بناء الدورة'}</span></div>
          <div className="course-heading-tools">
            {course && <span className={`course-status ${course.published ? '' : 'draft'}`}>{course.published ? 'منشورة للمتعلمين' : 'مسودة'}</span>}
            {course && <button className="button-soft" type="button" onClick={() => void run('set_course_published', { courseId, published: !course.published })}>{course.published ? 'إيقاف النشر' : 'نشر الدورة'}</button>}
          </div>
        </div>
        {query.isLoading ? <LoadingState label="جارٍ تحميل بنية الدورة…" /> :
          query.isError ? <section className="panel"><EmptyState title="تعذّر تحميل البناء" description="أعد المحاولة لتحميل بنية الدورة." icon={Layers3} /><div className="empty-state-action"><button type="button" className="button-soft" onClick={() => void query.refetch()}><RefreshCw size={15} /> إعادة المحاولة</button></div></section> :
          !course ? <section className="panel"><EmptyState title="لم نعثر على هذه الدورة" description="قد تكون حُذفت أو لم تعد متاحة في حسابك." icon={BookOpen} /><div className="empty-state-action"><Link className="button-soft" href="/admin/courses">العودة إلى الدورات</Link></div></section> :
          <>
            <section className="course-builder-hero">
              <div><div className="eyebrow">مخطط المحتوى</div><h2>{course.name}</h2><p>رتّب المواد في المستوى أو القسم المناسب. سيظهر هذا الترتيب نفسه للمتعلّم.</p></div>
              <div className="course-builder-hero-tools">
                <button className="button-soft" type="button" onClick={() => setEditingName({ type: 'course', id: course.id, title: course.name })}><Pencil size={15} /> تعديل الاسم</button>
                {levels.length === 0 && <button className="button-primary" type="button" onClick={() => setDialog({ type: 'content', scope: { levelId: null, sectionId: null } })}><Plus size={16} /> مادة للدورة</button>}
                {course.items.length === 0 && <button className="button-primary" type="button" onClick={() => setDialog({ type: 'level', scope: { levelId: null, sectionId: null } })}><Plus size={16} /> إضافة مستوى</button>}
              </div>
            </section>
            {error && <InlineAlert>{error}</InlineAlert>}
            {levels.length === 0 && <section className="panel course-scope">
              <div className="course-scope-head">
                <div className="course-scope-heading"><span className="course-scope-number">01</span><div><h3>مواد الدورة</h3><p>محتوى يظهر قبل المستويات</p></div></div>
                <div className="course-scope-tools"><button type="button" className="button-soft" onClick={() => setDialog({ type: 'content', scope: { levelId: null, sectionId: null } })}><Plus size={14} /> إضافة مادة</button></div>
              </div>
              <ContentList items={[...course.items].sort((a, b) => a.sortOrder - b.sortOrder)} onReorder={(ids) => void reorderGroup('content', 'course', course.id, ids)} onEdit={(item) => setDialog({ type: 'content', scope: { levelId: null, sectionId: null }, item })} onDelete={(item) => confirmDelete(item.title, 'delete_content', { contentId: item.id }, item.storagePath ? [item.storagePath] : [])} />
            </section>}
            {levels.length === 0 && course.items.length === 0 && <section className="panel"><EmptyState title="اختر طريقة بناء الدورة" description="ابدأ بمواد مباشرة، أو أنشئ مستويات ثم أضف إليها المواد والأقسام." icon={Layers3} /><div className="empty-state-action"><button className="button-primary" type="button" onClick={() => setDialog({ type: 'level', scope: { levelId: null, sectionId: null } })}><Plus size={15} /> إضافة مستوى</button><button className="button-soft" type="button" onClick={() => setDialog({ type: 'content', scope: { levelId: null, sectionId: null } })}><Plus size={15} /> إضافة مادة مباشرة</button></div></section>}
            <SortableList
              items={levels}
              label="ترتيب مستويات الدورة"
              onReorder={(next) => void reorderGroup('levels', 'course', course.id, next.map((item) => item.id))}
              render={(level) => ({ attributes, listeners }) => (
                <section className="panel course-scope">
                  <div className="course-scope-head">
                    <div className="course-scope-heading"><DragHandle attributes={attributes} listeners={listeners} /><span className="course-scope-number">{formatCount(level.sortOrder + 1).padStart(2, '0')}</span><div><h3>{level.title}</h3><p>{formatCount(level.items.length + level.sections.reduce((n, section) => n + section.items.length, 0))} مادة تعليمية · {formatCount(level.sections.length)} أقسام</p></div></div>
                    <div className="course-scope-tools">
                       {level.sections.length === 0 && <button className="button-soft" type="button" onClick={() => setDialog({ type: 'content', scope: { levelId: level.id, sectionId: null } })}><Plus size={14} /> مادة للمستوى</button>}
                       {level.items.length === 0 && <button className="button-soft" type="button" onClick={() => setDialog({ type: 'section', scope: { levelId: level.id, sectionId: null } })}><Plus size={14} /> قسم</button>}
                      <button className="course-tool" type="button" aria-label="تعديل المستوى" onClick={() => setEditingName({ type: 'level', id: level.id, title: level.title })}><Pencil size={14} /></button>
                       <button className="course-tool" type="button" aria-label="حذف المستوى" onClick={() => confirmDelete(level.title, 'delete_level', { levelId: level.id }, levelMediaPaths(level))}><Trash2 size={14} /></button>
                    </div>
                  </div>
                   {level.sections.length === 0 && <ContentList items={[...level.items].sort((a, b) => a.sortOrder - b.sortOrder)} onReorder={(ids) => void reorderGroup('content', 'level', level.id, ids)} onEdit={(item) => setDialog({ type: 'content', scope: { levelId: level.id, sectionId: null }, item })} onDelete={(item) => confirmDelete(item.title, 'delete_content', { contentId: item.id }, item.storagePath ? [item.storagePath] : [])} />}
                  <SortableList items={[...level.sections].sort((a, b) => a.sortOrder - b.sortOrder)} label={`أقسام ${level.title}`} onReorder={(next) => void reorderGroup('sections', 'level', level.id, next.map((item) => item.id))} render={(section) => ({ attributes: sectionAttributes, listeners: sectionListeners }) => (
                    <SectionBlock
                      section={section}
                      attributes={sectionAttributes}
                      listeners={sectionListeners}
                      onAdd={() => setDialog({ type: 'content', scope: { levelId: level.id, sectionId: section.id } })}
                      onRename={() => setEditingName({ type: 'section', id: section.id, title: section.title })}
                       onDelete={() => confirmDelete(section.title, 'delete_section', { sectionId: section.id }, section.items.map((item) => item.storagePath).filter((path): path is string => Boolean(path)))}
                      onItemEdit={(item) => setDialog({ type: 'content', scope: { levelId: level.id, sectionId: section.id }, item })}
                       onItemDelete={(item) => confirmDelete(item.title, 'delete_content', { contentId: item.id }, item.storagePath ? [item.storagePath] : [])}
                      onItemsReorder={(ids) => void reorderGroup('content', 'section', section.id, ids)}
                    />
                  )} />
                </section>
              )}
            />
          </>
        }
        {dialog && course && <ContentDialog
          key={`${dialog.type}-${dialog.item?.id ?? 'new'}-${dialog.scope.sectionId ?? dialog.scope.levelId ?? 'course'}`}
          mode={dialog.type}
          courseId={course.id}
          scope={dialog.scope}
          item={dialog.item}
          pending={saving}
          error={error}
          onClose={() => { setDialog(null); setError(''); }}
          onSubmit={async (draft) => {
            const common = {
              kind: draft.kind,
              title: draft.title.trim(),
              body: draft.kind === 'text' || draft.kind === 'note' ? draft.body.trim() || null : null,
              storagePath: draft.storagePath, mimeType: draft.mimeType,
              fileSizeBytes: draft.fileSizeBytes, durationSeconds: draft.durationSeconds,
            };
            const oldPath = dialog.item?.storagePath;
            const cleanupPaths = oldPath && oldPath !== draft.storagePath ? [oldPath] : [];
            return draft.id
              ? run('update_content', { contentId: draft.id, ...common }, cleanupPaths)
              : run('create_content', { courseId: course.id, levelId: dialog.scope.levelId, sectionId: dialog.scope.sectionId, ...common });
          }}
          onFailure={setError}
        />}
        {editingName && <div className="modal-backdrop" role="presentation"><section className="panel modal-card course-modal-card" role="dialog" aria-modal="true" aria-labelledby="rename-node-title"><button className="icon-button modal-close" type="button" aria-label="إغلاق" onClick={() => setEditingName(null)}><X size={18} /></button><div className="dialog-icon"><Pencil size={21} /></div><div className="eyebrow">تعديل التسمية</div><h2 id="rename-node-title">اسم واضح يساعد على التعلّم</h2><form className="course-form" onSubmit={(event) => { event.preventDefault(); doRename(); }}><label className="field">الاسم<input autoFocus value={editingName.title} maxLength={140} onChange={(event) => setEditingName({ ...editingName, title: event.target.value })} required /></label>{error && <InlineAlert>{error}</InlineAlert>}<div className="course-form-actions"><button className="button-primary" type="submit" disabled={saving || !editingName.title.trim()}>{saving ? 'جارٍ الحفظ…' : 'حفظ الاسم'}</button><button className="button-soft" type="button" onClick={() => setEditingName(null)}>إلغاء</button></div></form></section></div>}
      </div>
    </AppShell>
  );
}

function ContentList({
  items, onReorder, onEdit, onDelete,
}: {
  items: CourseContentItem[];
  onReorder: (ids: string[]) => void;
  onEdit: (item: CourseContentItem) => void;
  onDelete: (item: CourseContentItem) => void;
}) {
  if (!items.length) return <div className="scope-empty">لا توجد مواد في هذا المكان بعد.</div>;
  return <SortableList items={items} label="ترتيب المواد التعليمية" onReorder={(next) => onReorder(next.map((item) => item.id))} render={(item) => ({ attributes, listeners }) => {
    const Icon = kindIcons[item.kind];
    return <div className="course-content-row"><span className={`content-kind-icon ${item.kind}`}><Icon size={18} /></span><div><div className="course-content-title">{item.title}</div><div className="course-content-subtitle">{kindNames[item.kind]}</div></div><div className="course-content-actions"><button className="course-tool" type="button" aria-label={`تعديل ${item.title}`} onClick={() => onEdit(item)}><Pencil size={14} /></button><button className="course-tool" type="button" aria-label={`حذف ${item.title}`} onClick={() => onDelete(item)}><Trash2 size={14} /></button><DragHandle attributes={attributes} listeners={listeners} /></div></div>;
  }} />;
}

function SectionBlock({
  section, attributes, listeners, onAdd, onRename, onDelete, onItemEdit, onItemDelete, onItemsReorder,
}: {
  section: CourseSection;
  attributes: DraggableAttributes;
  listeners: SortListeners;
  onAdd: () => void;
  onRename: () => void;
  onDelete: () => void;
  onItemEdit: (item: CourseContentItem) => void;
  onItemDelete: (item: CourseContentItem) => void;
  onItemsReorder: (ids: string[]) => void;
}) {
  return <div className="course-section">
    <div className="course-scope-head">
      <div className="course-scope-heading"><DragHandle attributes={attributes} listeners={listeners} /><span className="course-scope-number"><Layers3 size={16} /></span><div><h3>{section.title}</h3><p>{formatCount(section.items.length)} مواد</p></div></div>
      <div className="course-scope-tools"><button className="button-soft" type="button" onClick={onAdd}><Plus size={13} /> مادة</button><button className="course-tool" type="button" aria-label="تعديل القسم" onClick={onRename}><Pencil size={14} /></button><button className="course-tool" type="button" aria-label="حذف القسم" onClick={onDelete}><Trash2 size={14} /></button></div>
    </div>
    <ContentList items={[...section.items].sort((a, b) => a.sortOrder - b.sortOrder)} onReorder={onItemsReorder} onEdit={onItemEdit} onDelete={onItemDelete} />
  </div>;
}

function ContentDialog({
  mode, courseId, scope, item, pending, error, onClose, onSubmit, onFailure,
}: {
  mode: 'level' | 'section' | 'content';
  courseId: string;
  scope: Scope;
  item?: CourseContentItem;
  pending: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (draft: ContentDraft) => Promise<boolean>;
  onFailure: (message: string) => void;
}) {
  const mutation = useAdminCourseMutation();
  const [title, setTitle] = useState(item?.title ?? '');
  const [kind, setKind] = useState<CourseContentKind>(item?.kind ?? 'text');
  const [body, setBody] = useState(item?.body ?? '');
  const [fileMeta, setFileMeta] = useState<{ storagePath: string | null; mimeType: string | null; fileSizeBytes: number | null; durationSeconds: number | null }>({
    storagePath: item?.storagePath ?? null, mimeType: item?.mimeType ?? null, fileSizeBytes: item?.fileSizeBytes ?? null, durationSeconds: item?.durationSeconds ?? null,
  });
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploadController, setUploadController] = useState<AbortController | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const recordedChunks = useRef<BlobPart[]>([]);
  const audioStream = useRef<MediaStream | null>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    uploadControllerRef.current?.abort();
    const recorder = mediaRecorder.current;
    if (recorder?.state === 'recording') {
      recorder.onstop = null;
      recorder.stop();
    }
    audioStream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function discardUncommittedUpload() {
    const path = fileMeta.storagePath;
    if (!path || path === item?.storagePath) return;
    try {
      await removeCourseMedia([path]);
    } catch {
      onFailure('تعذّر تنظيف الملف غير المحفوظ من التخزين الخاص.');
    }
  }

  function closeDialog() {
    if (uploading || recording) return;
    void discardUncommittedUpload();
    onClose();
  }

  async function uploadFile(file: File) {
    if (fileMeta.storagePath && fileMeta.storagePath !== item?.storagePath) {
      try {
        await removeCourseMedia([fileMeta.storagePath]);
      } catch {
        onFailure('تعذّر استبدال الملف السابق. أعد المحاولة.');
        return;
      }
      setFileMeta(item ? {
        storagePath: item.storagePath,
        mimeType: item.mimeType,
        fileSizeBytes: item.fileSizeBytes,
        durationSeconds: item.durationSeconds,
      } : {
        storagePath: null,
        mimeType: null,
        fileSizeBytes: null,
        durationSeconds: null,
      });
    }
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    setUploadController(controller); setUploading(true); setUploadPercent(0); onFailure('');
    try {
      const result = await uploadCourseMedia(file, { onProgress: setUploadPercent, signal: controller.signal });
      setFileMeta({ ...result, durationSeconds: fileMeta.durationSeconds });
    } catch (uploadError) {
      onFailure(uploadError instanceof DOMException && uploadError.name === 'AbortError' ? 'تم إلغاء الرفع.' : 'تعذّر رفع الملف. تحقق من نوعه وحجمه ثم حاول مجددًا.');
    } finally {
      if (uploadControllerRef.current === controller) uploadControllerRef.current = null;
      setUploading(false); setUploadController(null);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStream.current = stream;
      recordedChunks.current = [];
      const preferredType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(
        stream,
        preferredType ? { mimeType: preferredType } : undefined,
      );
      mediaRecorder.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) recordedChunks.current.push(event.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm';
        const extension = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        const file = new File(recordedChunks.current, `voice-note-${Date.now()}.${extension}`, { type });
        audioStream.current?.getTracks().forEach((track) => track.stop());
        audioStream.current = null;
        setRecording(false);
        void uploadFile(file);
      };
      recorder.start();
      setRecording(true);
    } catch {
      onFailure('لم نتمكن من استخدام الميكروفون. اسمح بالتسجيل من إعدادات المتصفح ثم حاول مجددًا.');
    }
  }

  function stopRecording() {
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
  }

  async function saveScope() {
    if (!title.trim()) return;
    try {
      if (mode === 'level') await mutation.mutateAsync({ action: 'create_level', payload: { courseId, title: title.trim() } });
      else await mutation.mutateAsync({ action: 'create_section', payload: { levelId: scope.levelId, title: title.trim() } });
      onClose();
    } catch { onFailure('تعذّر إنشاء هذه المجموعة. حاول مرة أخرى.'); }
  }

  const needsFile = kind === 'video' || kind === 'image' || kind === 'audio';
  const accepted = kind === 'video' ? 'video/*' : kind === 'image' ? 'image/*' : 'audio/*';
  const ready = title.trim().length > 0 && (
    needsFile ? Boolean(fileMeta.storagePath) : body.trim().length > 0
  );

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending && !uploading && !recording) closeDialog(); }}>
      <section className="panel modal-card course-modal-card" role="dialog" aria-modal="true" aria-labelledby="content-dialog-title">
        <button type="button" className="icon-button modal-close" aria-label="إغلاق" onClick={closeDialog} disabled={uploading || recording}><X size={18} /></button>
        <div className="dialog-icon">{mode === 'content' ? <FileText size={22} /> : <Layers3 size={22} />}</div>
        <div className="eyebrow">{mode === 'content' ? item ? 'تحديث مادة' : 'مادة تعليمية جديدة' : mode === 'level' ? 'مرحلة من الدورة' : 'مجموعة دروس'}</div>
        <h2 id="content-dialog-title">{mode === 'content' ? item ? 'حرّر محتوى المادة' : 'أضف مادة تعليمية' : mode === 'level' ? 'إضافة مستوى' : 'إضافة قسم'}</h2>
        <form className="course-form" onSubmit={async (event) => {
          event.preventDefault();
          if (mode !== 'content') { void saveScope(); return; }
          const saved = await onSubmit({ id: item?.id, kind, title, body, ...fileMeta });
          if (!saved && fileMeta.storagePath && fileMeta.storagePath !== item?.storagePath) {
            await discardUncommittedUpload();
            setFileMeta({ storagePath: null, mimeType: null, fileSizeBytes: null, durationSeconds: null });
          }
        }}>
          <label className="field">{mode === 'content' ? 'عنوان المادة' : 'الاسم'}<input autoFocus value={title} maxLength={140} onChange={(event) => setTitle(event.target.value)} placeholder={mode === 'content' ? 'مثال: التحية والتعارف' : mode === 'level' ? 'مثال: الأساسيات' : 'مثال: في المقهى'} required /></label>
          {mode === 'content' && <>
            <label className="field">نوع المادة<select value={kind} onChange={(event) => { void discardUncommittedUpload(); setKind(event.target.value as CourseContentKind); setBody(''); setFileMeta({ storagePath: null, mimeType: null, fileSizeBytes: null, durationSeconds: null }); }}><option value="video">فيديو</option><option value="image">صورة</option><option value="text">نص تعليمي</option><option value="note">ملاحظة</option><option value="audio">ملف صوتي</option></select></label>
            {(kind === 'text' || kind === 'note') && <label className="field">{kind === 'note' ? 'الملاحظة' : 'النص التعليمي'}<textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="اكتب محتوى واضحًا ومباشرًا للمتعلّم." /></label>}
            {needsFile && <>
              <label className="course-upload-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && !uploading) void uploadFile(file); }}>
                <Upload size={20} />
                <strong>{fileMeta.storagePath ? 'تم تجهيز الملف للدرس' : 'اسحب الملف إلى هنا أو اختره من جهازك'}</strong>
                <span>رفع محمي قابل للاستئناف · الحد الأقصى 500 ميغابايت</span>
                <input className="course-file-input" type="file" accept={accepted} disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); event.currentTarget.value = ''; }} />
              </label>
              {kind === 'audio' && <div className="course-recording">{recording ? <strong><span className="recording-dot" /> التسجيل جارٍ…</strong> : <strong><Mic size={16} /> أو سجّل شرحًا صوتيًا قصيرًا</strong>}<button type="button" className={recording ? 'button-danger' : 'button-soft'} disabled={uploading} onClick={() => recording ? stopRecording() : void startRecording()}>{recording ? 'إيقاف وإرفاق' : 'بدء التسجيل'}</button></div>}
              {uploading && <><div className="course-progress-track" role="progressbar" aria-valuenow={uploadPercent ?? 0} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${uploadPercent ?? 0}%` }} /></div><div className="course-upload-status"><span>جارٍ رفع الملف… {formatCount(uploadPercent ?? 0)}٪</span><button type="button" className="button-soft compact-action" onClick={() => uploadController?.abort()}>إلغاء الرفع</button></div></>}
              {fileMeta.storagePath && !uploading && <div className="course-upload-status"><span><Check size={14} /> الملف جاهز للإضافة</span><button type="button" className="button-soft compact-action" onClick={() => { void discardUncommittedUpload(); setFileMeta({ storagePath: null, mimeType: null, fileSizeBytes: null, durationSeconds: null }); }}>استبدال الملف</button></div>}
            </>}
          </>}
          {error && <InlineAlert>{error}</InlineAlert>}
          <div className="course-form-actions"><button className="button-primary" type="submit" disabled={pending || uploading || recording || !ready}>{pending ? 'جارٍ الحفظ…' : mode === 'content' ? item ? 'حفظ التعديلات' : 'إضافة المادة' : mode === 'level' ? 'إضافة المستوى' : 'إضافة القسم'}</button><button className="button-soft" type="button" onClick={closeDialog} disabled={pending || uploading || recording}>إلغاء</button></div>
        </form>
      </section>
    </div>
  );
}

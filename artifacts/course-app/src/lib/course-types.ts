export type CourseContentKind = 'video' | 'image' | 'text' | 'note' | 'audio';

export type CourseProgress = {
  positionSeconds: number;
  durationSeconds: number | null;
  progressPercent: number;
  completed: boolean;
  completedAt: string | null;
  updatedAt: string | null;
};

export type CourseContentItem = {
  id: string;
  kind: CourseContentKind;
  title: string;
  body: string | null;
  storagePath: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  durationSeconds: number | null;
  sortOrder: number;
  progress?: CourseProgress | null;
};

export type CourseSection = {
  id: string;
  title: string;
  sortOrder: number;
  items: CourseContentItem[];
};

export type CourseLevel = {
  id: string;
  title: string;
  sortOrder: number;
  items: CourseContentItem[];
  sections: CourseSection[];
};

export type Course = {
  id: string;
  name: string;
  published: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  items: CourseContentItem[];
  levels: CourseLevel[];
};

export type CourseAdminAction =
  | 'create_course'
  | 'rename_course'
  | 'set_course_published'
  | 'delete_course'
  | 'create_level'
  | 'rename_level'
  | 'delete_level'
  | 'create_section'
  | 'rename_section'
  | 'delete_section'
  | 'create_content'
  | 'update_content'
  | 'delete_content';

export type CourseAdminPayload = Record<string, string | number | boolean | null>;

export type CourseProgressInput = {
  contentId: string;
  positionSeconds: number;
  durationSeconds: number | null;
  markDone: boolean;
};

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { callRpc } from '@/lib/supabase';
import { readLearnerSession } from '@/lib/learner-session';
import type {
  Course,
  CourseAdminAction,
  CourseAdminPayload,
  CourseProgressInput,
} from '@/lib/course-types';

type RpcReply<T = undefined> = {
  ok: boolean;
  error?: string;
  id?: string;
  progress?: T;
};

export const adminCourseQueryKey = ['course-tree', 'admin'] as const;
export const learnerCourseQueryKey = ['course-tree', 'learner'] as const;

export function useAdminCourses() {
  return useQuery({
    queryKey: adminCourseQueryKey,
    queryFn: () => callRpc<Course[]>('admin_course_tree'),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useAdminCourseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      action,
      payload,
    }: {
      action: CourseAdminAction;
      payload: CourseAdminPayload;
    }) => {
      const reply = await callRpc<RpcReply>('admin_course_mutate', {
        p_action: action,
        p_payload: payload,
      });
      if (!reply.ok) throw new Error(reply.error ?? 'course_action_failed');
      return reply;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminCourseQueryKey }),
  });
}

export function useAdminCourseReorder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      kind,
      parentType,
      parentId,
      ids,
    }: {
      kind: 'courses' | 'levels' | 'sections' | 'content';
      parentType: 'course' | 'level' | 'section' | 'none';
      parentId: string | null;
      ids: string[];
    }) => {
      const reply = await callRpc<RpcReply>('admin_course_reorder', {
        p_kind: kind,
        p_parent_type: parentType,
        p_parent_id: parentId,
        p_ids: ids,
      });
      if (!reply.ok) throw new Error(reply.error ?? 'course_reorder_failed');
      return reply;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminCourseQueryKey }),
  });
}

export function useLearnerCourses() {
  return useQuery({
    queryKey: learnerCourseQueryKey,
    queryFn: async () => {
      const sessionSecret = readLearnerSession();
      if (!sessionSecret) throw new Error('learner_session_required');
      return callRpc<Course[]>('learner_course_tree', {
        p_session_secret: sessionSecret,
      });
    },
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useSaveLearnerProgress() {
  return useMutation({
    mutationFn: async (progress: CourseProgressInput) => {
      const sessionSecret = readLearnerSession();
      if (!sessionSecret) throw new Error('learner_session_required');
      const reply = await callRpc<RpcReply>('learner_save_progress', {
        p_session_secret: sessionSecret,
        p_content_id: progress.contentId,
        p_position_seconds: progress.positionSeconds,
        p_duration_seconds: progress.durationSeconds,
        p_mark_done: progress.markDone,
      });
      if (!reply.ok) throw new Error(reply.error ?? 'progress_save_failed');
      return reply;
    },
  });
}

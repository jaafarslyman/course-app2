import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createChatMediaSignedUrl,
  createChatMediaUploadUrl,
} from '@workspace/api-client-react';
import type {
  ChatMediaSignedUrlInput,
  ChatMediaUploadUrlInput,
} from '@workspace/api-client-react';
import { readLearnerSession } from '@/lib/learner-session';
import { callRpc, requireSupabase } from '@/lib/supabase';

export type ChatAudience = 'admin' | 'learner';
export type ChatMessageKind = 'text' | 'image' | 'video' | 'audio';

export type GroupChatMessage = {
  id: string;
  senderType: 'admin' | 'learner';
  senderName: string;
  body: string | null;
  kind: ChatMessageKind;
  mimeType: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
};

export type GroupChatState = {
  messagingEnabled: boolean;
  canSend: boolean;
  messages: GroupChatMessage[];
};

export type GroupChatMessageInput = {
  kind: ChatMessageKind;
  body?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
};

type RpcReply = {
  ok: boolean;
  id?: string;
  error?: string;
  messagingEnabled?: boolean;
};

export const groupChatQueryKey = (
  audience: ChatAudience,
  learnerId?: string,
) => ['group-chat', audience, audience === 'learner' ? learnerId ?? null : 'admin'] as const;

async function apiRequestOptions(audience: ChatAudience) {
  if (audience === 'learner') return undefined;
  const {
    data: { session },
    error,
  } = await requireSupabase().auth.getSession();
  if (error || !session?.access_token) throw new Error('admin_session_required');
  return { headers: { Authorization: `Bearer ${session.access_token}` } };
}

function requireLearnerSecret() {
  const secret = readLearnerSession();
  if (!secret) throw new Error('learner_session_required');
  return secret;
}

export function useGroupChatState(audience: ChatAudience, learnerId?: string) {
  return useQuery({
    queryKey: groupChatQueryKey(audience, learnerId),
    queryFn: () =>
      callRpc<GroupChatState>('chat_get_state', {
        p_session_secret: audience === 'learner' ? requireLearnerSecret() : null,
      }),
    enabled: audience === 'admin' || Boolean(learnerId),
    refetchInterval: 4_000,
    refetchOnWindowFocus: true,
    staleTime: 2_000,
  });
}

export function useSendGroupChatMessage(
  audience: ChatAudience,
  learnerId?: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: GroupChatMessageInput) => {
      const reply = await callRpc<RpcReply>('chat_send_message', {
        p_session_secret: audience === 'learner' ? requireLearnerSecret() : null,
        p_kind: input.kind,
        p_body: input.body ?? null,
        p_storage_path: input.storagePath ?? null,
        p_mime_type: input.mimeType ?? null,
        p_file_size_bytes: input.fileSizeBytes ?? null,
      });
      if (!reply.ok) throw new Error(reply.error ?? 'chat_send_failed');
      return reply;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: groupChatQueryKey(audience, learnerId),
      }),
  });
}

export function useSetLearnerMessagingEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const reply = await callRpc<RpcReply>('admin_chat_set_messaging_enabled', {
        p_enabled: enabled,
      });
      if (!reply.ok) throw new Error(reply.error ?? 'chat_settings_save_failed');
      return reply;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['group-chat'] }),
  });
}

export function useGroupChatMediaUrl(
  messageId: string,
  audience: ChatAudience,
  learnerId?: string,
) {
  return useQuery({
    queryKey: ['group-chat-media', audience, learnerId ?? 'admin', messageId],
    queryFn: async () => {
      const input: ChatMediaSignedUrlInput = {
        messageId,
        learnerSessionSecret:
          audience === 'learner' ? requireLearnerSecret() : null,
      };
      const result = await createChatMediaSignedUrl(
        input,
        await apiRequestOptions(audience),
      );
      return result.signedUrl;
    },
    enabled: Boolean(messageId) && (audience === 'admin' || Boolean(learnerId)),
    staleTime: 45 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchInterval: 45 * 60 * 1000,
  });
}

const CHAT_MEDIA_LIMIT_BYTES = 50 * 1024 * 1024;
const SUPPORTED_CHAT_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg',
  'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/3gpp',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  aac: 'audio/aac',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  m4a: 'audio/x-m4a',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  png: 'image/png',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
};

export function getChatMediaKind(file: File): ChatMessageKind | null {
  const mimeType = getChatMimeType(file);
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return null;
}

function getChatMimeType(file: File): string {
  const suppliedType = file.type.split(';', 1)[0].trim().toLowerCase();
  if (suppliedType) return suppliedType;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? '';
}

function isSupportedChatMimeType(mimeType: string): boolean {
  return SUPPORTED_CHAT_MIME_TYPES.has(mimeType);
}

export async function uploadGroupChatMedia(
  file: File,
  audience: ChatAudience,
): Promise<{
  kind: Exclude<ChatMessageKind, 'text'>;
  storagePath: string;
  mimeType: string;
  fileSizeBytes: number;
}> {
  if (file.size < 1) throw new Error('empty_file');
  if (file.size > CHAT_MEDIA_LIMIT_BYTES) throw new Error('chat_media_too_large');

  const mimeType = getChatMimeType(file);
  const kind = getChatMediaKind(file);
  if (!kind || kind === 'text' || !isSupportedChatMimeType(mimeType)) {
    throw new Error('unsupported_chat_media');
  }

  const input: ChatMediaUploadUrlInput = {
    contentType: mimeType,
    fileSizeBytes: file.size,
    learnerSessionSecret:
      audience === 'learner' ? requireLearnerSecret() : null,
  };
  const upload = await createChatMediaUploadUrl(
    input,
    await apiRequestOptions(audience),
  );
  const token = new URL(upload.signedUrl).searchParams.get('token');
  if (!token) throw new Error('chat_upload_token_missing');

  const { error } = await requireSupabase()
    .storage.from('chat-media')
    .uploadToSignedUrl(upload.storagePath, token, file, {
      cacheControl: '3600',
      contentType: mimeType,
      upsert: false,
    });
  if (error) throw error;

  return {
    kind,
    storagePath: upload.storagePath,
    mimeType,
    fileSizeBytes: file.size,
  };
}

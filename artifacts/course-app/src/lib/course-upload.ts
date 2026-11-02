import * as tus from 'tus-js-client';
import { requireSupabase } from '@/lib/supabase';

const COURSE_MEDIA_BUCKET = 'course-media';
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
const SUPPORTED_COURSE_MEDIA_TYPES = new Set([
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg',
  'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/3gpp',
]);

export type CourseUploadResult = {
  storagePath: string;
  fileSizeBytes: number;
  mimeType: string;
};

export async function uploadCourseMedia(
  file: File,
  options: {
    onProgress: (percent: number) => void;
    signal?: AbortSignal;
  },
): Promise<CourseUploadResult> {
  if (file.size === 0) throw new Error('empty_file');
  if (file.size > MAX_FILE_SIZE_BYTES) throw new Error('file_too_large');
  if (!globalThis.crypto?.randomUUID) throw new Error('secure_random_unavailable');

  const client = requireSupabase();
  const {
    data: { session },
    error,
  } = await client.auth.getSession();
  if (error || !session?.access_token) throw new Error('admin_session_required');

  const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  if (!configuredUrl) throw new Error('supabase_configuration_missing');
  const mimeType = normalizeMimeType(file);
  if (!SUPPORTED_COURSE_MEDIA_TYPES.has(mimeType)) {
    throw new Error('unsupported_file_type');
  }
  const storagePath = `${crypto.randomUUID()}/${sanitizeFilename(file.name)}`;
  const endpoint = getTusEndpoint(configuredUrl);

  await new Promise<void>((resolve, reject) => {
    const signal = options.signal;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abortUpload);
      callback();
    };

    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: COURSE_MEDIA_BUCKET,
        objectName: storagePath,
        contentType: mimeType,
        cacheControl: '3600',
      },
      chunkSize: TUS_CHUNK_SIZE,
      onError: (uploadError) => {
        finish(() => reject(uploadError));
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        options.onProgress(
          bytesTotal > 0
            ? Math.min(100, Math.round((bytesUploaded / bytesTotal) * 100))
            : 0,
        );
      },
      onSuccess: () => finish(resolve),
    });

    const abortUpload = () => {
      void upload.abort(true).finally(() => {
        finish(() => reject(new DOMException('Upload cancelled', 'AbortError')));
      });
    };

    if (signal?.aborted) {
      abortUpload();
      return;
    }
    signal?.addEventListener('abort', abortUpload, { once: true });

    void upload
      .findPreviousUploads()
      .then((previousUploads) => {
        if (settled) return;
        if (previousUploads.length > 0) {
          upload.resumeFromPreviousUpload(previousUploads[0]);
        }
        upload.start();
      })
      .catch((uploadError: unknown) => {
        finish(() => reject(uploadError));
      });
  });

  return {
    storagePath,
    fileSizeBytes: file.size,
    mimeType,
  };
}

export async function removeCourseMedia(storagePaths: string[]) {
  const uniquePaths = [...new Set(storagePaths.filter(Boolean))];
  if (uniquePaths.length === 0) return;

  const { error } = await requireSupabase()
    .storage.from(COURSE_MEDIA_BUCKET)
    .remove(uniquePaths);
  if (error) throw error;
}

function getTusEndpoint(configuredUrl: string) {
  const url = new URL(configuredUrl);
  const hostname = url.hostname;
  const projectRef = hostname.endsWith('.supabase.co')
    ? hostname.slice(0, -'.supabase.co'.length)
    : null;
  const storageOrigin = projectRef
    ? `https://${projectRef}.storage.supabase.co`
    : url.origin;
  return `${storageOrigin}/storage/v1/upload/resumable`;
}

function sanitizeFilename(filename: string) {
  const cleaned = filename
    .normalize('NFKC')
    .replace(/[/\\]/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return cleaned || 'course-media';
}

function normalizeMimeType(file: File) {
  const browserType = file.type.split(';', 1)[0]?.trim().toLowerCase();
  if (browserType && browserType !== 'application/octet-stream') return browserType;
  const extension = file.name.split('.').pop()?.toLowerCase();
  const fallbackTypes: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/x-m4v',
    webm: 'video/webm',
    mov: 'video/quicktime',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    wav: 'audio/wav',
  };
  return fallbackTypes[extension ?? ''] ?? 'application/octet-stream';
}

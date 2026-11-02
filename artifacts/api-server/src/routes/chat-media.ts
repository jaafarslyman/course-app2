import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Router, type IRouter } from "express";
import {
  CreateChatMediaSignedUrlBody,
  CreateChatMediaSignedUrlResponse,
  CreateChatMediaUploadUrlBody,
  CreateChatMediaUploadUrlResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const CHAT_MEDIA_BUCKET = "chat-media";
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_CHAT_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  "audio/wav",
  "audio/x-wav",
  "audio/3gpp",
]);

function readSupabaseConfig() {
  const url = process.env["VITE_SUPABASE_URL"]?.trim();
  const anonKey = process.env["VITE_SUPABASE_ANON_KEY"]?.trim();
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  return { url, anonKey, serviceRoleKey };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasSafeChatPath(path: string): boolean {
  return /^chat\/[A-Za-z0-9-]{36}$/.test(path);
}

function createAuthorizationClient(url: string, anonKey: string, authorization?: string) {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    ...(authorization ? { global: { headers: { Authorization: authorization } } } : {}),
  });
}

function createServiceClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

router.post("/chat-media/upload-url", async (req, res): Promise<void> => {
  const parsed = CreateChatMediaUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const contentType = parsed.data.contentType.split(";", 1)[0].trim().toLowerCase();
  if (
    !SUPPORTED_CHAT_MEDIA_TYPES.has(contentType) ||
    parsed.data.fileSizeBytes > MAX_FILE_SIZE_BYTES
  ) {
    res.status(400).json({ error: "unsupported_chat_media" });
    return;
  }

  const authorization = req.header("authorization");
  if (authorization !== undefined && !/^Bearer\s+\S+$/i.test(authorization)) {
    res.status(401).json({ error: "invalid_authorization" });
    return;
  }

  const { url, anonKey, serviceRoleKey } = readSupabaseConfig();
  if (!url || !anonKey || !serviceRoleKey) {
    req.log.error("Chat media upload is not configured");
    res.status(503).json({ error: "chat_media_unavailable" });
    return;
  }

  try {
    const authorizationClient = createAuthorizationClient(url, anonKey, authorization);
    const { data: permission, error: permissionError } =
      await authorizationClient.rpc("chat_media_upload_permission", {
        p_session_secret: parsed.data.learnerSessionSecret ?? null,
      });

    if (
      permissionError ||
      !isRecord(permission) ||
      permission["ok"] !== true
    ) {
      if (permissionError) {
        req.log.warn(
          { code: permissionError.code },
          "Chat media upload permission was rejected",
        );
      }
      res.status(403).json({ error: "chat_upload_not_allowed" });
      return;
    }

    const storagePath = `chat/${randomUUID()}`;
    const serviceClient = createServiceClient(url, serviceRoleKey);
    const { data: upload, error: uploadError } = await serviceClient.storage
      .from(CHAT_MEDIA_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });

    if (
      uploadError ||
      !upload?.signedUrl ||
      upload.path !== storagePath
    ) {
      req.log.error(
        { statusCode: uploadError?.statusCode },
        "Unable to create chat media upload URL",
      );
      res.status(500).json({ error: "chat_upload_url_failed" });
      return;
    }

    const response = CreateChatMediaUploadUrlResponse.parse({
      signedUrl: upload.signedUrl,
      storagePath,
    });
    res.status(200).json(response);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.name : "unknown_chat_upload_error",
      },
      "Chat media upload URL request failed",
    );
    res.status(500).json({ error: "chat_upload_url_failed" });
  }
});

router.post("/chat-media/signed-url", async (req, res): Promise<void> => {
  const parsed = CreateChatMediaSignedUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const authorization = req.header("authorization");
  if (authorization !== undefined && !/^Bearer\s+\S+$/i.test(authorization)) {
    res.status(401).json({ error: "invalid_authorization" });
    return;
  }

  const { url, anonKey, serviceRoleKey } = readSupabaseConfig();
  if (!url || !anonKey || !serviceRoleKey) {
    req.log.error("Chat media signing is not configured");
    res.status(503).json({ error: "chat_media_unavailable" });
    return;
  }

  try {
    const authorizationClient = createAuthorizationClient(url, anonKey, authorization);
    const { data: permission, error: permissionError } =
      await authorizationClient.rpc("chat_media_path", {
        p_message_id: parsed.data.messageId,
        p_session_secret: parsed.data.learnerSessionSecret ?? null,
      });

    if (
      permissionError ||
      !isRecord(permission) ||
      permission["ok"] !== true ||
      typeof permission["storagePath"] !== "string" ||
      !hasSafeChatPath(permission["storagePath"])
    ) {
      if (permissionError) {
        req.log.warn(
          { code: permissionError.code },
          "Chat media access was rejected",
        );
      }
      res.status(403).json({ error: "chat_media_access_denied" });
      return;
    }

    const serviceClient = createServiceClient(url, serviceRoleKey);
    const { data: signedMedia, error: signingError } = await serviceClient.storage
      .from(CHAT_MEDIA_BUCKET)
      .createSignedUrl(permission["storagePath"], SIGNED_URL_TTL_SECONDS);

    if (signingError || !signedMedia?.signedUrl) {
      req.log.error(
        { statusCode: signingError?.statusCode },
        "Unable to sign chat media URL",
      );
      res.status(500).json({ error: "chat_media_signing_failed" });
      return;
    }

    const response = CreateChatMediaSignedUrlResponse.parse({
      signedUrl: signedMedia.signedUrl,
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
    res.status(200).json(response);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.name : "unknown_chat_media_error",
      },
      "Chat media signing request failed",
    );
    res.status(500).json({ error: "chat_media_signing_failed" });
  }
});

export default router;

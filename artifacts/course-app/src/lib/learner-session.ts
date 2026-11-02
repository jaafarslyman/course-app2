export const LEARNER_SESSION_KEY = 'lughti-learner-session';

const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type LearnerIdentity = {
  id: string;
  name: string;
  email: string;
};

export type LearnerRpcReply = {
  ok: boolean;
  error?: string;
  learner?: LearnerIdentity;
};

export function createAccessCode(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('secure_random_unavailable');
  }

  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => ACCESS_CODE_ALPHABET[byte & 31]).join('');
}

export function createSessionSecret(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('secure_random_unavailable');
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function readLearnerSession(): string | null {
  return localStorage.getItem(LEARNER_SESSION_KEY);
}

export function saveLearnerSession(secret: string): void {
  localStorage.setItem(LEARNER_SESSION_KEY, secret);
}

export function clearLearnerSession(): void {
  localStorage.removeItem(LEARNER_SESSION_KEY);
}

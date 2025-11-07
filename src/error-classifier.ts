import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

export type ConnectionIssueKind = 'auth' | 'offline' | 'other';

export interface ConnectionIssue {
  kind: ConnectionIssueKind;
  rawMessage: string;
  statusCode?: number;
}

const AUTH_STATUSES = new Set([401, 403, 405]);
const OFFLINE_PATTERNS = [
  'fetch failed',
  'econnrefused',
  'connection refused',
  'connection closed',
  'connection reset',
  'socket hang up',
  'connect timeout',
  'network is unreachable',
  'timed out',
  'timeout',
  'timeout after',
];

export function analyzeConnectionError(error: unknown): ConnectionIssue {
  const rawMessage = extractMessage(error);
  if (error instanceof UnauthorizedError) {
    return { kind: 'auth', rawMessage };
  }
  const statusCode = extractStatusCode(rawMessage);
  const normalized = rawMessage.toLowerCase();
  if (AUTH_STATUSES.has(statusCode ?? -1) || containsAuthToken(normalized)) {
    return { kind: 'auth', rawMessage, statusCode };
  }
  if (OFFLINE_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return { kind: 'offline', rawMessage };
  }
  return { kind: 'other', rawMessage };
}

export function isAuthIssue(issue: ConnectionIssue): boolean {
  return issue.kind === 'auth';
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message ?? '';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error === undefined || error === null) {
    return '';
  }
  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
}

function extractStatusCode(message: string): number | undefined {
  const match = message.match(/status code\s*\((\d{3})\)/i);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function containsAuthToken(normalizedMessage: string): boolean {
  return (
    normalizedMessage.includes('401') ||
    normalizedMessage.includes('unauthorized') ||
    normalizedMessage.includes('invalid_token') ||
    normalizedMessage.includes('forbidden')
  );
}

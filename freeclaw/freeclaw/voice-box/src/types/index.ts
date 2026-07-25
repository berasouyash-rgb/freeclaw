/**
 * Shared domain types for Voice Box.
 * Source of truth for all frontend data shapes.
 */

// ─── Post ────────────────────────────────────────────

export type PostType = 'problem' | 'suggestion' | 'poll';
export type PostStatus = 'reported' | 'verified' | 'in_progress' | 'waiting' | 'solved' | 'archived';
export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface StatusHistoryEntry {
  status: PostStatus;
  at: string;
  note?: string;
}

export interface PostData {
  id: string;
  type: PostType;
  title: string;
  description: string;
  category: string;
  status: PostStatus;
  priority: Priority;
  author_id: string;
  created_at: string;
  updated_at?: string;
  tags?: string[];
  reactions?: Record<string, number>;
  comment_count?: number;
  linked_poll?: string | null;
  ready_for_decision?: boolean;
  ready_threshold?: number;
  pinned?: boolean;
  featured?: boolean;
  hidden?: boolean;
  locked?: boolean;
  deleted?: boolean;
  admin_reply?: string;
  admin_notes?: string;
  ai_summary?: string;
  image_url?: string | null;
  merged_into?: string;
  is_mine?: boolean;
  status_history?: StatusHistoryEntry[];
  status_note?: string;
  assigned_to?: string;
  eta?: string;
  progress?: number;
  purge_at?: string;
  star?: { reactions?: Record<string, number> };
  author_name?: string;
}

// ─── Comment ─────────────────────────────────────────

export interface CommentData {
  id: string;
  post_id: string;
  parent_id?: string | null;
  body: string;
  author_id: string;
  is_admin: boolean;
  created_at: string;
  edited?: boolean;
  deleted?: boolean;
  hidden?: boolean;
  is_mine?: boolean;
}

// ─── Poll ────────────────────────────────────────────

export type PollType = 'yesno' | 'single' | 'multi';

export interface PollData {
  id: string;
  title: string;
  ptype: PollType;
  options: string[];
  post_id?: string | null;
  author_id: string;
  expires_at?: string | null;
  archived?: boolean;
  deleted?: boolean;
  total_votes?: number;
  vote_counts?: Record<number, number>;
  is_mine?: boolean;
  created_at?: string;
}

export interface PollVote {
  poll_id: string;
  choices: number[];
}

// ─── Reactions ───────────────────────────────────────

export interface ReactionResponse {
  toggled: boolean;
  counts: Record<string, number>;
  mine: string[];
}

export interface ReactionEntry {
  id?: string;
  target_id: string;
  target_type?: string;
  kind: string;
}

// ─── Notifications ───────────────────────────────────

export type NotificationKind = 'status' | 'reply' | 'comment' | 'chat' | 'poll' | 'info' | 'submitted';

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string;
  at: string;
  read: boolean;
}

// ─── Chat ────────────────────────────────────────────

export type ChatSender = 'admin' | 'student' | 'user' | 'ai';

export interface ChatMessage {
  id?: string;
  sender: ChatSender;
  text?: string;
  body?: string;
  at?: string;
  created_at?: string;
  read: boolean;
  attachment_url?: string;
  [k: string]: unknown;
}

export interface ChatThread {
  thread_id: string;
  messages: ChatMessage[];
  status?: string;
  last_message?: string;
  last_at?: string;
  unread?: number;
  updated_at?: string;
  [k: string]: unknown;
}

// ─── Account / User ──────────────────────────────────

export interface AccountStatus {
  banned: boolean;
  suspended: boolean;
  suspended_until: string | null;
  strikes: number;
  latest_warning?: string | null;
}

// ─── Report ──────────────────────────────────────────

export type ReportTargetType = 'post' | 'comment' | 'poll';

// ─── AI Analysis ─────────────────────────────────────

export interface AiAnalysis {
  toxicity?: number;
  category_suggestion?: string;
  priority_suggestion?: string;
  summary?: string;
  flagged?: boolean;
  reasons?: string[];
}

// ─── Admin Token ─────────────────────────────────────

export interface AdminSession {
  token: string;
  exp: number;
}

// ─── Reaction Meta (for UI) ──────────────────────────

import type { LucideIcon } from 'lucide-react';

export interface ReactionMeta {
  kind: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

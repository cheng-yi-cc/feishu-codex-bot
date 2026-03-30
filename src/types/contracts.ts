export type {
  RuntimeStore,
  TaskArtifactRecord,
  TaskEventRecord,
  TaskRecord,
  WorkspaceState,
} from "../runtime/types.js";

export type IncomingAttachment = {
  type: "image" | "file";
  fileKey: string;
  fileName?: string;
};

export type IncomingMessage = {
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group";
  senderOpenId: string;
  messageType: string;
  text: string;
  mentionedBot: boolean;
  attachments: IncomingAttachment[];
};

export type SessionMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CodexStreamEvent =
  | { type: "thread.started"; threadId: string }
  | { type: "tool.started"; label: string; message: string }
  | { type: "tool.completed"; label: string; message: string }
  | { type: "agent.message"; message: string }
  | { type: "turn.completed"; inputTokens?: number; outputTokens?: number };

export type CodexRunRequest = {
  sessionKey: string;
  prompt: string;
  workdir: string;
  timeoutMs: number;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
  imagePaths?: string[];
  onEvent?: (event: CodexStreamEvent) => void;
  abortSignal?: AbortSignal;
};

export type CodexRunResult = {
  answer: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  threadId?: string;
  durationMs: number;
};

export type SessionOptions = {
  model?: string;
  thinkingLevel?: "low" | "medium" | "high";
};

export interface SessionStore {
  isDuplicate(messageId: string): boolean;
  appendUser(sessionKey: string, content: string): void;
  appendAssistant(sessionKey: string, content: string): void;
  loadRecent(sessionKey: string, turns: number): SessionMessage[];
  getSessionOptions(sessionKey: string): SessionOptions;
  setSessionModel(sessionKey: string, model?: string): void;
  setSessionThinkingLevel(sessionKey: string, thinkingLevel?: "low" | "medium" | "high"): void;
  resetSession(sessionKey: string): void;
}

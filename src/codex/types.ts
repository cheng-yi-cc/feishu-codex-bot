import type { CodexRunRequest, CodexRunResult, CodexStreamEvent, SessionMessage } from "../types/contracts.js";

export type CodexPromptParams = {
  sessionKey: string;
  history: SessionMessage[];
};

export type CodexRunner = {
  run(request: CodexRunRequest): Promise<CodexRunResult>;
};

export type CodexUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type CodexJsonState = {
  answer?: string;
  threadId?: string;
  usage?: CodexUsage;
};

export type CodexJsonItem = {
  type?: string;
  text?: string;
  description?: string;
  name?: string;
};

export type CodexJsonRecord = {
  type?: string;
  thread_id?: string;
  item?: CodexJsonItem;
  usage?: unknown;
};

export type CodexStreamListener = (event: CodexStreamEvent) => void;

export type CodexRunnerOptions = {
  codexBin: string;
  sandboxMode: "danger-full-access";
  defaultWorkdir: string;
  timeoutMs: number;
};

import type { CodexRunRequest, CodexRunResult, SessionMessage } from "../types/contracts.js";

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

export type CodexRunnerOptions = {
  codexBin: string;
  sandboxMode: "danger-full-access";
  defaultWorkdir: string;
  timeoutMs: number;
};

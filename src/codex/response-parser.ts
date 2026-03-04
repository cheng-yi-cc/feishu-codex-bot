import fs from "node:fs";
import path from "node:path";

export type OutgoingDirective = {
  type: "image" | "file";
  path: string;
};

export type ParsedAssistantResponse = {
  text: string;
  directives: OutgoingDirective[];
};

const DIRECTIVE_REGEX = /<send_(image|file)\s+path="([^"]+)"\s*\/>/g;

function toAbsolutePath(rawPath: string, workdir: string): string {
  if (path.isAbsolute(rawPath)) {
    return path.normalize(rawPath);
  }
  return path.resolve(workdir, rawPath);
}

function isPathWithin(baseDir: string, targetPath: string): boolean {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

export function parseAssistantResponse(answer: string, workdir: string): ParsedAssistantResponse {
  const directives: OutgoingDirective[] = [];
  let match: RegExpExecArray | null;

  while ((match = DIRECTIVE_REGEX.exec(answer)) !== null) {
    const kind = match[1];
    const rawPath = match[2];
    const abs = toAbsolutePath(rawPath, workdir);
    if (!isPathWithin(workdir, abs)) {
      continue;
    }
    if (!fs.existsSync(abs)) {
      continue;
    }
    directives.push({
      type: kind === "image" ? "image" : "file",
      path: abs,
    });
  }

  const cleaned = answer.replace(DIRECTIVE_REGEX, "").trim();
  return { text: cleaned, directives };
}

import path from "node:path";

function normalizeForComparison(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function isWithinWorkspaceRoot(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeForComparison(root);
  const normalizedCandidate = normalizeForComparison(candidate);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

export function resolveWorkspacePath(root: string, candidate?: string): string {
  const nextPath = candidate ? path.resolve(root, candidate) : path.resolve(root);
  if (!isWithinWorkspaceRoot(root, nextPath)) {
    throw new Error(`Path ${nextPath} is outside the configured workspace root`);
  }
  return nextPath;
}

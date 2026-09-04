/** Browser-only shim for ephone's unreachable Node.js fallback import. */
export function createRequire(): never {
  throw new Error("Node module loading is unavailable in the speech worker.");
}

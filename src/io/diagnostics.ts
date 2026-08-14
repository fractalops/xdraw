import type {
  Diagnostic,
  DiagnosticCollector,
  DiagnosticNode,
  DiagnosticSeverity,
  SourceLocation,
} from "../foundation-contracts.ts";

function locationOf(node?: DiagnosticNode | null): SourceLocation | null {
  const location = node?.span?.start ?? node?.start ?? null;
  return location ? { ...location, file: node?.sourceFile ?? node?.file } : null;
}

export function formatDiagnostic(item: Diagnostic): string {
  const location = item.location
    ? ` at ${item.location.file ? `${item.location.file}:` : ""}${item.location.line}:${item.location.column}`
    : "";
  return `${item.code}: ${item.message}${location}`;
}

export function createDiagnosticCollector(initial: Diagnostic[] = []): DiagnosticCollector {
  const diagnostics = [...initial];
  const seen = new Set(diagnostics.map((item) => JSON.stringify(item)));
  const add = (
    severity: DiagnosticSeverity,
    code: string,
    message: string,
    node?: DiagnosticNode | null,
  ): Diagnostic => {
    const item = { code, severity, message, location: locationOf(node) };
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push(item);
    }
    return item;
  };
  return {
    diagnostics,
    error: (code, message, node) => add("error", code, message, node),
    warn: (code, message, node) => add("warning", code, message, node),
  };
}

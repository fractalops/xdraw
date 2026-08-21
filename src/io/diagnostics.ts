import type {
  Diagnostic,
  DiagnosticFormat,
  DiagnosticCollector,
  DiagnosticDetails,
  DiagnosticNode,
  DiagnosticSeverity,
  SourceLocation,
} from "../contracts/foundation.ts";

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

/**
 * Renders a whole run, ready to write, or the empty string when there is
 * nothing to report so a caller does not need its own length check.
 *
 * `json` is one object per line rather than an array, which is what rustc does:
 * a consumer can read it incrementally, and a shell can filter it a line at a
 * time. Each line repeats the prose as `rendered`, so a consumer that wants to
 * show a person the message does not have to reimplement the formatting.
 */
export function renderDiagnostics(items: readonly Diagnostic[], format: DiagnosticFormat): string {
  if (!items.length) return "";
  if (format === "text") return `${items.map(formatDiagnostic).join("\n")}\n`;
  return `${items.map((item) => JSON.stringify({ ...item, rendered: formatDiagnostic(item) })).join("\n")}\n`;
}

export function createDiagnosticCollector(initial: Diagnostic[] = []): DiagnosticCollector {
  const diagnostics = [...initial];
  const seen = new Set(diagnostics.map((item) => JSON.stringify(item)));
  const add = (
    severity: DiagnosticSeverity,
    code: string,
    message: string,
    node?: DiagnosticNode | null,
    details?: DiagnosticDetails,
  ): Diagnostic => {
    // Undefined details are omitted rather than stored as undefined, so the
    // dedupe key below stays the same shape for a code that supplies none.
    const item: Diagnostic = {
      code,
      severity,
      message,
      location: locationOf(node),
      ...(details?.subjects ? { subjects: details.subjects } : {}),
      ...(details?.measures ? { measures: details.measures } : {}),
      ...(details?.suggestion !== undefined ? { suggestion: details.suggestion } : {}),
    };
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push(item);
    }
    return item;
  };
  return {
    diagnostics,
    error: (code, message, node, details) => add("error", code, message, node, details),
    warn: (code, message, node, details) => add("warning", code, message, node, details),
    remark: (code, message, node, details) => add("remark", code, message, node, details),
  };
}

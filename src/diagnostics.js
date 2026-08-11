/** @param {import("./contracts.js").DiagnosticNode | null | undefined} node */
function locationOf(node) {
  const location = node?.span?.start ?? node?.start ?? null;
  return location ? { ...location, file: node?.sourceFile ?? node?.file } : null;
}

/** @param {import("./contracts.js").Diagnostic} item */
export function formatDiagnostic(item) {
  const location = item.location
    ? ` at ${item.location.file ? `${item.location.file}:` : ""}${item.location.line}:${item.location.column}`
    : "";
  return `${item.code}: ${item.message}${location}`;
}

/** @param {import("./contracts.js").Diagnostic[]} [initial] */
export function createDiagnosticCollector(initial = []) {
  const diagnostics = [...initial];
  const seen = new Set(diagnostics.map((item) => JSON.stringify(item)));
  /**
   * @param {import("./contracts.js").DiagnosticSeverity} severity
   * @param {string} code
   * @param {string} message
   * @param {import("./contracts.js").DiagnosticNode | null | undefined} node
   */
  const add = (severity, code, message, node) => {
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
    /** @param {string} code @param {string} message @param {import("./contracts.js").DiagnosticNode} [node] */
    error: (code, message, node) => add("error", code, message, node),
    /** @param {string} code @param {string} message @param {import("./contracts.js").DiagnosticNode} [node] */
    warn: (code, message, node) => add("warning", code, message, node),
  };
}

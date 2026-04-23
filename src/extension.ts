import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("JSON Studio");
  output.appendLine(`[activate] JSON Studio activated at ${new Date().toISOString()}`);

  const helloDisposable = vscode.commands.registerCommand("jsonStudio.helloWorld", async () => {
    output.show(true);
    output.appendLine(`[command] jsonStudio.helloWorld invoked at ${new Date().toISOString()}`);
    await vscode.window.showInformationMessage("JSON Studio: Hello World (extension is running).");
  });

  const openInStudioDisposable = vscode.commands.registerCommand(
    "jsonStudio.openInStudio",
    async (uri?: vscode.Uri) => {
      const targetUri =
        uri ??
        vscode.window.activeTextEditor?.document.uri ??
        (await pickJsonFileUri());

      if (!targetUri) return;

      const info = await getFileInfo(targetUri);
      output.appendLine(`[studio] Open ${targetUri.toString()} (${info.sizeBytes} bytes)`);

      const { schemaText, parseError } = await getJsonSchemaText(targetUri);

      const panel = vscode.window.createWebviewPanel(
        "jsonStudio.studio",
        `JSON Studio: ${info.baseName}`,
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        { enableScripts: false }
      );

      panel.webview.html = renderStudioHtml(info, { schemaText, parseError });
    }
  );

  context.subscriptions.push(output, helloDisposable, openInStudioDisposable);
}

export function deactivate() {}

async function pickJsonFileUri(): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Open JSON in Studio",
    filters: { JSON: ["json"] }
  });
  return picked?.[0];
}

type FileInfo = {
  uri: vscode.Uri;
  baseName: string;
  sizeBytes: number;
  createdAt?: Date;
  modifiedAt?: Date;
};

async function getFileInfo(uri: vscode.Uri): Promise<FileInfo> {
  const baseName = path.basename(uri.fsPath || uri.path);

  // Prefer Node stats (gives birthtime on local disk), but gracefully fallback.
  try {
    if (uri.scheme === "file" && uri.fsPath) {
      const stat = await fs.stat(uri.fsPath);
      return {
        uri,
        baseName,
        sizeBytes: stat.size,
        createdAt: isValidDate(stat.birthtime) ? stat.birthtime : undefined,
        modifiedAt: isValidDate(stat.mtime) ? stat.mtime : undefined
      };
    }
  } catch {
    // fall through
  }

  const stat = await vscode.workspace.fs.stat(uri);
  return {
    uri,
    baseName,
    sizeBytes: stat.size,
    // VS Code FileStat does not expose birthtime; ctime is "change time".
    createdAt: stat.ctime ? new Date(stat.ctime) : undefined,
    modifiedAt: stat.mtime ? new Date(stat.mtime) : undefined
  };
}

function isValidDate(d: Date): boolean {
  return Number.isFinite(d.getTime());
}

function fmtDate(d?: Date): string {
  if (!d) return "—";
  return d.toLocaleString();
}

type StudioJsonState = {
  schemaText?: string;
  parseError?: string;
};

function renderStudioHtml(info: FileInfo, jsonState: StudioJsonState): string {
  const title = escapeHtml(info.baseName);
  const fullPath = escapeHtml(info.uri.fsPath || info.uri.toString());
  const createdAt = escapeHtml(fmtDate(info.createdAt));
  const modifiedAt = escapeHtml(fmtDate(info.modifiedAt));
  const sizeBytes = escapeHtml(info.sizeBytes.toLocaleString());
  const schemaText = escapeHtml(jsonState.schemaText ?? "");
  const parseError = jsonState.parseError ? escapeHtml(jsonState.parseError) : "";
  const schemaTableHtml =
    !parseError && jsonState.schemaText ? renderSchemaTableFromText(jsonState.schemaText) : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif; padding: 16px; }
      h1 { font-size: 16px; margin: 0 0 12px; }
      h2 { font-size: 13px; margin: 16px 0 8px; opacity: 0.9; }
      .card { border: 1px solid rgba(127,127,127,0.35); border-radius: 10px; padding: 12px; }
      .row { display: grid; grid-template-columns: 140px 1fr; gap: 8px; padding: 6px 0; }
      .k { opacity: 0.75; }
      .error { color: #b00020; }
      pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(127,127,127,0.25); vertical-align: top; }
      th { position: sticky; top: 0; background: var(--vscode-editor-background, #fff); z-index: 1; }
      .muted { opacity: 0.7; }
      .pill { display: inline-block; font-size: 11px; padding: 2px 6px; border-radius: 999px; border: 1px solid rgba(127,127,127,0.35); }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    </style>
  </head>
  <body>
    <h1>JSON Studio</h1>
    <div class="card">
      <div class="row"><div class="k">File</div><div><code>${title}</code></div></div>
      <div class="row"><div class="k">Path</div><div><code>${fullPath}</code></div></div>
      <div class="row"><div class="k">Size</div><div><code>${sizeBytes} bytes</code></div></div>
      <div class="row"><div class="k">Created</div><div><code>${createdAt}</code></div></div>
      <div class="row"><div class="k">Modified</div><div><code>${modifiedAt}</code></div></div>
    </div>

    <h2>Schema</h2>
    <div class="card">
      ${
        parseError
          ? `<div class="error"><code>Could not parse JSON: ${parseError}</code></div>`
          : schemaTableHtml ||
            `<div class="muted"><code>(No schema)</code></div><pre><code>${schemaText}</code></pre>`
      }
    </div>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type SchemaRow = {
  path: string;
  type: string;
  required: boolean;
  note?: string;
};

function renderSchemaTableFromText(schemaText: string): string {
  try {
    const schema = JSON.parse(schemaText) as unknown;
    if (!schema || typeof schema !== "object") return "";

    const rows = schemaToRows(schema as Record<string, unknown>);
    if (rows.length === 0) return "";

    const header = `<table>
  <thead>
    <tr>
      <th>Path</th>
      <th>Type</th>
      <th>Required</th>
      <th>Notes</th>
    </tr>
  </thead>
  <tbody>`;

    const body = rows
      .map((r) => {
        const req = r.required ? `<span class="pill">yes</span>` : `<span class="pill muted">no</span>`;
        const note = r.note ? `<code>${escapeHtml(r.note)}</code>` : `<span class="muted">—</span>`;
        return `<tr>
  <td><code>${escapeHtml(r.path)}</code></td>
  <td><code>${escapeHtml(r.type)}</code></td>
  <td>${req}</td>
  <td>${note}</td>
</tr>`;
      })
      .join("");

    return `${header}${body}</tbody></table>`;
  } catch {
    return "";
  }
}

function schemaToRows(schema: Record<string, unknown>): SchemaRow[] {
  const rows: SchemaRow[] = [];
  walkSchema(schema, "$", true, rows);
  return rows;
}

function walkSchema(
  schema: Record<string, unknown>,
  atPath: string,
  required: boolean,
  out: SchemaRow[]
): void {
  const type = schemaTypeString(schema);
  const note = schemaNote(schema);
  out.push({ path: atPath, type, required, note });

  const schemaType = schema.type;
  if (schemaType === "object") {
    const props = schema.properties;
    if (!props || typeof props !== "object") return;
    const requiredList = new Set(
      Array.isArray(schema.required) ? schema.required.filter((s) => typeof s === "string") : []
    );
    for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      walkSchema(v as Record<string, unknown>, `${atPath}.${k}`, requiredList.has(k), out);
    }
    return;
  }

  if (schemaType === "array") {
    const items = schema.items;
    if (items && typeof items === "object") {
      walkSchema(items as Record<string, unknown>, `${atPath}[]`, true, out);
    }
  }
}

function schemaTypeString(schema: Record<string, unknown>): string {
  const t = schema.type;
  if (typeof t === "string") return t;
  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf)) {
    const types = anyOf
      .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>).type : undefined))
      .filter((x): x is string => typeof x === "string");
    if (types.length > 0) return types.join(" | ");
    return "anyOf";
  }
  return "unknown";
}

function schemaNote(schema: Record<string, unknown>): string | undefined {
  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf) && anyOf.length > 1) return `anyOf(${anyOf.length})`;
  if (schema.type === "array") {
    const items = schema.items;
    if (items && typeof items === "object") return `items: ${schemaTypeString(items as Record<string, unknown>)}`;
    return "items: unknown";
  }
  return undefined;
}

async function getJsonSchemaText(
  uri: vscode.Uri
): Promise<{ schemaText?: string; parseError?: string }> {
  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder("utf-8").decode(raw);
    const json = JSON.parse(text) as unknown;
    const schema = inferJsonSchema(json, 0);
    const withMeta =
      schema && typeof schema === "object"
        ? { $schema: "https://json-schema.org/draft/2020-12/schema", ...schema }
        : { $schema: "https://json-schema.org/draft/2020-12/schema" };
    return { schemaText: JSON.stringify(withMeta, null, 2) };
  } catch (e) {
    return { parseError: e instanceof Error ? e.message : String(e) };
  }
}

type JsonSchema = Record<string, unknown>;

function inferJsonSchema(value: unknown, depth: number): JsonSchema {
  // Keep this simple and safe for arbitrarily large JSON.
  const MAX_DEPTH = 12;
  if (depth > MAX_DEPTH) return {};

  if (value === null) return { type: "null" };

  switch (typeof value) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: Number.isInteger(value) ? "integer" : "number" };
    case "boolean":
      return { type: "boolean" };
    case "object": {
      if (Array.isArray(value)) {
        const itemsSchemas = value.map((v) => inferJsonSchema(v, depth + 1));
        const items = mergeSchemas(itemsSchemas);
        return { type: "array", items };
      }

      const obj = value as Record<string, unknown>;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const [k, v] of Object.entries(obj)) {
        properties[k] = inferJsonSchema(v, depth + 1);
        required.push(k);
      }

      const schema: JsonSchema = {
        type: "object",
        properties
      };

      if (required.length > 0) schema.required = required;
      return schema;
    }
    default:
      return {};
  }
}

function mergeSchemas(schemas: JsonSchema[]): JsonSchema {
  const cleaned = schemas.filter((s) => Object.keys(s).length > 0);
  if (cleaned.length === 0) return {};
  if (cleaned.length === 1) return cleaned[0]!;

  const uniqueJson = new Map<string, JsonSchema>();
  for (const s of cleaned) uniqueJson.set(JSON.stringify(s), s);
  const unique = Array.from(uniqueJson.values());

  if (unique.length === 1) return unique[0]!;
  return { anyOf: unique };
}


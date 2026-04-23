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

      const { schemaText, jsonData, parseError } = await getJsonSchemaText(targetUri);

      const panel = vscode.window.createWebviewPanel(
        "jsonStudio.studio",
        `JSON Studio: ${info.baseName}`,
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        { enableScripts: true }
      );

      panel.webview.html = renderStudioHtml(info, { schemaText, jsonData, parseError });
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
  jsonData?: unknown;
  parseError?: string;
};

function renderStudioHtml(info: FileInfo, jsonState: StudioJsonState): string {
  const title = escapeHtml(info.baseName);
  const fullPath = escapeHtml(info.uri.fsPath || info.uri.toString());
  const createdAt = escapeHtml(fmtDate(info.createdAt));
  const modifiedAt = escapeHtml(fmtDate(info.modifiedAt));
  const sizeBytes = escapeHtml(info.sizeBytes.toLocaleString());
  const parseError = jsonState.parseError ? escapeHtml(jsonState.parseError) : "";

  // Prepare data for JS
  const jsonDataStr = jsonState.jsonData ? JSON.stringify(jsonState.jsonData) : 'null';
  const schemaStr = jsonState.schemaText ? JSON.stringify(JSON.parse(jsonState.schemaText)) : 'null';

  const dataTreeHtml = jsonState.jsonData ? renderDataTable(jsonState.jsonData, '$') : '<div class="muted">No data</div>';
  const schemaTreeHtml = jsonState.schemaText ? renderSchemaTableFromText(jsonState.schemaText) : '<div class="muted">No schema</div>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        margin: 0;
        padding: 0;
        background: var(--vscode-editor-background, #ffffff);
        color: var(--vscode-editor-foreground, #000000);
        height: 100vh;
        overflow: hidden;
      }
      .header {
        padding: 16px;
        border-bottom: 1px solid var(--vscode-panel-border, #cccccc);
        background: var(--vscode-titleBar-activeBackground, #f3f3f3);
      }
      .header h1 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }
      .tabs {
        display: flex;
        margin-top: 12px;
      }
      .tab {
        padding: 8px 16px;
        cursor: pointer;
        border-radius: 4px;
        background: transparent;
        border: none;
        color: var(--vscode-foreground, #000000);
      }
      .tab.active {
        background: var(--vscode-tab-activeBackground, #ffffff);
        border: 1px solid var(--vscode-tab-border, #cccccc);
      }
      .search {
        margin-top: 12px;
        display: flex;
        gap: 8px;
      }
      .search input {
        flex: 1;
        padding: 6px 12px;
        border: 1px solid var(--vscode-input-border, #cccccc);
        border-radius: 4px;
        background: var(--vscode-input-background, #ffffff);
        color: var(--vscode-input-foreground, #000000);
      }
      .search button {
        padding: 6px 12px;
        border: 1px solid var(--vscode-button-border, #cccccc);
        border-radius: 4px;
        background: var(--vscode-button-background, #ffffff);
        color: var(--vscode-button-foreground, #000000);
        cursor: pointer;
      }
      .main {
        display: flex;
        height: calc(100vh - 120px);
      }
      .tree-panel {
        flex: 1;
        padding: 16px;
        overflow-y: auto;
        border-right: 1px solid var(--vscode-panel-border, #cccccc);
      }
      .details-panel {
        flex: 1;
        padding: 16px;
        overflow-y: auto;
        background: var(--vscode-editor-background, #ffffff);
      }
      .card { border: 1px solid var(--vscode-panel-border, #cccccc); border-radius: 4px; padding: 12px; margin-bottom: 16px; }
      .row { display: grid; grid-template-columns: 140px 1fr; gap: 8px; padding: 6px 0; }
      .k { opacity: 0.75; }
      .tree {
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        font-size: 13px;
        line-height: 1.4;
      }
      .tree-item {
        margin-left: 16px;
      }
      .tree-key {
        color: var(--vscode-symbolIcon-methodForeground, #6c6cc4);
        font-weight: 500;
      }
      .tree-value {
        color: var(--vscode-foreground, #000000);
      }
      .tree-type {
        color: var(--vscode-descriptionForeground, #6c6c80);
        font-size: 11px;
        margin-left: 4px;
      }
      .tree-toggle {
        cursor: pointer;
        margin-right: 4px;
        color: var(--vscode-foreground, #000000);
      }
      .tree-toggle::before {
        content: '▼';
      }
      .tree-collapsed .tree-toggle::before {
        content: '▶';
      }
      .tree-collapsed .tree-children {
        display: none;
      }
      .icon {
        margin-right: 4px;
        font-size: 12px;
      }
      .icon-string { color: #ce9178; }
      .icon-number { color: #b5cea8; }
      .icon-boolean { color: #569cd6; }
      .icon-null { color: #569cd6; }
      .icon-object { color: #dcdcaa; }
      .icon-array { color: #c586c0; }
      .required { font-weight: bold; }
      .required::after { content: '*'; color: #f44747; }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      th, td {
        border: 1px solid var(--vscode-panel-border, #cccccc);
        padding: 8px;
        text-align: left;
      }
      th {
        background: var(--vscode-titleBar-activeBackground, #f3f3f3);
        font-weight: 600;
      }
      .pill {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 500;
        background: var(--vscode-charts-green, #4caf50);
        color: white;
      }
      .pill.muted {
        background: var(--vscode-disabledForeground, #cccccc);
        color: var(--vscode-foreground, #000000);
      }
      .error {
        color: #f44747;
        padding: 16px;
      }
      .hidden { display: none; }
      .copy-btn {
        margin-left: 8px;
        padding: 2px 6px;
        font-size: 10px;
        border: 1px solid var(--vscode-button-border, #cccccc);
        border-radius: 3px;
        background: var(--vscode-button-background, #ffffff);
        color: var(--vscode-button-foreground, #000000);
        cursor: pointer;
      }
      .expand-all, .collapse-all {
        margin-left: 8px;
        padding: 4px 8px;
        font-size: 11px;
        border: 1px solid var(--vscode-button-border, #cccccc);
        border-radius: 3px;
        background: var(--vscode-button-background, #ffffff);
        color: var(--vscode-button-foreground, #000000);
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <h1>JSON Studio: ${title}</h1>
      <div class="tabs">
        <button class="tab active" onclick="showTab('schema')">Schema</button>
        <button class="tab" onclick="showTab('data')">Data Explorer</button>
        <button class="tab" onclick="showTab('info')">Info</button>
      </div>
      <div class="search">
        <input type="text" id="search" placeholder="Search..." oninput="filterTree()">
        <button onclick="expandAll()">Expand All</button>
        <button onclick="collapseAll()">Collapse All</button>
      </div>
    </div>
    <div class="main">
      <div class="tree-panel">
        <div id="schema-tab" class="tab-content">
          ${parseError ? `<div class="error">Could not parse JSON: ${parseError}</div>` : schemaTreeHtml}
        </div>
        <div id="data-tab" class="tab-content hidden">
          ${parseError ? `<div class="error">Could not parse JSON: ${parseError}</div>` : dataTreeHtml}
        </div>
        <div id="info-tab" class="tab-content hidden">
          <div class="card">
            <div class="row"><div class="k">File</div><div><code>${title}</code></div></div>
            <div class="row"><div class="k">Path</div><div><code>${fullPath}</code></div></div>
            <div class="row"><div class="k">Size</div><div><code>${sizeBytes} bytes</code></div></div>
            <div class="row"><div class="k">Created</div><div><code>${createdAt}</code></div></div>
            <div class="row"><div class="k">Modified</div><div><code>${modifiedAt}</code></div></div>
          </div>
        </div>
      </div>
      <div class="details-panel">
        <div id="details">Select an item to view details</div>
      </div>
    </div>
    <script>
      const jsonData = ${jsonDataStr};
      const schemaData = ${schemaStr};
      let currentTab = 'schema';

      function showTab(tab) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        document.querySelector(\`button[onclick="showTab('\${tab}')"]\`).classList.add('active');
        document.getElementById(\`\${tab}-tab\`).classList.remove('hidden');
        currentTab = tab;
        filterTree();
      }

      function filterTree() {
        const query = document.getElementById('search').value.toLowerCase();
        const items = document.querySelectorAll('.tree-item');
        items.forEach(item => {
          const text = item.textContent.toLowerCase();
          item.style.display = text.includes(query) ? '' : 'none';
        });
      }

      function toggleTree(el) {
        el.parentElement.classList.toggle('tree-collapsed');
      }

      function selectItem(path, type, value, required) {
        const details = document.getElementById('details');
        details.innerHTML = \`
          <h3>Details</h3>
          <div><strong>Path:</strong> <code>\${path}</code> <button class="copy-btn" onclick="copyToClipboard('\${path}')">Copy</button></div>
          <div><strong>Type:</strong> \${type}</div>
          <div><strong>Required:</strong> \${required ? 'Yes' : 'No'}</div>
          <div><strong>Value:</strong> <pre>\${JSON.stringify(value, null, 2)}</pre></div>
        \`;
      }

      function copyToClipboard(text) {
        navigator.clipboard.writeText(text);
      }

      function expandAll() {
        document.querySelectorAll('.tree-collapsed').forEach(el => el.classList.remove('tree-collapsed'));
      }

      function collapseAll() {
        document.querySelectorAll('.tree-item:has(.tree-children)').forEach(el => el.classList.add('tree-collapsed'));
      }

      // Initialize
      showTab('schema');
    </script>
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

function renderJsonTree(value: unknown, path: string, depth = 0): string {
  const type = getType(value);
  const icon = getTypeIcon(type);
  const displayValue = getDisplayValue(value, type);
  const hasChildren = type === 'object' || type === 'array';

  let html = `<div class="tree-item${depth > 0 ? ' tree-collapsed' : ''}" data-path="${escapeHtml(path)}" onclick="selectItem('${escapeHtml(path)}', '${type}', ${JSON.stringify(value)}, false)">`;

  if (hasChildren) {
    html += `<span class="tree-toggle" onclick="toggleTree(this)">▶</span>`;
  } else {
    html += `<span style="margin-left: 16px;"></span>`;
  }

  html += `<span class="icon ${icon}">${getTypeSymbol(type)}</span>`;

  if (path !== '$') {
    const lastPart = path.split('.').pop() || '';
    const isArray = lastPart.includes('[');
    const displayKey = isArray ? lastPart : `"${escapeHtml(lastPart)}"`;
    html += `<span class="tree-key">${displayKey}: </span>`;
  }

  html += `<span class="tree-value">${displayValue}</span>`;
  html += `<span class="tree-type">${type}</span>`;

  if (hasChildren) {
    html += `<div class="tree-children">`;
    if (type === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        html += renderJsonTree(v, `${path}.${k}`, depth + 1);
      }
    } else if (type === 'array') {
      (value as unknown[]).forEach((v, i) => {
        html += renderJsonTree(v, `${path}[${i}]`, depth + 1);
      });
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function renderSchemaTree(schema: Record<string, unknown>, path: string, required = false, depth = 0): string {
  const type = schemaTypeString(schema);
  const icon = getTypeIcon(type);
  const hasChildren = type === 'object' || type === 'array';

  let html = `<div class="tree-item ${required ? 'required' : ''}${depth > 0 ? ' tree-collapsed' : ''}" data-path="${escapeHtml(path)}" onclick="selectItem('${escapeHtml(path)}', '${type}', ${JSON.stringify(schema)}, ${required})">`;

  if (hasChildren) {
    html += `<span class="tree-toggle" onclick="toggleTree(this)">▶</span>`;
  } else {
    html += `<span style="margin-left: 16px;"></span>`;
  }

  html += `<span class="icon ${icon}">${getTypeSymbol(type)}</span>`;

  if (path !== '$') {
    const lastPart = path.split('.').pop() || '';
    const isArray = lastPart.includes('[');
    const displayKey = isArray ? lastPart : `"${escapeHtml(lastPart)}"`;
    html += `<span class="tree-key">${displayKey}: </span>`;
  }

  html += `<span class="tree-value">${type}</span>`;

  if (hasChildren) {
    html += `<div class="tree-children">`;
    if (type === 'object') {
      const props = schema.properties as Record<string, unknown> | undefined;
      const requiredList = new Set((schema.required as string[]) || []);
      if (props) {
        for (const [k, v] of Object.entries(props)) {
          html += renderSchemaTree(v as Record<string, unknown>, `${path}.${k}`, requiredList.has(k), depth + 1);
        }
      }
    } else if (type === 'array') {
      const items = schema.items as Record<string, unknown> | undefined;
      if (items) {
        html += renderSchemaTree(items, `${path}[]`, true, depth + 1);
      }
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function getType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function getTypeIcon(type: string): string {
  return `icon-${type}`;
}

function getTypeSymbol(type: string): string {
  switch (type) {
    case 'string': return '"';
    case 'number': return '#';
    case 'boolean': return '□';
    case 'null': return '∅';
    case 'object': return '{}';
    case 'array': return '[]';
    default: return '?';
  }
}

function getDisplayValue(value: unknown, type: string): string {
  if (type === 'string') return `"${escapeHtml(String(value))}"`;
  if (type === 'null') return 'null';
  if (type === 'object' || type === 'array') return type === 'object' ? '{' : '[';
  return String(value);
}

type SchemaRow = {
  path: string;
  type: string;
  required: boolean;
  note?: string;
};

function renderDataTable(data: unknown, rootPath: string): string {
  // Special case: if data is an array of objects, show as table
  if (Array.isArray(data) && data.length > 0 && data.every(item => typeof item === 'object' && item !== null)) {
    const properties = new Set<string>();
    data.forEach(item => {
      Object.keys(item as Record<string, unknown>).forEach(key => properties.add(key));
    });
    const propArray = Array.from(properties);

    const header = `<table><thead><tr>${propArray.map(p => `<th>${escapeHtml(p)}</th>`).join('')}</tr></thead><tbody>`;
    const body = data.map(item => {
      const row = propArray.map(p => {
        const value = (item as Record<string, unknown>)[p];
        const str = value === undefined ? '' : JSON.stringify(value);
        return `<td>${escapeHtml(str)}</td>`;
      }).join('');
      return `<tr>${row}</tr>`;
    }).join('');
    return `${header}${body}</tbody></table>`;
  }

  // Special case: if data is a single object, show as single-row table
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const properties = Object.keys(data as Record<string, unknown>);
    const header = `<table><thead><tr>${properties.map(p => `<th>${escapeHtml(p)}</th>`).join('')}</tr></thead><tbody>`;
    const row = properties.map(p => {
      const value = (data as Record<string, unknown>)[p];
      const str = JSON.stringify(value);
      return `<td>${escapeHtml(str)}</td>`;
    }).join('');
    return `${header}<tr>${row}</tr></tbody></table>`;
  }

  // Fallback: flatten structure
  const rows = dataToRows(data, rootPath);
  if (rows.length === 0) return "";

  const header = `<table>
  <thead>
    <tr>
      <th>Path</th>
      <th>Type</th>
      <th>Value</th>
    </tr>
  </thead>
  <tbody>`;

  const body = rows
    .map((r) => {
      const value = r.value.length > 100 ? `${r.value.substring(0, 100)}...` : r.value;
      return `<tr>
  <td><code>${escapeHtml(r.path)}</code></td>
  <td><code>${escapeHtml(r.type)}</code></td>
  <td><code>${escapeHtml(value)}</code></td>
</tr>`;
    })
    .join("");

  return `${header}${body}</tbody></table>`;
}

type DataRow = {
  path: string;
  type: string;
  value: string;
};

function dataToRows(data: unknown, rootPath: string): DataRow[] {
  const rows: DataRow[] = [];
  walkData(data, rootPath, rows);
  return rows;
}

function walkData(data: unknown, atPath: string, out: DataRow[]): void {
  const type = getType(data);
  const value = JSON.stringify(data);
  out.push({ path: atPath, type, value });

  if (type === 'object' && data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      walkData(v, `${atPath}.${k}`, out);
    }
  } else if (type === 'array' && Array.isArray(data)) {
    data.forEach((v, i) => {
      walkData(v, `${atPath}[${i}]`, out);
    });
  }
}

function renderSchemaTableFromText(schemaText: string): string {
  try {
    const schema = JSON.parse(schemaText) as Record<string, unknown>;
    if (!schema || typeof schema !== "object") return "";

    // Special case: if it's an array of objects, show the property names as table headers
    if (schema.type === "array" && typeof schema.items === "object" && schema.items !== null) {
      const items = schema.items as Record<string, unknown>;
      if (items.type === "object" && typeof items.properties === "object" && items.properties !== null) {
        const properties = Object.keys(items.properties as Record<string, unknown>);
        const headerCells = properties.map(p => `<th>${escapeHtml(p)}</th>`).join('');
        return `<table><thead><tr>${headerCells}</tr></thead><tbody></tbody></table>`;
      }
    }

    // Special case: if it's a single object, show the property names as table headers
    if (schema.type === "object" && typeof schema.properties === "object" && schema.properties !== null) {
      const properties = Object.keys(schema.properties as Record<string, unknown>);
      const headerCells = properties.map(p => `<th>${escapeHtml(p)}</th>`).join('');
      return `<table><thead><tr>${headerCells}</tr></thead><tbody></tbody></table>`;
    }

    // Fallback to detailed table
    const rows = schemaToRows(schema);
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
): Promise<{ schemaText?: string; jsonData?: unknown; parseError?: string }> {
  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder("utf-8").decode(raw);
    const json = JSON.parse(text) as unknown;
    const schema = inferJsonSchema(json, 0);
    const withMeta =
      schema && typeof schema === "object"
        ? { $schema: "https://json-schema.org/draft/2020-12/schema", ...schema }
        : { $schema: "https://json-schema.org/draft/2020-12/schema" };
    return { schemaText: JSON.stringify(withMeta, null, 2), jsonData: json };
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


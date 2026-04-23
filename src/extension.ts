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

      const panel = vscode.window.createWebviewPanel(
        "jsonStudio.studio",
        `JSON Studio: ${info.baseName}`,
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        { enableScripts: false }
      );

      panel.webview.html = renderStudioHtml(info);
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

function renderStudioHtml(info: FileInfo): string {
  const title = escapeHtml(info.baseName);
  const fullPath = escapeHtml(info.uri.fsPath || info.uri.toString());
  const createdAt = escapeHtml(fmtDate(info.createdAt));
  const modifiedAt = escapeHtml(fmtDate(info.modifiedAt));
  const sizeBytes = escapeHtml(info.sizeBytes.toLocaleString());

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif; padding: 16px; }
      h1 { font-size: 16px; margin: 0 0 12px; }
      .card { border: 1px solid rgba(127,127,127,0.35); border-radius: 10px; padding: 12px; }
      .row { display: grid; grid-template-columns: 140px 1fr; gap: 8px; padding: 6px 0; }
      .k { opacity: 0.75; }
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


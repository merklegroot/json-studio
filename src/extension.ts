import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("JSON Studio");
  output.appendLine(`[activate] JSON Studio activated at ${new Date().toISOString()}`);

  const disposable = vscode.commands.registerCommand("jsonStudio.helloWorld", async () => {
    output.show(true);
    output.appendLine(`[command] jsonStudio.helloWorld invoked at ${new Date().toISOString()}`);
    await vscode.window.showInformationMessage("JSON Studio: Hello World (extension is running).");
  });

  context.subscriptions.push(output, disposable);
}

export function deactivate() {}


const vscode = require('vscode');
const path = require('node:path');

exports.activate = async function(context) {
  const { analyze, readWorkspace } = await import('./core.mjs');
  const changed = new vscode.EventEmitter(), diagnostics = vscode.languages.createDiagnosticCollection('e365');
  let indexes = [], generation = 0, timer;
  const uri = (index, relative) => vscode.Uri.file(path.join(index.root, relative));
  const location = async (index, file, token, offset) => {
    const doc = await vscode.workspace.openTextDocument(uri(index, file));
    const at = offset ?? Math.max(0, doc.getText().indexOf(JSON.stringify(token)) + 1);
    return new vscode.Location(doc.uri, new vscode.Range(doc.positionAt(at), doc.positionAt(at + (token?.length || 1))));
  };
  async function refresh() {
    const current = ++generation, next = [];
    try {
      for (const folder of vscode.workspace.workspaceFolders || []) {
        if (folder.uri.scheme !== 'file') continue;
        const files = await readWorkspace(folder.uri.fsPath);
        next.push({ root: folder.uri.fsPath, name: folder.name, files, ...analyze(files) });
      }
      if (current !== generation) return;
      indexes = next; diagnostics.clear();
      for (const index of indexes) {
        const byPath = new Map();
        for (const d of index.diagnostics) {
          const loc = await location(index, d.path, d.token || '');
          const item = new vscode.Diagnostic(loc.range, d.message, d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
          item.source = 'E365';
          if (!byPath.has(d.path)) byPath.set(d.path, []);
          byPath.get(d.path).push(item);
        }
        for (const [file, rows] of byPath) diagnostics.set(uri(index, file), rows);
      }
      changed.fire();
    } catch (error) { vscode.window.showErrorMessage(`E365: ${error.message}`); }
  }
  const provider = {
    onDidChangeTreeData: changed.event,
    getTreeItem(node) {
      const item = new vscode.TreeItem(node.label, node.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      if (node.file) { item.resourceUri = uri(node.index, node.file); item.command = { command: 'vscode.open', title: 'Открыть исходник', arguments: [item.resourceUri] }; }
      if (node.description) item.description = node.description;
      return item;
    },
    getChildren(node) {
      if (node) return node.children || [];
      return indexes.map(index => ({ label: index.name, children: ['appViews', 'widgets', 'processor'].map(service => ({ label: service, children: [...new Set(index.entities.filter(e => e.service === service).map(e => e.namespace))].sort().map(namespace => ({ label: namespace, children: index.entities.filter(e => e.service === service && e.namespace === namespace).map(e => ({ label: e.code, file: e.path, index, children: [
        ...e.fields.map(f => ({ label: f.code, description: f.type, file: e.path, index })),
        ...index.files.filter(f => f.path === `${e.path}.client.ts` || f.path === `${e.path}.server.ts`).map(f => ({ label: path.basename(f.path), file: f.path, index }))
      ] })) })) })) }));
    }
  };
  const select = document => indexes.find(i => document.uri.fsPath.startsWith(i.root + path.sep));
  function target(document, position) {
    const index = select(document); if (!index) return null;
    const file = path.relative(index.root, document.uri.fsPath).replace(/\\/g, '/');
    const range = document.getWordRangeAtPosition(position, /[A-Za-z_$][\w$]*/), field = range && document.getText(range);
    if (!field) return null;
    const owners = [...new Set(index.usages.filter(u => u.path === file && u.field === field && u.owner).map(u => u.owner))];
    const direct = index.entities.find(e => e.path === file && e.fields.some(f => f.code === field));
    // Ambiguous occurrences are deliberately left unresolved.
    if (direct) owners.push(direct.path);
    const unique = [...new Set(owners)];
    return unique.length === 1 ? { index, owner: unique[0], field } : null;
  }
  const selector = [{ scheme: 'file', language: 'json' }, { scheme: 'file', language: 'typescript' }, { scheme: 'file', language: 'plaintext' }];
  const references = async target => Promise.all(target.index.usages.filter(u => u.owner === target.owner && u.field === target.field).map(u => location(target.index, u.path, u.field, u.offset == null ? undefined : u.offset + `${u.context}.data.`.length)));
  context.subscriptions.push(changed, diagnostics,
    vscode.window.registerTreeDataProvider('e365.entities', provider),
    vscode.commands.registerCommand('e365.refresh', refresh),
    vscode.languages.registerDefinitionProvider(selector, { async provideDefinition(document, position) {
      const t = target(document, position); return t ? location(t.index, t.owner, t.field) : undefined;
    } }),
    vscode.languages.registerReferenceProvider(selector, { async provideReferences(document, position, options) {
      const t = target(document, position); if (!t) return [];
      const rows = await references(t);
      if (options.includeDeclaration) rows.unshift(await location(t.index, t.owner, t.field));
      return rows;
    } }),
    vscode.commands.registerCommand('e365.references', async () => {
      const editor = vscode.window.activeTextEditor;
      const t = editor && target(editor.document, editor.selection.active);
      if (!t) return vscode.window.showInformationMessage('Выберите код поля или однозначную привязку в форме/скрипте.');
      await vscode.commands.executeCommand('editor.action.showReferences', editor.document.uri, editor.selection.active, await references(t));
    }),
    vscode.commands.registerCommand('e365.verify', async () => {
      if (!vscode.workspace.isTrusted) return;
      const choices = await vscode.window.showOpenDialog({ canSelectFolders: false, canSelectFiles: true, canSelectMany: false, title: 'Выберите установленный bin/elma-dev.mjs' });
      if (!choices?.length) return;
      const folders = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, title: 'Выберите корень экспорта с widgets/entities' });
      if (!folders?.length) return;
      const host = await vscode.window.showInputBox({ title: 'Адрес сервера, для которого сохранён кеш типов (offline)', prompt: 'Адрес используется как ключ кеша. Эта команда не получает типы из сети.', validateInput(value) { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? undefined : 'Нужен HTTP(S) URL без credentials'; } catch { return 'Нужен HTTP(S) URL'; } } });
      if (!host) return;
      const task = new vscode.Task({ type: 'e365', task: 'verify' }, vscode.TaskScope.Workspace, 'Проверить runtime (offline)', 'E365', new vscode.ProcessExecution('node', [choices[0].fsPath, 'compile', '--verify', '--offline', '--host', host, folders[0].fsPath], { cwd: path.dirname(path.dirname(choices[0].fsPath)) }));
      await vscode.tasks.executeTask(task);
    }),
    vscode.workspace.onDidSaveTextDocument(() => { clearTimeout(timer); timer = setTimeout(refresh, 250); }),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    { dispose() { clearTimeout(timer); generation++; } }
  );
  await refresh();
};

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';



export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.workspace.onDidChangeTextDocument(async (document) => {
		if (!document.document.fileName.endsWith('.dart')) { return; }
		if (document.document.fileName.includes('/app/translations/messages')) { return; }

		const text = document.document.getText();
		const stringRegex = /(["'])(.*?)\1/g;
		let match: RegExpExecArray | null;

		while ((match = stringRegex.exec(text)) !== null) {
			const fullMatch = match[0];
			const cleanText = fullMatch.slice(1, -1);
			console.log('CHECK:', cleanText);

			if (!cleanText.trim()) { continue; }
			if (isLikelyTranslationKey(cleanText)) { continue; }

			const shouldTranslate = await vscode.window.showQuickPick([
				'Так, перекласти',
				'Ні'
			], { placeHolder: `Знайдено рядок: "${cleanText}". Додати до перекладу?` });

			if (shouldTranslate === 'Так, перекласти') {
				handleTranslation(cleanText, document.document, match.index);
			}
		}
	});

	context.subscriptions.push(disposable);
}

function isLikelyTranslationKey(text: string): boolean {
	return /^Strings\.[a-zA-Z0-9_]+$/.test(text);
}

async function handleTranslation(original: string, document: vscode.TextDocument, position: number) {
	const locales = ['en', 'pt', 'pt_BR'];
	const translations: { [locale: string]: string } = {};

	for (const locale of locales) {
		const translated = await vscode.window.showInputBox({
			prompt: `Переклад для [${locale}]`,
			value: original
		});
		if (translated !== undefined) {
			translations[locale] = translated;
		}
	}

	const keyName = toKeyName(original);
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
	if (!workspaceFolder) { return; }

	const trStringsPath = path.join(workspaceFolder, 'lib/app/translations/tr_strings.dart');
	const messagesDir = path.join(workspaceFolder, 'lib/app/translations/messages');

	// Додаємо ключ у tr_strings.dart
	if (fs.existsSync(trStringsPath)) {
		let content = fs.readFileSync(trStringsPath, 'utf8');
		const insertPos = content.lastIndexOf('}');
		content = content.slice(0, insertPos) + `  static String ${keyName} = '${keyName}';\n` + content.slice(insertPos);
		fs.writeFileSync(trStringsPath, content);
	}

	for (const locale of Object.keys(translations)) {
		const fileName = `messages_${locale}.dart`;
		const filePath = path.join(messagesDir, fileName);

		if (fs.existsSync(filePath)) {
			let content = fs.readFileSync(filePath, 'utf8');
			const match = content.match(/(['\"])([a-zA-Z0-9_]+)\1\s*:\s*['\"]/);
			const insertPos = match?.index ?? content.indexOf('};');
			const insertLine = `\n          Strings.${keyName}: '${translations[locale]}',`;
			content = content.slice(0, insertPos) + insertLine + content.slice(insertPos);
			fs.writeFileSync(filePath, content);
		}
	}

	const editor = await vscode.window.showTextDocument(document);
	const edit = new vscode.WorkspaceEdit();
	const range = new vscode.Range(document.positionAt(position), document.positionAt(position + original.length + 2));
	edit.replace(document.uri, range, `Strings.${keyName}.tr`);
	await vscode.workspace.applyEdit(edit);

	if (!document.getText().includes("import 'package:get/get_utils/get_utils.dart';")) {
		const firstImportIndex = document.getText().indexOf('import');
		const insertPos = document.positionAt(firstImportIndex);
		const importEdit = new vscode.WorkspaceEdit();
		importEdit.insert(document.uri, insertPos, "import 'package:get/get_utils/get_utils.dart';\n");
		await vscode.workspace.applyEdit(importEdit);
	}

	vscode.window.showInformationMessage(`Рядок "${original}" додано як Strings.${keyName}.tr`);
}

function toKeyName(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function deactivate() { }

import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	console.log('Activate', 'Extension activate');

	const diagnosticCollection = vscode.languages.createDiagnosticCollection('translationStrings');
	context.subscriptions.push(diagnosticCollection);

	const disposable = vscode.workspace.onDidChangeTextDocument(async (document) => {
		console.log('CHECK:', `Check file: "${document.document.fileName}"`);
		if (!document.document.fileName.endsWith('.dart')) { return; }
		if (document.document.fileName.includes('/app/translations')) { return; }

		const text = document.document.getText();
		const stringRegex = /(["'])(.*?)\1/g;
		const importRegex = /^\s*(import|part+of|part)\s+['"].+['"]\s*;/gm;
		const urlRegex = /https?:\/\/[^\s'"]+/;
		let match: RegExpExecArray | null;
		const diagnostics: vscode.Diagnostic[] = [];

		// Знаходимо всі імпорти
		const importRanges: vscode.Range[] = [];
		let importMatch: RegExpExecArray | null;
		while ((importMatch = importRegex.exec(text)) !== null) {
			const startPos = document.document.positionAt(importMatch.index);
			const endPos = document.document.positionAt(importMatch.index + importMatch[0].length);
			importRanges.push(new vscode.Range(startPos, endPos));
		}

		while ((match = stringRegex.exec(text)) !== null) {
			const fullMatch = match[0];
			const startPos = document.document.positionAt(match.index);
			const endPos = document.document.positionAt(match.index + fullMatch.length);
			const range = new vscode.Range(startPos, endPos);

			// Перевіряємо чи це імпорт
			const isInsideImport = importRanges.some(importRange =>
				importRange.start.line <= range.start.line &&
				importRange.end.line >= range.end.line
			);

			if (isInsideImport) { continue; }

			const cleanText = fullMatch.slice(1, -1);
			console.log('CHECK:', cleanText);

			if (!cleanText.trim()) { continue; }
			if (isLikelyTranslationKey(cleanText)) { continue; }
			if (urlRegex.test(cleanText)) { continue; }

			const diagnostic = new vscode.Diagnostic(
				range,
				'String might need translation',
				vscode.DiagnosticSeverity.Warning
			);

			diagnostic.code = 'missing-translation';
			diagnostics.push(diagnostic);
		}

		diagnosticCollection.set(document.document.uri, diagnostics);
	});

	const disposableOpen = vscode.workspace.onDidOpenTextDocument(async (document) => {
		console.log('CHECK:', `Check file: "${document.fileName}"`);
		if (!document.fileName.endsWith('.dart')) { return; }
		if (document.fileName.includes('/app/translations')) { return; }

		const text = document.getText();
		const stringRegex = /(["'])(.*?)\1/g;
		const importRegex = /^\s*(import|part+of|part)\s+['"].+['"]\s*;/gm;
		const urlRegex = /https?:\/\/[^\s'"]+/;
		let match: RegExpExecArray | null;
		const diagnostics: vscode.Diagnostic[] = [];

		// Знаходимо всі імпорти
		const importRanges: vscode.Range[] = [];
		let importMatch: RegExpExecArray | null;
		while ((importMatch = importRegex.exec(text)) !== null) {
			const startPos = document.positionAt(importMatch.index);
			const endPos = document.positionAt(importMatch.index + importMatch[0].length);
			importRanges.push(new vscode.Range(startPos, endPos));
		}

		while ((match = stringRegex.exec(text)) !== null) {
			const fullMatch = match[0];
			const startPos = document.positionAt(match.index);
			const endPos = document.positionAt(match.index + fullMatch.length);
			const range = new vscode.Range(startPos, endPos);

			// Перевіряємо чи це імпорт
			const isInsideImport = importRanges.some(importRange =>
				importRange.start.line <= range.start.line &&
				importRange.end.line >= range.end.line
			);

			if (isInsideImport) { continue; }

			const cleanText = fullMatch.slice(1, -1);
			console.log('CHECK:', cleanText);

			if (!cleanText.trim()) { continue; }
			if (isLikelyTranslationKey(cleanText)) { continue; }
			if (urlRegex.test(cleanText)) { continue; }

			const diagnostic = new vscode.Diagnostic(
				range,
				'String might need translation',
				vscode.DiagnosticSeverity.Warning
			);

			diagnostic.code = 'missing-translation';
			diagnostics.push(diagnostic);
		}

		diagnosticCollection.set(document.uri, diagnostics);
	});

	// Реєструємо провайдер код-акшнів
	const codeActionProvider = {
		provideCodeActions: (document: vscode.TextDocument, range: vscode.Range) => {
			const diagnostics = vscode.languages.getDiagnostics(document.uri);
			const relevantDiagnostics = diagnostics.filter(d =>
				d.range.intersection(range) &&
				d.code === 'missing-translation'
			);

			if (!relevantDiagnostics.length) { return []; }

			return relevantDiagnostics.map(diagnostic => {
				const text = document.getText(diagnostic.range);
				const cleanText = text.slice(1, -1); // Видаляємо лапки

				return {
					title: 'Add Get translations',
					kind: vscode.CodeActionKind.QuickFix,
					diagnostics: [diagnostic],
					isPreferred: true,
					command: {
						title: 'Wrap with translation',
						command: 'extension.wrapWithTranslation',
						arguments: [document, diagnostic.range, cleanText]
					}
				};
			});
		}
	};

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('dart', codeActionProvider, {
			providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('extension.wrapWithTranslation',
			async (document: vscode.TextDocument, range: vscode.Range, text: string) => {
				const edit = new vscode.WorkspaceEdit();
				let translationKey = generateTranslationKey(text);

				if (translationKey === undefined) {
					const userKey = await vscode.window.showInputBox({
						prompt: 'Будь ласка, введіть власний ключ (англійські літери/цифри)',
						placeHolder: 'Наприклад: userProfileHeader'
					});

					if (!userKey) { return; }
					translationKey = userKey.trim();
				}

				edit.replace(
					document.uri,
					range,
					`Strings.${translationKey}.tr`
				);

				await vscode.workspace.applyEdit(edit);
				vscode.window.showInformationMessage(
					`Додано переклад для: "${text}" з ключем "${translationKey}"`
				);
			})
	);

	context.subscriptions.push(disposable);
}

function generateTranslationKey(text: string): string | undefined {
	const isEnglishOnly = /^[a-zA-Z0-9\s]+$/.test(text.replace(/[^\w\s]/g, ''));

	if (!isEnglishOnly) {
		return undefined;
	}

	return text.toLowerCase()
		.replace(/[^\w\s]/g, '')
		.trim()
		.split(/\s+/)
		.map((word, index) =>
			index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
		)
		.join('')
		.substring(0, 30);
}

function isLikelyTranslationKey(text: string): boolean {
	return /^Strings\.[a-zA-Z0-9_]+$/.test(text);
}

export function deactivate() { }

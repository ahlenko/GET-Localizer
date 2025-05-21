/* eslint-disable curly */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export function activate(context: vscode.ExtensionContext) {
	const disposableInit = vscode.commands.registerCommand('flutterI18nHelper.initTranslations', () => {
		createTranslationStructure(context);
	});

	const disposableLocale = vscode.commands.registerCommand('flutterI18nHelper.addLocale', () => {
		vscode.window.showInformationMessage('Add locale triggered');
		const credentials = loadGoogleServiceAccountCredentials();
		if (!credentials) return;

	});

	const disposableUpload = vscode.commands.registerCommand('flutterI18nHelper.uploadLocalTranslations', () => {
		vscode.window.showInformationMessage('Upload Local Translations triggered');
		const credentials = loadGoogleServiceAccountCredentials();
		if (!credentials) return;

		async function uploadTranslationsToSheet() {
			try {
				const serviceAccountAuth = new JWT({
					email: credentials.client_email,
					key: credentials.private_key,
					scopes: ['https://www.googleapis.com/auth/spreadsheets'],
				});
				const doc = new GoogleSpreadsheet(credentials.table_key, serviceAccountAuth);
				await doc.loadInfo();
				const sheet = doc.sheetsByTitle['localization'];

				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders || workspaceFolders.length === 0) {
					vscode.window.showErrorMessage('No workspace open');
					return;
				}
				const rootPath = workspaceFolders[0].uri.fsPath;
				const messagesDir = path.join(rootPath, 'lib', 'app', 'translations', 'messages');
				const tableHeader = generateSheetHeaderFromLocales(messagesDir);

				await sheet.clear();

				await sheet.setHeaderRow(tableHeader[0]);
				await sheet.addRow(
					Object.fromEntries(
						tableHeader[0].map((header, i) => [header, tableHeader[1][i] || ''])
					)
				);

				const headerRow = sheet.headerValues;
				const locales = headerRow.slice(1).map(h => {
					const match = h.match(/\(([^)]+)\)/);
					return match ? match[1] : null;
				}).filter(Boolean) as string[];

				const translationsByLocale: Record<string, Record<string, string>> = {};

				for (const locale of locales) {
					const filePath = path.join(messagesDir, `messages_${locale}.dart`);
					if (!fs.existsSync(filePath)) continue;

					const content = fs.readFileSync(filePath, 'utf-8');

					const match = content.match(/['"]?([a-zA-Z0-9_]+)['"]:\s+'''(.*?)'''/gs);
					if (!match) continue;

					translationsByLocale[locale] = {};
					for (const pair of match) {
						const keyMatch = pair.match(/['"]?([a-zA-Z0-9_]+)['"]:\s+'''(.*?)'''/s);
						if (keyMatch) {
							const [, key, value] = keyMatch;
							translationsByLocale[locale][key] = value;
						}
					}
				}

				const allKeys = new Set<string>();
				for (const locale of locales) {
					Object.keys(translationsByLocale[locale] || {}).forEach(key => allKeys.add(key));
				}

				const rowsToAdd: Record<string, string>[] = [];
				for (const key of Array.from(allKeys)) {
					const row: Record<string, string> = {};
					row[headerRow[0]] = key;
					locales.forEach((locale, i) => {
						const colName = headerRow[i + 1];
						row[colName] = translationsByLocale[locale]?.[key] ?? '';
					});
					rowsToAdd.push(row);
				}

				await sheet.addRows(rowsToAdd);
				vscode.window.showInformationMessage(`Uploaded ${rowsToAdd.length} translation keys.`);

			} catch (err) {
				vscode.window.showErrorMessage(`Failed to upload translations: ${err}`);
			}
		}
		uploadTranslationsToSheet();
	});

	const disposableFetch = vscode.commands.registerCommand('flutterI18nHelper.fetchCloudTranslations', () => {
		vscode.window.showInformationMessage('Fetch Cloud Translations triggered');
		const credentials = loadGoogleServiceAccountCredentials();
		if (!credentials) return;

		async function fetchTranslationsFromSheet() {
			try {
				const serviceAccountAuth = new JWT({
					email: credentials.client_email,
					key: credentials.private_key,
					scopes: ['https://www.googleapis.com/auth/spreadsheets'],
				});
				const doc = new GoogleSpreadsheet(credentials.table_key, serviceAccountAuth);
				await doc.loadInfo();
				const sheet = doc.sheetsByTitle['localization'];
				const rows = await sheet.getRows();
				console.log('Fetched rows:', rows.length);
				vscode.window.showInformationMessage(`Fetched ${rows.length} rows from Google Sheets.`);


				const headerRow = sheet.headerValues;
				const locales: string[] = [];
				for (let i = 1; i < Object.keys(headerRow).length; i++) {
					const headerValue = headerRow[i];
					if (headerValue) {
						const match = headerValue.match(/\(([^)]+)\)/);
						if (match) locales.push(match[1]);
					}
				}

				const translationsByLocale: Record<string, Record<string, string>> = {};
				locales.forEach(loc => {
					translationsByLocale[loc] = {};
				});

				for (let i = 1; i < rows.length; i++) {
					const row = rows[i];
					const rowObj = row.toObject();
					const keys = Object.keys(rowObj);
					const key = rowObj[keys[0]];
					if (!key) continue;

					for (let j = 1; j < locales.length + 1; j++) {
						const locale = locales[j - 1];
						const value = rowObj[keys[j]] || '';
						translationsByLocale[locale][key] = value;
					}
				}

				function generateDartContent(translations: Record<string, string>, locale: string): string {
					const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
					let buffer = '';
					buffer += "import 'package:get/get_navigation/src/root/internacionalization.dart';\n\n";
					buffer += `class Messages${capitalize(locale)} extends Translations {\n`;
					buffer += '  @override\n';
					buffer += '  Map<String, Map<String, String>> get keys => {\n';
					buffer += `    '${locale}_${locale.toUpperCase()}': {\n`;

					for (const [key, value] of Object.entries(translations)) {
						buffer += `      '${key}': '''${value}''',\n`;
					}

					buffer += '    },\n';
					buffer += '  };\n';
					buffer += '}\n';

					return buffer;
				}

				function generateDartStrings(): string {

					let buffer = '';
					buffer += `class Strings {\n`;

					let firstRow = true;

					for (const [key, value] of Object.entries(rows)) {
						if (firstRow) {
							firstRow = false;
							continue;
						}
						const rowObj = value.toObject();
						const keys = Object.keys(rowObj);
						const key = rowObj[keys[0]];
						const data = rowObj[keys[0]] || '';
						buffer += `	static String ${data} = '${data}';\n`;
					}
					buffer += '}\n';

					return buffer;
				}

				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders || workspaceFolders.length === 0) {
					vscode.window.showErrorMessage('No workspace open');
					return;
				}
				const rootPath = workspaceFolders[0].uri.fsPath;
				const messagesDir = path.join(rootPath, 'lib', 'app', 'translations', 'messages');

				if (!fs.existsSync(messagesDir)) {
					fs.mkdirSync(messagesDir, { recursive: true });
				}

				let bufferIMPORTS = '';
				let bufferINITIALIZATION = '';
				let bufferIMPLEMENT = '';
				let bufferSUPPORTED_LOCALES = '';
				let bufferLOCALES = '';

				const projectName = path.basename(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '');

				for (const locale of locales) {
					const content = generateDartContent(translationsByLocale[locale], locale);
					const filePath = path.join(messagesDir, `messages_${locale}.dart`);
					fs.writeFileSync(filePath, content, 'utf-8');

					bufferIMPORTS += `import 'package:${projectName}/app/translations/messages/messages_${locale.charAt(0).toUpperCase() + locale.slice(1)}.dart';`;
					bufferINITIALIZATION += `final Messages${locale.charAt(0).toUpperCase() + locale.slice(1)} _messages${locale.charAt(0).toUpperCase() + locale.slice(1)} = Messages${locale.charAt(0).toUpperCase() + locale.slice(1)}();\n`;
					bufferIMPLEMENT += `..._messages${locale.charAt(0).toUpperCase() + locale.slice(1)}.keys, \n`;
					bufferSUPPORTED_LOCALES += `const Locale('${locale}'), \n	`;
					bufferLOCALES += `'${locale}', \n	`;
				}

				const libPath = path.join(rootPath, 'lib');
				const appPath = path.join(libPath, 'app',);
				const translationsPath = path.join(appPath, 'translations');

				const filesToCreate: { fileContent: string, targetPath: string }[] = [
					{
						fileContent: `import 'package:get/get_navigation/src/root/internacionalization.dart';
${bufferIMPORTS}

class Messages extends Translations {
  ${bufferINITIALIZATION}

  @override
  Map<String, Map<String, String>> get keys {
    Map<String, Map<String, String>> combinedKeys = {
      ${bufferIMPLEMENT}
    };
    return combinedKeys;
  }
}`,
						targetPath: path.join(translationsPath, 'messages.dart')
					},
					{
						fileContent: `import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:syncfusion_localizations/syncfusion_localizations.dart';

mixin TrSettings {
  static const locale = Locale('en');
  static const fallbackLocale = Locale('en');
  static List<Locale> supportedLocales = List.of([
    ${bufferSUPPORTED_LOCALES}
  ]);
  static final languages = [
    ${bufferLOCALES}
  ];
  static const Iterable<LocalizationsDelegate> localizationsDelegates = [
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    SfGlobalLocalizations.delegate,
  ];
}`,
						targetPath: path.join(translationsPath, 'tr_settings.dart')
					},
					{
						fileContent: generateDartStrings(),
						targetPath: path.join(translationsPath, 'tr_strings.dart')
					},
				];

				filesToCreate.forEach(({ fileContent, targetPath }) => {
					fs.writeFileSync(targetPath, fileContent);
				});

				vscode.window.showInformationMessage(`Generated localization files for locales: ${locales.join(', ')}`);

			} catch (err) {
				vscode.window.showErrorMessage(`Failed to fetch translations: ${err}`);
			}
		}
		fetchTranslationsFromSheet();
	});

	context.subscriptions.push(disposableInit, disposableUpload, disposableFetch, disposableLocale);
}

function generateSheetHeaderFromLocales(messagesDir: string): string[][] {
	const files = fs.readdirSync(messagesDir);
	const localeFiles = files
		.filter(f => f.startsWith('messages_') && f.endsWith('.dart'));

	const allLocales = localeFiles
		.map(f => f.replace('messages_', '').replace('.dart', ''));

	const priorityLocales = ['en', 'uk', 'ru'];
	const orderedLocales = [
		...priorityLocales.filter(loc => allLocales.includes(loc)),
		...allLocales.filter(loc => !priorityLocales.includes(loc)).sort()
	];

	const firstRow = ['variable_name', ...orderedLocales.map(loc => {
		const display = new Intl.DisplayNames(['en'], { type: 'language' });
		return `${display.of(loc)} (${loc})`;
	})];

	const secondRow = ['translator', 'Hello'];
	for (const loc of orderedLocales) {
		if (loc === 'en') continue;
		secondRow.push(`=PROPER(GOOGLETRANSLATE($B2; "en"; "${loc}"))`);
	}

	return [firstRow, secondRow];
}

function loadGoogleServiceAccountCredentials(): any | null {
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders || workspaceFolders.length === 0) {
		vscode.window.showErrorMessage('No workspace open');
		return null;
	}

	const rootPath = workspaceFolders[0].uri.fsPath;
	const credentialsPath = path.join(rootPath, 'google-service-account.json');

	if (!fs.existsSync(credentialsPath)) {
		vscode.window.showErrorMessage('`google-service-account.json` not found in project root.');
		return null;
	}

	const raw = fs.readFileSync(credentialsPath, 'utf-8');
	const credentials = JSON.parse(raw);

	if (typeof credentials.table_key !== 'string') {
		vscode.window.showErrorMessage('`table_key` field missing in google-service-account.json.');
		return null;
	}

	vscode.window.showInformationMessage('Credentials loaded successfully.');
	return credentials;
}

function createTranslationStructure(context: vscode.ExtensionContext) {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		vscode.window.showErrorMessage('No workspace open');
		return;
	}

	const rootPath = workspaceFolders[0].uri.fsPath;
	const libPath = path.join(rootPath, 'lib');
	const appPath = path.join(libPath, 'app',);
	const translationsPath = path.join(appPath, 'translations');
	const messagesPath = path.join(translationsPath, 'messages');

	const filesToCreate: { content: string, targetPath: string }[] = [
		{
			content: `import 'package:get/get_navigation/src/root/internacionalization.dart';
//IMPORTS

class Messages extends Translations {
  //INITIALIZATION

  @override
  Map<String, Map<String, String>> get keys {
    Map<String, Map<String, String>> combinedKeys = {
      //IMPLEMENT
    };
    return combinedKeys;
  }
}
`,
			targetPath: path.join(translationsPath, 'messages.dart')
		},
		{
			content: `import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:syncfusion_localizations/syncfusion_localizations.dart';

mixin TrSettings {
  static const locale = Locale('en');
  static const fallbackLocale = Locale('en');
  static List<Locale> supportedLocales = List.of([
    //SUPPORTED_LOCALES
  ]);
  static final languages = [
    //LOCALES
  ];
  static const Iterable<LocalizationsDelegate> localizationsDelegates = [
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    SfGlobalLocalizations.delegate,
  ];
}
`,
			targetPath: path.join(translationsPath, 'tr_settings.dart')
		},
		{
			content: `class Strings {}
`,
			targetPath: path.join(translationsPath, 'tr_strings.dart')
		},
		{
			content: `import 'package:get/get_navigation/src/root/internacionalization.dart';
import 'package:NAMESPASE/app/translations/tr_strings.dart';

class MessagesEn extends Translations {
  @override
  Map<String, Map<String, String>> get keys => {'en_EN': {}};
}
`,
			targetPath: path.join(messagesPath, 'messages_en.dart')
		},
		{
			content: `import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:NAMESPASE/app/translations/messages.dart';
import 'package:NAMESPASE/app/translations/tr_settings.dart';

class App extends StatefulWidget {
  const App({super.key});

  @override
  State<App> createState() => _MyAppAppState();
}

class _MyAppAppState extends State<App> {
  @override
  Widget build(BuildContext context) {
    return GetMaterialApp(
      locale: Get.locale,
      translations: Messages(),
      fallbackLocale: TrSettings.fallbackLocale,
      localizationsDelegates: TrSettings.localizationsDelegates,
    );
  }
}
`,
			targetPath: path.join(appPath, 'app.dart')
		}
	];

	[libPath, path.join(libPath, 'app'), translationsPath, messagesPath].forEach(dir => {
		if (!fs.existsSync(dir)) fs.mkdirSync(dir);
	});

	filesToCreate.forEach(({ content, targetPath }) => {
		if (!fs.existsSync(targetPath)) {
			const projectName = path.basename(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '');
			content = content.replace(/NAMESPASE/g, projectName);
			fs.writeFileSync(targetPath, content);
		}
	});

	vscode.window.showInformationMessage('Translation structure created.');

	const pubspecPath = path.join(rootPath, 'pubspec.yaml');
	if (fs.existsSync(pubspecPath)) {
		let pubspecContent = fs.readFileSync(pubspecPath, 'utf-8');
		const insertAfter = 'sdk: flutter';
		const additionalDeps = [
			'\n  flutter_localizations:\n    sdk: flutter\n',
			'  get: ^4.7.2',
			'  syncfusion_localizations: ^25.2.4'
		];
		if (pubspecContent.includes(insertAfter)) {
			const insertion = [insertAfter, ...additionalDeps].join('\n');
			pubspecContent = pubspecContent.replace(insertAfter, insertion);
			fs.writeFileSync(pubspecPath, pubspecContent);
			vscode.window.showInformationMessage('Dependencies added to pubspec.yaml');
			const terminal = vscode.window.createTerminal('Flutter Pub Get');
			terminal.show();
			terminal.sendText('flutter pub get');
		} else {
			vscode.window.showWarningMessage('Expected flutter SDK block not found in pubspec.yaml');
		}
	}
}

export function deactivate() { }
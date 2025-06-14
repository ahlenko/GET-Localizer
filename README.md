# GET Localizer README

VS Code extension that helps translate string literals in Flutter projects using the `get` package.

## Features

- Detects hardcoded strings in `.dart` files (excluding translation files)
- Prompts for translation into all supported locales
- Adds keys to `tr_strings.dart`
- Updates corresponding `messages_*.dart` files
- Replaces string with `Strings.key.tr`
- Adds import for `get_utils` if missing

## Requirements

- Flutter project using the `get` package
- Translation structure: `lib/app/translations/messages/messages_*.dart`
- Keys defined in `lib/app/translations/tr_strings.dart`

## Known Issues

- Does not support multiline strings
- No undo for changes in translation files

## Release Notes

### 0.0.1

- Initial version with basic string detection and translation handling.

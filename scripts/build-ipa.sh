#!/usr/bin/env bash
# Builds an unsigned build/Macro.ipa on a Mac. AltStore signs it with your Apple ID when it
# installs it, so no paid developer account is needed.
# Requirements: macOS, Xcode (opened once to accept the licence), CocoaPods, Node.js.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
BUILD="$ROOT/build"
SCHEME="Macro"
LOG="$BUILD/xcodebuild.log"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Serve un Mac con Xcode." >&2
  exit 1
fi
command -v xcodebuild >/dev/null || { echo "xcodebuild non trovato: installa Xcode dall'App Store e aprilo una volta." >&2; exit 1; }
command -v pod >/dev/null || { echo "CocoaPods non trovato: installalo con 'brew install cocoapods'." >&2; exit 1; }

echo "› Installo le dipendenze"
npm install

echo "› Genero il progetto Xcode"
npx expo prebuild --platform ios --clean

rm -rf "$BUILD"
mkdir -p "$BUILD"

echo "› Compilo (qualche minuto; log completo in $LOG)"
if ! xcodebuild \
  -workspace "ios/$SCHEME.xcworkspace" \
  -scheme "$SCHEME" \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -archivePath "$BUILD/$SCHEME.xcarchive" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  archive >"$LOG" 2>&1; then
  echo "Compilazione fallita. Ultime righe del log:" >&2
  tail -n 40 "$LOG" >&2
  exit 1
fi

echo "› Impacchetto l'IPA"
mkdir -p "$BUILD/Payload"
cp -R "$BUILD/$SCHEME.xcarchive/Products/Applications/$SCHEME.app" "$BUILD/Payload/"
(cd "$BUILD" && zip -qry "$SCHEME.ipa" Payload)
rm -rf "$BUILD/Payload"

echo "Fatto: $BUILD/$SCHEME.ipa"

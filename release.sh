#!/usr/bin/env bash
# SubGrid release build: web bundles, Windows exes (Studio + Lite), installer, source zip.
# Needs: node (esbuild), go >= 1.24, makensis (NSIS 3). Output: dist/
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${VERSION:-2.2.0}"
export GOFLAGS=-mod=mod

node build.mjs
mkdir -p build dist

( cd app
  go run github.com/tc-hib/go-winres@v0.3.3 make --in winres/winres.json --arch amd64 >/dev/null
  for ED in studio lite; do
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath \
      -ldflags "-H windowsgui -s -w -X main.edition=$ED -X main.version=$VERSION" -o "../build/SubGrid-$ED.exe" .
  done )

cp build/SubGrid-lite.exe dist/SubGrid-Lite.exe
( cd installer && makensis -V2 -DVERSION="$VERSION" -DEXE=../build/SubGrid-studio.exe -DOUT=../dist/SubGrid-Studio-Setup.exe subgrid-studio.nsi )

rm -f dist/SubGrid-Quellcode.zip
zip -qr dist/SubGrid-Quellcode.zip README.md release.sh build.mjs package.json fonts src app/*.go app/go.mod app/go.sum app/winres installer test/*.py test/*.mjs .github 2>/dev/null || true
ls -la dist

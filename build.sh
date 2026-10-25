#!/bin/sh
set -e
cd "$(dirname "$0")"
npx esbuild src/main.js --bundle --minify --format=iife --target=safari15 --outfile=docs/app.js
npx esbuild src/style.css --bundle --minify --loader:.svg=dataurl --outfile=docs/app.css

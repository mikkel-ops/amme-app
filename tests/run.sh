#!/bin/bash
# Kører tests/index.html i headless Chrome og udskriver resultatet.
# Brug: bash tests/run.sh   (exit-kode 0 = alle tests bestået)
set -u
cd "$(dirname "$0")/.."

PORT="${PORT:-8765}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
trap 'kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; rm -rf "$TMP"' EXIT

node --check app.js || { echo "app.js har syntaksfejl"; exit 1; }

python3 -m http.server "$PORT" >/dev/null 2>&1 &
SRV=$!
for _ in $(seq 1 50); do
  curl -s -o /dev/null "http://localhost:$PORT/" && break
  sleep 0.1
done

"$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$TMP/profile" \
  --virtual-time-budget=60000 --timeout=90000 \
  --dump-dom "http://localhost:$PORT/tests/" 2>/dev/null > "$TMP/out.html"

python3 - "$TMP/out.html" <<'EOF'
import html, re, sys
dom = open(sys.argv[1], encoding='utf-8').read()
get = lambda i: html.unescape(re.sub(r'<[^>]+>', '', (re.search(rf'id="{i}"[^>]*>(.*?)</(?:pre|h1)>', dom, re.S) or [None, ''])[1]))
summary = get('summary').strip()
print(get('out'))
print()
print(summary or 'Ingen resultat (kørte Chrome?)')
sys.exit(0 if summary.startswith('PASS') else 1)
EOF

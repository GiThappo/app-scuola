#!/usr/bin/env bash
# Carica l'orario (Markdown) nel database dell'app online. Uso: scripts/carica-orario.sh ~/Scuola/orario.md (DOVE=--local per il database locale)
set -euo pipefail
file="${1:?Uso: $0 <orario.md>}"
cartella="$(mktemp -d)"
sql="$cartella/orario.sql"
trap 'rm -rf "$cartella"' EXIT
testo="$(sed "s/'/''/g" "$file")"
printf "INSERT INTO impostazioni (chiave, valore) VALUES ('orario_md', '%s') ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore;\n" "$testo" > "$sql"
npx wrangler d1 execute app-scuola "${DOVE:---remote}" --file "$sql"

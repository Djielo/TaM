#!/usr/bin/env sh
# Télécharge le dernier simulation_data.json publié sur gh-pages (clone local sans fichier).
# Usage (depuis la racine du dépôt) : scripts/fetch_simulation_data_local.sh Proprietaire/NomRepo
set -e
if [ -z "${1:-}" ]; then
  echo "Usage: $0 proprietaire/nom-repo   (ex. Djielo/TaM)" >&2
  exit 1
fi
REPO="$1"
curl -fsSL "https://raw.githubusercontent.com/${REPO}/gh-pages/simulation_data.json" -o simulation_data.json
echo "OK : simulation_data.json <- gh-pages (${REPO})."

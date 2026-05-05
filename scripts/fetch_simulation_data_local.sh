#!/usr/bin/env sh
# Télécharge le dernier simulation_data.json publié sur GitHub Pages (clone local sans fichier).
# Usage (depuis la racine du dépôt) : scripts/fetch_simulation_data_local.sh Proprietaire/NomRepo
set -e
if [ -z "${1:-}" ]; then
  echo "Usage: $0 proprietaire/nom-repo   (ex. Djielo/TaM)" >&2
  exit 1
fi
REPO="$1"
OWNER="${REPO%%/*}"
NAME="${REPO##*/}"
for U in \
  "https://${OWNER}.github.io/${NAME}/simulation_data.json" \
  "https://raw.githubusercontent.com/${REPO}/gh-pages/simulation_data.json" \
  ; do
  echo "Essai : $U"
  if curl -fsSL "$U" -o simulation_data.json; then
    echo "OK : simulation_data.json <- ${U}"
    exit 0
  fi
done
echo "Échec : aucune URL n’a renvoyé le fichier." >&2
exit 1

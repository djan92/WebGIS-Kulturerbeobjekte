#!/usr/bin/env bash
# Wandelt die beiden GeoJSON-Dateien (70 MB) in FlatGeobuf mit räumlichem Index um
# und kopiert das Logo. Aufruf im Projektordner:  bash convert.sh
set -euo pipefail

SRC="/mnt/c/Users/dennis.jan/Desktop/Technik"

if ! command -v ogr2ogr >/dev/null; then
  echo "ogr2ogr fehlt. Installation:  sudo apt update && sudo apt install -y gdal-bin"
  exit 1
fi

mkdir -p data img

for name in RLP NI; do
  in="$SRC/Kulturerbeobjekte_${name}.geojson"
  out="data/Kulturerbeobjekte_${name}.fgb"
  echo "→ $in"
  # -t_srs EPSG:4326: FlatGeobuf-Client im Browser erwartet lon/lat
  ogr2ogr -f FlatGeobuf "$out" "$in" -t_srs EPSG:4326 -lco SPATIAL_INDEX=YES
done

cp "$SRC/icon.png" img/icon.png

echo
ls -lh data img
echo "Hinweis: GitHub lehnt Einzeldateien > 100 MB ab (Warnung ab 50 MB)."

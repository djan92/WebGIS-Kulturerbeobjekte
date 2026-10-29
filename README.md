# webgis-kulturerbe-test

Statische Web-GIS-Anwendung (OpenLayers, kein Build-Schritt).

## Inhalt
- OSM-Basiskarte
- Niedersachsen: OGC API Features (Denkmalatlas), Collections werden automatisch gelesen
- Rheinland-Pfalz: WFS 1.1.0 (GeoPortal), FeatureTypes aus GetCapabilities
- Baden-Württemberg: WFS 2.0.0 (archäologische Kulturdenkmale), FeatureTypes aus GetCapabilities
- Eigene Daten Kulturerbeobjekte RLP/NI als FlatGeobuf (`data/`)
- Logo `img/icon.png` oben links

## Einrichtung (WSL)
```bash
sudo apt update && sudo apt install -y gdal-bin git
bash convert.sh                 # erzeugt data/*.fgb und kopiert img/icon.png
python3 -m http.server 8000     # dann im Windows-Browser http://localhost:8000
```

## Konfiguration
Alles Wichtige steht oben in `app.js` (Dienste, Farben, Mindest-Zoom, optionaler CORS-Proxy).

## Veröffentlichen
```bash
git init -b main
git add .
git commit -m "Grundgerüst Web-GIS"
git remote add origin https://github.com/djan92/webgis-kulturerbe-test.git
git push -u origin main
```
Danach auf GitHub: Settings → Pages → Branch `main`, Ordner `/ (root)`.

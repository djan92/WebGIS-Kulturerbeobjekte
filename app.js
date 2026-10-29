/* WebGIS Kulturerbe – Grundgerüst
 * OpenLayers (global `ol`) + FlatGeobuf (global `flatgeobuf`)
 */

// ───────────────────────── Konfiguration ─────────────────────────

// Falls ein Dienst kein CORS liefert: hier einen Proxy eintragen, z. B.
// 'https://dein-worker.workers.dev/?url='  (die Ziel-URL wird URL-kodiert angehängt)
const PROXY = '';

const MIN_ZOOM_SERVICES = 10;   // Dienste werden erst ab diesem Zoom abgefragt
const FEATURE_LIMIT = 2000;     // max. Features pro Abfrage (OGC API / WFS)

// Koordinatensystem ETRS89 / UTM 32N für OpenLayers bekannt machen (proj4 wird in index.html geladen)
proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
ol.proj.proj4.register(proj4);

const SERVICES = [
  {
    id: 'ni',
    group: 'Niedersachsen – Denkmalatlas (OGC API Features)',
    type: 'ogcapi',
    url: 'https://geodatendienste.denkmalatlas.niedersachsen.de/xtraserver-webapi/denkmale/v1',
    color: '#d9480f',
  },
  {
    id: 'rlp',
    group: 'Rheinland-Pfalz – GeoPortal (WFS 1.1.0)',
    type: 'wfs',
    url: 'https://www.geoportal.rlp.de/registry/wfs/665',
    version: '1.1.0',
    extraParams: { VERSION: '1.1.0' },
    srs: 'EPSG:25832',          // der RLP-Dienst filtert BBOX nur im Standard-CRS 25832 korrekt (3857/4326 liefern 0 Objekte)
    color: '#1c7ed6',
  },
  {
    id: 'bw',
    group: 'Baden-Württemberg – Archäologische Kulturdenkmale (WFS 2.0.0)',
    type: 'wfs',
    url: 'https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_LAD_Archaeologische_Kulturdenkmale_BW',
    version: '2.0.0',
    extraParams: {},
    srs: 'EPSG:3857',
    color: '#2f9e44',
  },
];

// Eigene Daten als FlatGeobuf (siehe convert.sh) – liegen im Ordner data/
const LOCAL_LAYERS = [
  { id: 'keo_rlp', title: 'Kulturerbeobjekte RLP', url: 'data/Kulturerbeobjekte_RLP.fgb', color: '#862e9c' },
  { id: 'keo_ni',  title: 'Kulturerbeobjekte NI',  url: 'data/Kulturerbeobjekte_NI.fgb',  color: '#c2255c' },
];

// ───────────────────────── Hilfsfunktionen ─────────────────────────

const statusEl = document.getElementById('status');
const log = (msg) => { statusEl.textContent = msg; };

const viaProxy = (url) => (PROXY ? PROXY + encodeURIComponent(url) : url);

function buildUrl(base, params) {
  const u = new URL(base);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}

function makeStyle(color) {
  const fill = color + '55';
  return new ol.style.Style({
    image: new ol.style.Circle({
      radius: 5,
      fill: new ol.style.Fill({ color }),
      stroke: new ol.style.Stroke({ color: '#fff', width: 1 }),
    }),
    stroke: new ol.style.Stroke({ color, width: 2 }),
    fill: new ol.style.Fill({ color: fill }),
  });
}

async function fetchText(url) {
  const res = await fetch(viaProxy(url));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ───────────────────────── Karte ─────────────────────────

const map = new ol.Map({
  target: 'map',
  layers: [new ol.layer.Tile({ source: new ol.source.OSM() })],
  view: new ol.View({
    center: ol.proj.fromLonLat([8.3, 50.0]),
    zoom: 7,
  }),
});

const layerListEl = document.getElementById('layerlist');

function addGroup(title, note, open = true) {
  // <details>: Gruppe lässt sich per Klick auf die Überschrift auf- und zuklappen
  const g = document.createElement('details');
  g.className = 'group';
  g.open = open;
  g.innerHTML = `<summary><h3><span class="gtitle"></span><span class="gcount"></span></h3></summary>${note ? '<div class="note"></div>' : ''}`;
  g.querySelector('.gtitle').textContent = title;
  if (note) g.querySelector('.note').textContent = note;
  layerListEl.appendChild(g);
  return g;
}

function addLayerEntry(groupEl, title, color, olLayer) {
  const row = document.createElement('div');
  row.className = 'layer';
  const id = 'cb_' + Math.random().toString(36).slice(2);
  row.innerHTML = `<span class="swatch" style="background:${color}"></span>
    <input type="checkbox" id="${id}"><label for="${id}"></label>`;
  row.querySelector('label').textContent = title;
  row.querySelector('input').addEventListener('change', (e) => olLayer.setVisible(e.target.checked));
  groupEl.appendChild(row);
  const cnt = groupEl.querySelector('.gcount');
  if (cnt) cnt.textContent = ` (${groupEl.querySelectorAll('.layer').length})`;
  olLayer.set('title', title);
  map.addLayer(olLayer);
}

function addError(groupEl, text) {
  const d = document.createElement('div');
  d.className = 'note err';
  d.textContent = text;
  groupEl.appendChild(d);
}

// ───────────────────────── OGC API Features (Niedersachsen) ─────────────────────────

function ogcApiSource(baseUrl, collectionId) {
  const format = new ol.format.GeoJSON();
  const source = new ol.source.Vector({
    strategy: ol.loadingstrategy.bbox,
    loader: async function (extent, resolution, projection) {
      const [minx, miny, maxx, maxy] = ol.proj.transformExtent(extent, projection, 'EPSG:4326');
      const url = buildUrl(`${baseUrl}/collections/${collectionId}/items`, {
        f: 'json',
        limit: FEATURE_LIMIT,
        bbox: [minx, miny, maxx, maxy].join(','),
      });
      try {
        const res = await fetch(viaProxy(url));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const features = format.readFeatures(await res.json(), {
          dataProjection: 'EPSG:4326',
          featureProjection: projection,
        });
        source.addFeatures(features);
        if (features.length >= FEATURE_LIMIT) log(`${collectionId}: Limit von ${FEATURE_LIMIT} Features erreicht – weiter hineinzoomen.`);
      } catch (err) {
        console.error('OGC API', collectionId, err);
        log(`Fehler bei ${collectionId}: ${err.message} (CORS? siehe Konsole)`);
        source.removeLoadedExtent(extent);
      }
    },
  });
  return source;
}

async function initOgcApi(svc) {
  const group = addGroup(svc.group, `Ab Zoom ${MIN_ZOOM_SERVICES} sichtbar`, false);
  try {
    const res = await fetch(viaProxy(buildUrl(`${svc.url}/collections`, { f: 'json' })));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    (json.collections || []).forEach((c) => {
      const layer = new ol.layer.Vector({
        source: ogcApiSource(svc.url, c.id),
        style: makeStyle(svc.color),
        visible: false,
        minZoom: MIN_ZOOM_SERVICES,
      });
      addLayerEntry(group, c.title || c.id, svc.color, layer);
    });
  } catch (err) {
    console.error(err);
    addError(group, `Collections nicht ladbar: ${err.message}`);
  }
}

// ───────────────────────── WFS (RLP 1.1.0, BW 2.0.0) ─────────────────────────

function wfsSource(svc, typeName) {
  const wfsFormat = new ol.format.WFS({ version: svc.version });
  const is2 = svc.version.startsWith('2');
  const source = new ol.source.Vector({
    strategy: ol.loadingstrategy.bbox,
    loader: async function (extent, resolution, projection) {
      const params = {
        SERVICE: 'WFS',
        REQUEST: 'GetFeature',
        VERSION: svc.version,
        SRSNAME: svc.srs,
        BBOX: ol.proj.transformExtent(extent, projection, svc.srs).join(',') + ',' + svc.srs,
        ...svc.extraParams,
      };
      params[is2 ? 'TYPENAMES' : 'TYPENAME'] = typeName;
      params[is2 ? 'COUNT' : 'MAXFEATURES'] = FEATURE_LIMIT;
      try {
        const text = await fetchText(buildUrl(svc.url, params));
        if (/ExceptionReport|ServiceException/.test(text.slice(0, 600))) {
          throw new Error('Dienst meldet Exception: ' + text.slice(0, 200).replace(/\s+/g, ' '));
        }
        const features = wfsFormat.readFeatures(text, {
          dataProjection: svc.srs,
          featureProjection: projection,
        });
        source.addFeatures(features);
        if (features.length >= FEATURE_LIMIT) log(`${typeName}: Limit von ${FEATURE_LIMIT} Features erreicht – weiter hineinzoomen.`);
      } catch (err) {
        console.error('WFS', typeName, err);
        log(`Fehler bei ${typeName}: ${err.message}`);
        source.removeLoadedExtent(extent);
      }
    },
  });
  return source;
}

async function initWfs(svc) {
  const group = addGroup(svc.group, `Ab Zoom ${MIN_ZOOM_SERVICES} sichtbar`, false);
  try {
    const capsUrl = buildUrl(svc.url, { SERVICE: 'WFS', REQUEST: 'GetCapabilities', VERSION: svc.version });
    const xml = new DOMParser().parseFromString(await fetchText(capsUrl), 'text/xml');
    const types = [...xml.getElementsByTagNameNS('*', 'FeatureType')];
    if (!types.length) throw new Error('keine FeatureTypes in den Capabilities');
    types.forEach((ft) => {
      const name = ft.getElementsByTagNameNS('*', 'Name')[0]?.textContent;
      const title = ft.getElementsByTagNameNS('*', 'Title')[0]?.textContent || name;
      if (!name) return;
      const layer = new ol.layer.Vector({
        source: wfsSource(svc, name),
        style: makeStyle(svc.color),
        visible: false,
        minZoom: MIN_ZOOM_SERVICES,
      });
      addLayerEntry(group, title, svc.color, layer);
    });
  } catch (err) {
    console.error(err);
    addError(group, `GetCapabilities fehlgeschlagen: ${err.message}`);
  }
}

// ───────────────────────── Lokale Daten (FlatGeobuf) ─────────────────────────

function fgbSource(url) {
  const format = new ol.format.GeoJSON();
  const source = new ol.source.Vector({
    strategy: ol.loadingstrategy.bbox,
    loader: async function (extent, resolution, projection) {
      const [minX, minY, maxX, maxY] = ol.proj.transformExtent(extent, projection, 'EPSG:4326');
      try {
        const loaded = [];
        for await (const f of flatgeobuf.deserialize(url, { minX, minY, maxX, maxY })) {
          loaded.push(format.readFeature(f, { dataProjection: 'EPSG:4326', featureProjection: projection }));
        }
        source.addFeatures(loaded);
      } catch (err) {
        console.error('FlatGeobuf', url, err);
        log(`Fehler bei ${url}: ${err.message}`);
        source.removeLoadedExtent(extent);
      }
    },
  });
  return source;
}

let localGroupEl = null;   // Gruppe "Eigene Daten"; mapping.js hängt hier seine Ergebnis-Layer an

function initLocal() {
  const group = addGroup('Eigene Daten (FlatGeobuf)', 'Aus data/, siehe convert.sh');
  localGroupEl = group;
  LOCAL_LAYERS.forEach((l) => {
    const layer = new ol.layer.Vector({
      source: fgbSource(l.url),
      style: makeStyle(l.color),
      visible: false,
      minZoom: 8,
    });
    addLayerEntry(group, l.title, l.color, layer);
  });
}

// ───────────────────────── Feature-Info ─────────────────────────

map.on('singleclick', (evt) => {
  let hit = null;
  map.forEachFeatureAtPixel(evt.pixel, (f, layer) => { hit = { f, layer }; return true; }, { hitTolerance: 5 });
  if (!hit) { hideFeatureForm(); return; }
  showFeatureForm(hit.f, hit.layer && hit.layer.get('title'));   // siehe form.js
});

map.on('pointermove', (evt) => {
  if (evt.dragging) return;
  map.getTargetElement().style.cursor = map.hasFeatureAtPixel(evt.pixel) ? 'pointer' : '';
});

// ───────────────────────── Start ─────────────────────────

initLocal();
SERVICES.forEach((svc) => (svc.type === 'ogcapi' ? initOgcApi(svc) : initWfs(svc)));

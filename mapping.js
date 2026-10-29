/* Semantische Auswahl über Cocoda-Mappings – Web-Port von SelectByMapping (QGIS)
 * Erste Ausbaustufe: nur Kulturerbeobjekte (lokale FlatGeobuf-Layer) und nur das Feld "epoche".
 *
 * Ablauf (wie im Plugin):
 *   1. Epoche-URIs (mit Labels) aus dem Startlayer lesen
 *   2. gewählte URIs in Cocoda nachschlagen:  GET <COCODA>?from=<uri>
 *   3. Mappings mit den gewählten Relationen -> gemappte URIs
 *   4. Startlayer: Objekte mit gewählten URIs ("Quelle"); Ziel-Layer: Objekte mit gemappten
 *      URIs ("<Relation> zu <Startlayer>")
 * Benötigt aus app.js: map, LOCAL_LAYERS, makeStyle
 */
(function () {
  const COCODA = 'https://coli-conc.gbv.de/phsdat/api/mappings';
  const FIELD = 'epoche';                       // Feld mit den Konzept-URIs (komma-getrennt)
  const RELATIONS = ['exactMatch', 'closeMatch', 'relatedMatch', 'broadMatch', 'narrowMatch'];
  const DEFAULT_RELATIONS = new Set(['exactMatch', 'closeMatch']);
  const SOURCE_TAG = 'Quelle';
  const COLORS = {
    [SOURCE_TAG]: '#e8590c',
    exactMatch: '#2f9e44', closeMatch: '#0c8599', relatedMatch: '#7048e8',
    broadMatch: '#1c7ed6', narrowMatch: '#a61e4d',
  };

  const geojson = new ol.format.GeoJSON();
  const mappingCache = new Map();
  const styleCache = new Map();
  let concepts = [];                            // [{uri, label}]
  let conceptsLayerId = null;

  // ───────────────────────── Hilfsfunktionen ─────────────────────────

  // Ganze Datei als Stream lesen (deserialize(url) bräuchte einen Ausschnitt/BBOX)
  async function* readAll(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
    yield* flatgeobuf.deserialize(res.body);
  }
  const findKey = (obj, name) => Object.keys(obj).find((k) => k.toLowerCase() === name);

  function splitList(v) {
    if (v === null || v === undefined) return [];
    return String(v).split(',').map((s) => s.trim()).filter((s) => s && s !== 'NULL');
  }

  const tagColor = (tag) => COLORS[tag === SOURCE_TAG ? SOURCE_TAG : tag.split(' ')[0]] || '#868e96';

  function styleFor(feature) {
    const color = tagColor(String(feature.get('MatchTyp') || SOURCE_TAG));
    if (!styleCache.has(color)) styleCache.set(color, makeStyle(color));
    return styleCache.get(color);
  }

  // ───────────────────────── Labels / Cocoda ─────────────────────────
  async function fetchLabel(uri) {
    try {
      if (uri.includes('wikidata.org')) {
        const qid = uri.replace(/\/$/, '').split('/').pop();
        const j = await (await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`)).json();
        const l = (j.entities[qid] || {}).labels || {};
        return (l.de && l.de.value) || (l.en && l.en.value) || null;
      }
      const sep = uri.includes('?') ? '&' : '?';
      const res = await fetch(uri + sep + 'format=jsonld', { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const j = await res.json();
      const pl = j.prefLabel || {};
      return pl.de || pl.en || null;
    } catch (e) {
      return null;       // Label ist nur Komfort, URI bleibt als Fallback
    }
  }

  async function getMappings(uri) {
    if (mappingCache.has(uri)) return mappingCache.get(uri);
    const res = await fetch(`${COCODA}?from=${encodeURIComponent(uri)}&limit=1000`);
    if (!res.ok) throw new Error(`Cocoda HTTP ${res.status}`);
    const data = await res.json();
    const out = [];
    (Array.isArray(data) ? data : []).forEach((m) => {
      try { out.push({ relation: m.type[0].split('#')[1], uri: m.to.memberSet[0].uri }); }
      catch (e) { /* Mapping ohne erwartete Struktur überspringen */ }
    });
    mappingCache.set(uri, out);
    return out;
  }

  // ───────────────────────── Oberfläche ─────────────────────────
  // Schaltfläche in der Seitenleiste
  const entry = document.createElement('div');
  entry.className = 'group';
  entry.innerHTML = `<h3>Werkzeuge</h3>
    <button id="sbm-open" type="button" class="tool-btn">Semantische Auswahl …</button>
    <div class="note">Kulturerbeobjekte über Ländergrenzen hinweg (Cocoda-Mapping)</div>`;
  document.getElementById('layerlist').after(entry);

  // Popup (wie der Dialog des QGIS-Plugins), verschiebbar und skalierbar
  const sec = document.createElement('div');
  sec.className = 'sbm sbm-dialog';
  sec.hidden = true;
  sec.innerHTML = `
    <div class="sbm-head"><div class="sbm-title">Semantische Auswahl – Kulturerbeobjekte (Epoche)</div>
      <button type="button" class="sbm-close" title="Schließen" aria-label="Schließen">×</button></div>
    <div class="sbm-body">
      <div class="sbm-col">
        <label class="sbm-row">Startlayer <select id="sbm-layer"></select></label>
        <button id="sbm-load" type="button">Epochen laden</button>
        <input id="sbm-filter" type="search" placeholder="Epochen filtern …" hidden>
        <div id="sbm-list" class="sbm-list" hidden></div>
      </div>
      <div class="sbm-col">
        <h4>Beziehungen</h4>
        <div id="sbm-rel" class="sbm-rel"></div>
        <h4>Ziel</h4>
        <div class="note">alle anderen Kulturerbeobjekte-Layer</div>
        <div class="sbm-actions">
          <button id="sbm-run" type="button" disabled>Auswahl anzeigen</button>
          <button id="sbm-clear" type="button" disabled>Ergebnis-Layer entfernen</button>
        </div>
        <div id="sbm-msg" class="note"></div>
        <div id="sbm-result" class="sbm-result"></div>
      </div>
    </div>`;
  document.querySelector('main').appendChild(sec);

  const $ = (id) => sec.querySelector('#' + id);
  const layerSel = $('sbm-layer'), listEl = $('sbm-list'), filterEl = $('sbm-filter');
  const loadBtn = $('sbm-load'), runBtn = $('sbm-run'), clearBtn = $('sbm-clear');
  const msgEl = $('sbm-msg'), resultEl = $('sbm-result');

  LOCAL_LAYERS.forEach((l) => layerSel.add(new Option(l.title, l.id)));
  $('sbm-rel').innerHTML = RELATIONS.map((r) =>
    `<label><input type="checkbox" value="${r}" ${DEFAULT_RELATIONS.has(r) ? 'checked' : ''}> ` +
    `<span class="swatch" style="background:${COLORS[r]}"></span>${r}</label>`).join('');

  const msg = (t, err) => { msgEl.textContent = t || ''; msgEl.classList.toggle('err', !!err); };
  const layerDef = () => LOCAL_LAYERS.find((l) => l.id === layerSel.value);

  // Ergebnis-Layer: jeder Lauf erzeugt einen eigenen Layer, der in "Eigene Daten" erscheint
  const results = [];   // {layer, row}
  let resultCounter = 0;

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/geo+json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function removeResult(entry) {
    map.removeLayer(entry.layer);
    entry.row.remove();
    results.splice(results.indexOf(entry), 1);
    const cnt = entry.group.querySelector('.gcount');
    if (cnt) cnt.textContent = ` (${entry.group.querySelectorAll('.layer').length})`;
    clearBtn.disabled = results.length === 0;
    if (typeof hideFeatureForm === 'function') hideFeatureForm();
  }

  function addResultLayer(features, title) {
    const source = new ol.source.Vector({ features });
    const layer = new ol.layer.Vector({ source, style: styleFor, zIndex: 100 + resultCounter++ });
    layer.set('title', title);
    map.addLayer(layer);

    const group = (typeof localGroupEl !== 'undefined' && localGroupEl) || document.getElementById('layerlist');
    if (group.tagName === 'DETAILS') group.open = true;
    const row = document.createElement('div');
    row.className = 'layer result-entry';
    const id = 'cb_' + Math.random().toString(36).slice(2);
    row.innerHTML = `<span class="swatch" style="background:${COLORS[SOURCE_TAG]}"></span>
      <input type="checkbox" id="${id}" checked><label for="${id}"></label>
      <button type="button" class="ico" data-act="zoom" title="Auf Ergebnis zoomen">⌖</button>
      <button type="button" class="ico" data-act="export" title="Als GeoJSON speichern">⤓</button>
      <button type="button" class="ico" data-act="remove" title="Layer entfernen">×</button>`;
    row.querySelector('label').textContent = title;
    row.querySelector('label').title = title;
    group.appendChild(row);
    const cnt = group.querySelector('.gcount');
    if (cnt) cnt.textContent = ` (${group.querySelectorAll('.layer').length})`;

    const entry = { layer, row, group };
    results.push(entry);
    row.querySelector('input').addEventListener('change', (e) => layer.setVisible(e.target.checked));
    row.addEventListener('click', (e) => {
      const act = e.target.closest('button') && e.target.closest('button').dataset.act;
      if (act === 'zoom') map.getView().fit(source.getExtent(), { padding: [40, 40, 40, 40], maxZoom: 13 });
      else if (act === 'export') {
        const json = geojson.writeFeatures(source.getFeatures(), {
          dataProjection: 'EPSG:4326', featureProjection: map.getView().getProjection(),
        });
        download(title.replace(/[^\wäöüÄÖÜß-]+/g, '_') + '.geojson', json);
      } else if (act === 'remove') removeResult(entry);
    });
    clearBtn.disabled = false;
    return source;
  }

  // ───────────────────────── 1. Epochen laden ─────────────────────────
  layerSel.addEventListener('change', () => {
    concepts = []; conceptsLayerId = null;
    listEl.hidden = filterEl.hidden = true; listEl.innerHTML = '';
    runBtn.disabled = true; msg('');
  });

  loadBtn.addEventListener('click', async () => {
    const l = layerDef();
    loadBtn.disabled = runBtn.disabled = true;
    listEl.hidden = filterEl.hidden = true;
    try {
      const found = new Map();
      let n = 0, hasField = false;
      for await (const f of readAll(l.url)) {
        const p = f.properties || {};
        const k = findKey(p, FIELD);
        if (!k) continue;
        hasField = true;
        const lk = findKey(p, FIELD + '_label');
        const uris = splitList(p[k]);
        const labels = lk ? splitList(p[lk]) : [];
        const aligned = labels.length === uris.length;
        uris.forEach((u, i) => {
          if (!found.has(u) || (found.get(u) === null && aligned)) found.set(u, aligned ? labels[i] : null);
        });
        if (++n % 5000 === 0) msg(`${l.title}: ${n} Objekte gelesen …`);
      }
      if (!hasField) throw new Error(`Feld "${FIELD}" nicht in ${l.title} gefunden`);

      // fehlende Labels nachladen (parallel, max. 5)
      const missing = [...found].filter(([, lab]) => !lab).map(([u]) => u);
      let idx = 0;
      const worker = async () => {
        while (idx < missing.length) {
          const u = missing[idx++];
          found.set(u, (await fetchLabel(u)) || u);
          msg(`Labels laden: ${idx}/${missing.length}`);
        }
      };
      await Promise.all(Array.from({ length: 5 }, worker));

      concepts = [...found].map(([uri, label]) => ({ uri, label: label || uri }))
        .sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }));
      conceptsLayerId = l.id;
      renderConcepts();
      msg(`${concepts.length} Epochen in ${l.title}`);
      runBtn.disabled = concepts.length === 0;
    } catch (err) {
      console.error(err);
      msg('Fehler beim Laden: ' + err.message, true);
    } finally {
      loadBtn.disabled = false;
    }
  });

  function renderConcepts() {
    const q = filterEl.value.trim().toLowerCase();
    const checked = new Set([...listEl.querySelectorAll('input:checked')].map((i) => i.value));
    listEl.innerHTML = '';
    concepts.forEach((c) => {
      if (q && !c.label.toLowerCase().includes(q) && !checked.has(c.uri)) return;
      const row = document.createElement('label');
      row.className = 'sbm-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = c.uri; cb.checked = checked.has(c.uri);
      row.append(cb, document.createTextNode(' ' + c.label));
      row.title = c.uri;
      listEl.appendChild(row);
    });
    listEl.hidden = filterEl.hidden = false;
  }
  filterEl.addEventListener('input', renderConcepts);

  // ───────────────────────── 2.–4. Auswahl berechnen ─────────────────────────
  async function collect(l, uriSet, tagFor) {
    const out = [];
    let n = 0;
    for await (const f of readAll(l.url)) {
      const p = f.properties || {};
      const k = findKey(p, FIELD);
      if (k) {
        const hit = splitList(p[k]).find((u) => uriSet.has(u));
        if (hit) out.push({ f, tag: tagFor(hit) });
      }
      if (++n % 5000 === 0) msg(`${l.title}: ${n} Objekte geprüft, ${out.length} Treffer …`);
    }
    return out;
  }

  runBtn.addEventListener('click', async () => {
    const start = layerDef();
    const checkedUris = [...listEl.querySelectorAll('input:checked')].map((i) => i.value);
    const rels = [...sec.querySelectorAll('#sbm-rel input:checked')].map((i) => i.value);
    if (!checkedUris.length) { msg('Bitte mindestens eine Epoche ankreuzen.', true); return; }
    if (!rels.length) { msg('Bitte mindestens eine Beziehung ankreuzen.', true); return; }

    loadBtn.disabled = runBtn.disabled = true;
    resultEl.innerHTML = '';
    try {
      // 2./3. Mappings
      msg('Mappings aus Cocoda laden …');
      const uriToRel = new Map();
      for (const uri of checkedUris) {
        for (const m of await getMappings(uri)) {
          if (rels.includes(m.relation) && !uriToRel.has(m.uri)) uriToRel.set(m.uri, m.relation);
        }
      }

      // 4. Objekte suchen
      const hits = [];
      const startHits = await collect(start, new Set(checkedUris), () => SOURCE_TAG);
      startHits.forEach((h) => hits.push({ layer: start.title, ...h }));

      if (uriToRel.size) {
        const targets = LOCAL_LAYERS.filter((l) => l.id !== start.id);
        const mappedSet = new Set(uriToRel.keys());
        for (const t of targets) {
          const th = await collect(t, mappedSet, (uri) => `${uriToRel.get(uri)} zu ${start.title}`);
          th.forEach((h) => hits.push({ layer: t.title, ...h }));
        }
      }

      const proj = map.getView().getProjection();
      const features = hits.map((h) => {
        const feat = geojson.readFeature(h.f, { dataProjection: 'EPSG:4326', featureProjection: proj });
        feat.setId(undefined);   // FlatGeobuf nummeriert pro Datei; gleiche IDs aus RLP und NI würden sich in der Source gegenseitig verdrängen
        feat.set('MatchTyp', h.tag);
        return feat;
      });

      // Zusammenfassung
      const counts = new Map();
      hits.forEach((h) => { const key = `${h.layer}|${h.tag}`; counts.set(key, (counts.get(key) || 0) + 1); });
      resultEl.innerHTML = [...counts].sort().map(([key, c]) => {
        const [layer, tag] = key.split('|');
        return `<div class="layer"><span class="swatch" style="background:${tagColor(tag)}"></span>` +
          `<span>${c} × ${layer}: ${tag}</span></div>`;
      }).join('');
      if (!uriToRel.size) resultEl.insertAdjacentHTML('afterbegin',
        '<div class="note">Keine Mappings mit den gewählten Beziehungen gefunden.</div>');

      msg(`${features.length} Objekte ausgewählt`);
      if (features.length) {
        const labels = checkedUris.map((u) => (concepts.find((c) => c.uri === u) || { label: u }).label);
        let list = labels.join(', ');
        if (list.length > 40) list = list.slice(0, 37) + '…';
        const source = addResultLayer(features, `Auswahl Epoche: ${list} (${start.title.replace(/^Kulturerbeobjekte\s+/, '')})`);
        map.getView().fit(source.getExtent(), { padding: [40, 40, 40, 40], maxZoom: 13 });
      }
    } catch (err) {
      console.error(err);
      msg('Fehler: ' + err.message, true);
    } finally {
      loadBtn.disabled = false;
      runBtn.disabled = conceptsLayerId !== layerSel.value;
    }
  });

  clearBtn.addEventListener('click', () => {
    [...results].forEach(removeResult);
    resultEl.innerHTML = ''; msg('');
  });

  // ───────────────────────── Popup: öffnen, schließen, verschieben ─────────────────────────
  let placed = false;
  document.getElementById('sbm-open').addEventListener('click', () => {
    sec.hidden = false;
    if (!placed) {
      const box = sec.parentElement;
      sec.style.left = Math.max(0, (box.clientWidth - sec.offsetWidth) / 2) + 'px';
      sec.style.top = Math.max(0, (box.clientHeight - sec.offsetHeight) / 2) + 'px';
      placed = true;
    }
  });
  sec.querySelector('.sbm-close').addEventListener('click', () => { sec.hidden = true; });

  let drag = null;
  sec.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('.sbm-head');
    if (!head || e.target.closest('button') || e.button !== 0) return;
    drag = { x: e.clientX - sec.offsetLeft, y: e.clientY - sec.offsetTop };
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  sec.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const box = sec.parentElement;
    sec.style.left = Math.min(Math.max(0, e.clientX - drag.x), box.clientWidth - 60) + 'px';
    sec.style.top = Math.min(Math.max(0, e.clientY - drag.y), box.clientHeight - 40) + 'px';
  });
  const endDrag = () => { drag = null; };
  sec.addEventListener('pointerup', endDrag);
  sec.addEventListener('pointercancel', endDrag);
})();

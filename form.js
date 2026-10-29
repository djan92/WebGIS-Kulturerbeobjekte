/* Feature-Formular – Web-Port von form_init.py (QGIS)
 * Stellt showFeatureForm(feature, layerTitle) und hideFeatureForm() bereit.
 */
(function () {
  // ───────────────────────── Konfiguration ─────────────────────────
  const FORM = {
    hideEmptyDefault: true,          // "Leere Felder ausblenden" beim Start aktiv
    previewTab: 'Identifikatoren',   // Reiter, an dessen Ende die Bildvorschau erscheint
    imageField: 'vorschaubild',
    titleFields: ['keo_bezeichnung', 'bezeichnung', 'name', 'titel', 'label'],   // erstes befülltes Feld = Überschrift

    // Reiter wie im QGIS-Formular (Zuordnung der Felder ist eine Annahme – bitte prüfen).
    // Felder, die in keinem Reiter stehen, landen in "Weitere". Hat ein Objekt (z. B. aus
    // einem anderen Bundesland) keines dieser Felder, wird stattdessen ein Reiter "Attribute" gezeigt.
    tabs: [
      { name: 'Identifikatoren', fields: [
        'pid', 'interne_id', 'weitere_datenverknuepfung', 'keo_bezeichnung',
      ] },
      { name: 'Beschreibung', fields: [
        'beschreibung', 'erweiterte_beschreibung', 'typ', 'datierung', 'datierung_von',
        'datierung_nach', 'datierung_abgeleitet', 'epoche', 'typ_epoche_zuordnung',
        'weitere_datierungsinformationen', 'literatur', 'obertaegige_sichtbarkeit',
        'vorschaubild', 'verweis_link', 'verweis_beschreibung',
      ] },
      { name: 'Verortung', fields: [
        'koordinatenbezugssystem', 'lagegenauigkeit', 'datenerhebungsqualitaet',
        'translozierung', 'transloziert_standort', 'lagebezeichnung_adresse',
        'lagebezeichnung_ags', 'lagebezeichnung_geonames', 'lagebezeichnung_freitext', 'befundfrei',
      ] },
      { name: 'Verantwortlichkeit und Technische Metadaten', fields: [
        'fachbehoerde', 'genehmigungsbehoerde', 'datenhaltende_institution',
        'datenhaltendes_system', 'letzte_aenderung', 'datenexport', 'datenerstellung',
        'lizenz', 'urheber', 'bemerkung',
      ] },
    ],

    // Anzeigenamen (Alias) pro Feld, sonst wird der Feldname angezeigt
    aliases: {},

    // Komma = neue Zeile, enthaltene URLs werden automatisch verlinkt
    commaBreak: new Set([
      'weitere_datenverknuepfung', 'typ', 'epoche', 'verweis_link',
      'fachbehoerde', 'datenhaltende_institution',
      'lagebezeichnung_geonames', 'urheber',
      'vorschaubild', 'massnahmentyp', 'schutzflächen',
    ]),

    // URI-Feld -> zugehöriges Label-Feld (Label-Feld selbst wird nicht angezeigt)
    labelLinked: { epoche: 'epoche_label', typ: 'typ_label' },
  };

  const URL_PATTERN = /(https?:\/\/[^\s,<]+)/g;
  const HIDDEN = new Set(Object.values(FORM.labelLinked));
  HIDDEN.add('MatchTyp');   // wird als Badge im Kopf angezeigt (Ergebnis der semantischen Auswahl)
  const infoEl = document.getElementById('info');

  let hideEmpty = FORM.hideEmptyDefault;
  let lastTab = null;
  let placed = false;   // Position/Größe bleiben nach dem ersten Öffnen erhalten

  // ───────────────────────── Rendering-Helfer ─────────────────────────
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

  // Feldname -> Anzeigename: Unterstriche als Leerzeichen, erster Buchstabe groß
  const prettyLabel = (n) => {
    const t = String(n).replace(/_/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  const isHttp =(u) => /^https?:\/\//i.test(u);

  const autolink = (escaped) =>
    escaped.replace(URL_PATTERN, '<a href="$1" target="_blank" rel="noopener">$1</a>');

  function toText(v) {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(toText).join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  function renderCommaBroken(raw) {
    return raw.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => autolink(esc(s)))
      .join('<br>');
  }

  function renderUriWithLabel(uriValue, labelValue) {
    const uris = uriValue.split(',').map((s) => s.trim()).filter(Boolean);
    const labels = labelValue.split(',').map((s) => s.trim()).filter(Boolean);
    return uris.map((uri, i) => {
      const label = i < labels.length ? labels[i] : uri;
      return isHttp(uri)
        ? `<a href="${esc(uri)}" target="_blank" rel="noopener">${esc(label)}</a>`
        : esc(label);
    }).join('<br>');
  }

  function autolinkFreeText(raw) {
    return autolink(esc(raw)).replace(/\n/g, '<br>');
  }

  function renderValue(name, raw, props) {
    if (FORM.labelLinked[name]) {
      return renderUriWithLabel(raw, toText(props[FORM.labelLinked[name]]));
    }
    if (FORM.commaBreak.has(name)) return renderCommaBroken(raw);
    return autolinkFreeText(raw);
  }

  // ───────────────────────── Formular ─────────────────────────
  function showFeatureForm(feature, layerTitle) {
    const props = Object.assign({}, feature.getProperties());
    delete props[feature.getGeometryName()];

    // Reiter bestimmen
    const names = Object.keys(props).filter((n) => !HIDDEN.has(n));
    let tabs;
    const configured = new Set(FORM.tabs.flatMap((t) => t.fields));
    if (FORM.tabs.length && names.some((n) => configured.has(n))) {
      tabs = FORM.tabs.map((t) => ({ name: t.name, fields: t.fields.filter((f) => !HIDDEN.has(f)) }));
      const used = new Set(tabs.flatMap((t) => t.fields));
      const rest = names.filter((n) => !used.has(n));
      if (rest.length) tabs.push({ name: 'Weitere', fields: rest });
    } else {
      tabs = [{ name: 'Attribute', fields: names }];
    }

    const rowHtml = (name) => {
      const raw = toText(props[name]);
      const empty = !raw.trim();
      const label = FORM.aliases[name] || prettyLabel(name);
      const value = empty ? '' : renderValue(name, raw, props);
      return `<div class="ff-row" data-empty="${empty ? 1 : 0}">` +
        `<div class="ff-label">${esc(label)}</div><div class="ff-value">${value}</div></div>`;
    };

    // Bildvorschau am Ende des Reiters "Identifikatoren" (sonst im ersten Reiter)
    const previewUrls = toText(props[FORM.imageField]).match(URL_PATTERN) || [];
    let previewIdx = tabs.findIndex((t) => t.name === FORM.previewTab);
    if (previewIdx < 0) previewIdx = 0;

    const pagesHtml = tabs.map((t, i) => {
      const previews = i === previewIdx
        ? previewUrls.map((u) =>
            `<div class="ff-preview"><img src="${esc(u)}" alt="Vorschaubild" loading="lazy" ` +
            `referrerpolicy="no-referrer" ` +
            `onerror="this.replaceWith(document.createTextNode('Vorschaubild konnte nicht geladen werden'))"></div>`
          ).join('')
        : '';
      return `<div class="ff-page" hidden>${t.fields.map(rowHtml).join('')}${previews}` +
        `<div class="ff-none" hidden>Keine Einträge</div></div>`;
    }).join('');

    const titleKey = FORM.titleFields.find((k) => toText(props[k]).trim());
    const title = titleKey ? toText(props[titleKey]).trim() : (layerTitle || 'Objekt');
    const sub = titleKey && layerTitle ? layerTitle : '';

    infoEl.innerHTML =
      `<div class="ff-head"><div><div class="ff-title"></div><div class="ff-sub"></div></div>` +
      `<button class="ff-close" title="Schließen" aria-label="Schließen">×</button></div>` +
      `<div class="ff-foot"><label><input type="checkbox" class="ff-hide-empty"> Leere Felder ausblenden</label></div>` +
      `<div class="ff-tabs" role="tablist">${tabs.map(() => '<button class="ff-tab" role="tab"></button>').join('')}</div>` +
      `<div class="ff-body">${pagesHtml}</div>`;

    infoEl.querySelector('.ff-title').textContent = title;
    infoEl.querySelector('.ff-sub').textContent = sub;
    if (props.MatchTyp) {
      const b = document.createElement('span');
      b.className = 'ff-badge';
      b.textContent = props.MatchTyp;
      infoEl.querySelector('.ff-sub').appendChild(b);
    }

    const tabBtns = [...infoEl.querySelectorAll('.ff-tab')];
    const pages = [...infoEl.querySelectorAll('.ff-page')];
    tabBtns.forEach((b, i) => { b.textContent = tabs[i].name; b.onclick = () => activate(i); });

    function activate(i) {
      tabBtns.forEach((b, j) => b.classList.toggle('active', j === i));
      pages.forEach((p, j) => { p.hidden = j !== i; });
      lastTab = tabs[i].name;
    }

    function refresh() {
      let firstVisible = -1;
      pages.forEach((p, i) => {
        let filled = 0;
        p.querySelectorAll('.ff-row').forEach((r) => {
          const empty = r.dataset.empty === '1';
          r.hidden = hideEmpty && empty;
          if (!empty) filled++;
        });
        const has = filled > 0 || !!p.querySelector('.ff-preview');
        tabBtns[i].hidden = hideEmpty && !has;
        p.querySelector('.ff-none').hidden = !(hideEmpty && !has);
        if (!tabBtns[i].hidden && firstVisible < 0) firstVisible = i;
      });
      if (firstVisible < 0) { tabBtns[0].hidden = false; firstVisible = 0; }
      const active = tabBtns.findIndex((b) => b.classList.contains('active'));
      if (active < 0 || tabBtns[active].hidden) activate(firstVisible);
    }

    const cb = infoEl.querySelector('.ff-hide-empty');
    cb.checked = hideEmpty;
    cb.onchange = () => { hideEmpty = cb.checked; refresh(); };
    infoEl.querySelector('.ff-close').onclick = hideFeatureForm;

    const startIdx = Math.max(0, tabs.findIndex((t) => t.name === lastTab));
    activate(startIdx);
    refresh();
    infoEl.hidden = false;
    if (!placed) { centerForm(); placed = true; }
  }

  function hideFeatureForm() { infoEl.hidden = true; }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideFeatureForm(); });

  // ───────────────────────── Fenster verschieben ─────────────────────────
  function centerForm() {
    const box = infoEl.parentElement;
    infoEl.style.left = Math.max(0, (box.clientWidth - infoEl.offsetWidth) / 2) + 'px';
    infoEl.style.top = Math.max(0, (box.clientHeight - infoEl.offsetHeight) / 2) + 'px';
  }

  let drag = null;
  infoEl.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('.ff-head');
    if (!head || e.target.closest('button') || e.button !== 0) return;
    drag = { x: e.clientX - infoEl.offsetLeft, y: e.clientY - infoEl.offsetTop };
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  infoEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const box = infoEl.parentElement;
    const x = Math.min(Math.max(0, e.clientX - drag.x), box.clientWidth - 60);
    const y = Math.min(Math.max(0, e.clientY - drag.y), box.clientHeight - 40);
    infoEl.style.left = x + 'px';
    infoEl.style.top = y + 'px';
  });
  const endDrag = () => { drag = null; };
  infoEl.addEventListener('pointerup', endDrag);
  infoEl.addEventListener('pointercancel', endDrag);

  window.showFeatureForm = showFeatureForm;
  window.hideFeatureForm = hideFeatureForm;
})();

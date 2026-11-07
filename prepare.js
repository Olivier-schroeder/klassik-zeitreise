// Prepare page: choose the Spotify recording and start time for each card, export cards.json.
(function () {
  const KZ = window.KZ;
  const { el, spotify } = KZ;
  const main = document.getElementById("main");
  let cards = [];
  const hits = {}; // card id -> search results
  let message = "";

  const overrides = () => KZ.local.get("kz.overrides", {});
  function setOverride(id, patch) {
    const all = overrides();
    all[id] = Object.assign({}, all[id] || {}, patch);
    KZ.local.set("kz.overrides", all);
    const c = cards.find((x) => x.id === id);
    Object.assign(c, patch);
  }

  const trackLabel = (t) =>
    t.name + " · " + t.artists.map((a) => a.name).join(", ") + " · " + t.album.name + " (" + KZ.fmtTime(t.duration_ms) + ")";

  function render() {
    const parts = [];
    if (!spotify.isConfigured()) {
      parts.push(el("div", { class: "panel warn" }, el("p", {}, "In config.js fehlt die Spotify-Client-ID (README, Schritt 2).")));
    } else if (!spotify.isLoggedIn()) {
      parts.push(
        el(
          "div",
          { class: "panel stack" },
          el("p", {}, "Mit Spotify verbinden, um Aufnahmen zu suchen und anzuhören."),
          el("button", { class: "btn btn-primary", onclick: () => spotify.login(location.href) }, "Mit Spotify verbinden")
        )
      );
    }
    parts.push(
      el(
        "div",
        { class: "toolbar" },
        el("button", { class: "btn btn-primary btn-small", onclick: exportJson }, "cards.json herunterladen"),
        el("button", { class: "btn btn-small", onclick: () => spotify.pause() }, "⏸ Pause"),
        el("button", { class: "btn btn-ghost btn-small", onclick: resetAll }, "Änderungen verwerfen"),
        el("span", { class: "muted" }, message)
      )
    );
    const filterBox = el("input", { type: "text", class: "grow", placeholder: "Filter: Komponist, Titel oder Jahr", value: filter.text });
    filterBox.addEventListener("input", () => {
      filter.text = filterBox.value;
      renderList();
    });
    const only = (key, label) => {
      const box = el("input", { type: "checkbox", checked: filter[key] });
      box.addEventListener("change", () => {
        filter[key] = box.checked;
        renderList();
      });
      return el("label", {}, box, label);
    };
    parts.push(el("div", { class: "row", style: "justify-content:flex-start" }, filterBox, only("noTrack", "nur ohne Aufnahme"), only("check", "nur „Jahr prüfen“")));
    const listBox = el("div", { class: "stack", id: "card-list" });
    parts.push(listBox);
    main.replaceChildren(...parts);
    renderList();
  }

  const filter = { text: "", noTrack: false, check: false };
  const PAGE = 40;
  function renderList() {
    const box = document.getElementById("card-list");
    if (!box) return;
    const q = filter.text.trim().toLowerCase();
    const shown = cards.filter(
      (c) =>
        (!q || (c.composer + " " + c.title + " " + c.year).toLowerCase().includes(q)) &&
        (!filter.noTrack || !c.spotify) &&
        (!filter.check || c.check)
    );
    const done = cards.filter((c) => c.spotify).length;
    const head = el("div", { class: "muted" }, `${shown.length} von ${cards.length} Karten · ${done} mit gewählter Aufnahme`);
    const items = shown.slice(0, PAGE).map(cardPanel);
    const more = shown.length > PAGE ? el("div", { class: "muted" }, `… und ${shown.length - PAGE} weitere. Filter benutzen, um sie zu sehen.`) : null;
    box.replaceChildren(head, ...items, ...(more ? [more] : []));
  }

  function cardPanel(c) {
    const query = el("input", { type: "text", class: "grow", value: c.query || "" });
    const startInput = el("input", { type: "text", value: KZ.fmtTime(c.start_ms), size: "6", "aria-label": "Start (m:ss)" });
    startInput.addEventListener("change", () => {
      const ms = KZ.parseTime(startInput.value);
      if (ms === null) startInput.value = KZ.fmtTime(c.start_ms);
      else setOverride(c.id, { start_ms: ms });
    });

    const list = el(
      "div",
      { class: "hits" },
      (hits[c.id] || []).map((t) =>
        el(
          "div",
          { class: "hit" + (t.uri === c.spotify ? " chosen" : "") },
          el("div", { class: "info" }, el("b", {}, t.name), el("div", { class: "muted" }, t.artists.map((a) => a.name).join(", ") + " · " + t.album.name + " · " + KZ.fmtTime(t.duration_ms))),
          el("button", { class: "btn btn-small", onclick: () => tryPlay(t.uri, c.start_ms) }, "▶ ab Start"),
          el(
            "button",
            {
              class: "btn btn-small" + (t.uri === c.spotify ? " btn-primary" : ""),
              onclick: () => {
                setOverride(c.id, { spotify: t.uri, spotify_label: trackLabel(t) });
                render();
              },
            },
            t.uri === c.spotify ? "Gewählt ✓" : "Wählen"
          )
        )
      )
    );

    return el(
      "section",
      { class: "panel stack" },
      el("div", { class: "card-head" }, el("h2", {}, c.composer + ": " + c.title), el("span", { class: "yr" }, String(c.year) + (c.year_note ? " (" + c.year_note + ")" : ""))),
      c.check ? el("div", { class: "muted", style: "color:var(--danger)" }, "⚠ Jahr noch prüfen (z. B. Wikipedia), dann in data/*.tsv die 1 in der Spalte check löschen") : null,
      el("div", { class: "muted" }, "Karte " + c.id + " · Aufnahme: " + (c.spotify ? c.spotify_label || c.spotify : "noch keine gewählt (im Spiel wird das erste Suchergebnis genommen)")),
      el(
        "label",
        {},
        "Start bei",
        startInput,
        el("button", { class: "btn btn-small", onclick: () => takePosition(c, startInput) }, "Aktuelle Position übernehmen"),
        c.spotify ? el("button", { class: "btn btn-small", onclick: () => tryPlay(c.spotify, c.start_ms) }, "▶ Gewählte ab Start") : null
      ),
      el(
        "label",
        {},
        "Suche",
        query,
        el(
          "button",
          {
            class: "btn btn-small",
            onclick: async () => {
              setOverride(c.id, { query: query.value });
              try {
                hits[c.id] = await spotify.search(query.value, 8);
                message = "";
              } catch (e) {
                message = e.message;
              }
              render();
            },
          },
          "Suchen"
        )
      ),
      list
    );
  }

  async function tryPlay(uri, startMs) {
    const r = await spotify.play(uri, startMs);
    message = r.ok ? "Spielt …" : r.reason === "no_device" ? "Öffne zuerst Spotify (App oder Web-Player) und starte kurz irgendein Lied." : "Fehler: " + (r.detail || r.reason);
    render();
  }

  async function takePosition(c, input) {
    const st = await spotify.state();
    if (!st || !st.item) {
      message = "Gerade läuft nichts auf Spotify.";
      return render();
    }
    const ms = Math.floor(st.progress_ms / 1000) * 1000;
    const patch = { start_ms: ms };
    if (st.item.uri !== c.spotify) {
      patch.spotify = st.item.uri;
      patch.spotify_label = trackLabel(st.item);
    }
    setOverride(c.id, patch);
    message = "Start für " + c.composer + " auf " + KZ.fmtTime(ms) + " gesetzt.";
    render();
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(cards, null, 2) + "\n"], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "cards.json" });
    document.body.append(a);
    a.click();
    a.remove();
    message = "Heruntergeladen. Ersetze damit cards.json im Projektordner.";
    render();
  }

  async function resetAll() {
    if (!confirm("Alle hier gemachten Änderungen auf diesem Gerät verwerfen?")) return;
    KZ.local.del("kz.overrides");
    cards = await KZ.loadCards();
    render();
  }

  (async function init() {
    cards = await KZ.loadCards();
    render();
  })();
})();

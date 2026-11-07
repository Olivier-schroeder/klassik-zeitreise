// Prepare page: choose the Spotify recording and start time for each card, export cards.json.
// "Automatisch auswählen" searches every card without a recording, scores the hits
// (KZ.scoreTrack) and keeps the best one; uncertain picks can then be reviewed with a filter.
(function () {
  const KZ = window.KZ;
  const { el, spotify } = KZ;
  const main = document.getElementById("main");
  let cards = [];
  const hits = {}; // card id -> [{track, score}]
  let message = "";
  const auto = { running: false, stop: false, done: 0, total: 0 };

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
  const isUnsure = (c) => c.spotify && c.auto_score != null && c.auto_score < 0.85;
  const scoreBadge = (s) =>
    s == null ? null : el("span", { class: "badge badge-" + KZ.scoreLabel(s) }, KZ.scoreLabel(s) + " " + Math.round(s * 100) + "%");

  // Chooses a track for a card; a suggested start beyond the end of this recording falls back to 0.
  function choose(c, t, score) {
    const patch = { spotify: t.uri, spotify_label: trackLabel(t), auto_score: score };
    if (c.start_ms && t.duration_ms && c.start_ms > t.duration_ms - 20000) patch.start_ms = 0;
    setOverride(c.id, patch);
  }

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
    const missing = cards.filter((c) => !c.spotify).length;
    parts.push(
      el(
        "div",
        { class: "toolbar" },
        auto.running
          ? el("button", { class: "btn btn-small", onclick: () => (auto.stop = true) }, `⏹ Stopp (${auto.done}/${auto.total})`)
          : el(
              "button",
              { class: "btn btn-primary btn-small", disabled: !spotify.isLoggedIn() || !missing, onclick: autoPick },
              `Automatisch auswählen (${missing} ohne Aufnahme)`
            ),
        el("button", { class: "btn btn-primary btn-small", onclick: exportJson }, "cards.json herunterladen"),
        el("button", { class: "btn btn-small", onclick: () => spotify.pause() }, "⏸ Pause"),
        spotify.isLoggedIn()
          ? el(
              "button",
              {
                class: "btn btn-ghost btn-small",
                onclick: () => {
                  spotify.logout();
                  message = "Abgemeldet. Zum Kontowechsel vorher auf accounts.spotify.com abmelden.";
                  render();
                },
              },
              "Spotify abmelden"
            )
          : null,
        el("button", { class: "btn btn-ghost btn-small", onclick: resetAll }, "Änderungen verwerfen"),
        el("span", { class: "muted", id: "message" }, message)
      )
    );
    const filterBox = el("input", { type: "text", class: "grow", style: "min-width:280px", placeholder: "Filter: Komponist, Titel oder Jahr", value: filter.text });
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
    parts.push(
      el(
        "div",
        { class: "row", style: "justify-content:flex-start" },
        filterBox,
        only("noTrack", "nur ohne Aufnahme"),
        only("unsure", "nur unsichere Auswahl"),
        only("hint", "nur mit Starthinweis"),
        only("check", "nur „Jahr prüfen“")
      )
    );
    parts.push(el("div", { class: "stack", id: "card-list" }));
    main.replaceChildren(...parts);
    renderList();
  }

  const filter = { text: "", noTrack: false, unsure: false, hint: false, check: false };
  const PAGE = 40;
  function renderList() {
    const box = document.getElementById("card-list");
    if (!box) return;
    const q = filter.text.trim().toLowerCase();
    const shown = cards.filter(
      (c) =>
        (!q || (c.composer + " " + c.title + " " + c.year).toLowerCase().includes(q)) &&
        (!filter.noTrack || !c.spotify) &&
        (!filter.unsure || isUnsure(c)) &&
        (!filter.hint || c.hint) &&
        (!filter.check || c.check)
    );
    const done = cards.filter((c) => c.spotify).length;
    const unsure = cards.filter(isUnsure).length;
    const head = el("div", { class: "muted" }, `${shown.length} von ${cards.length} Karten · ${done} mit Aufnahme · ${unsure} davon unsicher`);
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
      (hits[c.id] || []).map(({ track: t, score }) =>
        el(
          "div",
          { class: "hit" + (t.uri === c.spotify ? " chosen" : "") },
          el(
            "div",
            { class: "info" },
            el("b", {}, t.name),
            " ",
            scoreBadge(score),
            el("div", { class: "muted" }, t.artists.map((a) => a.name).join(", ") + " · " + t.album.name + " · " + KZ.fmtTime(t.duration_ms))
          ),
          el("button", { class: "btn btn-small", onclick: () => tryPlay(t.uri, c.start_ms) }, "▶ ab Start"),
          el(
            "button",
            {
              class: "btn btn-small" + (t.uri === c.spotify ? " btn-primary" : ""),
              onclick: () => {
                choose(c, t, null); // chosen by a person: no longer "unsicher"
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
      c.check ? el("div", { class: "muted", style: "color:var(--danger)" }, "⚠ Jahr noch prüfen (z. B. Wikipedia), dann in data/pieces_*.tsv die 1 in der Spalte check löschen") : null,
      c.hint ? el("div", { class: "hint" }, "💡 " + c.hint) : null,
      el(
        "div",
        { class: "muted" },
        "Karte " + c.id + " · Aufnahme: " + (c.spotify ? c.spotify_label || c.spotify : "noch keine gewählt (im Spiel wird der beste Suchtreffer genommen)"),
        " ",
        c.spotify ? scoreBadge(c.auto_score) : null,
        c.spotify && c.auto_score != null
          ? el(
              "button",
              {
                class: "btn btn-small",
                style: "margin-left:8px",
                onclick: () => {
                  setOverride(c.id, { auto_score: null });
                  render();
                },
              },
              "Passt ✓"
            )
          : null
      ),
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
                const seen = new Map();
                for (const q of KZ.queryAlternatives(query.value)) for (const t of await spotify.search(q, 10)) seen.set(t.uri, t);
                hits[c.id] = [...seen.values()].map((t) => ({ track: t, score: KZ.scoreTrack(c, t) })).sort((a, b) => b.score - a.score).slice(0, 10);
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

  async function autoPick() {
    const todo = cards.filter((c) => !c.spotify);
    Object.assign(auto, { running: true, stop: false, done: 0, total: todo.length });
    render();
    let failed = 0;
    for (const c of todo) {
      if (auto.stop) break;
      try {
        const best = await spotify.pickBest(c, 10);
        if (best) choose(c, best.track, best.score);
        else failed++;
      } catch (e) {
        message = e.message;
        failed++;
        if (/zu viele Anfragen|401/.test(e.message)) break;
      }
      auto.done++;
      if (auto.done % 5 === 0 || auto.done === auto.total) render();
      await new Promise((r) => setTimeout(r, 120)); // stay well below Spotify's rate limit
    }
    auto.running = false;
    const unsure = cards.filter(isUnsure).length;
    message = `${auto.done} Karten durchsucht${failed ? `, ${failed} ohne Treffer` : ""}. ${unsure} unsichere Auswahl — Filter „nur unsichere Auswahl“ zum Nachhören. Danach cards.json herunterladen.`;
    render();
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
      patch.auto_score = null;
    }
    setOverride(c.id, patch);
    message = "Start für " + c.composer + " auf " + KZ.fmtTime(ms) + " gesetzt.";
    render();
  }

  function exportJson() {
    const out = cards.map((c) => {
      const copy = Object.assign({}, c);
      if (copy.auto_score == null) delete copy.auto_score;
      return copy;
    });
    const blob = new Blob([JSON.stringify(out, null, 2) + "\n"], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "cards.json" });
    document.body.append(a);
    a.click();
    a.remove();
    message = "Heruntergeladen. Ersetze damit cards.json im Projektordner (oder schick sie Olivier).";
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

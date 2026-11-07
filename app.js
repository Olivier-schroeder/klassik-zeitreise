// Game page: scan a card, play its piece without showing what it is.
(function () {
  const KZ = window.KZ;
  const { el, spotify } = KZ;
  const main = document.getElementById("main");
  const footer = document.getElementById("footer");
  document.getElementById("game-name").textContent = KZ.gameName;
  document.title = KZ.gameName;

  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/></svg>';

  const S = {
    cards: [],
    card: null, // current card
    mode: null, // "spotify" | "audio"
    started: false,
    playing: false,
    busy: false,
    status: "",
    problem: null, // {kind, text}
    revealed: false,
    audio: null,
  };

  // ---------- rendering ----------
  function render() {
    main.replaceChildren(...(S.card ? cardView() : homeView()));
    footer.replaceChildren(...footerView());
  }

  function homeView() {
    const parts = [];
    if (S.problem) parts.push(problemPanel());
    parts.push(
      el("p", { class: "status" }, "Scanne eine Karte, hör zu und leg sie an die richtige Stelle deiner Zeitleiste."),
      el("button", { class: "btn btn-primary", onclick: scan }, "Karte scannen")
    );
    parts.push(...spotifyBox());
    return parts;
  }

  function cardView() {
    const c = S.card;
    const parts = [];
    const btn = el("button", {
      class: "big-play" + (S.playing ? " playing" : ""),
      "aria-label": S.playing ? "Pause" : "Abspielen",
      disabled: S.busy,
      onclick: toggle,
    });
    btn.innerHTML = S.playing ? ICON_PAUSE : ICON_PLAY;
    parts.push(btn, el("p", { class: "status", "aria-live": "polite" }, S.status));
    if (S.problem) parts.push(problemPanel());
    if (!spotify.isLoggedIn() && !c.audio) parts.push(...spotifyBox());

    parts.push(
      el(
        "div",
        { class: "row" },
        el("button", { class: "btn", disabled: S.busy || !S.started, onclick: () => start(true) }, "↺ Von vorne"),
        el("button", { class: "btn", onclick: scan }, "Nächste Karte")
      )
    );
    if (S.revealed) {
      parts.push(
        el(
          "div",
          { class: "panel answer" },
          el("div", { class: "year" }, String(c.year)),
          el("div", { class: "composer" }, c.composer),
          el("div", { class: "title" }, c.title)
        )
      );
    } else {
      parts.push(
        el("div", { class: "row" }, el("button", { class: "link", onclick: reveal }, "Lösung anzeigen"))
      );
    }
    return parts;
  }

  function spotifyBox() {
    if (!spotify.isConfigured()) {
      return [
        el(
          "div",
          { class: "panel warn" },
          el("p", {}, "Spotify ist noch nicht eingerichtet: In config.js fehlt die Client-ID (siehe README).")
        ),
      ];
    }
    if (spotify.isLoggedIn()) return [];
    return [
      el(
        "div",
        { class: "panel stack" },
        el("p", {}, "Einmal pro Handy mit Spotify Premium verbinden, dann spielt die Musik über deine Spotify-App."),
        el("button", { class: "btn btn-primary", onclick: () => spotify.login(currentReturnUrl()) }, "Mit Spotify verbinden")
      ),
    ];
  }

  function problemPanel() {
    const p = S.problem;
    const kids = [el("p", {}, p.text)];
    if (p.kind === "no_device") {
      kids.push(
        el(
          "div",
          { class: "row" },
          el("a", { class: "btn", href: "spotify:" }, "Spotify öffnen"),
          el("button", { class: "btn btn-primary", onclick: () => start(true) }, "Nochmal versuchen")
        )
      );
    }
    if (p.kind === "login") {
      kids.push(el("button", { class: "btn btn-primary", onclick: () => spotify.login(currentReturnUrl()) }, "Mit Spotify verbinden"));
    }
    return el("div", { class: "panel warn stack" }, kids);
  }

  function footerView() {
    const items = [];
    if (spotify.isLoggedIn()) {
      items.push(
        el(
          "div",
          {},
          el("span", { class: "okline" }, "Spotify verbunden ✓ "),
          el(
            "button",
            {
              class: "link",
              onclick: () => {
                spotify.logout();
                render();
              },
            },
            "abmelden"
          )
        )
      );
    }
    return items;
  }

  function currentReturnUrl() {
    return S.card ? KZ.cardUrl(S.card.id) : location.href;
  }

  // ---------- actions ----------
  function scan() {
    stopAll();
    KZ.openScanner((text) => {
      const id = KZ.parseCardId(text);
      openCard(id, true);
    });
  }

  function openCard(id, autoplay) {
    const card = S.cards.find((c) => c.id === id);
    Object.assign(S, { card: null, mode: null, started: false, playing: false, busy: false, status: "", problem: null, revealed: false });
    if (!card) {
      S.problem = { kind: "unknown", text: "Diese Karte gehört nicht zum Spiel (oder der Code war nicht lesbar)." };
      render();
      return;
    }
    S.card = card;
    S.mode = spotify.isLoggedIn() ? "spotify" : card.audio ? "audio" : null;
    S.status = S.mode ? "Tippe zum Abspielen" : "";
    render();
    if (autoplay && S.mode === "spotify") start(false);
  }

  async function start(fromBeginning) {
    const c = S.card;
    if (!c) return;
    S.problem = null;
    if (S.mode === "audio") return startAudio();
    if (!spotify.isLoggedIn()) {
      S.problem = { kind: "login", text: "Bitte zuerst mit Spotify verbinden." };
      return render();
    }
    S.busy = true;
    S.status = "Musik wird gestartet …";
    render();
    try {
      const uri = await spotify.resolveUri(c);
      if (!uri) throw new Error("Kein passender Titel auf Spotify gefunden.");
      const r = await spotify.play(uri, c.start_ms || 0);
      if (r.ok) {
        Object.assign(S, { started: true, playing: true, status: "Läuft …" });
      } else {
        S.playing = false;
        S.status = "";
        S.problem = problemFor(r);
      }
    } catch (e) {
      S.playing = false;
      S.status = "";
      S.problem = { kind: "error", text: e.message || String(e) };
    }
    S.busy = false;
    render();
  }

  function problemFor(r) {
    if (r.reason === "no_device")
      return {
        kind: "no_device",
        text: "Spotify ist auf diesem Handy gerade nicht aktiv. Öffne kurz die Spotify-App, starte irgendein Lied und pausiere es, komm hierher zurück und tippe auf „Nochmal versuchen“.",
      };
    if (r.reason === "premium")
      return {
        kind: "premium",
        text: "Spotify hat die Wiedergabe abgelehnt. Das Konto braucht Premium und muss für das Spiel freigeschaltet sein (README, Schritt 2).",
      };
    if (r.reason === "login") return { kind: "login", text: "Die Spotify-Verbindung ist abgelaufen. Bitte neu verbinden." };
    return { kind: "error", text: "Spotify-Fehler: " + (r.detail || "unbekannt") };
  }

  async function toggle() {
    if (!S.card || S.busy) return;
    if (S.mode === "audio") {
      if (S.playing) {
        S.audio.pause();
        Object.assign(S, { playing: false, status: "Pausiert" });
        return render();
      }
      return S.started ? resumeAudio() : startAudio();
    }
    if (!S.started) return start(false);
    S.busy = true;
    render();
    if (S.playing) {
      await spotify.pause();
      Object.assign(S, { playing: false, status: "Pausiert" });
    } else {
      const ok = await spotify.resume();
      if (ok) Object.assign(S, { playing: true, status: "Läuft …" });
      else {
        S.busy = false;
        return start(true);
      }
    }
    S.busy = false;
    render();
  }

  // Fallback without Spotify: an audio file from cards.json ("audio"), played in the browser.
  function startAudio() {
    const c = S.card;
    if (!S.audio) {
      S.audio = new Audio();
      S.audio.addEventListener("ended", () => {
        Object.assign(S, { playing: false, status: "Zu Ende" });
        render();
      });
    }
    S.audio.src = c.audio;
    S.audio.currentTime = (c.start_ms || 0) / 1000;
    return resumeAudio();
  }
  function resumeAudio() {
    return S.audio
      .play()
      .then(() => Object.assign(S, { started: true, playing: true, status: "Läuft …" }))
      .catch((e) => (S.problem = { kind: "error", text: "Audio konnte nicht abgespielt werden: " + e.message }))
      .then(render);
  }

  function stopAll() {
    if (S.audio) S.audio.pause();
    if (S.mode === "spotify" && S.playing) spotify.pause();
    S.playing = false;
  }

  function reveal() {
    if (confirm("Lösung wirklich anzeigen?")) {
      S.revealed = true;
      render();
    }
  }

  // ---------- start ----------
  (async function init() {
    let cardId = KZ.parseCardId(location.href);
    const redirect = await spotify.handleRedirect();
    if (redirect && redirect.error) S.problem = { kind: "error", text: redirect.error };
    if (redirect && redirect.returnTo) {
      // Spotify always returns to this page; go back to the page that started the login.
      const back = new URL(redirect.returnTo, location.href);
      const norm = (p) => p.replace(/index\.html$/, "");
      if (norm(back.pathname) !== norm(location.pathname)) return location.replace(back.href);
      cardId = KZ.parseCardId(redirect.returnTo);
    }
    // Keep the address bar clean so a reload doesn't replay an old card.
    if (location.search) history.replaceState(null, "", location.pathname);
    try {
      S.cards = await KZ.loadCards();
    } catch (e) {
      S.problem = { kind: "error", text: e.message };
    }
    if (cardId) {
      const problem = S.problem;
      openCard(cardId, true);
      if (problem && !S.problem) {
        S.problem = problem;
        render();
      }
    } else render();
  })();
})();

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
    device: null, // Spotify device the music plays on
    account: null, // Spotify account the game is connected with
    devices: null, // device list while choosing one by hand
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
    if (spotify.isLoggedIn() && spotify.isPhone() && KZ.webPlayer.failed) parts.push(preparePanel());
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
    if (S.mode === "spotify" && S.device && !S.devices)
      parts.push(el("p", { class: "status device" }, "🔊 Spielt auf: " + S.device.name + " ", el("button", { class: "link", onclick: chooseDevice }, "anderes Gerät"),
        spotify.isPhone() && S.device.type !== "Browser" ? [" · ", el("button", { class: "link", onclick: prepareSpotify }, "kein Ton?")] : null));
    if (S.devices) parts.push(devicePanel());
    if (S.problem) parts.push(problemPanel());
    if (!spotify.isLoggedIn() && !c.audio) parts.push(...spotifyBox());

    parts.push(
      el(
        "div",
        { class: "row" },
        el("button", { class: "btn", disabled: S.busy || !S.started, onclick: () => start(true) }, "↺ Von vorne"),
        el("button", { class: "btn", disabled: S.busy || !S.started, onclick: skip, "aria-label": "30 Sekunden vor" }, "⏩ 30 s"),
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
          el("div", { class: "title" }, c.title),
          c.back_note ? el("div", { class: "egg" }, c.back_note) : null
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
    if (p.detail) kids.push(el("p", { style: "font-size:14px;opacity:.75" }, "Spotify sagt: " + p.detail));
    if (p.kind === "no_device" || p.kind === "not_playing") {
      kids.push(
        el(
          "div",
          { class: "row" },
          el("a", { class: "btn", href: KZ.spotifyAppUrl() }, "Spotify öffnen"),
          el("button", { class: "btn", onclick: chooseDevice }, "Gerät wählen"),
          el("button", { class: "btn btn-primary", onclick: () => start(true) }, "Nochmal versuchen")
        )
      );
    }
    if (p.kind === "no_phone") {
      kids.push(
        el(
          "div",
          { class: "stack" },
          el("a", { class: "btn btn-primary", href: KZ.spotifyAppUrl() }, "Spotify-App öffnen"),
          el("button", { class: "btn", onclick: switchAccount }, "Mit anderem Spotify-Konto verbinden"),
          el("button", { class: "btn btn-ghost", onclick: chooseDevice }, "Auf einem anderen Gerät abspielen")
        )
      );
    }
    if (p.kind === "login") {
      kids.push(el("button", { class: "btn btn-primary", onclick: () => spotify.login(currentReturnUrl()) }, "Mit Spotify verbinden"));
    }
    if (["no_phone", "no_device", "not_playing", "error", "premium"].includes(p.kind) && KZ.apiLog.length) {
      const pre = el("pre", { style: "white-space:pre-wrap;font-size:11px;line-height:1.35;margin:6px 0 0;opacity:.85" }, KZ.apiLogText());
      kids.push(el("details", {}, el("summary", { style: "font-size:14px;opacity:.75;cursor:pointer" }, "Technische Details (für Olivier)"),
        el("p", { style: "font-size:12px;opacity:.7;margin:4px 0 0" }, (navigator.userAgent.match(/Android [\d.]+|iPhone OS [\d_]+|Windows NT [\d.]+|Mac OS X [\d_]+/) || [""])[0] + " · Version " + VERSION),
        pre));
    }
    return el("div", { class: "panel warn stack" }, kids);
  }

  // Version tag from the script address (index.html loads app.js?v=…), to see on a phone which version runs.
  const VERSION = ((document.querySelector('script[src*="app.js"]') || {}).src || "").split("v=")[1] || "dev";

  function devicePanel() {
    const list = S.devices;
    const kids = [el("p", {}, list.length ? "Auf welchem Gerät soll die Musik laufen?" : "Spotify findet gerade kein Gerät. Öffne die Spotify-App auf diesem Handy, starte kurz ein Lied und tippe dann auf „Aktualisieren“.")];
    for (const d of list)
      kids.push(
        el(
          "button",
          {
            class: "btn" + (S.device && S.device.id === d.id ? " btn-primary" : ""),
            onclick: () => {
              spotify.rememberDevice(d);
              S.devices = null;
              start(true);
            },
          },
          d.name + " (" + ({ Smartphone: "Handy", Computer: "Computer", Speaker: "Lautsprecher", Tablet: "Tablet", TV: "Fernseher" }[d.type] || d.type) + ")"
        )
      );
    kids.push(
      el(
        "div",
        { class: "row" },
        el("button", { class: "btn btn-ghost", onclick: chooseDevice }, "Aktualisieren"),
        el("button", { class: "btn btn-ghost", onclick: () => { S.devices = null; render(); } }, "Schließen")
      )
    );
    return el("div", { class: "panel stack" }, kids);
  }

  // ---------- waking up Spotify on a phone ----------
  // Android lets a background app continue audio, but not start it. Spotify then "plays" without
  // sound until it was in the foreground once. So: start 30 s of silence and open the Spotify app
  // (both inside the tap, which Android requires for opening an app); after coming back, every
  // card plays with sound while Spotify stays in the background.
  function preparePanel() {
    if (KZ.spotifyPrepared())
      return el("p", { class: "status" }, "Spotify ist vorbereitet ✓ ", el("button", { class: "link", onclick: prepareSpotify }, "nochmal"));
    return el(
      "div",
      { class: "panel stack" },
      el("p", {}, "Vor dem ersten Lied: Spotify einmal vorbereiten. Die Spotify-App öffnet sich kurz und spielt Stille. Dann hierher zurückkommen."),
      el("button", { class: "btn btn-primary", onclick: prepareSpotify }, "Spotify vorbereiten")
    );
  }

  function prepareSpotify() {
    S.preparing = true;
    // Start the silence (not awaited: the app has to be opened right now, inside the tap).
    (async () => {
      for (const uri of KZ.SILENCE) {
        const r = await spotify.play(uri, 0);
        if (r.ok) break;
      }
    })();
    KZ.local.set("kz.prepared", Date.now());
    setTimeout(() => (location.href = KZ.spotifyAppUrl()), 150);
  }

  function switchAccount() {
    spotify.logout();
    S.account = null;
    spotify.login(currentReturnUrl());
  }

  // Coming back from the Spotify app: try again automatically (the phone should now be listed).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && S.preparing) {
      S.preparing = false;
      render();
      return;
    }
    if (document.visibilityState === "visible" && S.card && S.problem && ["no_phone", "no_device", "not_playing"].includes(S.problem.kind) && !S.busy)
      setTimeout(() => start(true), 800);
  });

  async function chooseDevice() {
    S.devices = [];
    render();
    S.devices = (await spotify.devices()).filter((d) => !d.is_restricted);
    render();
  }

  function playerStatus() {
    const wp = KZ.webPlayer;
    if (wp.deviceId) return "Browser-Player: bereit ✓";
    if (wp.failed) {
      const hint = /keysystem|EME|DRM|provision|MediaKey|Widevine/i.test(wp.failed)
        ? " · Tipp: In Chrome Einstellungen → Website-Einstellungen → Geschützte Inhalte erlauben, dann Seite neu laden."
        : "";
      return "Browser-Player nicht verfügbar: " + wp.failed + hint;
    }
    return wp.supported() ? "Browser-Player: verbindet …" : "Browser-Player: von diesem Browser nicht unterstützt";
  }

  function footerView() {
    const items = [el("div", { style: "font-size:12px;opacity:.6" }, "Version " + VERSION)];
    if (spotify.isLoggedIn()) {
      items.push(el("div", { style: "font-size:12px;opacity:.75;max-width:420px" }, playerStatus()));
      items.push(
        el(
          "details",
          { style: "font-size:12px;opacity:.75;max-width:420px;text-align:left" },
          el("summary", { style: "cursor:pointer;text-align:center" }, "Technische Details"),
          el("p", { style: "margin:4px 0" }, (navigator.userAgent.match(/Android [\d.]+|iPhone OS [\d_]+|Windows NT [\d.]+|Mac OS X [\d_]+/) || [""])[0] + " · Chrome " + ((navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || "?") + " · MediaKeys: " + ("MediaKeys" in window ? "ja" : "nein")),
          el("pre", { style: "white-space:pre-wrap;font-size:11px;line-height:1.35;margin:0" }, KZ.apiLogText() || "noch keine Einträge")
        )
      );
    }
    if (spotify.isLoggedIn()) {
      items.push(
        el(
          "div",
          {},
          el("span", { class: "okline" }, "Spotify verbunden" + (S.account ? " als „" + S.account.display_name + "“" : "") + " ✓ "),
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
    KZ.webPlayer.activate(); // inside the tap: unlocks audio for the in-browser player
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
    KZ.webPlayer.activate();
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
      if (r.device) S.device = r.device;
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
        detail: r.detail,
        text: "Spotify ist auf diesem Handy gerade nicht aktiv. Öffne kurz die Spotify-App, starte irgendein Lied und pausiere es, komm hierher zurück und tippe auf „Nochmal versuchen“.",
      };
    if (r.reason === "no_phone") {
      const acc = r.account ? "„" + r.account.display_name + "“" : "dem verbundenen Konto";
      return {
        kind: "no_phone",
        text:
          "Spotify findet dieses Handy nicht. Das Spiel ist mit dem Spotify-Konto " + acc + " verbunden; Spotify kennt dort nur " +
          (r.devices || []).map((d) => "„" + d.name + "“").join(", ") +
          ". So klappt es: Die Spotify-App auf diesem Handy muss mit demselben Konto angemeldet und kurz geöffnet sein. " +
          "Ist die App mit einem anderen Konto angemeldet, verbinde das Spiel mit diesem Konto (es muss in der Spotify-App des Spiels freigeschaltet sein). " +
          "Nach dem Öffnen der App hierher zurückkommen: die Seite versucht es dann automatisch nochmal.",
      };
    }
    if (r.reason === "not_playing")
      return {
        kind: "not_playing",
        text: "Die Musik startet nicht auf diesem Handy. " + (r.detail || "") + " Wähle das richtige Gerät oder öffne kurz die Spotify-App und versuche es nochmal.",
      };
    if (r.reason === "premium")
      return {
        kind: "premium",
        detail: r.detail,
        text: "Spotify hat die Wiedergabe abgelehnt. Das Konto braucht Premium und muss für das Spiel freigeschaltet sein.",
      };
    if (r.reason === "login") return { kind: "login", text: "Die Spotify-Verbindung ist abgelaufen. Bitte neu verbinden." };
    return { kind: "error", text: "Spotify-Fehler: " + (r.detail || "unbekannt") };
  }

  async function toggle() {
    KZ.webPlayer.activate();
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
      const ok = await spotify.resume(S.device && S.device.id);
      if (ok) Object.assign(S, { playing: true, status: "Läuft …" });
      else {
        S.busy = false;
        return start(true);
      }
    }
    S.busy = false;
    render();
  }

  // Jumps 30 s ahead, for pieces with a quiet beginning.
  async function skip() {
    if (!S.started) return;
    if (S.mode === "audio") {
      S.audio.currentTime += 30;
      return;
    }
    S.busy = true;
    render();
    const ok = await spotify.seekBy(30000);
    if (!ok) S.status = "Vorspulen ging gerade nicht";
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
    if (spotify.isLoggedIn()) {
      spotify.me().then((m) => { S.account = m; render(); });
      if (KZ.webPlayer.supported()) KZ.webPlayer.ensure().then(() => render());
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

// Shared code: settings, card list, Spotify login (PKCE, no server needed) and playback.
(function () {
  const KZ = (window.KZ = window.KZ || {});
  const CFG = window.KZ_CONFIG || {};

  // ---------- storage (never throws; private mode may block it) ----------
  function store(kind) {
    return {
      get(key, fallback = null) {
        try {
          const v = window[kind].getItem(key);
          return v === null ? fallback : JSON.parse(v);
        } catch (e) {
          return fallback;
        }
      },
      set(key, value) {
        try {
          window[kind].setItem(key, JSON.stringify(value));
        } catch (e) {}
      },
      del(key) {
        try {
          window[kind].removeItem(key);
        } catch (e) {}
      },
    };
  }
  KZ.local = store("localStorage");
  KZ.session = store("sessionStorage");

  KZ.config = CFG;
  KZ.gameName = CFG.GAME_NAME || "Klassik-Zeitreise";
  KZ.baseUrl = function () {
    const b = (CFG.BASE_URL || "").trim();
    return b ? (b.endsWith("/") ? b : b + "/") : new URL("./", location.href).href;
  };
  KZ.cardUrl = (id) => KZ.baseUrl() + "?c=" + encodeURIComponent(id);

  // ---------- cards ----------
  // cards.json is the source of truth; choices made on prepare.html on this device override it
  // until they are exported into cards.json.
  KZ.loadCards = async function () {
    const res = await fetch("cards.json", { cache: "no-store" });
    if (!res.ok) throw new Error("cards.json konnte nicht geladen werden");
    const cards = await res.json();
    const overrides = KZ.local.get("kz.overrides", {});
    return cards.map((c) => Object.assign({}, c, overrides[c.id] || {}));
  };

  // Accepts a scanned QR text: a card URL (…?c=<id>) or a bare id.
  KZ.parseCardId = function (text) {
    if (!text) return null;
    try {
      const u = new URL(text);
      const c = u.searchParams.get("c");
      if (c) return c.trim();
    } catch (e) {}
    const t = String(text).trim();
    return /^[a-z0-9]{3,16}$/i.test(t) ? t : null;
  };

  KZ.fmtTime = function (ms) {
    const s = Math.max(0, Math.round((ms || 0) / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };
  KZ.parseTime = function (text) {
    const m = String(text).trim().match(/^(\d+)(?::(\d{1,2}))?$/);
    if (!m) return null;
    return m[2] === undefined ? Number(m[1]) * 1000 : (Number(m[1]) * 60 + Number(m[2])) * 1000;
  };

  // ---------- Spotify ----------
  const AUTH_URL = "https://accounts.spotify.com/authorize";
  const TOKEN_URL = "https://accounts.spotify.com/api/token";
  const API = "https://api.spotify.com/v1";
  const SCOPES = "user-modify-playback-state user-read-playback-state user-read-private streaming user-read-email";
  const clientId = () => (CFG.SPOTIFY_CLIENT_ID || "").trim();
  // One redirect address for every page: the game's folder (index.html).
  const redirectUri = () => new URL("./", location.href).href;

  function b64url(bytes) {
    let s = "";
    bytes.forEach((b) => (s += String.fromCharCode(b)));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomString(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return b64url(a).slice(0, n);
  }

  function saveToken(t) {
    const prev = KZ.local.get("kz.token", {}) || {};
    KZ.local.set("kz.token", {
      access_token: t.access_token,
      refresh_token: t.refresh_token || prev.refresh_token,
      expires_at: Date.now() + (t.expires_in || 3600) * 1000,
      scope: t.scope || prev.scope || "",
    });
  }

  async function tokenRequest(params) {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    if (!res.ok) throw new Error("Spotify-Anmeldung fehlgeschlagen (" + res.status + ")");
    const t = await res.json();
    saveToken(t);
    return t.access_token;
  }

  const spotify = (KZ.spotify = {
    isConfigured: () => !!clientId(),
    // A login from before a permission was added counts as logged out, so the page asks again.
    isLoggedIn: () => {
      const t = KZ.local.get("kz.token") || {};
      if (!t.refresh_token) return false;
      const have = String(t.scope || "").split(" ");
      if (!SCOPES.split(" ").every((s) => have.includes(s))) {
        KZ.local.del("kz.token");
        return false;
      }
      return true;
    },

    async login(returnTo) {
      const verifier = randomString(64);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      const state = randomString(16);
      KZ.session.set("kz.pkce", { verifier, state, returnTo: returnTo || location.href });
      const q = new URLSearchParams({
        response_type: "code",
        client_id: clientId(),
        scope: SCOPES,
        redirect_uri: redirectUri(),
        code_challenge_method: "S256",
        code_challenge: b64url(new Uint8Array(digest)),
        state,
        // Always show Spotify's dialog, so you see (and can change, "Nicht du?") which account gets connected.
        show_dialog: "true",
      });
      location.assign(AUTH_URL + "?" + q);
    },

    logout() {
      KZ.local.del("kz.token");
      KZ.local.del("kz.device");
      KZ.session.del("kz.me");
    },

    // Call on page load. Returns {returnTo} after a login redirect, {error} on failure, else null.
    async handleRedirect() {
      const p = new URLSearchParams(location.search);
      if (!p.has("code") && !p.has("error")) return null;
      const pkce = KZ.session.get("kz.pkce");
      KZ.session.del("kz.pkce");
      history.replaceState(null, "", location.pathname);
      if (p.has("error")) return { error: "Spotify-Anmeldung abgebrochen (" + p.get("error") + ")" };
      if (!pkce || pkce.state !== p.get("state")) return { error: "Anmeldung abgelaufen, bitte nochmal verbinden." };
      try {
        await tokenRequest({
          grant_type: "authorization_code",
          code: p.get("code"),
          redirect_uri: redirectUri(),
          client_id: clientId(),
          code_verifier: pkce.verifier,
        });
      } catch (e) {
        return { error: e.message };
      }
      return { returnTo: pkce.returnTo };
    },

    async accessToken(forceRefresh) {
      const t = KZ.local.get("kz.token");
      if (!t || !t.refresh_token) return null;
      if (!forceRefresh && t.access_token && Date.now() < t.expires_at - 60000) return t.access_token;
      try {
        return await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId() });
      } catch (e) {
        spotify.logout();
        return null;
      }
    },

    async api(method, path, body) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = await spotify.accessToken(attempt > 0);
        if (!token) return { status: 401, ok: false, json: async () => ({}), text: async () => "not logged in" };
        const res = await fetch(API + path, {
          method,
          headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}),
          body: body ? JSON.stringify(body) : undefined,
        });
        KZ.logApi(method, path, res);
        if (res.status !== 401) return res;
      }
    },

    async devices() {
      const r = await spotify.api("GET", "/me/player/devices");
      if (!r.ok) return [];
      return (await r.json()).devices || [];
    },

    // Which Spotify device should play? A device chosen by hand (remembered on this phone) wins;
    // on a phone the smartphone comes first, so the music does not end up on a laptop or speaker
    // that happens to be "active" on the same account.
    chooseDevice(ds) {
      const usable = ds.filter((d) => !d.is_restricted);
      const saved = KZ.local.get("kz.device");
      const byId = saved && usable.find((d) => d.id === saved.id);
      if (byId) return byId;
      const byName = saved && usable.find((d) => d.name === saved.name && d.type === saved.type);
      if (byName) return byName;
      const onPhone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      const phones = usable.filter((d) => d.type === "Smartphone" || d.type === "Tablet");
      // On a phone never fall back to a TV or speaker somewhere else: that only happens when chosen by hand.
      if (onPhone) return phones.find((d) => d.is_active) || phones[0] || null;
      return usable.find((d) => d.is_active) || usable.find((d) => d.type === "Computer") || usable[0] || null;
    },

    rememberDevice(d) {
      if (d) KZ.local.set("kz.device", { id: d.id, name: d.name, type: d.type });
      else KZ.local.del("kz.device");
    },

    async apiError(r) {
      const text = await r.text().catch(() => "");
      try {
        const j = JSON.parse(text);
        return (j.error && (j.error.message || j.error.reason)) || text;
      } catch (e) {
        return text;
      }
    },

    // Plays one track from positionMs on the right device. Returns {ok, device} or {ok:false, reason, detail}.
    // reason: "login" | "no_device" | "premium" | "not_playing" | "error"
    isPhone: () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),

    // The Spotify account the game is connected with: {display_name, id, product}.
    async me() {
      const cached = KZ.session.get("kz.me");
      if (cached) return cached;
      const r = await spotify.api("GET", "/me");
      if (!r.ok) return null;
      const j = await r.json();
      const me = { display_name: j.display_name || j.id, id: j.id, product: j.product };
      KZ.session.set("kz.me", me);
      return me;
    },

    // opts.remoteOnly: skip the in-browser player (used to keep a phone's Spotify app busy).
    async play(uri, positionMs, opts = {}) {
      KZ.webPlayer.active = false;
      // 1st choice: Spotify's player inside this web page (no app, no background limits),
      // unless a device was chosen by hand.
      const saved = KZ.local.get("kz.device");
      const savedIsBrowser = saved && (saved.id === KZ.webPlayer.deviceId || saved.name === KZ.gameName);
      if (!opts.remoteOnly && (!saved || savedIsBrowser) && KZ.webPlayer.supported()) {
        const r = await KZ.webPlayer.play(uri, positionMs);
        if (r.ok) return r;
        KZ.logNote("Browser-Player: " + (r.detail || "nicht verfügbar") + " → Fernsteuerung");
      }
      const ds = await spotify.devices();
      const dev = spotify.chooseDevice(ds);
      if (!dev) {
        const others = ds.filter((d) => !d.is_restricted);
        // reason "no_phone": the account has devices (TV, speakers, laptop) but not this phone's Spotify app.
        return { ok: false, reason: spotify.isPhone() && others.length ? "no_phone" : "no_device", devices: others, account: await spotify.me() };
      }
      // A start position beyond the end of this recording would play nothing: start from 0 instead.
      let pos = Math.max(0, positionMs || 0);
      if (pos > 0) {
        const id = uri.split(":").pop();
        const tr = await spotify.api("GET", "/tracks/" + encodeURIComponent(id));
        if (tr.ok) {
          const t = await tr.json();
          if (t.duration_ms && pos > t.duration_ms - 15000) pos = 0;
        }
      }
      const body = { uris: [uri], position_ms: pos };
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const withId = "/me/player/play?device_id=" + encodeURIComponent(dev.id);
      // Different ways to start the track, tried in this order until the device really plays:
      //  A  plain "play" on the active device (no device_id: some phones ignore commands that name them)
      //  B  "play" naming the device
      //  C  hand playback over with play:true, then plain "play"
      //  D  play the track's album, starting at this track (phones treat albums like normal listening)
      //  E  put the track in the queue and skip to it
      const trackId = uri.split(":").pop();
      let albumUri = null;
      const album = async () => {
        if (albumUri) return albumUri;
        const tr = await spotify.api("GET", "/tracks/" + encodeURIComponent(trackId));
        if (tr.ok) albumUri = ((await tr.json()).album || {}).uri || null;
        return albumUri;
      };
      const variants = {
        A: () => spotify.api("PUT", "/me/player/play", body),
        D: async () => {
          const a = await album();
          if (!a) return { ok: false, status: 0, text: async () => "album unknown" };
          return spotify.api("PUT", "/me/player/play", { context_uri: a, offset: { uri }, position_ms: pos });
        },
        E: async () => {
          const q = await spotify.api("POST", "/me/player/queue?uri=" + encodeURIComponent(uri));
          if (!q.ok) return q;
          await wait(500);
          return spotify.api("POST", "/me/player/next");
        },
        B: () => spotify.api("PUT", withId, body),
        C: async () => {
          await spotify.api("PUT", "/me/player", { device_ids: [dev.id], play: true });
          await wait(1200);
          return spotify.api("PUT", "/me/player/play", body);
        },
      };
      if (!dev.is_active) {
        // Make the chosen device the active one first, so a plain "play" lands there.
        await spotify.api("PUT", "/me/player", { device_ids: [dev.id], play: false });
        await wait(1200);
      }
      const resume = () => spotify.api("PUT", "/me/player/play");
      const isOurs = (st) => st && st.item && (st.item.uri === uri || (st.item.linked_from && st.item.linked_from.uri === uri));
      KZ.expectUri = uri; // only so the log can say whether the loaded track is the right one
      let last = null, firstError = null;
      // Order: the attempt that worked last time on this device first; on phones the album variant
      // before the plain one (a plain "play" stops a phone's Spotify, and a stopped Spotify on
      // Android starts again without sound).
      let order = (dev.type === "Smartphone" || dev.type === "Tablet") ? ["D", "E", "A", "B", "C"] : ["A", "D", "E", "B", "C"];
      const known = (KZ.local.get("kz.variant") || {})[dev.id];
      if (known && order.includes(known)) order = [known, ...order.filter((n) => n !== known)];
      for (const name of order) {
        KZ.logNote("Versuch " + name);
        let r = await variants[name]();
        if (r.status === 401) return { ok: false, reason: "login" };
        if (!r.ok) {
          if (!firstError) firstError = { status: r.status, detail: await spotify.apiError(r) };
          if (r.status === 404 && name === "A") {
            // No active device: name it directly.
            continue;
          }
          continue;
        }
        for (let i = 1; i <= 3; i++) {
          await wait(1000);
          const st = await spotify.state();
          last = st;
          // Success = our track is playing there (not the previous one, not the silence).
          if (st && st.is_playing && (!st.device || st.device.id === dev.id) && (!st.item || isOurs(st))) {
            KZ.logNote("Erfolg mit Versuch " + name);
            const kv = KZ.local.get("kz.variant") || {};
            kv[dev.id] = name;
            KZ.local.set("kz.variant", kv);
            // Repeat this track, so Spotify never stops on its own (on Android a stopped Spotify
            // comes back without sound when started from the background).
            spotify.api("PUT", "/me/player/repeat?state=track").catch(() => {});
            return { ok: true, device: dev };
          }
          // Loaded our track but paused: a plain "resume" usually starts it.
          if (st && !st.is_playing && isOurs(st) && i === 1) await resume();
        }
      }
      if (firstError && !last) {
        if (firstError.status === 403) return { ok: false, reason: "premium", detail: firstError.detail, device: dev };
        if (firstError.status === 404) return { ok: false, reason: "no_device", detail: firstError.detail, device: dev, devices: ds };
        return { ok: false, reason: "error", detail: firstError.status + " " + firstError.detail, device: dev };
      }
      if (last && last.device && last.device.id !== dev.id)
        return { ok: false, reason: "not_playing", detail: "Spotify spielt auf „" + last.device.name + "“ statt auf „" + dev.name + "“.", device: dev, devices: ds };
      return { ok: false, reason: "not_playing", detail: "Spotify meldet keine Wiedergabe auf „" + dev.name + "“.", device: dev, devices: ds };
    },

    async resume(deviceId) {
      if (KZ.webPlayer.active) {
        await KZ.webPlayer.player.resume();
        return true;
      }
      const r = await spotify.api("PUT", "/me/player/play" + (deviceId ? "?device_id=" + encodeURIComponent(deviceId) : ""));
      return r.ok;
    },

    async pause() {
      if (KZ.webPlayer.active) return KZ.webPlayer.player.pause();
      await spotify.api("PUT", "/me/player/pause");
    },

    async state() {
      const r = await spotify.api("GET", "/me/player");
      if (r.status !== 200) return null;
      return r.json();
    },

    async search(query, limit = 10) {
      for (let attempt = 0; attempt < 4; attempt++) {
        // No "market": with a user login Spotify uses the listener's country anyway.
        const q = new URLSearchParams({ q: query, type: "track", limit: String(limit) });
        const r = await spotify.api("GET", "/search?" + q);
        if (r.status === 429) {
          // Rate limit: wait as long as Spotify asks (at most 30 s), then retry.
          const wait = Math.min(30, Number(r.headers.get("Retry-After")) || 2);
          await new Promise((res) => setTimeout(res, wait * 1000));
          continue;
        }
        if (r.status === 400 && limit > 10) {
          limit = 10;
          continue;
        }
        if (!r.ok) {
          const detail = await r.text().catch(() => "");
          if (r.status === 403)
            throw new Error(
              "Spotify verweigert den Zugriff (403). Meist ist das angemeldete Spotify-Konto nicht in der Spotify-App freigeschaltet (User Management). Spotify sagt: " +
                (detail.replace(/\s+/g, " ").slice(0, 200) || "–")
            );
          throw new Error("Spotify-Suche fehlgeschlagen (" + r.status + ") " + detail.slice(0, 200));
        }
        return ((await r.json()).tracks || {}).items || [];
      }
      throw new Error("Spotify-Suche: zu viele Anfragen, bitte später nochmal");
    },

    // Searches every query alternative of a card and returns the best-scoring track:
    // {track, score, alternatives} or null.
    async pickBest(card, limit = 10) {
      const alts = KZ.queryAlternatives(card.query);
      const seen = new Map();
      for (const q of alts) {
        for (const t of await spotify.search(q, limit)) if (!seen.has(t.uri)) seen.set(t.uri, t);
      }
      const ranked = [...seen.values()]
        .map((t) => ({ track: t, score: KZ.scoreTrack(card, t) }))
        .sort((a, b) => b.score - a.score);
      return ranked.length ? { track: ranked[0].track, score: ranked[0].score, alternatives: ranked.slice(1, 6) } : null;
    },

    // The pinned track, or the best search match (cached for this session).
    async resolveUri(card) {
      if (card.spotify) return card.spotify;
      const key = "kz.resolved." + card.id;
      const cached = KZ.session.get(key);
      if (cached) return cached;
      const best = await spotify.pickBest(card, 10);
      if (!best) return null;
      KZ.session.set(key, best.track.uri);
      return best.track.uri;
    },

    // Jumps forward/back in the current track (ms may be negative).
    async seekBy(ms) {
      if (KZ.webPlayer.active) {
        const st = await KZ.webPlayer.player.getCurrentState();
        if (!st) return false;
        await KZ.webPlayer.player.seek(Math.max(0, st.position + ms));
        return true;
      }
      const st = await spotify.state();
      if (!st || st.progress_ms == null) return false;
      const target = Math.max(0, st.progress_ms + ms);
      const r = await spotify.api("PUT", "/me/player/seek?position_ms=" + Math.round(target));
      return r.ok;
    },
  });

  // Diagnostics: the last Spotify exchanges (method, path, status, short answer), shown under
  // "Technische Details" when something goes wrong. No tokens or personal data beyond device names.
  KZ.apiLog = [];
  KZ.logApi = function (method, path, res) {
    const t = new Date().toTimeString().slice(0, 8);
    const entry = { t, line: method + " " + path.replace(/q=[^&]*/, "q=…").slice(0, 70) + " → " + res.status };
    KZ.apiLog.push(entry);
    if (KZ.apiLog.length > 60) KZ.apiLog.shift();
    // Add a short summary of the answers that matter for playback.
    if (/\/me\/player(\/devices)?$/.test(path) || /^\/me\/player\?/.test(path)) {
      res.clone().text().then((txt) => {
        try {
          const j = JSON.parse(txt);
          if (j.devices) entry.line += " · " + j.devices.map((d) => d.name + (d.is_active ? " (aktiv)" : "") + (d.is_restricted ? " (gesperrt)" : "")).join(", ");
          else if (j.device) {
            entry.line += " · " + (j.is_playing ? "spielt" : "pausiert") + " auf " + j.device.name;
            if (j.item && KZ.expectUri)
              entry.line += " · " + (j.item.uri === KZ.expectUri || (j.item.linked_from && j.item.linked_from.uri === KZ.expectUri) ? "richtiger Titel geladen" : "anderer Titel geladen");
            else if (!j.item) entry.line += " · kein Titel geladen";
          }
        } catch (e) {
          if (txt) entry.line += " · " + txt.slice(0, 80);
        }
      }).catch(() => {});
    } else if (!res.ok) {
      res.clone().text().then((txt) => { if (txt) entry.line += " · " + txt.replace(/\s+/g, " ").slice(0, 120); }).catch(() => {});
    }
  };
  KZ.logNote = (text) => {
    KZ.apiLog.push({ t: new Date().toTimeString().slice(0, 8), line: "— " + text + " —" });
    if (KZ.apiLog.length > 60) KZ.apiLog.shift();
  };
  KZ.apiLogText = () => KZ.apiLog.map((e) => e.t + "  " + e.line).join(String.fromCharCode(10));

  // ---------- Spotify's player inside the page (Web Playback SDK) ----------
  // The page itself becomes a Spotify device ("Klassik-Zeitreise") and plays through the phone's
  // speaker or Bluetooth. Needs Premium and the "streaming" permission. If it cannot start
  // (some phones/browsers), play() falls back to remote-controlling the Spotify app.
  KZ.webPlayer = {
    player: null,
    deviceId: null,
    active: false, // true while the current card plays in the browser
    failed: null, // reason, if the SDK cannot be used on this device
    supported: () => window.isSecureContext && !KZ.webPlayer.failed && "MediaKeys" in window,
    // Must be called inside a tap: unlocks audio on phones.
    activate() {
      try {
        if (KZ.webPlayer.player && KZ.webPlayer.player.activateElement) KZ.webPlayer.player.activateElement();
      } catch (e) {}
    },
    loadSdk() {
      if (KZ.webPlayer._sdk) return KZ.webPlayer._sdk;
      KZ.webPlayer._sdk = new Promise((resolve, reject) => {
        if (window.Spotify && window.Spotify.Player) return resolve();
        window.onSpotifyWebPlaybackSDKReady = () => resolve();
        const sc = document.createElement("script");
        sc.src = "https://sdk.scdn.co/spotify-player.js";
        sc.onerror = () => reject(new Error("SDK konnte nicht geladen werden"));
        document.head.append(sc);
      });
      return KZ.webPlayer._sdk;
    },
    // Connects once; resolves to the device id or null (and remembers why it failed).
    async ensure() {
      const wp = KZ.webPlayer;
      if (wp.deviceId) return wp.deviceId;
      if (wp.failed) return null;
      if (wp._connecting) return wp._connecting;
      wp._connecting = (async () => {
        try {
          await wp.loadSdk();
          const player = new window.Spotify.Player({
            name: KZ.gameName,
            getOAuthToken: (cb) => spotify.accessToken().then((t) => cb(t)),
            volume: 1.0,
          });
          wp.player = player;
          const id = await new Promise((resolve, reject) => {
            const fail = (label) => ({ message }) => reject(new Error(label + ": " + message));
            player.addListener("ready", ({ device_id }) => resolve(device_id));
            player.addListener("initialization_error", fail("Initialisierung"));
            player.addListener("authentication_error", fail("Anmeldung"));
            player.addListener("account_error", fail("Konto"));
            player.addListener("playback_error", ({ message }) => KZ.logNote("Browser-Player Wiedergabefehler: " + message));
            player.addListener("not_ready", () => { wp.deviceId = null; });
            player.addListener("autoplay_failed", () => KZ.logNote("Browser-Player: Autoplay blockiert (einmal ▶ tippen)"));
            player.connect().then((ok) => { if (!ok) reject(new Error("connect() abgelehnt")); });
            setTimeout(() => reject(new Error("keine Antwort nach 10 s")), 10000);
          });
          wp.deviceId = id;
          KZ.logNote("Browser-Player bereit");
          return id;
        } catch (e) {
          wp.failed = e.message || String(e);
          KZ.logNote("Browser-Player nicht verfügbar: " + wp.failed);
          try { if (wp.player) wp.player.disconnect(); } catch (x) {}
          return null;
        } finally {
          wp._connecting = null;
        }
      })();
      return wp._connecting;
    },
    async play(uri, positionMs) {
      const wp = KZ.webPlayer;
      const id = await wp.ensure();
      if (!id) return { ok: false, detail: wp.failed };
      const pos = Math.max(0, positionMs || 0);
      const r = await spotify.api("PUT", "/me/player/play?device_id=" + encodeURIComponent(id), { uris: [uri], position_ms: pos });
      if (!r.ok) return { ok: false, detail: "play → " + r.status + " " + (await spotify.apiError(r)) };
      for (let i = 0; i < 8; i++) {
        await new Promise((res) => setTimeout(res, 600));
        const st = await wp.player.getCurrentState();
        if (st && !st.paused) {
          wp.active = true;
          KZ.logNote("Erfolg: spielt im Browser");
          return { ok: true, device: { id, name: "diesem Handy (Browser)", type: "Browser" } };
        }
        if (st && st.paused && i === 3) await wp.player.resume().catch(() => {});
      }
      return { ok: false, detail: "Browser-Player startet nicht (Autoplay?)" };
    },
  };

  // Earlier versions remembered a device chosen by hand before the browser player existed: forget it once.
  if (!KZ.local.get("kz.migr10")) {
    KZ.local.del("kz.device");
    KZ.local.set("kz.migr10", 1);
  }

  // A few seconds of silence, used to "wake up" Spotify on a phone (see app.js prepareSpotify).
  KZ.SILENCE = ["spotify:track:5nX8GYWkbmCh4BYYRi5F7Y", "spotify:track:2Retu7fAHEAERBPKf0jtnX"];
  // Spotify counts as prepared for 3 hours after the wake-up step.
  KZ.spotifyPrepared = () => Date.now() - (KZ.local.get("kz.prepared") || 0) < 3 * 3600 * 1000;

  // Link that opens the Spotify app: Chrome on Android needs an intent link, iPhone understands "spotify:".
  KZ.spotifyAppUrl = () =>
    /Android/i.test(navigator.userAgent) ? "intent://open#Intent;scheme=spotify;package=com.spotify.music;end" : "spotify:";

  // ---------- choosing the right recording ----------
  KZ.queryAlternatives = (query) =>
    String(query || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);

  const STOP = new Set("the of a an in and for with no nr op k kv d s de la le les il di du der die das von und et e from to".split(" "));
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/ß/g, "ss");
  const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w && (w.length > 1 || /\d/.test(w)) && !STOP.has(w));
  // Words that point to arrangements, covers or background-music compilations.
  const BAD = ["arr", "arranged", "arrangement", "transcription", "transcr", "lofi", "lo-fi", "relaxing", "relax", "sleep", "sleeping",
    "study", "karaoke", "cover", "remix", "ringtone", "8-bit", "8bit", "music box", "baby", "babies", "meditation", "spa", "chill",
    "piano version", "ukulele", "marimba", "synth", "epic version", "medley", "excerpt", "lullaby version", "for kids"];

  KZ.composerNames = function (card) {
    const names = new Set();
    String(card.composer || "")
      .replace(/\(.*?\)/g, " ")
      .split(/\s+und\s+|\s+/)
      .forEach((w) => {
        const t = norm(w).replace(/[^a-z]/g, "");
        if (t.length >= 4) names.add(t);
      });
    // The first word of each search alternative is the composer as Spotify spells him/her.
    for (const q of KZ.queryAlternatives(card.query)) {
      const first = tokens(q)[0];
      if (first && !/\d/.test(first)) names.add(first);
    }
    return names;
  };

  // 0 … 1: how well a Spotify track matches the card.
  KZ.scoreTrack = function (card, t) {
    const names = KZ.composerNames(card);
    const artistText = norm((t.artists || []).map((a) => a.name).join(" "));
    const nameText = norm(t.name) + " " + norm(t.album && t.album.name);
    const nameTokens = new Set(tokens(nameText));
    let score = 0;

    if ([...names].some((n) => artistText.includes(n))) score += 0.35;

    // Best title overlap over all query alternatives (composer words not counted).
    let best = 0, numbersOk = true;
    for (const q of KZ.queryAlternatives(card.query)) {
      const words = tokens(q).filter((w) => !names.has(w));
      if (!words.length) continue;
      const hit = words.filter((w) => nameTokens.has(w)).length / words.length;
      const nums = words.filter((w) => /^\d+$/.test(w));
      const numsOk = nums.every((n) => new Set(tokens(t.name)).has(n) || nameTokens.has(n));
      if (hit > best) {
        best = hit;
        numbersOk = numsOk;
      }
    }
    score += 0.45 * best;
    score += numbersOk ? 0.1 : -0.15;

    const queryText = norm(card.query);
    const raw = norm(t.name + " " + (t.album ? t.album.name : ""));
    const rawWords = new Set(raw.split(/[^a-z0-9]+/));
    const bad = (b) => (/[\s-]/.test(b) ? raw.includes(b) : rawWords.has(b)) && !queryText.includes(b);
    if (BAD.some(bad)) score -= 0.3;
    if (t.duration_ms && t.duration_ms < 45000) score -= 0.3;
    if (t.duration_ms && card.start_ms && card.start_ms > t.duration_ms - 20000) score -= 0.3;
    if (typeof t.popularity === "number") score += 0.1 * (t.popularity / 100);
    return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  };
  KZ.scoreLabel = (s) => (s == null ? "" : s >= 0.85 ? "sicher" : s >= 0.65 ? "mittel" : "unsicher");

  KZ.el = function (tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) e.append(c);
    return e;
  };
})();

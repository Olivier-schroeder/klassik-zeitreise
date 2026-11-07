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
  const SCOPES = "user-modify-playback-state user-read-playback-state";
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
    isLoggedIn: () => !!(KZ.local.get("kz.token") || {}).refresh_token,

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
      });
      location.assign(AUTH_URL + "?" + q);
    },

    logout() {
      KZ.local.del("kz.token");
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
        if (res.status !== 401) return res;
      }
    },

    async devices() {
      const r = await spotify.api("GET", "/me/player/devices");
      if (!r.ok) return [];
      return (await r.json()).devices || [];
    },

    // Plays one track from positionMs. Returns {ok} or {ok:false, reason, detail}.
    // reason: "login" | "no_device" | "premium" | "error"
    async play(uri, positionMs) {
      const body = { uris: [uri], position_ms: Math.max(0, positionMs || 0) };
      let r = await spotify.api("PUT", "/me/player/play", body);
      if (r.ok) return { ok: true };
      if (r.status === 401) return { ok: false, reason: "login" };
      if (r.status === 404) {
        // No active device: pick the phone/computer where Spotify is open.
        const ds = (await spotify.devices()).filter((d) => !d.is_restricted);
        const pick = ds.find((d) => d.is_active) || ds.find((d) => d.type === "Smartphone") || ds[0];
        if (!pick) return { ok: false, reason: "no_device" };
        r = await spotify.api("PUT", "/me/player/play?device_id=" + encodeURIComponent(pick.id), body);
        if (r.ok) return { ok: true };
      }
      const detail = await r.text().catch(() => "");
      if (r.status === 403) return { ok: false, reason: "premium", detail };
      if (r.status === 404) return { ok: false, reason: "no_device", detail };
      return { ok: false, reason: "error", detail: r.status + " " + detail };
    },

    async resume() {
      const r = await spotify.api("PUT", "/me/player/play");
      return r.ok;
    },

    async pause() {
      await spotify.api("PUT", "/me/player/pause");
    },

    async state() {
      const r = await spotify.api("GET", "/me/player");
      if (r.status !== 200) return null;
      return r.json();
    },

    async search(query, limit = 8) {
      const q = new URLSearchParams({ q: query, type: "track", limit: String(limit), market: "from_token" });
      const r = await spotify.api("GET", "/search?" + q);
      if (!r.ok) throw new Error("Spotify-Suche fehlgeschlagen (" + r.status + ")");
      return ((await r.json()).tracks || {}).items || [];
    },

    // The pinned track, or the first search hit (cached for this session).
    async resolveUri(card) {
      if (card.spotify) return card.spotify;
      const key = "kz.resolved." + card.id;
      const cached = KZ.session.get(key);
      if (cached) return cached;
      const hits = await spotify.search(card.query, 1);
      if (!hits.length) return null;
      KZ.session.set(key, hits[0].uri);
      return hits[0].uri;
    },
  });

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

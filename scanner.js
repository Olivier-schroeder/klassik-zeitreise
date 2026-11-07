// QR scanner inside the page: uses the phone's back camera. BarcodeDetector where the browser
// has it (Chrome on Android), otherwise jsQR (iPhone Safari, Firefox).
(function () {
  const KZ = (window.KZ = window.KZ || {});
  const JSQR_URL = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";

  function loadJsQR() {
    if (window.jsQR) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = JSQR_URL;
      s.onload = resolve;
      s.onerror = () => reject(new Error("QR-Leser konnte nicht geladen werden"));
      document.head.append(s);
    });
  }

  async function makeDetector() {
    if ("BarcodeDetector" in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes("qr_code")) {
          const d = new window.BarcodeDetector({ formats: ["qr_code"] });
          return async (video) => {
            const r = await d.detect(video);
            return r.length ? r[0].rawValue : null;
          };
        }
      } catch (e) {}
    }
    await loadJsQR();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    return async (video) => {
      const w = video.videoWidth,
        h = video.videoHeight;
      if (!w || !h) return null;
      const scale = Math.min(1, 720 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      return code ? code.data : null;
    };
  }

  // Opens a full-screen camera view; calls onResult(text) once a QR code is read.
  KZ.openScanner = async function (onResult) {
    const hint = KZ.el("p", { class: "scan-hint" }, "Karte vor die Kamera halten");
    const video = KZ.el("video", { playsinline: true, muted: true, autoplay: true });
    const close = KZ.el("button", { class: "btn btn-ghost scan-close" }, "Abbrechen");
    const overlay = KZ.el("div", { class: "scan-overlay" }, video, KZ.el("div", { class: "scan-frame" }), hint, close);
    document.body.append(overlay);

    let stream = null;
    let done = false;
    const stop = () => {
      done = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      overlay.remove();
    };
    close.addEventListener("click", stop);

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      video.srcObject = stream;
      await video.play();
      const detect = await makeDetector();
      const tick = async () => {
        if (done) return;
        let text = null;
        try {
          text = await detect(video);
        } catch (e) {}
        if (text) {
          stop();
          onResult(text);
        } else setTimeout(tick, 200);
      };
      tick();
    } catch (e) {
      hint.textContent =
        e && e.name === "NotAllowedError"
          ? "Kein Kamerazugriff. Bitte in den Browser-Einstellungen erlauben, oder die Karte mit der normalen Kamera-App scannen."
          : "Kamera nicht verfügbar: " + (e.message || e);
    }
  };
})();

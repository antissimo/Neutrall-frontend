// Adresa backend API-ja. Lokalno je to API u Dockeru, u produkciji javna adresa Tailscale Funnela.
// Promijeni API_PRODUCTION na svoj hostname (vidi neutrall/README.md -> Javni pristup).
window.NEUTRALL_CONFIG = (() => {
  const API_PRODUCTION = "https://neutrall.tail11f3ee.ts.net";
  const API_LOCAL = "http://localhost:8787";
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  return { apiBase: local ? API_LOCAL : API_PRODUCTION };
})();

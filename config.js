// Adresa backend API-ja. Lokalno je to API u Dockeru, u produkciji javni hostname Cloudflare Tunnela.
// Promijeni API_PRODUCTION na svoj hostname (vidi neutrall/README.md -> Javni pristup).
window.NEUTRALL_CONFIG = (() => {
  const API_PRODUCTION = "https://api.neutrall.hr";
  const API_LOCAL = "http://localhost:8787";
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  return { apiBase: local ? API_LOCAL : API_PRODUCTION };
})();

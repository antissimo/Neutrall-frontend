# neutrall.hr — frontend

Javna stranica agregatora [neutrall.hr](https://neutrall.hr): čisti HTML, CSS i JavaScript, bez build koraka i bez ovisnosti. Podatke čita iz backend API-ja (zaseban repozitorij `neutrall`).

| Datoteka | |
|---|---|
| `index.html` | Struktura stranice i predložak kartice priče |
| `app.js` | Dohvat feeda, filteri (kategorija + Hrvatska/Svijet), paginacija |
| `styles.css` | Izgled, svijetla i tamna tema, mobilni prikaz |
| `config.js` | Adresa API-ja: na `localhost` koristi `http://localhost:8787`, inače `API_PRODUCTION` |
| `vercel.json` | Sigurnosna zaglavlja i CSP (dopušta pozive samo prema API domeni) |

## Lokalni pregled

Frontend se lokalno poslužuje iz backend repozitorija (servis `web` u njegovom `docker-compose.yml`), koji ovu mapu očekuje kao `../neutrall.hr`:

```bash
cd ../neutrall && docker compose up -d
```

Stranica je na http://localhost:5500 i čita lokalni API. Mapa je izravno spojena u kontejner, pa se izmjene vide nakon osvježavanja preglednika.

## Objava na Vercelu

1. *New Project* → importaj ovaj repozitorij, Framework: *Other*. Build naredba i output mapa nisu potrebni.
2. U `config.js` postavi `API_PRODUCTION` na javni hostname API-ja (Cloudflare Tunnel, zadano `https://api.neutrall.hr`). Isti hostname mora biti u `connect-src` u `vercel.json`.
3. Domenu Vercel projekta dodaj u `CORS_ORIGINS` u backend `.env`.

## Sigurnost

Sav sadržaj iz API-ja upisuje se kao tekst (`textContent`), nikad kao HTML, a poveznice se prihvaćaju samo ako počinju s `http(s)://`. CSP u `vercel.json` ne dopušta vanjske skripte ni inline kod.

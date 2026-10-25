(() => {
  const API = window.NEUTRALL_CONFIG.apiBase.replace(/\/$/, "");
  const CATEGORY_LABELS = {
    politika: "Politika", ekonomija: "Ekonomija", tehnologija: "Tehnologija", sport: "Sport",
    kultura: "Kultura", znanost: "Znanost", zdravlje: "Zdravlje", kronika: "Kronika", lifestyle: "Lifestyle",
    ostalo: "Ostalo",
  };
  const REGION_LABELS = { hrvatska: "Hrvatska", svijet: "Svijet" };

  const $ = (sel, root = document) => root.querySelector(sel);
  const feedEl = $("#feed");
  const statusEl = $("#status");
  const moreBtn = $("#more");
  const tpl = $("#story-tpl");
  const searchForm = $("#search");
  const searchInput = $("#q");

  const params = new URLSearchParams(location.search);
  const filters = {
    category: { value: params.get("kategorija") || "sve", param: "kategorija", el: $("#categories") },
    region: { value: params.get("regija") || "sve", param: "regija", el: $("#regions") },
    tone: { value: params.get("ton") || "sve", param: "ton", el: $("#tones") },
  };
  let query = (params.get("q") || "").trim();
  searchInput.value = query;
  let cursor = null;
  let loading = false;
  let requestId = 0;

  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");

  // Mjerenje čitanja bez kolačića (backend broji dnevne posjetitelje po sažetku sa dnevnom soli). Anonimni ID
  // za mjerenje povratka šalje se samo uz pristanak.
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* privatni način: bez pamćenja */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* isto */ } },
  };
  function track(kind, storyId) {
    const body = JSON.stringify({ k: kind, s: storyId || undefined, v: store.get("neutrall-consent") === "da" ? store.get("neutrall-vid") || undefined : undefined });
    const blob = new Blob([body], { type: "text/plain" });
    if (!(navigator.sendBeacon && navigator.sendBeacon(API + "/api/v1/events", blob))) {
      fetch(API + "/api/v1/events", { method: "POST", body, headers: { "Content-Type": "text/plain" }, keepalive: true }).catch(() => {});
    }
  }
  function askConsent() {
    if (store.get("neutrall-consent")) return;
    const bar = el("div", "consent");
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Pristanak za mjerenje");
    const text = el("p", "", "Smijemo li anonimno brojati vraćaš li se na neutrall.hr? Ne spremamo ime, e-poštu ni IP adresu.");
    const yes = el("button", "yes", "Dopusti");
    const no = el("button", "", "Ne");
    for (const b of [yes, no]) b.type = "button";
    yes.addEventListener("click", () => {
      store.set("neutrall-consent", "da");
      store.set("neutrall-vid", crypto.randomUUID ? crypto.randomUUID()
        : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
      bar.remove();
    });
    no.addEventListener("click", () => {
      store.set("neutrall-consent", "ne");
      store.del("neutrall-vid");
      bar.remove();
    });
    const actions = el("div", "actions");
    actions.append(yes, no);
    bar.append(text, actions);
    document.body.append(bar);
  }

  function relativeTime(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "upravo";
    if (diff < 3600) return `prije ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `prije ${Math.floor(diff / 3600)} h`;
    return new Date(iso).toLocaleDateString("hr-HR", { day: "numeric", month: "long" });
  }

  function setTime(el, iso) {
    el.dateTime = iso;
    el.textContent = relativeTime(iso);
    el.title = new Date(iso).toLocaleString("hr-HR");
  }

  async function api(path) {
    const res = await fetch(API + path, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const listNames = (names) =>
    names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} i ${names[names.length - 1]}`;

  // Trajna adresa priče: /prica/<id>-<naslov>. Broj je dovoljan; naslov je samo za čitljivost.
  const DIACRITICS = { č: "c", ć: "c", ž: "z", š: "s", đ: "dj" };
  const slug = (text) => text.toLowerCase().replace(/[čćžšđ]/g, (c) => DIACRITICS[c])
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70)
    .replace(/-[^-]*$/, (m) => (m.length > 1 ? m : ""));
  const storyPath = (story) => `/prica/${story.id}-${slug(story.lead.title_hr || story.lead.title)}`;
  const detailMatch = location.pathname.match(/^\/prica\/(\d+)/);

  // Svi aktivni mediji: traka pokrivenosti pokazuje i one koji o događaju ne pišu.
  let allSources = [];

  function renderCoverage(ul, story, articles) {
    const covering = new Set(articles.map((a) => a.source.name));
    const differing = new Set((story.claims || []).flatMap((c) => (c.differs || []).map((d) => d.source)));
    const names = allSources.length ? allSources.map((s) => s.name) : [...covering];
    for (const name of names) {
      const li = el("li", covering.has(name) ? "on" : "", name);
      if (differing.has(name)) li.classList.add("differs");
      li.title = differing.has(name) ? `${name} navodi nešto drugo`
        : covering.has(name) ? `${name} piše o ovome` : `${name} ne piše o ovome`;
      ul.append(li);
    }
    ul.setAttribute("aria-label", `Pišu: ${listNames([...covering])}`);
  }

  function renderClaims(box, story) {
    const ul = $("ul", box);
    for (const c of story.claims) {
      const li = el("li", "", c.claim);
      // Mediji se navode samo kad tvrdnju ne prenose svi koji pišu o priči.
      const sources = (c.sources || []).filter((s) => s !== c.by);
      const partial = sources.length && sources.length < story.source_count;
      li.append(el("span", "who", partial ? `${c.by}, prema ${listNames(sources)}` : c.by));
      for (const d of c.differs || []) {
        const alt = el("span", "alt");
        alt.append(el("b", "", `${d.source} navodi drukčije: `), d.version);
        li.append(alt);
      }
      ul.append(li);
    }
    box.hidden = false;
  }

  // U feedu je samo naslov i kratki tekst; tko piše, tko što tvrdi i izvori su na stranici priče.
  function renderStory(story) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    const lead = story.lead;
    $(".cat", node).textContent = CATEGORY_LABELS[lead.category] || "Vijest";
    $(".region", node).textContent = REGION_LABELS[lead.region] || "";
    setTime($("time", node), story.updated_at);
    const title = $(".title a", node);
    title.textContent = lead.title_hr || lead.title;
    title.href = storyPath(story);
    $(".summary", node).textContent = lead.summary || "";
    return node;
  }

  async function load(reset) {
    if (loading && !reset) return;
    const id = ++requestId; // odgovor na zastarjeli upit ili filter se odbacuje
    loading = true;
    moreBtn.disabled = true;
    if (reset) {
      cursor = null;
      feedEl.replaceChildren();
      moreBtn.hidden = true;
      statusEl.textContent = query ? "Pretraživanje…" : "Učitavanje…";
    }
    try {
      const qs = new URLSearchParams({
        category: filters.category.value, region: filters.region.value, tone: filters.tone.value, limit: "20",
      });
      let data;
      if (query) {
        qs.set("q", query);
        data = await api(`/api/v1/search?${qs}`);
      } else {
        if (cursor) qs.set("cursor", cursor);
        data = await api(`/api/v1/feed?${qs}`);
      }
      if (id !== requestId) return;
      if (reset) track(query ? "search" : "feed");
      feedEl.append(...data.items.map(renderStory));
      cursor = query ? null : data.next_cursor;
      moreBtn.hidden = !cursor;
      if (feedEl.children.length) {
        statusEl.textContent = query ? `Rezultati za „${query}“` : "";
      } else {
        statusEl.textContent = query
          ? `Nema važnih vijesti koje odgovaraju upitu „${query}“.`
          : "Trenutno nema važnih priča za ovaj filter. Priča se pojavi kad o istom događaju napišu barem dva medija, a nove se obrađuju svakih desetak minuta.";
      }
    } catch (e) {
      if (id !== requestId) return;
      statusEl.textContent = e.message === "HTTP 429"
        ? "Pretraga je trenutno zauzeta. Pokušaj ponovno za nekoliko sekundi."
        : query
          ? "Pretraga trenutno nije dostupna. Pokušaj ponovno za nekoliko minuta."
          : "Vijesti trenutno nisu dostupne. Pokušaj ponovno za nekoliko minuta.";
      console.error(e);
    } finally {
      if (id === requestId) {
        loading = false;
        moreBtn.disabled = false;
      }
    }
  }

  function setUrlParam(name, value) {
    const url = new URL(location.href);
    value ? url.searchParams.set(name, value) : url.searchParams.delete(name);
    history.replaceState(null, "", url);
  }

  // Pretraga se pokreće na Enter ili kratko nakon što korisnik prestane tipkati.
  let searchTimer;
  function runSearch() {
    clearTimeout(searchTimer);
    const next = searchInput.value.trim().replace(/\s+/g, " ");
    if (next === query || (next.length === 1)) return;
    query = next;
    setUrlParam("q", query);
    markTrending();
    load(true);
  }
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch();
  });
  const clearBtn = $("#clear");
  const syncClear = () => { clearBtn.hidden = !searchInput.value; };
  clearBtn.addEventListener("click", () => {
    clearSearch();
    searchInput.focus();
  });
  syncClear();
  searchInput.addEventListener("input", () => {
    syncClear();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, searchInput.value.trim() ? 700 : 0);
  });

  async function renderDetail(id) {
    const box = $("#detail");
    document.querySelector(".bar").hidden = true;
    $(".trending").remove();
    $(".more").hidden = true;
    statusEl.textContent = "Učitavanje…";
    let story;
    try {
      story = await api(`/api/v1/stories/${id}`);
    } catch (e) {
      statusEl.textContent = e.message === "HTTP 404"
        ? "Ova priča ne postoji. Možda je adresa nepotpuna; sve priče su na naslovnici."
        : "Priča trenutno nije dostupna. Pokušaj ponovno za nekoliko minuta.";
      return;
    }
    statusEl.textContent = "";
    track("story", story.id);
    // Stara ili skraćena adresa preusmjerava se na kanonsku, s naslovom.
    if (location.pathname !== storyPath(story)) history.replaceState(null, "", storyPath(story));
    const lead = story.lead;
    const articles = [lead, ...story.related];
    document.title = `${lead.title_hr || lead.title} | neutrall.hr`;

    const back = el("a", "back", "Sve vijesti");
    back.href = "/";
    const meta = el("div", "meta");
    meta.append(el("span", "cat", CATEGORY_LABELS[lead.category] || "Vijest"), el("span", "region", REGION_LABELS[lead.region] || ""));
    const t = el("time");
    setTime(t, story.updated_at);
    meta.append(t);
    const coverage = el("ul", "coverage");
    renderCoverage(coverage, story, articles);
    const h1 = el("h1", "title", lead.title_hr || lead.title);
    const lede = el("p", "lede", lead.summary || "");
    const body = el("div", "body");
    for (const p of story.body || []) body.append(el("p", "", p));

    box.append(back, meta, coverage, h1, lede);
    if (story.polymarket) box.append(renderMarket(story.polymarket));
    box.append(body);
    if (lead.uncertainty) box.append(el("p", "uncertainty", lead.uncertainty));
    if (story.claims && story.claims.length) {
      const claims = el("section", "claims");
      claims.append(el("h2", "", "Tko što tvrdi"), el("ul"));
      renderClaims(claims, story);
      box.append(claims);
    }
    if (story.keywords && story.keywords.length) {
      const topics = el("p", "topics");
      for (const k of story.keywords) {
        const a = el("a", "", k);
        a.href = `/?q=${encodeURIComponent(k)}`;
        topics.append(a);
      }
      box.append(topics);
    }

    box.append(renderRating(story.id));

    const src = el("section", "originals");
    src.append(el("h2", "", "Izvorni članci"));
    const ul = el("ul");
    for (const a of [...articles].sort((x, y) => x.published_at.localeCompare(y.published_at))) {
      const li = el("li");
      const link = el("a", "", a.title_hr || a.title);
      link.href = safeUrl(a.url);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const when = el("time");
      setTime(when, a.published_at);
      const who = el("span", "rel-source", a.source.name + " ");
      who.append(when);
      li.append(who, link);
      ul.append(li);
    }
    src.append(ul);
    const note = el("p", "ai-label", story.ai_provider && story.ai_provider.startsWith("claude")
      ? "Tekst je napisao AI (Claude) iz članaka navedenih medija; originale ne čuvamo, nego vodimo na njih."
      : "Tekst je napisao lokalni AI model iz članaka navedenih medija.");
    const share = el("button", "share", "Kopiraj poveznicu");
    share.type = "button";
    share.addEventListener("click", async () => {
      const url = location.origin + storyPath(story);
      try {
        await navigator.clipboard.writeText(url);
        share.textContent = "Poveznica kopirana";
      } catch {
        window.prompt("Poveznica na priču:", url);
      }
    });
    box.append(src, note, share);
    box.hidden = false;
  }

  // Statistika čitanja (ključ samo za čitanje, pamti se u ovom pregledniku).
  async function renderStats() {
    document.querySelector(".bar").hidden = true;
    $(".trending").remove();
    $(".more").hidden = true;
    document.title = "Statistika | neutrall.hr";
    const box = $("#detail");
    box.classList.add("stats");
    box.hidden = false;
    const head = () => {
      const back = el("a", "back", "Sve vijesti");
      back.href = "/";
      return [back, el("h1", "title", "Statistika čitanja")];
    };
    // Ključ iz adrese (/statistika?k=...) se zapamti i odmah makne iz adrese.
    const fromUrl = new URLSearchParams(location.search).get("k");
    if (fromUrl) {
      store.set("neutrall-stats-key", fromUrl);
      history.replaceState(null, "", "/statistika");
    }
    const key = store.get("neutrall-stats-key");
    if (!key) {
      const form = el("form", "key-form");
      const input = el("input");
      input.type = "password";
      input.autocomplete = "off";
      input.placeholder = "Ključ za statistiku (STATS_KEY)";
      input.setAttribute("aria-label", "Ključ za statistiku");
      const go = el("button", "", "Prikaži");
      go.type = "submit";
      form.append(input, go);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        store.set("neutrall-stats-key", input.value.trim());
        box.replaceChildren();
        renderStats();
      });
      box.append(...head(), el("p", "lede", "Unesi ključ za statistiku. Pamti se samo u ovom pregledniku."), form);
      input.focus();
      return;
    }
    statusEl.textContent = "Učitavanje…";
    let d;
    try {
      d = await api(`/api/v1/stats?k=${encodeURIComponent(key)}`);
    } catch (e) {
      statusEl.textContent = "";
      if (e.message === "HTTP 403") {
        store.del("neutrall-stats-key");
        box.replaceChildren();
        renderStats();
        statusEl.textContent = "Ključ nije ispravan.";
      } else {
        statusEl.textContent = "Statistika trenutno nije dostupna.";
      }
      return;
    }
    statusEl.textContent = "";
    const S = d.summary;
    const pct = (v) => (v == null ? "–" : `${v.toLocaleString("hr-HR")} %`);
    const tile = (label, value, note) => {
      const t = el("div", "tile");
      t.append(el("p", "label", label), el("p", "value", value), el("p", "note", note));
      return t;
    };
    const tiles = el("div", "tiles");
    tiles.append(
      tile("Otvara stranicu", (S.visitors_7d_avg || 0).toLocaleString("hr-HR"), `posjetitelja dnevno (prosjek 7 dana); danas ${S.visitors_today}`),
      tile("Čita više priča", pct(S.multi_story_pct_7d), "posjetitelja dana otvori 2 ili više priča (7 dana)"),
      tile("Vrati se nakon 7 dana", pct(S.returned_after_7d_pct),
        S.returned_after_7d_base ? `od ${S.returned_after_7d_base} koji su pristali na mjerenje; pristaje ${pct(S.consent_pct_7d)}`
          : "još nema dovoljno starih posjetitelja koji su pristali na mjerenje"),
      tile("Ocjene sažetaka", S.feedback_count ? `${pct(S.accurate_pct)} točno` : "–",
        S.feedback_count ? `${pct(S.neutral_pct)} nepristrano, ${S.feedback_count} ocjena (30 dana)` : "još nema ocjena"),
    );

    // Posjetitelji po danu: jedna serija, stupci od osnovice; vrijednost u oblačiću i u tablici ispod.
    const chart = el("figure", "chart");
    chart.append(el("figcaption", "", "Posjetitelji po danu, zadnjih 30 dana"));
    const max = Math.max(1, ...d.daily.map((x) => x.visitors));
    const bars = el("div", "bars");
    bars.setAttribute("role", "img");
    bars.setAttribute("aria-label", `Posjetitelji po danu, najviše ${max}`);
    const tip = el("div", "tip");
    tip.hidden = true;
    const fmtDay = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("hr-HR", { day: "numeric", month: "numeric" });
    for (const x of d.daily) {
      const b = el("span", "b");
      b.style.height = `${Math.max(2, (x.visitors / max) * 100)}%`;
      b.tabIndex = 0;
      const show = () => {
        tip.textContent = `${fmtDay(x.day)}: ${x.visitors} posjetitelja, ${x.story_views} otvorenih priča`;
        tip.hidden = false;
        tip.style.left = `${b.offsetLeft + b.offsetWidth / 2}px`;
      };
      b.addEventListener("mouseenter", show);
      b.addEventListener("focus", show);
      b.addEventListener("mouseleave", () => { tip.hidden = true; });
      b.addEventListener("blur", () => { tip.hidden = true; });
      bars.append(b);
    }
    const axis = el("div", "axis");
    if (d.daily.length) axis.append(el("span", "", fmtDay(d.daily[0].day)), el("span", "", fmtDay(d.daily[d.daily.length - 1].day)));
    const plot = el("div", "plot");
    plot.append(el("span", "ymax", String(max)), bars, tip);
    chart.append(plot, axis);

    const table = (cols, rows) => {
      const t = el("table");
      const tr = el("tr");
      cols.forEach((c) => tr.append(el("th", "", c)));
      const thead = el("thead");
      thead.append(tr);
      const tbody = el("tbody");
      rows.forEach((r) => {
        const row = el("tr");
        r.forEach((c) => { const td = el("td"); td.append(c); row.append(td); });
        tbody.append(row);
      });
      t.append(thead, tbody);
      return t;
    };
    const daily = table(["Dan", "Posjetitelji", "Pregledi", "Otvorene priče", "2+ priče"],
      [...d.daily].reverse().map((x) => [fmtDay(x.day), String(x.visitors), String(x.views), String(x.story_views), pct(x.multi_story_pct)]));
    const link = (id, title) => {
      const a = el("a", "", title || `Priča ${id}`);
      a.href = `/prica/${id}`;
      return a;
    };
    const top = table(["Priča (7 dana)", "Otvaranja", "Čitatelja"],
      d.top_stories_7d.map((x) => [link(x.story_id, x.title), String(x.views), String(x.readers)]));
    const yn = (v) => (v == null ? "–" : v ? "da" : "ne");
    const neg = table(["Kad", "Priča", "Točna", "Nepristrana", "Komentar"],
      d.negative_feedback.map((x) => [new Date(x.ts).toLocaleString("hr-HR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }),
        link(x.story_id, x.title), yn(x.accurate), yn(x.neutral), x.comment || ""]));

    const logout = el("button", "share", "Zaboravi ključ u ovom pregledniku");
    logout.type = "button";
    logout.addEventListener("click", () => { store.del("neutrall-stats-key"); location.reload(); });
    const section = (title, ...children) => {
      const sec = el("section", "stats-section");
      sec.append(el("h2", "", title), ...children);
      return sec;
    };
    box.append(...head(),
      el("p", "lede", "Posjetitelji se broje po danu bez kolačića: ista osoba sutradan se broji ponovno. Povratak se mjeri samo za one koji su pristali."),
      tiles, chart,
      section("Po danu", daily),
      section("Najčitanije priče", d.top_stories_7d.length ? top : el("p", "", "Još nema otvorenih priča.")),
      section("Negativne ocjene i komentari", d.negative_feedback.length ? neg : el("p", "", "Još nema negativnih ocjena.")),
      logout);
  }

  // Ocjena priče: točnost i nepristranost (da/ne) uz neobavezni komentar. Pamti se da je priča ocijenjena.
  function renderRating(storyId) {
    const sec = el("section", "rating");
    sec.append(el("h2", "", "Je li ova priča točna i nepristrana?"));
    if (store.get(`neutrall-rated-${storyId}`)) {
      sec.append(el("p", "thanks", "Hvala, tvoja ocjena je zabilježena."));
      return sec;
    }
    const answers = {};
    const row = (key, label) => {
      const p = el("div", "q");
      p.append(el("span", "", label));
      for (const [text, val] of [["Da", true], ["Ne", false]]) {
        const b = el("button", "", text);
        b.type = "button";
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => {
          answers[key] = val;
          p.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          send.disabled = false;
          if (val === false) comment.hidden = false;
        });
        p.append(b);
      }
      return p;
    };
    const comment = el("textarea");
    comment.maxLength = 300;
    comment.rows = 2;
    comment.placeholder = "Što nije točno ili je pristrano? (neobavezno)";
    comment.setAttribute("aria-label", "Komentar");
    comment.hidden = true;
    const send = el("button", "send", "Pošalji ocjenu");
    send.type = "button";
    send.disabled = true;
    send.addEventListener("click", async () => {
      send.disabled = true;
      try {
        const res = await fetch(API + "/api/v1/feedback", {
          method: "POST", headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ s: storyId, ...answers, comment: comment.value.trim() || undefined }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        store.set(`neutrall-rated-${storyId}`, "1");
        sec.replaceChildren(el("h2", "", "Je li ova priča točna i nepristrana?"), el("p", "thanks", "Hvala, tvoja ocjena je zabilježena."));
      } catch {
        send.disabled = false;
        send.textContent = "Slanje nije uspjelo, pokušaj ponovno";
      }
    });
    sec.append(row("accurate", "Točna"), row("neutral", "Nepristrana"), comment, send);
    return sec;
  }

  // Sažetak dana: najvažnije priče zadnjih 24 sata, poredane po važnosti (zato su numerirane).
  async function renderDigest() {
    document.querySelector(".bar").hidden = true;
    $(".trending").remove();
    $(".more").hidden = true;
    document.title = "Sažetak dana | neutrall.hr";
    $(".digest-btn").setAttribute("aria-current", "page");
    statusEl.textContent = "Učitavanje…";
    let data;
    try {
      data = await api("/api/v1/digest");
      track("digest");
    } catch {
      statusEl.textContent = "Sažetak trenutno nije dostupan. Pokušaj ponovno za nekoliko minuta.";
      return;
    }
    statusEl.textContent = "";
    const box = $("#detail");
    box.classList.add("digest");
    const back = el("a", "back", "Sve vijesti");
    back.href = "/";
    const today = new Date().toLocaleDateString("hr-HR", { weekday: "long", day: "numeric", month: "long" });
    box.append(back, el("h1", "title", `Sažetak dana, ${today}`),
      el("p", "lede", "Najvažnije iz zadnja 24 sata, poredano po važnosti i broju medija koji o tome pišu."));
    if (!data.items.length) {
      box.append(el("p", "", "Zadnja 24 sata još nema dovoljno važnih priča. Pogledaj naslovnicu."));
    }
    const ol = el("ol", "digest-list");
    for (const story of data.items) {
      const li = el("li");
      const a = el("a", "", story.lead.title_hr || story.lead.title);
      a.href = storyPath(story);
      const h = el("h2");
      h.append(a);
      const first = (story.lead.summary || "").split(/(?<=[.!?])\s+(?=[A-ZČĆŽŠĐ0-9])/).slice(0, 2).join(" ");
      const meta = el("p", "digest-meta", `${CATEGORY_LABELS[story.lead.category] || "Vijest"}, ${story.source_count} medija`);
      li.append(h, el("p", "", first), meta);
      ol.append(li);
    }
    box.append(ol);
    box.hidden = false;
  }

  // Tržište predviđanja (Polymarket) o istoj temi: kvote trgovaca, jasno odvojene od teksta priče.
  function renderMarket(pm) {
    const sec = el("section", "market");
    sec.append(el("h2", "", "Tržište predviđanja"));
    const q = el("p", "question", pm.title);
    q.lang = "en";
    sec.append(q);
    const ul = el("ul");
    for (const o of pm.outcomes) {
      const pct = Math.round(o.probability * 100);
      const li = el("li");
      const label = el("span", "label", o.label);
      if (o.label !== "Da" && o.label !== "Ne") label.lang = "en";
      const bar = el("span", "bar");
      const fill = el("span", "fill");
      fill.style.width = `${Math.max(pct, 1)}%`;
      bar.append(fill);
      li.append(label, bar, el("span", "pct", `${pct} %`));
      li.setAttribute("aria-label", `${o.label}: ${pct} posto`);
      ul.append(li);
    }
    sec.append(ul);
    const volume = pm.volume >= 1e6 ? `${(pm.volume / 1e6).toLocaleString("hr-HR", { maximumFractionDigits: 1 })} mil. $`
      : `${Math.round(pm.volume / 1000)} tis. $`;
    const note = el("p", "note");
    const link = el("a", "", "Polymarket");
    link.href = safeUrl(pm.url);
    link.target = "_blank";
    link.rel = "noopener noreferrer nofollow";
    const when = el("time");
    setTime(when, pm.updated_at);
    note.append(link, `, promet ${volume}, ${pm.closed ? "tržište zatvoreno, zadnje kvote od" : "kvote osvježene"} `, when,
      ". Kvote su procjena trgovaca na tržištu predviđanja, a ne činjenica ni stav neutrall.hr.");
    sec.append(note);
    return sec;
  }

  // Klik na temu (u trendu ili uz priču) pretražuje sve priče po toj ključnoj riječi.
  function searchFor(keyword) {
    searchInput.value = keyword;
    syncClear();
    runSearch();
    markTrending();
    window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function markTrending() {
    document.querySelectorAll("#trending button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.keyword === query)));
  }

  async function loadTrending() {
    try {
      const { items } = await api("/api/v1/trending?limit=10");
      if (!items.length) return;
      $("#trending").replaceChildren(...items.map((t) => {
        const li = el("li");
        const b = el("button");
        b.type = "button";
        b.dataset.keyword = t.keyword;
        b.append(el("span", "kw", t.keyword), el("span", "n", t.stories === 1 ? "1 priča" : `${t.stories} priče`));
        b.addEventListener("click", () => (query === t.keyword ? clearSearch() : searchFor(t.keyword)));
        li.append(b);
        return li;
      }));
      $(".trending").hidden = false;
      markTrending();
    } catch {
      // bez trendova stranica radi normalno
    }
  }

  function clearSearch() {
    searchInput.value = "";
    syncClear();
    runSearch();
    markTrending();
  }

  function renderFilter(key, options) {
    const f = filters[key];
    if (!options.some((o) => o.id === f.value)) f.value = "sve";
    f.el.replaceChildren(...options.map((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = o.label;
      b.dataset.value = o.id;
      b.setAttribute("aria-pressed", String(o.id === f.value));
      b.addEventListener("click", () => {
        if (o.id === f.value) return;
        f.value = o.id;
        f.el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.value === f.value)));
        setUrlParam(f.param, f.value === "sve" ? "" : f.value);
        load(true);
      });
      return b;
    }));
  }

  async function loadSources() {
    try {
      const { sources } = await api("/api/v1/sources");
      allSources = sources;
      const el = $("#sources");
      el.replaceChildren();
      sources.forEach((s, i) => {
        const a = document.createElement("a");
        a.href = safeUrl(s.url);
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = s.name;
        el.append(a);
        if (i < sources.length - 1) el.append(", ");
      });
    } catch {
      $("#sources").textContent = "Popis izvora trenutno nije dostupan.";
    }
  }

  moreBtn.addEventListener("click", () => load(false));

  if (location.pathname.replace(/\/$/, "") === "/statistika") {
    renderStats();
    return;
  }
  askConsent();
  if (location.pathname.replace(/\/$/, "") === "/sazetak") {
    renderDigest();
    return;
  }
  if (detailMatch) {
    loadSources().then(() => renderDetail(detailMatch[1]));
    return;
  }
  // Feed se crta tek kad su poznati filteri i popis medija (za traku pokrivenosti).
  Promise.allSettled([
    api("/api/v1/filters").then(({ categories, regions, tones }) => {
      renderFilter("category", categories);
      renderFilter("region", regions);
      if (tones) renderFilter("tone", tones);
    }),
    loadSources(),
  ]).then(() => load(true));
  loadTrending();
})();

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
        ? "Previše pretraga u kratkom vremenu. Pričekaj minutu pa pokušaj ponovno."
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

    box.append(back, meta, coverage, h1, lede, body);
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

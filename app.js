(() => {
  const API = window.NEUTRALL_CONFIG.apiBase.replace(/\/$/, "");
  const CATEGORY_LABELS = {
    politika: "Politika", ekonomija: "Ekonomija", tehnologija: "Tehnologija", sport: "Sport",
    kultura: "Kultura", znanost: "Znanost", zdravlje: "Zdravlje", kronika: "Kronika", lifestyle: "Lifestyle",
    ostalo: "Ostalo",
  };
  const TYPE_LABELS = { analiza: "Analiza", misljenje: "Mišljenje", intervju: "Intervju", priopcenje: "Priopćenje" };
  const REGION_LABELS = { hrvatska: "Hrvatska", svijet: "Svijet" };
  const SUMMARY_LABELS = { ai: "AI sažetak", translated: "Strojni prijevod opisa", original: "Izvorni opis" };

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

  function renderStory(story) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    const lead = story.lead;
    const articles = [lead, ...story.related];

    $(".cat", node).textContent = CATEGORY_LABELS[lead.category] || "Vijest";
    if (TYPE_LABELS[lead.content_type]) {
      const t = $(".type", node);
      t.textContent = TYPE_LABELS[lead.content_type];
      t.hidden = false;
    }
    $(".region", node).textContent = REGION_LABELS[lead.region] || "";
    setTime($("time", node), story.updated_at);
    renderCoverage($(".coverage", node), story, articles);

    // Strani naslov prikazujemo u strojnom prijevodu (prošao je provjeru vjernosti), a izvorni ispod njega.
    const title = $(".title", node);
    title.textContent = lead.title_hr || lead.title;
    if (lead.title_hr) {
      const o = $(".translated-title", node);
      o.textContent = `Izvorni naslov: ${lead.title}`;
      o.lang = "en";
      o.hidden = false;
    }
    $(".summary", node).textContent = lead.summary || "";

    if (lead.uncertainty) {
      const u = $(".uncertainty", node);
      u.textContent = lead.uncertainty;
      u.hidden = false;
    }
    if (story.claims && story.claims.length) renderClaims($(".claims", node), story);

    const label = $(".ai-label", node);
    if (lead.summary_kind === "ai") {
      label.textContent = `AI sažetak iz ${listNames([...new Set(articles.map((a) => a.source.name))])}`;
      if (story.ai_provider) label.title = story.ai_provider.startsWith("claude") ? "Obradio Claude" : "Obradio lokalni AI model";
    } else {
      label.textContent = `${SUMMARY_LABELS[lead.summary_kind] || "Izvorni opis"}, ${lead.source.name}`;
    }

    const d = $(".related", node);
    $("summary", d).textContent = `Naslovi u medijima (${articles.length})`;
    const ul = $("ul", d);
    for (const a of [...articles].sort((x, y) => x.published_at.localeCompare(y.published_at))) {
      const li = el("li");
      const src = el("span", "rel-source", a.source.name + " ");
      const t = el("time");
      setTime(t, a.published_at);
      src.append(t);
      const tt = el("span", "rel-title", a.title_hr || a.title);
      if (a.title_hr) tt.title = `Strojni prijevod. Izvorni naslov: ${a.title}`;
      li.append(src, tt);
      if (TYPE_LABELS[a.content_type]) li.append(`, ${TYPE_LABELS[a.content_type].toLowerCase()}`);
      ul.append(li);
    }
    d.hidden = false;
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
    load(true);
  }
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch();
  });
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, searchInput.value.trim() ? 700 : 0);
  });

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

  // Feed se crta tek kad su poznati filteri i popis medija (za traku pokrivenosti).
  Promise.allSettled([
    api("/api/v1/filters").then(({ categories, regions, tones }) => {
      renderFilter("category", categories);
      renderFilter("region", regions);
      if (tones) renderFilter("tone", tones);
    }),
    loadSources(),
  ]).then(() => load(true));
})();

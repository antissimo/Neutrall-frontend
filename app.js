(() => {
  const API = window.NEUTRALL_CONFIG.apiBase.replace(/\/$/, "");
  const CATEGORY_LABELS = {
    politika: "Politika", ekonomija: "Ekonomija", tehnologija: "Tehnologija", sport: "Sport",
    kultura: "Kultura", znanost: "Znanost", zdravlje: "Zdravlje", kronika: "Kronika", ostalo: "Ostalo",
  };
  const TYPE_LABELS = { analiza: "Analiza", misljenje: "Mišljenje", intervju: "Intervju", priopcenje: "Priopćenje" };
  const REGION_LABELS = { hrvatska: "Hrvatska", svijet: "Svijet" };

  const $ = (sel, root = document) => root.querySelector(sel);
  const feedEl = $("#feed");
  const statusEl = $("#status");
  const moreBtn = $("#more");
  const tpl = $("#story-tpl");

  const params = new URLSearchParams(location.search);
  const filters = {
    category: { value: params.get("kategorija") || "sve", param: "kategorija", el: $("#categories") },
    region: { value: params.get("regija") || "sve", param: "regija", el: $("#regions") },
  };
  let cursor = null;
  let loading = false;

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

  function renderStory(story) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    const lead = story.lead;

    $(".cat", node).textContent = CATEGORY_LABELS[lead.category] || "Vijest";
    if (TYPE_LABELS[lead.content_type]) {
      const t = $(".type", node);
      t.textContent = TYPE_LABELS[lead.content_type];
      t.hidden = false;
    }
    $(".region", node).textContent = REGION_LABELS[lead.region] || "";
    setTime($("time", node), story.updated_at);
    if (story.source_count > 1) {
      const c = $(".count", node);
      c.textContent = `${story.source_count} izvora`;
      c.hidden = false;
    }

    const link = $(".title a", node);
    link.textContent = lead.title;
    link.href = safeUrl(lead.url);
    $(".summary", node).textContent = lead.summary || "";

    if (lead.uncertainty) {
      const u = $(".uncertainty", node);
      u.textContent = "Nepotvrđeno: " + lead.uncertainty;
      u.hidden = false;
    }

    if (lead.claims && lead.claims.length) {
      const d = $(".claims", node);
      $("summary", d).textContent = `Tvrdnje u članku (${lead.claims.length})`;
      const ul = $("ul", d);
      for (const c of lead.claims) {
        const li = document.createElement("li");
        const by = document.createElement("strong");
        by.textContent = c.by + ": ";
        li.append(by, c.claim);
        ul.append(li);
      }
      d.hidden = false;
    }

    if (story.comparison) {
      const box = $(".comparison", node);
      $("strong", box).textContent = story.disagreement ? "Izvori se razlikuju" : "Kako izvještavaju izvori";
      $("p", box).textContent = story.comparison;
      box.hidden = false;
    }

    $(".source-name", node).textContent = lead.source.name;
    $(".ai-label", node).textContent = lead.summary_is_ai ? "AI sažetak" : "Izvorni opis";
    $(".original", node).href = safeUrl(lead.url);

    if (story.related.length) {
      const d = $(".related", node);
      $("summary", d).textContent = `Također izvještavaju (${story.related.length})`;
      const ul = $("ul", d);
      for (const a of story.related) {
        const li = document.createElement("li");
        const src = document.createElement("span");
        src.className = "rel-source";
        src.textContent = a.source.name;
        const al = document.createElement("a");
        al.href = safeUrl(a.url);
        al.target = "_blank";
        al.rel = "noopener noreferrer";
        al.textContent = a.title;
        const t = document.createElement("time");
        setTime(t, a.published_at);
        li.append(src, al, t);
        if (TYPE_LABELS[a.content_type]) li.append(` · ${TYPE_LABELS[a.content_type]}`);
        ul.append(li);
      }
      d.hidden = false;
    }
    return node;
  }

  async function load(reset) {
    if (loading) return;
    loading = true;
    moreBtn.disabled = true;
    if (reset) {
      cursor = null;
      feedEl.replaceChildren();
      statusEl.textContent = "Učitavanje…";
    }
    try {
      const qs = new URLSearchParams({ category: filters.category.value, region: filters.region.value, limit: "20" });
      if (cursor) qs.set("cursor", cursor);
      const data = await api(`/api/v1/feed?${qs}`);
      feedEl.append(...data.items.map(renderStory));
      cursor = data.next_cursor;
      moreBtn.hidden = !cursor;
      statusEl.textContent = feedEl.children.length ? "" : "Još nema obrađenih vijesti za ovaj filter. Nove stižu svakih nekoliko minuta.";
    } catch (e) {
      statusEl.textContent = "Vijesti trenutno nisu dostupne. Pokušaj ponovno za nekoliko minuta.";
      console.error(e);
    } finally {
      loading = false;
      moreBtn.disabled = false;
    }
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
        const url = new URL(location.href);
        f.value === "sve" ? url.searchParams.delete(f.param) : url.searchParams.set(f.param, f.value);
        history.replaceState(null, "", url);
        load(true);
      });
      return b;
    }));
  }

  async function loadSources() {
    try {
      const { sources } = await api("/api/v1/sources");
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

  api("/api/v1/filters")
    .then(({ categories, regions }) => {
      renderFilter("category", categories);
      renderFilter("region", regions);
    })
    .catch(() => {})
    .finally(() => load(true));
  loadSources();
})();

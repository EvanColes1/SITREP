/* SITREP dashboard. Reads the JSON files in data/ and draws every panel with D3. */
(function () {
  "use strict";

  const state = { region: "", theme: "", country: "", days: 7, q: "", limit: 20, energyDays: 90, layer: "coverage" };
  const D = {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const DAY = 86400000;
  const nf = (n) => Number(n || 0).toLocaleString("en-GB");
  const fmtDate = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const ageDays = (iso) => (Date.now() - new Date(iso)) / DAY;
  const within = (iso, days) => ageDays(iso) <= days;
  const HOT_THEMES = new Set(["sanctions", "maritime", "conflict", "nuclear"]);
  let regionNames;
  try { regionNames = new Intl.DisplayNames(["en-GB"], { type: "region" }); } catch (e) { regionNames = null; }
  const flagName = (code) => {
    const c = (code || "").trim().toUpperCase();
    if (!c) return "Unknown";
    try { return (c.length === 2 && regionNames && regionNames.of(c)) || c; } catch (e) { return c; }
  };

  /* Country names in the map file that differ from the names used for tagging */
  const ATLAS_NAME = {
    "United States": "United States of America", "DR Congo": "Dem. Rep. Congo", "Republic of Congo": "Congo",
    "Central African Republic": "Central African Rep.", "South Sudan": "S. Sudan", "Bosnia and Herzegovina": "Bosnia and Herz.",
    "Dominican Republic": "Dominican Rep.", "Ivory Coast": "Côte d'Ivoire", "Equatorial Guinea": "Eq. Guinea", "North Macedonia": "Macedonia",
  };
  const FROM_ATLAS = Object.fromEntries(Object.entries(ATLAS_NAME).map(([k, v]) => [v, k]));

  async function load(name) {
    try {
      const r = await fetch(`${name}.json`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) { return null; }
  }

  function ago(iso) {
    if (!iso) return "–";
    const mins = Math.round((Date.now() - new Date(iso)) / 60000);
    if (mins < 60) return `${Math.max(mins, 1)} min ago`;
    const h = Math.round(mins / 60);
    if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
    return `${Math.round(h / 24)} days ago`;
  }

  /* ------------------------------------------------------------ tooltip */
  const tip = $("tip");
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
    tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, y)}px`;
  }
  const hideTip = () => { tip.hidden = true; };

  /* ------------------------------------------------------------ data helpers */
  const items = () => D.news?.items || [];
  function filtered(skip = []) {
    return items().filter((i) =>
      within(i.published, state.days) &&
      (skip.includes("region") || !state.region || i.regions.includes(state.region)) &&
      (skip.includes("theme") || !state.theme || i.themes.includes(state.theme)) &&
      (skip.includes("country") || !state.country || i.countries.includes(state.country)) &&
      (!state.q || `${i.title} ${i.summary} ${i.source} ${i.countries.join(" ")}`.toLowerCase().includes(state.q)));
  }
  function countBy(list, fn) {
    const m = new Map();
    for (const x of list) for (const k of [].concat(fn(x))) if (k) m.set(k, (m.get(k) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  /* ------------------------------------------------------------ bar lists */
  function drawBars(el, rows, { onClick, active, limit = 8, empty = "Nothing to show yet." } = {}) {
    rows = rows.slice(0, limit);
    if (!rows.length) { el.innerHTML = `<li class="bars-empty">${esc(empty)}</li>`; return; }
    const max = rows[0][1];
    el.innerHTML = rows.map(([k, n, label]) => `
      <li class="${onClick ? "clickable" : ""} ${active === k ? "on" : ""}" ${onClick ? `tabindex="0" role="button" data-k="${esc(k)}" aria-pressed="${active === k}"` : ""}>
        <span class="lbl" title="${esc(label || k)}">${esc(label || k)}</span>
        <span class="track"><span class="fill" style="width:${(n / max) * 100}%"></span></span>
        <span class="val">${nf(n)}</span>
      </li>`).join("");
    if (onClick) {
      el.onclick = (e) => { const li = e.target.closest("li[data-k]"); if (li) onClick(li.dataset.k); };
      el.onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.dataset.k) { e.preventDefault(); onClick(e.target.dataset.k); } };
    }
  }

  /* ------------------------------------------------------------ overview */
  function drawOverview() {
    const week = items().filter((i) => within(i.published, 7));
    const prev = items().filter((i) => ageDays(i.published) > 7 && ageDays(i.published) <= 14);
    $("hero-count").textContent = nf(week.length);
    const s = D.status || {};
    $("updated").textContent = `Updated ${ago(s.updated || D.news?.updated)}`;
    const feeds = s.feeds || [];
    $("sources-ok").textContent = feeds.length ? `${feeds.filter((f) => f.ok).length}/${feeds.length}` : "–";
    $("hero-sub").textContent = `Tracking ${D.meta.feed_count || feeds.length || 35} sources across six regions and ten themes.`;
    if (prev.length) {
      const pct = ((week.length - prev.length) / prev.length) * 100;
      $("hero-change").innerHTML = `<span class="${pct >= 0 ? "up" : "down"}">${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%</span>`;
    } else $("hero-change").textContent = "–";
    $("hero-sanc").textContent = D.sanctions ? nf(D.sanctions.recent_total) : "–";
    if ([D.news, D.sanctions, D.energy, D.conflict].some((d) => d && d.sample)) $("sample-banner").hidden = false;
    drawHotList();
  }

  function drawHotList() {
    const week = items().filter((i) => within(i.published, 7));
    const top = countBy(week, (i) => i.countries).filter(([c]) => c !== "European Union").slice(0, 6);
    const max = top[0]?.[1] || 1;
    $("hot-list").innerHTML = top.map(([c, n], idx) => `
      <li><button type="button" data-c="${esc(c)}" aria-pressed="${state.country === c}">
        <span class="hot-rank">${idx + 1}</span><span>${esc(c)}</span><span class="hot-n">${nf(n)}</span>
        <span class="hot-bar"><i style="width:${(n / max) * 100}%"></i></span>
      </button></li>`).join("") || `<li class="board-sub">No stories yet.</li>`;
    $("hot-list").onclick = (e) => { const b = e.target.closest("button[data-c]"); if (b) openDossier(b.dataset.c); };
  }

  /* ------------------------------------------------------------ world map */
  let worldFeatures = null;
  function features() {
    if (!worldFeatures && D.world && window.topojson) {
      worldFeatures = topojson.feature(D.world, D.world.objects.countries).features.filter((f) => f.properties.name !== "Antarctica");
    }
    return worldFeatures;
  }

  function drawWorld() {
    const el = $("world"); el.innerHTML = "";
    const feats = features();
    if (!feats || !window.d3) { el.innerHTML = `<p class="board-sub">The map couldn't load. Reload the page to try again.</p>`; return; }
    const w = el.clientWidth || 800, h = Math.round(w / 1.9);
    const proj = d3.geoNaturalEarth1().fitExtent([[4, 4], [w - 4, h - 4]], { type: "Sphere" });
    const path = d3.geoPath(proj);
    const conflictLayer = state.layer === "conflict" && (D.conflict?.events || []).length;
    const week = items().filter((i) => within(i.published, 7));
    let counts, unit;
    if (conflictLayer) {
      counts = new Map([...conflictByCountry(14)].map(([c, r]) => [c, r.ev])); unit = ["event", "events", "in 14 days"];
    } else {
      counts = new Map(countBy(week, (i) => i.countries)); unit = ["story", "stories", "this week"];
    }
    $("key-low").textContent = conflictLayer ? "Fewer events" : "Fewer stories";
    const themeTop = (c) => countBy(week.filter((i) => i.countries.includes(c)), (i) => i.themes)[0]?.[0];
    const max = d3.max(counts.values()) || 1;
    const ramp = ["--b1", "--b2", "--b3", "--b4", "--b5"].map(css);
    const colour = (n) => (n ? ramp[Math.min(4, Math.floor(Math.sqrt(n / max) * 4.999))] : css("--land"));

    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("aria-hidden", "true");
    svg.append("path").attr("class", "sphere").attr("d", path({ type: "Sphere" }));
    svg.append("path").attr("class", "graticule").attr("d", path(d3.geoGraticule10()));
    svg.append("g").selectAll("path").data(feats).join("path")
      .attr("class", (f) => `country${state.country && (ATLAS_NAME[state.country] || state.country) === f.properties.name ? " sel" : ""}`)
      .attr("d", path)
      .style("fill", (f) => colour(counts.get(FROM_ATLAS[f.properties.name] || f.properties.name) || 0))
      .on("mousemove", (ev, f) => {
        const name = FROM_ATLAS[f.properties.name] || f.properties.name, n = counts.get(name) || 0;
        const r = RISK?.byName.get(name), t = !conflictLayer && n && themeTop(name);
        showTip(`<strong>${esc(name)}</strong>${n ? `${nf(n)} ${n === 1 ? unit[0] : unit[1]} ${unit[2]}` : `No ${unit[1]} ${unit[2]}`}${t ? `<br>Mostly ${esc(D.meta.themes[t]?.label || t)}` : ""}${r ? `<br>Risk index ${r.score}, ${bandOf(r.score)[1]}` : ""}`, ev);
      })
      .on("mouseleave", hideTip)
      .on("click", (ev, f) => { hideTip(); openDossier(FROM_ATLAS[f.properties.name] || f.properties.name); });
    svg.selectAll(".country.sel").raise();

    if ($("show-choke").checked) {
      const stats = chokeStats();
      const g = svg.append("g");
      const size = d3.scaleSqrt().domain([0, Math.max(1, d3.max(stats, (c) => c.cur))]).range([3.5, 9]);
      for (const c of stats) {
        const [x, y] = proj([c.lon, c.lat]), s = size(c.cur);
        g.append("path").attr("class", "choke-mark").attr("d", `M${x},${y - s}L${x + s},${y}L${x},${y + s}L${x - s},${y}Z`)
          .style("opacity", c.cur ? 1 : 0.45)
          .on("mousemove", (ev) => showTip(`<strong>${esc(c.name)}</strong>${nf(c.cur)} stories in 7 days${c.prev ? `, ${nf(c.prev)} the week before` : ""}`, ev))
          .on("mouseleave", hideTip)
          .on("click", () => { hideTip(); state.q = c.kw[0]; $("f-search").value = c.kw[0]; state.days = 14; $("f-days").value = "14"; refresh(); $("news").scrollIntoView({ block: "start" }); });
        if (c.cur && w > 560) g.append("text").attr("class", "choke-label").attr("x", x + s + 3).attr("y", y + 3.5).text(nf(c.cur));
      }
    }
  }

  function toggleCountry(c, scroll) {
    state.country = state.country === c ? "" : c;
    if (state.country && state.days < 7) { state.days = 7; $("f-days").value = "7"; }
    refresh();
    if (scroll && state.country) $("news").scrollIntoView({ block: "start" });
  }

  /* ------------------------------------------------------------ theme pulse */
  function drawPulse() {
    const el = $("pulse");
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const dayIdx = (iso) => Math.floor((today - new Date(iso)) / DAY); // 0 = today
    el.innerHTML = "";
    for (const [tk, t] of Object.entries(D.meta.themes)) {
      const daily = new Array(14).fill(0);
      for (const i of items()) if (i.themes.includes(tk)) { const d = dayIdx(i.published); if (d >= 0 && d < 14) daily[13 - d]++; }
      const cur = daily.slice(7).reduce((a, b) => a + b, 0), prev = daily.slice(0, 7).reduce((a, b) => a + b, 0);
      const pct = prev ? ((cur - prev) / prev) * 100 : cur ? 100 : 0;
      const cls = Math.abs(pct) < 5 ? "flat" : pct > 0 ? "rise" : "fall";
      const card = document.createElement("button");
      card.type = "button"; card.className = "pulse-card"; card.dataset.t = tk;
      card.setAttribute("aria-pressed", String(state.theme === tk));
      card.setAttribute("aria-label", `${t.label}: ${cur} stories this week, ${cls === "flat" ? "level with" : `${Math.abs(pct).toFixed(0)}% ${pct > 0 ? "up on" : "down on"}`} the week before`);
      card.innerHTML = `<span class="pulse-name">${esc(t.label)}</span>
        <span class="pulse-row"><span class="pulse-n">${nf(cur)}<small>this week</small></span>
        <span class="chg ${cls}">${cls === "flat" ? "Level" : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%`}</span></span>`;
      el.appendChild(card);
      const W = 200, H = 40, gap = 2, bw = (W - gap * 13) / 14, max = Math.max(1, ...daily);
      const svg = d3.select(card).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "none").attr("aria-hidden", "true");
      svg.selectAll("rect").data(daily.map((v, i) => ({ v, i }))).join("rect")
        .attr("x", (d) => d.i * (bw + gap)).attr("width", bw)
        .attr("y", (d) => H - Math.max(1.5, (d.v / max) * H)).attr("height", (d) => Math.max(1.5, (d.v / max) * H))
        .attr("rx", 1.5).style("fill", (d) => css(d.i >= 7 ? "--bar" : "--bar-soft"))
        .on("mousemove", (ev, d) => {
          const date = new Date(today - (13 - d.i) * DAY);
          showTip(`<strong>${fmtDate(date)}</strong>${nf(d.v)} ${d.v === 1 ? "story" : "stories"} on ${esc(t.label)}`, ev);
        })
        .on("mouseleave", hideTip);
    }
    el.onclick = (e) => {
      const b = e.target.closest(".pulse-card"); if (!b) return;
      state.theme = state.theme === b.dataset.t ? "" : b.dataset.t; $("f-theme").value = state.theme; refresh();
    };
  }

  /* ------------------------------------------------------------ matrix */
  function drawMatrix() {
    const { regions, themes } = D.meta;
    const week = items().filter((i) => within(i.published, 7));
    const count = {};
    let max = 0;
    for (const i of week) for (const r of i.regions) for (const t of i.themes) {
      const k = `${r}|${t}`; count[k] = (count[k] || 0) + 1; max = Math.max(max, count[k]);
    }
    const q = (n) => (n === 0 ? 0 : Math.min(5, Math.ceil((n / max) * 5)));
    let h = `<thead><tr><th scope="col">Region</th>${Object.values(themes).map((t) => `<th scope="col">${esc(t.label)}</th>`).join("")}<th scope="col" class="total">All</th></tr></thead><tbody>`;
    for (const [rk, r] of Object.entries(regions)) {
      h += `<tr><th scope="row">${esc(r.label)}</th>`;
      for (const [tk, t] of Object.entries(themes)) {
        const n = count[`${rk}|${tk}`] || 0;
        h += `<td><button type="button" class="cell" data-q="${q(n)}" data-r="${rk}" data-t="${tk}" aria-pressed="${state.region === rk && state.theme === tk}"
          aria-label="${esc(r.label)}, ${esc(t.label)}: ${n} ${n === 1 ? "story" : "stories"}">${n || "·"}</button></td>`;
      }
      h += `<td class="total">${week.filter((i) => i.regions.includes(rk)).length}</td></tr>`;
    }
    $("matrix").innerHTML = h + "</tbody>";
  }

  /* ------------------------------------------------------------ filters + feed */
  function setupFilters() {
    const fr = $("f-region"), ft = $("f-theme");
    for (const [k, r] of Object.entries(D.meta.regions)) fr.add(new Option(r.label, k));
    for (const [k, t] of Object.entries(D.meta.themes)) ft.add(new Option(t.label, k));
    fr.onchange = () => { state.region = fr.value; refresh(); };
    ft.onchange = () => { state.theme = ft.value; refresh(); };
    $("f-days").onchange = (e) => { state.days = +e.target.value; refresh(); };
    let timer;
    $("f-search").oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); refresh(); }, 200); };
    $("f-clear").onclick = clearAll;
    $("matrix").addEventListener("click", (e) => {
      const b = e.target.closest(".cell"); if (!b) return;
      const same = state.region === b.dataset.r && state.theme === b.dataset.t;
      state.region = same ? "" : b.dataset.r; state.theme = same ? "" : b.dataset.t;
      fr.value = state.region; ft.value = state.theme;
      if (state.days < 7) { state.days = 7; $("f-days").value = "7"; }
      refresh();
      if (!same) $("news").scrollIntoView({ block: "start" });
    });
    $("feed").addEventListener("click", (e) => {
      const b = e.target.closest(".tag"); if (!b) return;
      if (b.dataset.r) { state.region = b.dataset.r; fr.value = b.dataset.r; }
      if (b.dataset.t) { state.theme = b.dataset.t; ft.value = b.dataset.t; }
      if (b.dataset.c) state.country = b.dataset.c;
      refresh();
    });
    $("active-filters").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      const k = b.dataset.k;
      state[k] = ""; if (k === "region") fr.value = ""; if (k === "theme") ft.value = ""; if (k === "q") $("f-search").value = "";
      refresh();
    });
    $("more").onclick = () => { state.limit += 20; drawFeed(); };
  }
  function clearAll() {
    Object.assign(state, { region: "", theme: "", country: "", q: "", days: 7 });
    $("f-region").value = $("f-theme").value = $("f-search").value = ""; $("f-days").value = "7";
    refresh();
  }

  function refresh() {
    state.limit = 20;
    drawMatrix(); drawFeed(); drawHotList(); drawWorld();
    document.querySelectorAll(".pulse-card").forEach((c) => c.setAttribute("aria-pressed", String(state.theme === c.dataset.t)));
  }

  function drawFeed() {
    const { regions, themes } = D.meta;
    const list = filtered();
    const chips = [];
    if (state.country) chips.push(["country", state.country]);
    if (state.region) chips.push(["region", regions[state.region].label]);
    if (state.theme) chips.push(["theme", themes[state.theme].label]);
    if (state.q) chips.push(["q", `“${state.q}”`]);
    $("active-filters").innerHTML = chips.map(([k, l]) => `<button type="button" class="chip" data-k="${k}" aria-label="Remove filter ${esc(l)}">${esc(l)}<span aria-hidden="true">×</span></button>`).join("");
    $("feed-count").textContent = `${nf(list.length)} ${list.length === 1 ? "story" : "stories"} in the last ${state.days === 1 ? "24 hours" : `${state.days} days`}${chips.length ? ", filtered" : ""}.`;

    drawBars($("top-countries"), countBy(filtered(["country"]), (i) => i.countries), {
      active: state.country, onClick: (c) => toggleCountry(c, false), empty: "No countries named in these stories.",
    });
    drawBars($("top-sources"), countBy(list, (i) => i.source), { limit: 6, empty: "No stories match." });

    if (!list.length) {
      $("feed").innerHTML = `<li class="empty">No stories match these filters. Try a longer period or remove a filter.</li>`;
      $("more").hidden = true; return;
    }
    $("feed").innerHTML = list.slice(0, state.limit).map((i) => `
      <li class="story">
        <span class="story-stripe ${i.themes.some((t) => HOT_THEMES.has(t)) ? "hot" : ""}" aria-hidden="true"></span>
        <div>
          <div class="story-meta"><span class="src">${esc(i.source)}</span><time datetime="${esc(i.published)}">${ago(i.published)}</time></div>
          <h3><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
          ${i.summary ? `<p>${esc(i.summary)}</p>` : ""}
          <div class="tags">
            ${i.themes.map((t) => themes[t] ? `<button class="tag" data-t="${t}" type="button">${esc(themes[t].label)}</button>` : "").join("")}
            ${i.regions.map((r) => regions[r] ? `<button class="tag region" data-r="${r}" type="button">${esc(regions[r].label)}</button>` : "").join("")}
            ${i.countries.slice(0, 3).map((c) => `<button class="tag country" data-c="${esc(c)}" type="button">${esc(c)}</button>`).join("")}
          </div>
        </div>
      </li>`).join("");
    $("more").hidden = list.length <= state.limit;
  }

  /* ------------------------------------------------------------ sanctions */
  function lists(p) {
    const s = (p || "").toUpperCase(), out = [];
    if (/OFAC|\bUS\b|UNITED STATES/.test(s)) out.push("US");
    if (/OFSI|\bUK\b|HM TREASURY|FCDO|UNITED KINGDOM/.test(s)) out.push("UK");
    if (/\bEU\b|EUROPEAN/.test(s)) out.push("EU");
    if (/\bUN\b|UNITED NATIONS|SECURITY COUNCIL/.test(s)) out.push("UN");
    return out.length ? out : ["Other"];
  }
  const typeName = (t) => ({ LegalEntity: "Entity", Organization: "Organisation" }[t] || t);

  function drawSanctions() {
    const s = D.sanctions;
    if (!s) {
      $("sanc-kpis").innerHTML = `<p class="hint">Sanctions data hasn't loaded yet. It appears after the first daily update.</p>`;
      return;
    }
    const recentVessels = s.recent.filter((r) => r.type === "Vessel").length;
    const flags = countBy(s.vessels, (v) => (v.countries || "").split(/[;,]/)[0]?.trim()).map(([k, n]) => [k, n, flagName(k)]);
    $("sanc-kpis").innerHTML = [
      ["New listings, 30 days", nf(s.recent_total)],
      ["Of which vessels", nf(recentVessels)],
      ["Sanctioned vessels in total", nf(s.vessel_total)],
      ["Most common vessel flag", flags[0] ? esc(flags[0][2]) : "–"],
    ].map(([k, v]) => `<dl class="kpi"><dt>${k}</dt><dd>${v}</dd></dl>`).join("");

    $("sanctions-table").innerHTML = `<thead><tr><th>Added</th><th>Name</th><th>Type</th><th>Lists</th></tr></thead><tbody>` +
      s.recent.slice(0, 12).map((r) => `<tr><td class="num">${fmtDate(r.first_seen)}</td><td>${esc(r.name)}</td><td>${esc(typeName(r.type))}</td>
        <td>${lists(r.programs).map((l) => `<span class="pill">${l}</span>`).join("")}</td></tr>`).join("") + "</tbody>";
    drawBars($("sanc-by-list"), countBy(s.recent, (r) => lists(r.programs)), { limit: 5 });
    drawBars($("sanc-by-type"), countBy(s.recent, (r) => typeName(r.type)), { limit: 5 });
    drawBars($("fleet-flags"), flags, { limit: 8 });
    drawFleet();
    $("fleet-search").oninput = drawFleet;
  }

  function drawFleet() {
    const s = D.sanctions; if (!s) return;
    const q = $("fleet-search").value.trim().toLowerCase();
    const rows = s.vessels.filter((v) => !q || `${v.name} ${v.imo} ${v.countries} ${flagName((v.countries || "").split(/[;,]/)[0])}`.toLowerCase().includes(q));
    $("fleet").innerHTML = `<thead><tr><th>Listed</th><th>Vessel</th><th>IMO</th><th>Flag</th><th>Lists</th></tr></thead><tbody>` +
      (rows.length ? rows.slice(0, 15).map((v) => `<tr><td class="num">${fmtDate(v.first_seen)}</td><td>${esc(v.name)}</td><td class="num">${esc(v.imo || "–")}</td>
        <td>${esc(flagName((v.countries || "").split(/[;,]/)[0]))}</td><td>${lists(v.programs).map((l) => `<span class="pill">${l}</span>`).join("")}</td></tr>`).join("")
        : `<tr><td colspan="5" class="hint">No vessels match “${esc(q)}”.</td></tr>`) + "</tbody>" +
      (rows.length > 15 ? `<caption class="hint" style="caption-side:bottom;text-align:left;padding-top:8px">Showing 15 of ${nf(rows.length)}. Search to narrow the list.</caption>` : "");
  }

  /* ------------------------------------------------------------ energy */
  function drawEnergy() {
    const el = $("energy-charts"); el.innerHTML = "";
    const series = D.energy?.series;
    if (!series || !Object.keys(series).length) {
      el.innerHTML = `<p class="hint">Energy prices appear once an EIA key is added. See the setup guide.</p>`; return;
    }
    const cards = [];
    for (const [label, all] of Object.entries(series)) {
      if (!all.length) continue;
      const cutoff = new Date(all[all.length - 1].date) - state.energyDays * DAY;
      const pts = all.filter((p) => new Date(p.date) >= cutoff).map((p) => ({ date: new Date(p.date), value: p.value }));
      const [name, unit] = label.match(/^(.*?)\s*\((.*)\)$/)?.slice(1) || [label, ""];
      const first = pts[0], last = pts[pts.length - 1];
      const diff = last.value - first.value, pct = (diff / first.value) * 100;
      const card = document.createElement("div");
      card.className = "echart";
      card.innerHTML = `<div class="echart-top"><span class="echart-name">${esc(name)}</span><span class="echart-val">${last.value.toFixed(2)}</span></div>
        <div class="echart-sub"><span>${esc(unit)}, ${fmtDate(last.date)}</span>
        <span class="${diff >= 0 ? "rise" : "fall"}">${diff >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}% over ${state.energyDays >= 180 ? "6 months" : state.energyDays >= 90 ? "3 months" : "1 month"}</span></div>`;
      el.appendChild(card);
      cards.push([card, pts, name, unit, first, last]);
    }
    // measure after every card is in the grid, so each chart gets its real width
    for (const [card, pts, name, unit, first, last] of cards) {
      const W = Math.max(240, card.clientWidth - 32), H = 160, m = { t: 8, r: 40, b: 20, l: 2 };
      const x = d3.scaleTime().domain(d3.extent(pts, (p) => p.date)).range([m.l, W - m.r]);
      const y = d3.scaleLinear().domain(d3.extent(pts, (p) => p.value)).nice(4).range([H - m.b, m.t]);
      const svg = d3.select(card).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
        .attr("aria-label", `${name}, ${pts.length} daily prices from ${fmtDate(first.date)} to ${fmtDate(last.date)}, latest ${last.value.toFixed(2)} ${unit}`);
      const gid = `g${Math.random().toString(36).slice(2, 8)}`;
      const grad = svg.append("defs").append("linearGradient").attr("id", gid).attr("x1", 0).attr("x2", 0).attr("y1", 0).attr("y2", 1);
      grad.append("stop").attr("offset", "0%").attr("stop-color", css("--series-1")).attr("stop-opacity", 0.22);
      grad.append("stop").attr("offset", "100%").attr("stop-color", css("--series-1")).attr("stop-opacity", 0);
      svg.append("g").selectAll("line").data(y.ticks(4)).join("line").attr("class", "gridline")
        .attr("x1", m.l).attr("x2", W - m.r).attr("y1", y).attr("y2", y);
      svg.append("g").attr("class", "axis").attr("transform", `translate(${W - m.r + 6},0)`).call(d3.axisRight(y).ticks(4).tickSize(0));
      svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
        .call(d3.axisBottom(x).ticks(4).tickSize(0).tickPadding(6).tickFormat(d3.timeFormat("%-d %b")));
      svg.append("path").datum(pts).attr("fill", `url(#${gid})`)
        .attr("d", d3.area().x((p) => x(p.date)).y0(H - m.b).y1((p) => y(p.value)).curve(d3.curveMonotoneX));
      svg.append("path").datum(pts).attr("fill", "none").attr("stroke", css("--series-1")).attr("stroke-width", 2)
        .attr("d", d3.line().x((p) => x(p.date)).y((p) => y(p.value)).curve(d3.curveMonotoneX));
      svg.append("circle").attr("cx", x(last.date)).attr("cy", y(last.value)).attr("r", 4)
        .style("fill", css("--series-1")).style("stroke", css("--panel")).style("stroke-width", 2);
      const hover = svg.append("g").style("display", "none");
      hover.append("line").attr("y1", m.t).attr("y2", H - m.b).style("stroke", css("--ink-2")).style("stroke-dasharray", "3 3");
      hover.append("circle").attr("r", 4.5).style("fill", css("--series-1")).style("stroke", css("--panel")).style("stroke-width", 2);
      const bis = d3.bisector((p) => p.date).center;
      svg.append("rect").attr("x", m.l).attr("y", 0).attr("width", W - m.l - m.r).attr("height", H).style("fill", "transparent")
        .on("mousemove", (ev) => {
          const [mx] = d3.pointer(ev), p = pts[bis(pts, x.invert(mx))];
          hover.style("display", null).select("line").attr("x1", x(p.date)).attr("x2", x(p.date));
          hover.select("circle").attr("cx", x(p.date)).attr("cy", y(p.value));
          showTip(`<strong>${p.value.toFixed(2)} ${esc(unit)}</strong>${fmtDate(p.date)}`, ev);
        })
        .on("mouseleave", () => { hover.style("display", "none"); hideTip(); });
    }
  }
  function setupEnergyRange() {
    $("energy-range").onclick = (e) => {
      const b = e.target.closest("button[data-days]"); if (!b) return;
      state.energyDays = +b.dataset.days;
      document.querySelectorAll("#energy-range button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      drawEnergy();
    };
  }

  /* ------------------------------------------------------------ conflict */
  const EVENT_GROUPS = [
    { key: "unrest", label: "Protests and riots", match: ["Protests", "Riots"], colour: "--series-1" },
    { key: "battle", label: "Battles and explosions", match: ["Battles", "Explosions/Remote violence"], colour: "--series-2" },
    { key: "civ", label: "Violence against civilians", match: ["Violence against civilians"], colour: "--series-3" },
  ];
  const groupOf = (type) => EVENT_GROUPS.find((g) => g.match.includes(type));

  function drawConflict() {
    const events = (D.conflict?.events || []).filter((e) => groupOf(e.type));
    const map = $("conflict-map");
    if (!events.length) {
      document.querySelector(".conflict-grid").hidden = true; $("conflict-legend").hidden = true;
      const msg = $("conflict-empty"); msg.hidden = false;
      msg.textContent = "Conflict events appear once ACLED login details are added. See the setup guide.";
      return;
    }
    $("conflict-legend").innerHTML = EVENT_GROUPS.map((g) => {
      const n = events.filter((e) => groupOf(e.type) === g).length;
      return `<li><span class="dot" style="background:${css(g.colour)}"></span>${g.label} (${nf(n)})</li>`;
    }).join("");

    map.innerHTML = "";
    const feats = features();
    const w = map.clientWidth || 800, h = Math.round(w / 1.75);
    const proj = d3.geoNaturalEarth1().fitExtent([[4, 4], [w - 4, h - 4]], { type: "Sphere" });
    const path = d3.geoPath(proj);
    const svg = d3.select(map).append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("aria-hidden", "true");
    const g = svg.append("g");
    g.append("path").attr("class", "sphere").attr("d", path({ type: "Sphere" }));
    if (feats) g.append("g").selectAll("path").data(feats).join("path").attr("class", "country").attr("d", path);
    const r = d3.scaleSqrt().domain([0, d3.max(events, (e) => e.fatalities) || 1]).range([2.5, 11]);
    const ring = css("--board");
    const dots = g.append("g").selectAll("circle")
      .data(events.slice().sort((a, b) => b.fatalities - a.fatalities))
      .join("circle")
      .attr("cx", (e) => proj([e.lon, e.lat])[0]).attr("cy", (e) => proj([e.lon, e.lat])[1])
      .attr("r", (e) => r(e.fatalities))
      .style("fill", (e) => css(groupOf(e.type).colour)).style("fill-opacity", 0.85)
      .style("stroke", ring).style("stroke-width", 1)
      .on("mousemove", (ev, e) => showTip(`<strong>${esc(e.location)}, ${esc(e.country)}</strong>${esc(e.type)}${e.sub_type ? ` – ${esc(e.sub_type)}` : ""}<br>${fmtDate(e.date)}${e.fatalities ? `, ${e.fatalities} reported deaths` : ""}${e.notes ? `<br>${esc(e.notes)}` : ""}`, ev))
      .on("mouseleave", hideTip);
    svg.call(d3.zoom().scaleExtent([1, 10]).translateExtent([[0, 0], [w, h]]).on("zoom", (ev) => {
      g.attr("transform", ev.transform);
      dots.attr("r", (e) => r(e.fatalities) / Math.sqrt(ev.transform.k)).style("stroke-width", 1 / ev.transform.k);
    }));

    // events per day, stacked by group (3 groups only)
    const days = d3.timeDays(d3.timeDay.offset(d3.timeDay.floor(new Date()), -13), d3.timeDay.offset(d3.timeDay.floor(new Date()), 1));
    const rows = days.map((d) => {
      const key = d3.timeFormat("%Y-%m-%d")(d), row = { date: d };
      for (const gr of EVENT_GROUPS) row[gr.key] = events.filter((e) => e.date === key && groupOf(e.type) === gr).length;
      return row;
    });
    const dEl = $("conflict-daily"); dEl.innerHTML = "";
    const W = Math.max(260, dEl.clientWidth || 360), H = 140, m = { t: 6, r: 30, b: 20, l: 0 };
    const stack = d3.stack().keys(EVENT_GROUPS.map((x) => x.key))(rows);
    const x = d3.scaleBand().domain(days).range([m.l, W - m.r]).padding(0.18);
    const y = d3.scaleLinear().domain([0, d3.max(stack[stack.length - 1], (d) => d[1]) || 1]).nice(3).range([H - m.b, m.t]);
    const ds = d3.select(dEl).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", "Conflict events per day over the last 14 days, by type");
    ds.append("g").selectAll("line").data(y.ticks(3)).join("line").attr("class", "gridline").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y).attr("y2", y);
    ds.append("g").attr("class", "axis").attr("transform", `translate(${W - m.r + 4},0)`).call(d3.axisRight(y).ticks(3).tickSize(0));
    ds.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(days.filter((_, i) => i % 4 === 1)).tickSize(0).tickPadding(6).tickFormat(d3.timeFormat("%-d %b")));
    ds.append("g").selectAll("g").data(stack).join("g").style("fill", (s) => css(EVENT_GROUPS.find((gr) => gr.key === s.key).colour))
      .selectAll("rect").data((s) => s).join("rect")
      .attr("x", (d) => x(d.data.date)).attr("width", x.bandwidth())
      .attr("y", (d) => y(d[1])).attr("height", (d) => Math.max(0, y(d[0]) - y(d[1]) - (d[1] > d[0] ? 1 : 0)));
    ds.append("g").selectAll("rect").data(rows).join("rect")
      .attr("x", (d) => x(d.date)).attr("width", x.bandwidth()).attr("y", m.t).attr("height", H - m.b - m.t).style("fill", "transparent")
      .on("mousemove", (ev, d) => showTip(`<strong>${fmtDate(d.date)}</strong>${EVENT_GROUPS.map((gr) => `${gr.label}: ${d[gr.key]}`).join("<br>")}`, ev))
      .on("mouseleave", hideTip);

    drawBars($("conflict-countries"), countBy(events, (e) => e.country), { limit: 8 });
  }

  /* ------------------------------------------------------------ status */
  function drawStatus() {
    const s = D.status; if (!s) return;
    const feeds = s.feeds || [], data = s.data || [];
    const bad = feeds.filter((f) => !f.ok).length + data.filter((d) => !d.ok).length;
    $("status-summary").textContent = bad ? `${bad} ${bad === 1 ? "source needs" : "sources need"} attention. Failing sources are listed first.` : "All sources are working.";
    const names = { sanctions: "OpenSanctions", energy: "US EIA energy prices", conflict: "ACLED conflict events" };
    $("status").innerHTML = `<thead><tr><th>Source</th><th>Type</th><th>State</th><th>Detail</th></tr></thead><tbody>` +
      [...data.map((d) => ({ name: names[d.name] || d.name, group: "Data", ok: d.ok, note: d.note })),
       ...feeds.map((f) => ({ ...f, note: f.ok ? `${f.new} new on last run` : f.note }))]
        .sort((a, b) => a.ok - b.ok)
        .map((f) => `<tr><td>${esc(f.name)}</td><td>${esc(f.group)}</td><td class="${f.ok ? "ok" : "fail"}">${f.ok ? "Working" : "Failing"}</td><td>${esc(f.note)}</td></tr>`).join("") + "</tbody>";
  }

  /* ------------------------------------------------------------ nav highlight */
  function setupNav() {
    const links = [...document.querySelectorAll(".nav-links a")];
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) links.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === `#${en.target.id}`)));
    }, { rootMargin: "-40% 0px -55% 0px" });
    ["overview", "risk", "news", "sanctions", "energy", "conflict", "method", "sources"].forEach((id) => $(id) && io.observe($(id)));
  }

  /* ============================================================ advanced layer */

  /* ---------- shared helpers ---------- */
  function dailySeries(pred, days = 14) {
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const arr = new Array(days).fill(0);
    for (const i of items()) if (pred(i)) {
      const d = Math.floor((end - new Date(i.published)) / DAY);
      if (d >= 0 && d < days) arr[days - 1 - d]++;
    }
    return arr;
  }
  function sparkBars(container, arr, { W = 200, H = 30, split = 7, label = "stories", lastHot = false } = {}) {
    const end = new Date(); end.setHours(12, 0, 0, 0);
    const gap = 2, bw = (W - gap * (arr.length - 1)) / arr.length, max = Math.max(1, ...arr);
    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "none").attr("aria-hidden", "true");
    svg.selectAll("rect").data(arr.map((v, i) => ({ v, i }))).join("rect")
      .attr("x", (d) => d.i * (bw + gap)).attr("width", bw)
      .attr("y", (d) => H - Math.max(1.5, (d.v / max) * H)).attr("height", (d) => Math.max(1.5, (d.v / max) * H)).attr("rx", 1.2)
      .style("fill", (d) => css(lastHot && d.i === arr.length - 1 ? "--signal" : d.i >= arr.length - split ? "--bar" : "--bar-soft"))
      .on("mousemove", (ev, d) => showTip(`<strong>${fmtDate(new Date(end - (arr.length - 1 - d.i) * DAY))}</strong>${nf(d.v)} ${label}`, ev))
      .on("mouseleave", hideTip);
    return svg;
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const regionOf = (c) => D.meta.countries?.[c];
  const regionLabel = (c) => D.meta.regions[regionOf(c)]?.label || "";

  /* ---------- clocks ---------- */
  const CLOCKS = [["UTC", "UTC"], ["London", "Europe/London"], ["Washington", "America/New_York"], ["Brussels", "Europe/Brussels"],
    ["Kyiv", "Europe/Kyiv"], ["Moscow", "Europe/Moscow"], ["Tehran", "Asia/Tehran"], ["Beijing", "Asia/Shanghai"], ["Tokyo", "Asia/Tokyo"]];
  function drawClocks() {
    const now = new Date();
    $("clocks").innerHTML = CLOCKS.map(([city, tz]) => {
      let t; try { t = now.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }); } catch (e) { t = "–"; }
      return `<div class="clock ${city === "UTC" ? "utc" : ""}"><span>${city}</span><b>${t}</b></div>`;
    }).join("");
  }

  /* ---------- signals (spike detection) ---------- */
  function computeSignals() {
    const now = Date.now();
    const out = [];
    const test = (kind, key, label, pred) => {
      let c = 0, b = 0;
      for (const i of items()) {
        if (!pred(i)) continue;
        const a = (now - new Date(i.published)) / DAY;
        if (a <= 1) c++; else if (a <= 14) b++;
      }
      const avg = b / 13, ratio = (c + 1) / (avg + 1);
      if (c >= 3 && ratio >= 1.6) out.push({ kind, key, label, c, avg, ratio, pred });
    };
    for (const [k, t] of Object.entries(D.meta.themes)) test("Theme", k, t.label, (i) => i.themes.includes(k));
    for (const [k, r] of Object.entries(D.meta.regions)) test("Region", k, r.label, (i) => i.regions.includes(k));
    const names = new Set(items().flatMap((i) => i.countries));
    for (const c of names) test("Country", c, c, (i) => i.countries.includes(c));
    return out.sort((a, b) => b.ratio - a.ratio).slice(0, 5);
  }
  function drawSignals() {
    const el = $("signals"); el.innerHTML = "";
    const sigs = computeSignals();
    if (!sigs.length) { el.innerHTML = `<p class="signals-empty">No unusual spikes in the last 24 hours. Coverage is close to its normal level everywhere.</p>`; return; }
    for (const s of sigs) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "signal";
      b.setAttribute("aria-label", `${s.kind} ${s.label}: ${s.ratio.toFixed(1)} times usual volume, ${s.c} stories in 24 hours`);
      b.innerHTML = `<span class="signal-kind">${s.kind} spike</span><span class="signal-name">${esc(s.label)}</span>
        <span class="signal-ratio">${s.ratio.toFixed(1)}×<small>usual volume</small></span>
        <span class="signal-detail">${nf(s.c)} stories in 24 hours, against ${s.avg.toFixed(1)} on an average day</span>`;
      el.appendChild(b);
      sparkBars(b, dailySeries(s.pred), { W: 220, H: 28, split: 1, lastHot: true });
      b.onclick = () => {
        if (s.kind === "Country") return openDossier(s.key);
        if (s.kind === "Theme") { state.theme = s.key; $("f-theme").value = s.key; }
        if (s.kind === "Region") { state.region = s.key; $("f-region").value = s.key; }
        state.days = 1; $("f-days").value = "1"; refresh(); $("news").scrollIntoView({ block: "start" });
      };
    }
  }

  /* ---------- risk index ---------- */
  const WEIGHTS = { volume: 0.35, severity: 0.25, momentum: 0.15, conflict: 0.25 };
  const PART_TEXT = {
    volume: "News volume: stories naming the country this week, on a log scale against the most covered country.",
    severity: "Severity: the share of those stories about conflict, sanctions, shipping or nuclear issues.",
    momentum: "Momentum: change on the previous week, capped at double or half.",
    conflict: "Conflict: ACLED events and reported deaths in the last 7 days, on a log scale.",
  };
  const ACLED_TO_NAME = { "Democratic Republic of Congo": "DR Congo", "Republic of Congo": "Republic of Congo", "Cote d'Ivoire": "Ivory Coast", "Côte d'Ivoire": "Ivory Coast", "eSwatini": "Eswatini" };
  const BANDS = [[80, "Severe", "b-severe"], [65, "High", "b-high"], [45, "Elevated", "b-elevated"], [25, "Guarded", "b-guarded"], [0, "Low", "b-low"]];
  const bandOf = (s) => BANDS.find(([min]) => s >= min);
  let RISK = null;

  function conflictByCountry(days) {
    const m = new Map();
    for (const e of D.conflict?.events || []) {
      if (!within(e.date, days + 0.5)) continue;
      const c = ACLED_TO_NAME[e.country] || e.country;
      const r = m.get(c) || { ev: 0, fat: 0 };
      r.ev++; r.fat += e.fatalities || 0; m.set(c, r);
    }
    return m;
  }

  function computeRisk() {
    const week = items().filter((i) => within(i.published, 7));
    const prev = items().filter((i) => ageDays(i.published) > 7 && ageDays(i.published) <= 14);
    const cw = new Map(countBy(week, (i) => i.countries)), cp = new Map(countBy(prev, (i) => i.countries));
    const conf = conflictByCountry(7);
    const hasConf = (D.conflict?.events || []).length > 0;
    const w = hasConf ? WEIGHTS : (() => { const t = 1 - WEIGHTS.conflict; return { volume: WEIGHTS.volume / t, severity: WEIGHTS.severity / t, momentum: WEIGHTS.momentum / t, conflict: 0 }; })();
    const maxVol = Math.max(1, ...cw.values());
    const confScore = (r) => (r ? r.ev + r.fat / 2 : 0);
    const maxConf = Math.max(1, ...[...conf.values()].map(confScore));
    const names = new Set([...cw.keys(), ...conf.keys()]);
    const rows = [];
    for (const c of names) {
      if (c === "European Union" || !regionOf(c) && !conf.has(c)) continue;
      const n = cw.get(c) || 0, p = cp.get(c) || 0;
      if (n < 2 && !conf.has(c)) continue;
      const mine = week.filter((i) => i.countries.includes(c));
      const parts = {
        volume: Math.log1p(n) / Math.log1p(maxVol),
        severity: n ? mine.filter((i) => i.themes.some((t) => HOT_THEMES.has(t))).length / n : 0,
        momentum: (clamp((n - p) / Math.max(p, 3), -1, 1) + 1) / 2,
        conflict: hasConf ? Math.log1p(confScore(conf.get(c))) / Math.log1p(maxConf) : 0,
      };
      const score = Math.round(100 * Object.keys(parts).reduce((a, k) => a + parts[k] * w[k], 0));
      rows.push({ c, n, p, parts, score, conf: conf.get(c) || { ev: 0, fat: 0 } });
    }
    rows.sort((a, b) => b.score - a.score || b.n - a.n);
    rows.forEach((r, i) => { r.rank = i + 1; });
    RISK = { rows, byName: new Map(rows.map((r) => [r.c, r])), weights: w, hasConf };
    return RISK;
  }

  function deltaHtml(n, p) {
    if (!p && !n) return `<span class="delta flat">–</span>`;
    if (!p) return `<span class="delta rise">New</span>`;
    const pct = p ? ((n - p) / p) * 100 : 100;
    const cls = Math.abs(pct) < 5 ? "flat" : pct > 0 ? "rise" : "fall";
    return `<span class="delta ${cls}">${cls === "flat" ? "Level" : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%`}</span>`;
  }

  function drawRisk() {
    const { rows } = computeRisk();
    const top = rows.slice(0, 15);
    const t = $("risk-table");
    t.innerHTML = `<thead><tr><th>#</th><th>Country</th><th>Index</th><th>Band</th><th>Stories, 7 days</th><th>Change</th><th>14-day trend</th></tr></thead><tbody>` +
      (top.length ? top.map((r) => {
        const [, band, cls] = bandOf(r.score);
        return `<tr tabindex="0" data-c="${esc(r.c)}" aria-label="${esc(r.c)}, risk index ${r.score}, ${band}. Open dossier.">
          <td class="risk-rank">${r.rank}</td>
          <td class="risk-name">${esc(r.c)}<small>${esc(regionLabel(r.c))}</small></td>
          <td><span class="score"><b>${r.score}</b><span class="score-track"><i class="${cls}" style="width:${r.score}%;background:var(--sev-${cls.slice(2)})"></i></span></span></td>
          <td><span class="band ${cls}">${band}</span></td>
          <td class="num">${nf(r.n)}</td>
          <td>${deltaHtml(r.n, r.p)}</td>
          <td class="trend-cell" data-trend="${esc(r.c)}"></td></tr>`;
      }).join("") : `<tr><td colspan="7" class="hint">Not enough stories yet to score countries.</td></tr>`) + "</tbody>";
    t.querySelectorAll("[data-trend]").forEach((td) => sparkBars(td, dailySeries((i) => i.countries.includes(td.dataset.trend)), { W: 90, H: 24 }));
    t.onclick = (e) => { const tr = e.target.closest("tr[data-c]"); if (tr) openDossier(tr.dataset.c); };
    t.onkeydown = (e) => { const tr = e.target.closest("tr[data-c]"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDossier(tr.dataset.c); } };

    $("weights").innerHTML = Object.entries(WEIGHTS).map(([k, v]) => `<li><b>${Math.round(v * 100)}%</b><span>${PART_TEXT[k]}</span></li>`).join("") +
      (RISK.hasConf ? "" : `<li><b>–</b><span>Conflict data isn't connected yet, so the other three parts are scaled up to fill 100%.</span></li>`);
  }

  /* ---------- co-mention network ---------- */
  function drawNetwork() {
    const el = $("network"); el.innerHTML = ""; el.classList.remove("focus");
    const week = items().filter((i) => within(i.published, 7));
    const counts = countBy(week, (i) => i.countries).filter(([c]) => c !== "European Union").slice(0, 26);
    if (counts.length < 3) { el.innerHTML = `<p class="hint" style="padding:16px">Not enough stories yet to draw connections.</p>`; return; }
    const keep = new Set(counts.map(([c]) => c));
    const pair = new Map();
    for (const i of week) {
      const cs = [...new Set(i.countries.filter((c) => keep.has(c)))].sort();
      for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) {
        const k = `${cs[a]}|${cs[b]}`; pair.set(k, (pair.get(k) || 0) + 1);
      }
    }
    const nodes = counts.map(([c, n]) => ({ id: c, n }));
    const links = [...pair.entries()].map(([k, w]) => { const [s, t] = k.split("|"); return { source: s, target: t, w }; });
    const linked = new Set(links.flatMap((l) => [l.source, l.target]));
    const use = nodes.filter((n) => linked.has(n.id) || n.n >= counts[Math.min(8, counts.length - 1)][1]);
    const W = Math.max(300, el.clientWidth || 460), H = Math.round(W / 1.15);
    const r = d3.scaleSqrt().domain([1, d3.max(use, (d) => d.n)]).range([4, 17]);
    const sim = d3.forceSimulation(use)
      .force("link", d3.forceLink(links).id((d) => d.id).distance((l) => 70 - Math.min(35, l.w * 6)).strength((l) => Math.min(0.9, 0.12 + l.w * 0.12)))
      .force("charge", d3.forceManyBody().strength(-170))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("x", d3.forceX(W / 2).strength(0.06)).force("y", d3.forceY(H / 2).strength(0.08))
      .force("collide", d3.forceCollide((d) => r(d.n) + 12))
      .stop();
    for (let k = 0; k < 320; k++) sim.tick();
    for (const n of use) { n.x = clamp(n.x, 24, W - 24); n.y = clamp(n.y, 20, H - 20); }
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("aria-hidden", "true");
    const linkSel = svg.append("g").selectAll("line").data(links.filter((l) => typeof l.source === "object")).join("line")
      .attr("class", "net-link").attr("x1", (l) => l.source.x).attr("y1", (l) => l.source.y).attr("x2", (l) => l.target.x).attr("y2", (l) => l.target.y)
      .attr("stroke-width", (l) => 1 + Math.sqrt(l.w) * 1.4);
    const nodeSel = svg.append("g").selectAll("circle").data(use).join("circle")
      .attr("class", "net-node").attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", (d) => r(d.n));
    const labelled = W < 520 ? new Set(use.slice().sort((a, b) => b.n - a.n).slice(0, 10).map((d) => d.id)) : null;
    const labelSel = svg.append("g").selectAll("text").data(labelled ? use.filter((d) => labelled.has(d.id)) : use).join("text")
      .attr("class", "net-label").attr("y", (d) => d.y + 4).text((d) => d.id)
      .attr("text-anchor", (d) => (d.x > W * 0.68 ? "end" : "start"))
      .attr("x", (d) => (d.x > W * 0.68 ? d.x - r(d.n) - 4 : d.x + r(d.n) + 4));
    const neighbours = (id) => new Set([id, ...links.filter((l) => l.source.id === id || l.target.id === id).flatMap((l) => [l.source.id, l.target.id])]);
    nodeSel
      .on("mouseenter", (ev, d) => {
        const nb = neighbours(d.id); el.classList.add("focus");
        nodeSel.classed("on", (n) => nb.has(n.id)); labelSel.classed("on", (n) => nb.has(n.id));
        linkSel.classed("on", (l) => l.source.id === d.id || l.target.id === d.id);
        const top = links.filter((l) => l.source.id === d.id || l.target.id === d.id).sort((a, b) => b.w - a.w).slice(0, 3)
          .map((l) => `${esc(l.source.id === d.id ? l.target.id : l.source.id)} (${l.w})`).join(", ");
        showTip(`<strong>${esc(d.id)}</strong>${nf(d.n)} stories this week${top ? `<br>Most often with ${top}` : ""}`, ev);
      })
      .on("mousemove", (ev) => { tip.style.left = `${ev.clientX + 14}px`; tip.style.top = `${ev.clientY + 14}px`; })
      .on("mouseleave", () => { el.classList.remove("focus"); nodeSel.classed("on", false); labelSel.classed("on", false); linkSel.classed("on", false); hideTip(); })
      .on("click", (ev, d) => { hideTip(); openDossier(d.id); });
  }

  /* ---------- chokepoints ---------- */
  const CHOKE = [
    { name: "Strait of Hormuz", lat: 26.6, lon: 56.4, kw: ["hormuz"] },
    { name: "Bab el-Mandeb and Red Sea", lat: 12.6, lon: 43.3, kw: ["bab el-mandeb", "red sea", "houthi", "houthis"] },
    { name: "Suez Canal", lat: 30.6, lon: 32.3, kw: ["suez"] },
    { name: "Turkish Straits and Black Sea", lat: 41.1, lon: 29.05, kw: ["bosporus", "bosphorus", "dardanelles", "turkish straits", "black sea"] },
    { name: "Baltic and Danish Straits", lat: 55.6, lon: 12.7, kw: ["baltic", "danish straits", "great belt", "oresund"] },
    { name: "Strait of Malacca", lat: 2.6, lon: 101.2, kw: ["malacca", "singapore strait"] },
    { name: "Taiwan Strait", lat: 24.3, lon: 119.6, kw: ["taiwan strait"] },
    { name: "South China Sea", lat: 13, lon: 114, kw: ["south china sea", "spratly", "scarborough shoal", "second thomas shoal"] },
    { name: "Panama Canal", lat: 9.1, lon: -79.7, kw: ["panama canal"] },
    { name: "Cape of Good Hope", lat: -34.4, lon: 18.5, kw: ["cape of good hope", "around the cape", "via the cape"] },
  ];
  for (const c of CHOKE) c.re = new RegExp(`(?<![\\w-])(${c.kw.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w-])`, "i");
  const chokeHit = (c) => (i) => c.re.test(`${i.title} ${i.summary}`);
  function chokeStats() {
    return CHOKE.map((c) => {
      const s = dailySeries(chokeHit(c));
      return { ...c, series: s, cur: s.slice(7).reduce((a, b) => a + b, 0), prev: s.slice(0, 7).reduce((a, b) => a + b, 0) };
    });
  }
  function drawChokepoints() {
    const el = $("chokepoints"); el.innerHTML = "";
    const stats = chokeStats().sort((a, b) => b.cur - a.cur);
    for (const c of stats) {
      const card = document.createElement("button");
      card.type = "button"; card.className = `choke pulse-card ${c.cur ? "" : "quiet"}`;
      card.innerHTML = `<span class="choke-name">${esc(c.name)}</span>
        <span class="choke-row"><span class="choke-n">${nf(c.cur)}</span>${c.cur || c.prev ? deltaHtml(c.cur, c.prev) : `<span class="delta flat">Quiet</span>`}</span>
        <span class="choke-sub">stories in 7 days</span>`;
      el.appendChild(card);
      sparkBars(card, c.series, { W: 200, H: 30 });
      card.onclick = () => { state.q = c.kw[0]; $("f-search").value = c.kw[0]; state.days = 14; $("f-days").value = "14"; refresh(); $("news").scrollIntoView({ block: "start" }); };
    }
  }

  /* ---------- dossier ---------- */
  let lastFocus = null;
  let ISO = null;
  function isoOf(name) {
    if (!ISO) {
      ISO = new Map(Object.entries({ "United States": "US", "DR Congo": "CD", "Republic of Congo": "CG", "Ivory Coast": "CI", "Palestine": "PS", "Kosovo": "XK" }));
      if (regionNames) for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        try { const n = regionNames.of(code); if (n && n !== code && !ISO.has(n)) ISO.set(n, code); } catch (e) { /* not a region */ }
      }
    }
    return ISO.get(name);
  }

  function openDossier(c) {
    if (!RISK) computeRisk();
    const r = RISK.byName.get(c);
    const mine = items().filter((i) => i.countries.includes(c));
    const week = mine.filter((i) => within(i.published, 7));
    const prev = mine.filter((i) => ageDays(i.published) > 7 && ageDays(i.published) <= 14);
    const conf14 = conflictByCountry(14).get(c) || { ev: 0, fat: 0 };
    const code = isoOf(c);
    const flagged = code && D.sanctions ? D.sanctions.vessels.filter((v) => (v.countries || "").toUpperCase().split(/[;,]/).map((x) => x.trim()).includes(code)).length : 0;
    $("dossier-region").textContent = regionLabel(c) || "Country dossier";
    $("dossier-title").textContent = c;
    const body = $("dossier-body");
    const band = r ? bandOf(r.score) : null;
    body.innerHTML = `
      ${r ? `<div class="dossier-score"><span class="big">${r.score}</span><span><span class="band ${band[2]}">${band[1]}</span><br><span class="of">Risk index out of 100, ranked ${r.rank} of ${RISK.rows.length}</span></span></div>
      <ul class="parts">${Object.keys(WEIGHTS).filter((k) => RISK.weights[k] > 0).map((k) => `<li><span>${k[0].toUpperCase() + k.slice(1)}</span><span class="track"><i style="width:${Math.round(r.parts[k] * 100)}%"></i></span><b>${Math.round(r.parts[k] * 100)}</b></li>`).join("")}</ul>`
        : `<p class="hint">Not enough coverage this week to score ${esc(c)}.</p>`}
      <div class="kpis">
        <dl class="kpi"><dt>Stories, 7 days</dt><dd>${nf(week.length)}</dd></dl>
        <dl class="kpi"><dt>Change</dt><dd>${deltaHtml(week.length, prev.length)}</dd></dl>
        <dl class="kpi"><dt>Conflict events, 14 days</dt><dd>${RISK.hasConf ? nf(conf14.ev) : "–"}</dd></dl>
        <dl class="kpi"><dt>Reported deaths, 14 days</dt><dd>${RISK.hasConf ? nf(conf14.fat) : "–"}</dd></dl>
      </div>
      <h3 class="mini-title">Stories per day, 14 days</h3><div class="daily" id="dossier-daily"></div>
      <h3 class="mini-title">Main themes</h3><ol class="bars" id="dossier-themes"></ol>
      <h3 class="mini-title">Named alongside</h3><ol class="bars" id="dossier-with"></ol>
      ${flagged ? `<p class="hint" style="margin-top:14px">${nf(flagged)} sanctioned ${flagged === 1 ? "vessel flies" : "vessels fly"} this country's flag.</p>` : ""}
      <h3 class="mini-title">Latest stories</h3>
      <ol class="dossier-stories">${mine.slice(0, 6).map((i) => `<li><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a><span>${esc(i.source)}, ${ago(i.published)}</span></li>`).join("") || `<li class="hint">No stories in the last 14 days.</li>`}</ol>
      <button type="button" class="btn" id="dossier-filter">Show all ${nf(mine.length)} stories in the news feed</button>`;
    sparkBars($("dossier-daily"), dailySeries((i) => i.countries.includes(c)), { W: 420, H: 90 });
    drawBars($("dossier-themes"), countBy(week, (i) => i.themes).map(([k, n]) => [k, n, D.meta.themes[k]?.label || k]), { limit: 6, empty: "No themes this week." });
    drawBars($("dossier-with"), countBy(week, (i) => i.countries.filter((x) => x !== c && x !== "European Union")), { limit: 6, onClick: (x) => openDossier(x), empty: "No other countries named." });
    $("dossier-filter").onclick = () => { closeDossier(); state.country = c; state.days = 14; $("f-days").value = "14"; refresh(); $("news").scrollIntoView({ block: "start" }); };
    if ($("dossier").hidden) lastFocus = document.activeElement;
    $("dossier").hidden = false; $("scrim").hidden = false;
    document.body.style.overflow = "hidden";
    $("dossier-body").scrollTop = 0;
    $("dossier-close").focus();
  }
  function closeDossier() {
    $("dossier").hidden = true; $("scrim").hidden = true; document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function setupDossier() {
    $("dossier-close").onclick = closeDossier;
    $("scrim").onclick = closeDossier;
    document.addEventListener("keydown", (e) => {
      if ($("dossier").hidden) return;
      if (e.key === "Escape") closeDossier();
      if (e.key === "Tab") { // keep focus inside the panel
        const f = [...$("dossier").querySelectorAll("button, a[href], [tabindex='0']")];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
  }

  /* ---------- map layer controls ---------- */
  function setupMapTools() {
    $("map-layer").onclick = (e) => {
      const b = e.target.closest("button[data-layer]"); if (!b) return;
      state.layer = b.dataset.layer;
      document.querySelectorAll("#map-layer button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      drawWorld();
    };
    $("show-choke").onchange = drawWorld;
  }


  /* ------------------------------------------------------------ start */
  async function start() {
    const names = ["meta", "news", "sanctions", "energy", "conflict", "status", "world"];
    const res = await Promise.all(names.map(load));
    names.forEach((n, i) => { D[n] = res[i]; });
    if (!D.meta) { document.querySelector("main").innerHTML = `<p class="empty">The dashboard data hasn't been created yet. Run the collector once, then reload.</p>`; return; }
    const safe = (fn) => { try { fn(); } catch (e) { console.error(e); } };
    safe(drawClocks); setInterval(() => safe(drawClocks), 30000);
    safe(drawOverview); safe(setupFilters); safe(setupMapTools); safe(setupDossier); safe(drawWorld);
    safe(drawSignals); safe(drawRisk); safe(drawNetwork); safe(drawChokepoints); safe(drawPulse); safe(drawMatrix); safe(drawFeed);
    safe(drawSanctions); safe(setupEnergyRange); safe(drawEnergy); safe(drawConflict); safe(drawStatus); safe(setupNav);
    let lastW = window.innerWidth, t;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(() => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; safe(drawWorld); safe(drawNetwork); safe(drawEnergy); safe(drawConflict); } }, 200);
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { safe(drawWorld); safe(drawPulse); safe(drawSignals); safe(drawRisk); safe(drawNetwork); safe(drawChokepoints); safe(drawEnergy); safe(drawConflict); });
  }
  start();
})();

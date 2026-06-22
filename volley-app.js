const API_URL = "/api/standings";
const LOGO_API_URL = "/api/logos";
const REGION_API_URL = "/api/region-matches";
const ROSTER_API_URL = "/api/rosters";
const REFRESH_MS = 60_000;
const SEASON_START = "01.07.2025";
const SEASON_END = "30.06.2026";

const TURKISH_DAYS = ["PAZAR", "PAZARTESİ", "SALI", "ÇARŞAMBA", "PERŞEMBE", "CUMA", "CUMARTESİ"];
const MOTIVATION_QUOTES = [
  "Başarı, hazırlık ve fırsatın buluştuğu yerdir.",
  "Sahadaki en büyük yetenek, asla pes etmeme yeteneğidir.",
  "Maç sahada kazanılmadan önce zihinde kazanılır.",
  "Vazgeçmeyen bir takımı asla yenemezsiniz.",
  "Sporun gücü kalptedir.",
];
const REGIONS = {
  istanbul: "TVF İstanbul",
  kocaeli: "TVF Kocaeli",
  ankara: "TVF Ankara",
  izmir: "TVF İzmir",
};

const K = {
  gender: "Cinsiyet",
  category: "Kategori",
  cluster: "Küme",
  competition: "Yarışma",
  team: "Takım Adı",
  rank: "Sıra",
  source: "Kaynak URL",
  hall: "Salon Adı",
  home: "Ev Sahibi (A)",
  away: "Misafir (B)",
  winner: "Kazanan",
  setResults: "Set Sonuçları",
};

const state = {
  payload: null,
  liveMatches: [],
  rosters: [],
  logos: [],
  logoMap: new Map(),
  loading: true,
  refreshing: false,
  error: "",
  tab: "matches",
  region: "istanbul",
  currentDate: "",
  dateTouched: false,
  selectedStatus: "all",
  selectedTeam: "",
  selectedAlphabet: "",
  filters: {
    q: "",
    gender: "",
    category: "",
    cluster: "",
    competition: "",
  },
};

const app = document.querySelector("#app");

function trCompare(a, b) {
  return String(a || "").localeCompare(String(b || ""), "tr-TR", { numeric: true });
}

function text(value) {
  return String(value ?? "").trim();
}

function numberText(value) {
  const clean = text(value);
  return clean || "-";
}

function dateKey(value) {
  const [day, month, year] = text(value).split(".").map(Number);
  if (!day || !month || !year) return 0;
  return new Date(year, month - 1, day).getTime();
}

function todayString() {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
}

function isSeasonDate(value) {
  const key = dateKey(value);
  return key >= dateKey(SEASON_START) && key <= dateKey(SEASON_END);
}

function quoteOfDay() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now - start) / 86400000);
  return MOTIVATION_QUOTES[day % MOTIVATION_QUOTES.length];
}

function normalizeName(value) {
  return text(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(sk|spor|voleybol|akademi|kulubu|kulübü|bld|belediye|ortaokulu|lisesi)\b/g, " ")
    .replace(/[^a-z0-9ığüşöçİĞÜŞÖÇ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function initials(value) {
  return text(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("tr-TR");
}

function getLogo(teamName) {
  const raw = text(teamName);
  const normalized = normalizeName(raw);
  return (
    state.logoMap.get(raw.toLocaleLowerCase("tr-TR")) ||
    state.logoMap.get(normalized) ||
    state.logos.find((logo) => {
      const logoName = normalizeName(logo.teamName);
      return logoName && normalized && (logoName.includes(normalized) || normalized.includes(logoName));
    }) ||
    null
  );
}

function renderLogo(teamName, className = "team-logo") {
  const logo = getLogo(teamName);
  const label = escapeHtml(teamName || "Takım");
  if (!logo) return `<span class="${className} logo-fallback" aria-label="${label}">${escapeHtml(initials(teamName) || "V")}</span>`;
  return `<img class="${className}" src="${escapeHtml(logo.logoUrl)}" alt="${label} logosu" loading="lazy" referrerpolicy="no-referrer" />`;
}

function isLiveMatchPlayed(match) {
  return Boolean(text(match.s1).replace("-", "") || text(match.s2).replace("-", "") || text(match.sets));
}

function isLiveMatchDelayed(match) {
  if (isLiveMatchPlayed(match)) return false;
  const matchDate = dateKey(match.date);
  const today = dateKey(todayString());
  if (!matchDate || matchDate > today) return false;
  if (matchDate < today) return true;

  const [hour, minute] = text(match.time).split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() > hour * 60 + minute + 120;
}

function liveMatchToRow(match) {
  const row = {
    [K.gender]: match.c || "",
    [K.category]: match.ktg || "",
    [K.cluster]: match.kume || "",
    [K.competition]: match.groupCode || match.league || "",
    [K.hall]: match.venue || "",
    [K.home]: match.t1 || "",
    [K.away]: match.t2 || "",
    [K.setResults]: match.sets || "",
    [K.winner]: "",
    Tarih: match.date || "",
    Saat: match.time || "",
    "Set A": match.s1 === "-" ? "" : match.s1,
    "Set B": match.s2 === "-" ? "" : match.s2,
  };

  [...text(match.sets).matchAll(/\((\d+)-(\d+)\)/g)].forEach((set, index) => {
    row[`Set ${index + 1} A`] = set[1];
    row[`Set ${index + 1} B`] = set[2];
  });

  const a = Number(row["Set A"]);
  const b = Number(row["Set B"]);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    row[K.winner] = a > b ? row[K.home] : b > a ? row[K.away] : "";
  }
  return row;
}

function formatDateTime(value) {
  if (!value) return "Henüz veri yok";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function uniqueRows(rows, key) {
  return [...new Set(rows.map((row) => text(row[key])).filter(Boolean))].sort(trCompare);
}

function matchesQuery(row, fields) {
  const query = state.filters.q.toLocaleLowerCase("tr-TR");
  if (!query) return true;
  return fields.some((field) => text(row[field]).toLocaleLowerCase("tr-TR").includes(query));
}

function filterByCommonFields(row) {
  return (
    (!state.filters.gender || row[K.gender] === state.filters.gender) &&
    (!state.filters.category || row[K.category] === state.filters.category) &&
    (!state.filters.cluster || row[K.cluster] === state.filters.cluster) &&
    (!state.filters.competition || row[K.competition] === state.filters.competition)
  );
}

function getStandings() {
  const rows = state.payload?.standings || [];
  return rows
    .filter(filterByCommonFields)
    .filter((row) => matchesQuery(row, [K.team, K.competition, K.category, K.cluster]))
    .sort(
      (a, b) =>
        trCompare(a[K.gender], b[K.gender]) ||
        trCompare(a[K.category], b[K.category]) ||
        trCompare(a[K.cluster], b[K.cluster]) ||
        trCompare(a[K.competition], b[K.competition]) ||
        Number(a[K.rank] || 9999) - Number(b[K.rank] || 9999)
    );
}

function getMatches() {
  if (state.liveMatches.length) {
    return state.liveMatches
      .filter((match) => !state.currentDate || match.date === state.currentDate || state.selectedTeam)
      .filter((match) => {
        if (state.selectedStatus === "played") return isLiveMatchPlayed(match);
        if (state.selectedStatus === "pending") return !isLiveMatchPlayed(match) && !isLiveMatchDelayed(match);
        if (state.selectedStatus === "delayed") return isLiveMatchDelayed(match);
        return true;
      })
      .filter((match) => {
        if (!state.selectedTeam) return true;
        const selected = normalizeName(state.selectedTeam);
        return normalizeName(match.t1) === selected || normalizeName(match.t2) === selected;
      })
      .filter((match) => {
        const q = state.filters.q.toLocaleLowerCase("tr-TR");
        if (!q) return true;
        return [match.t1, match.t2, match.venue, match.groupCode, match.league].some((field) =>
          text(field).toLocaleLowerCase("tr-TR").includes(q)
        );
      })
      .sort((a, b) => dateKey(a.date) - dateKey(b.date) || trCompare(a.time, b.time))
      .map(liveMatchToRow);
  }

  const rows = state.payload?.matches || [];
  return rows
    .filter(filterByCommonFields)
    .filter((row) => matchesQuery(row, [K.home, K.away, K.competition, K.hall]))
    .sort(
      (a, b) =>
        trCompare(a.Tarih, b.Tarih) ||
        trCompare(a.Saat, b.Saat) ||
        trCompare(a[K.hall], b[K.hall])
    );
}

function hasMatchScore(row) {
  return Boolean(text(row["Set A"]) || text(row["Set B"]) || text(row[K.setResults]));
}

function getCompetitions() {
  const rows = state.payload?.competitions || [];
  return rows
    .filter(filterByCommonFields)
    .filter((row) => matchesQuery(row, [K.competition, K.category, K.cluster]))
    .sort(
      (a, b) =>
        trCompare(a[K.gender], b[K.gender]) ||
        trCompare(a[K.category], b[K.category]) ||
        trCompare(a[K.cluster], b[K.cluster]) ||
        trCompare(a[K.competition], b[K.competition])
    );
}

function setDependentFilterOptions() {
  const source = state.payload?.competitions?.length
    ? state.payload.competitions
    : state.payload?.standings || [];
  return {
    genders: uniqueRows(source, K.gender),
    categories: uniqueRows(source.filter((row) => !state.filters.gender || row[K.gender] === state.filters.gender), K.category),
    clusters: uniqueRows(
      source.filter(
        (row) =>
          (!state.filters.gender || row[K.gender] === state.filters.gender) &&
          (!state.filters.category || row[K.category] === state.filters.category)
      ),
      K.cluster
    ),
    competitions: uniqueRows(
      source.filter(
        (row) =>
          (!state.filters.gender || row[K.gender] === state.filters.gender) &&
          (!state.filters.category || row[K.category] === state.filters.category) &&
          (!state.filters.cluster || row[K.cluster] === state.filters.cluster)
      ),
      K.competition
    ),
  };
}

function optionList(values, current, placeholder) {
  return [
    `<option value="">${placeholder}</option>`,
    ...values.map((value) => `<option value="${escapeHtml(value)}" ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`),
  ].join("");
}

function dataAttr(value) {
  return escapeHtml(encodeURIComponent(text(value)));
}

function escapeHtml(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSetBreakdown(row) {
  const sets = [1, 2, 3, 4, 5]
    .map((setNumber) => {
      const home = text(row[`Set ${setNumber} A`]);
      const away = text(row[`Set ${setNumber} B`]);
      if (!home && !away) return "";
      return `<span>${setNumber}. set: <strong>${escapeHtml(home || "-")} - ${escapeHtml(away || "-")}</strong></span>`;
    })
    .filter(Boolean);

  if (sets.length) return `<div class="set-breakdown">${sets.join("")}</div>`;
  if (row[K.setResults]) return `<div class="set-breakdown"><span>${escapeHtml(row[K.setResults])}</span></div>`;
  return `<span class="muted-dash">Set detayı yok</span>`;
}

function renderLogoRail() {
  const activeTeams = [
    ...new Set(
      (state.liveMatches.length ? state.liveMatches : getMatches())
        .filter((item) => !state.currentDate || item.date === state.currentDate || item.Tarih === state.currentDate)
        .flatMap((row) => [row.t1 || row[K.home], row.t2 || row[K.away]])
        .filter(Boolean)
    ),
  ];
  const railTeams = activeTeams.length ? activeTeams : state.logos.map((logo) => logo.teamName);

  return `
    <div class="logo-rail" aria-label="Takım logoları">
      ${railTeams.map((team) => `<div class="rail-logo" title="${escapeHtml(team)}">${renderLogo(team)}</div>`).join("")}
    </div>
  `;
}

function dateChips() {
  const source = state.liveMatches.length ? state.liveMatches.map((row) => row.date) : (state.payload?.matches || []).map((row) => row.Tarih);
  const today = todayString();
  const dates = [...new Set([...source.map(text).filter(Boolean), today])]
    .filter(isSeasonDate)
    .sort((a, b) => dateKey(a) - dateKey(b))
    .map((date) => {
      const classes = ["date-chip"];
      if (date === state.currentDate) classes.push("active");
      if (date === today) classes.push("today");
      const subLabel = date === today ? "BUG\u00dcN" : dayName(date);
      return `<button class="${classes.join(" ")}" type="button" data-date="${escapeHtml(date)}" aria-current="${date === today ? "date" : "false"}"><span>${escapeHtml(date)}</span><small>${escapeHtml(subLabel)}</small></button>`;
    });
  return `<span class="date-chip date-chip-label" aria-hidden="true"><span>Tarih</span><small>2025-2026</small></span>${dates.join("")}`;
}

function dayName(value) {
  const [day, month, year] = text(value).split(".").map(Number);
  const date = day && month && year ? new Date(year, month - 1, day) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { weekday: "short" }).format(date);
}

function alphabetButtons() {
  const letters = ["Hepsi", "A", "B", "C", "Ç", "D", "E", "F", "G", "H", "I", "İ", "K", "M", "O", "Ö", "P", "S", "Ş", "T", "U", "Ü", "V", "Y", "Z"];
  return letters
    .map((letter) => `<button class="${state.selectedAlphabet === letter ? "active" : ""}" type="button" data-letter="${escapeHtml(letter)}">${letter}</button>`)
    .join("");
}

function playingTeamsPanel() {
  if (!state.selectedAlphabet) return `<div class="team-picker-note">Takım seçerek listeleyin.</div>`;
  const teams = [...new Set(state.liveMatches.flatMap((match) => [match.t1, match.t2]).filter(Boolean))]
    .sort(trCompare)
    .filter((team) => state.selectedAlphabet === "Hepsi" || team.charAt(0).toLocaleUpperCase("tr-TR") === state.selectedAlphabet);
  if (!teams.length) return `<div class="team-picker-note">Bu harfte takım yok.</div>`;
  return `<div class="playing-team-grid">${teams
    .map(
      (team) => `<button type="button" class="playing-team ${state.selectedTeam === team ? "active" : ""}" data-team="${escapeHtml(team)}">${renderLogo(team, "picker-logo")}<span>${escapeHtml(team)}</span></button>`
    )
    .join("")}</div>`;
}

function selectedTeamPanel() {
  if (!state.selectedTeam) return "";
  const key = normalizeName(state.selectedTeam);
  const matches = state.liveMatches.filter((match) => normalizeName(match.t1) === key || normalizeName(match.t2) === key);
  const played = matches.filter(isLiveMatchPlayed);
  const delayed = matches.filter(isLiveMatchDelayed);
  const wins = played.filter((match) => {
    const a = Number(match.s1);
    const b = Number(match.s2);
    return normalizeName(match.t1) === key ? a > b : b > a;
  }).length;
  const losses = Math.max(0, played.length - wins);

  return `
    <div class="selected-team-panel" data-clear-team>
      ${renderLogo(state.selectedTeam, "selected-logo")}
      <strong>${escapeHtml(state.selectedTeam)}</strong>
      <span>Oynanan ${played.length}</span>
      <span>G ${wins}</span>
      <span>M ${losses}</span>
      <span>Ertelenen ${delayed.length}</span>
    </div>
  `;
}

function selectedRosterPanel() {
  if (!state.selectedTeam || !state.rosters.length) return "";
  const selected = normalizeName(state.selectedTeam);
  const players = state.rosters.filter((row) => normalizeName(row.team) === selected).slice(0, 18);
  if (!players.length) return "";
  const coach = players.find((row) => row.coach)?.coach || "";
  return `
    <div class="roster-panel">
      <div class="roster-heading">
        <strong>Takım Kadrosu</strong>
        ${coach ? `<span>Antrenör: ${escapeHtml(coach)}</span>` : ""}
      </div>
      <div class="roster-grid">
        ${players
          .map(
            (player) => `
              <div class="player-card">
                <b>${escapeHtml(player.number || "-")}</b>
                <span>${escapeHtml(player.name)}</span>
                <small>${escapeHtml(player.position || "Oyuncu")}</small>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function metricCard(label, value, hint) {
  return `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${hint}</small>
    </article>
  `;
}

function renderShell() {
  const meta = state.payload?.metadata || {};
  const options = setDependentFilterOptions();
  const standings = getStandings();
  const matches = getMatches();
  const competitions = getCompetitions();
  const activeRows =
    state.tab === "matches" ? matches : state.tab === "competitions" ? competitions : standings;
  const status = state.error ? "Bağlantı hatası" : state.refreshing || meta.updating ? "Güncelleniyor" : "Canlı";

  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#top" aria-label="Ana sayfa">
        <span class="brand-text">Voleybol<span>Day</span> Pro</span>
        <small>Takım odaklı canlı veri ve paylaşım portalı.</small>
      </a>
      <nav class="nav-links" aria-label="Sayfa bölümleri">
        <a href="#puan">Puan Durumu</a>
        <a href="#veri">Veri Kaynağı</a>
      </nav>
    </header>

    <main id="top">
      <section class="hero-band">
        <div class="hero-copy">
          <p class="eyebrow">VoleybolDay Pro</p>
          <h1>Maçları, set skorlarını ve gerçek puan durumunu tek ekranda takip edin.</h1>
          <p>
            Puan durumu İstanbul Voleybol İl Temsilciliği kaynağından, takım logoları ise bağlı Google Sheet listesinden alınır.
          </p>
          <div class="hero-actions">
            <button class="button primary" data-action="refresh" ${state.refreshing ? "disabled" : ""}>
              ${state.refreshing ? "Yenileniyor..." : "Şimdi güncelle"}
            </button>
            <a class="button secondary" href="${escapeHtml(meta.source_url || "https://istanbul.voleyboliltemsilciligi.com/PuanDurumu")}" target="_blank" rel="noopener">
              Kaynağı aç
            </a>
          </div>
        </div>

        <aside class="live-panel" aria-label="Canlı veri durumu">
          <div class="status-row">
            <span class="status-dot ${state.error ? "error" : state.refreshing ? "loading" : ""}"></span>
            <strong>${status}</strong>
          </div>
          <dl>
            <div>
              <dt>Son veri çekimi</dt>
              <dd>${formatDateTime(meta.scraped_at)}</dd>
            </div>
            <div>
              <dt>Panel yenileme</dt>
              <dd>Her ${REFRESH_MS / 1000} saniyede kontrol</dd>
            </div>
          </dl>
          ${state.error ? `<p class="error-text">${escapeHtml(state.error)}</p>` : ""}
        </aside>
      </section>

      <section class="control-card" aria-label="Maç kontrol paneli">
        ${selectedTeamPanel()}
        ${renderLogoRail()}
        <div class="federation-row">
          ${Object.entries(REGIONS)
            .map(([key, label]) => `<button class="${state.region === key ? "active" : ""}" type="button" data-region="${key}">${label}</button>`)
            .join("")}
        </div>
        <div class="quick-row">
          <div class="quick-tabs">
            ${[
              ["all", "Hepsi"],
              ["played", "Bitenler"],
              ["pending", "Gelecek"],
              ["delayed", "Ertelenen"],
            ]
              .map(([key, label]) => `<button class="${state.selectedStatus === key ? "active" : ""}" type="button" data-status="${key}">${label}</button>`)
              .join("")}
          </div>
          <p>${escapeHtml(quoteOfDay())}</p>
        </div>
        <div class="date-row">${dateChips()}</div>
        <div class="letter-row">${alphabetButtons()}</div>
        ${playingTeamsPanel()}
        ${selectedRosterPanel()}
      </section>

      <section class="metrics" aria-label="Veri özeti">
        ${metricCard("Yarışma", meta.competition_count ?? "-", "Filtrelenebilir lig/seri")}
        ${metricCard("Takım", meta.team_count ?? "-", "Benzersiz takım")}
        ${metricCard("Puan satırı", meta.standing_row_count ?? "-", "Takım performansı")}
        ${metricCard("Logo", state.logos.length || "-", "Google Sheet kaynaklı")}
      </section>

      <section class="data-section" id="puan">
        <div class="section-heading">
          <p class="eyebrow">Puan durumu</p>
          <h2>${state.tab === "matches" ? "Biten maçlar" : state.tab === "competitions" ? "Yarışmalar" : "Gerçek puan durumu"}</h2>
          <p>${activeRows.length} kayıt gösteriliyor. Filtreler tüm sekmelerde aynı seçimleri kullanır.</p>
        </div>

        <div class="toolbar" id="filters">
          <label class="search-field">
            Arama
            <input id="q" type="search" placeholder="Takım, yarışma, salon..." value="${escapeHtml(state.filters.q)}" />
          </label>
          <label>
            Cinsiyet
            <select id="gender">${optionList(options.genders, state.filters.gender, "Tümü")}</select>
          </label>
          <label>
            Kategori
            <select id="category">${optionList(options.categories, state.filters.category, "Tümü")}</select>
          </label>
          <label>
            Küme
            <select id="cluster">${optionList(options.clusters, state.filters.cluster, "Tümü")}</select>
          </label>
          <label>
            Yarışma
            <select id="competition">${optionList(options.competitions, state.filters.competition, "Tümü")}</select>
          </label>
        </div>

        <div class="tabs" role="tablist" aria-label="Veri sekmeleri">
          ${tabButton("standings", "Puan Tablosu", standings.length)}
          ${tabButton("matches", "Maç Sonuçları", matches.length)}
          ${tabButton("competitions", "Yarışmalar", competitions.length)}
        </div>

        <div class="table-shell" aria-live="polite">
          ${state.loading ? renderSkeleton() : renderActiveTab()}
        </div>
      </section>

      <section class="source-section" id="veri">
        <div>
          <p class="eyebrow">Veri kaynağı</p>
          <h2>Otomatik güncelleme nasıl çalışır?</h2>
        </div>
        <div class="source-grid">
          <article>
            <strong>1. Sunucu veriyi çeker</strong>
            <p>Node sunucusu mevcut Python tarayıcısını çalıştırır ve resmi sayfadaki seçim zincirini okur.</p>
          </article>
          <article>
            <strong>2. Önbellek yenilenir</strong>
            <p>API eski veriyi kullanırken arka planda yeni veriyi alır; manuel buton anlık yenileme ister.</p>
          </article>
          <article>
            <strong>3. Sayfa kendini günceller</strong>
            <p>Tarayıcı her dakika API’yi kontrol eder ve kaynakta değişen kayıtları ekrana taşır.</p>
          </article>
        </div>
      </section>
    </main>

    <footer class="footer">
      <span>Kaynak: İstanbul Voleybol İl Temsilciliği</span>
      <span>Son kontrol: ${formatDateTime(meta.server_checked_at || meta.scraped_at)}</span>
    </footer>

    ${renderActionModal()}
  `;

  bindEvents();
}

function renderActionModal() {
  return `
    <div class="modal-overlay" id="action-modal" hidden>
      <div class="modal-content">
        <button class="modal-close" type="button" data-close-modal>×</button>
        <div id="modal-body"></div>
      </div>
    </div>
  `;
}

function matchSummaryText(row) {
  const sets = [1, 2, 3, 4, 5]
    .map((index) => {
      const a = text(row[`Set ${index} A`]);
      const b = text(row[`Set ${index} B`]);
      return a || b ? `${index}. set ${a || "-"}-${b || "-"}` : "";
    })
    .filter(Boolean)
    .join(", ");
  return `🏐 VoleybolDay Pro\n\n${row[K.home]} ${numberText(row["Set A"])}-${numberText(row["Set B"])} ${row[K.away]}\n📅 ${row.Tarih} ${row.Saat}\n📍 ${row[K.hall]}\n🏆 ${row[K.competition]}\n${sets ? `📝 ${sets}` : ""}`;
}

function openShareModal(row) {
  const modal = document.querySelector("#action-modal");
  const body = document.querySelector("#modal-body");
  if (!modal || !body) return;
  const message = matchSummaryText(row);
  body.innerHTML = `
    <div class="modal-heading">
      <span>WhatsApp'ta Paylaş</span>
      <h3>${escapeHtml(row[K.home])} - ${escapeHtml(row[K.away])}</h3>
      <p>Canlı app modülündeki paylaşım akışı bu uygulamaya bağlandı.</p>
    </div>
    <textarea class="share-textarea" readonly>${escapeHtml(message)}</textarea>
    <div class="modal-actions">
      <a class="whatsapp-share" href="https://api.whatsapp.com/send?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">WhatsApp'ta Aç</a>
      <button type="button" data-copy-share>Kopyala</button>
    </div>
  `;
  modal.hidden = false;
  modal.style.display = "flex";
  body.querySelector("[data-copy-share]")?.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(message);
  });
}

function openReportModal(row) {
  const modal = document.querySelector("#action-modal");
  const body = document.querySelector("#modal-body");
  if (!modal || !body) return;
  body.innerHTML = `
    <div class="modal-heading">
      <span>Maç Değerlendirme Raporu</span>
      <h3>${escapeHtml(row[K.home])} - ${escapeHtml(row[K.away])}</h3>
      <p>Rapor modülü canlı app akışından sadeleştirilerek bağlandı.</p>
    </div>
    <div class="report-preview" id="report-preview">
      <div class="report-title">
        ${renderLogo(row[K.home], "table-logo")}
        <div><strong>Resmi Maç Değerlendirme</strong><small>${escapeHtml(row.Tarih)} | ${escapeHtml(row[K.hall])}</small></div>
      </div>
      <div class="report-score">${escapeHtml(row[K.home])} <b>${numberText(row["Set A"])} - ${numberText(row["Set B"])}</b> ${escapeHtml(row[K.away])}</div>
      ${renderSetBreakdown(row)}
      <label>Maç Özeti<textarea id="report-note" placeholder="Maçla ilgili kısa not yazın..."></textarea></label>
      <label>Gelecek Antrenman Odağı<input id="report-focus" placeholder="Örn: servis karşılama, blok zamanlaması" /></label>
    </div>
    <div class="modal-actions">
      <button type="button" data-print-report>Yazdır / PDF</button>
      <button type="button" data-copy-report>Rapor Metnini Kopyala</button>
    </div>
  `;
  modal.hidden = false;
  modal.style.display = "flex";
  body.querySelector("[data-print-report]")?.addEventListener("click", () => window.print());
  body.querySelector("[data-copy-report]")?.addEventListener("click", async () => {
    const note = document.querySelector("#report-note")?.value || "";
    const focus = document.querySelector("#report-focus")?.value || "";
    await navigator.clipboard?.writeText(`${matchSummaryText(row)}\n\nMaç özeti: ${note || "-"}\nOdak: ${focus || "-"}`);
  });
}

function closeModal() {
  const modal = document.querySelector("#action-modal");
  if (!modal) return;
  modal.hidden = true;
  modal.style.display = "none";
}

function tabButton(name, label, count) {
  const selected = state.tab === name;
  return `
    <button class="tab ${selected ? "active" : ""}" data-tab="${name}" role="tab" aria-selected="${selected}">
      ${label}
      <span>${count}</span>
    </button>
  `;
}

function renderSkeleton() {
  return `
    <div class="skeleton-list" aria-label="Veriler yükleniyor">
      <span></span><span></span><span></span><span></span>
    </div>
  `;
}

function renderActiveTab() {
  if (state.tab === "matches") return renderMatches();
  if (state.tab === "competitions") return renderCompetitions();
  return renderStandings();
}

function renderStandings() {
  const rows = getStandings();
  if (!rows.length) return emptyState("Bu filtrelere uygun puan durumu kaydı bulunamadı.");
  const limitedRows = rows.slice(0, 500);
  return `
    <div class="desktop-table">
      <table>
        <thead>
          <tr>
            <th>Sıra</th><th>Takım</th><th>Yarışma</th><th>O</th><th>G</th><th>M</th><th>A</th><th>V</th><th>P</th><th>SAV</th><th>ASP</th><th>VSP</th><th>SPAV</th><th>3-0</th><th>3-1</th><th>3-2</th><th>2-3</th><th>1-3</th><th>0-3</th>
          </tr>
        </thead>
        <tbody>
          ${limitedRows
            .map(
              (row) => `
                <tr>
                  <td>${numberText(row[K.rank])}</td>
                  <td class="team-cell">${renderLogo(row[K.team], "table-logo")}<span><strong>${escapeHtml(row[K.team])}</strong><small>${escapeHtml(row[K.category])} / ${escapeHtml(row[K.cluster])}</small></span></td>
                  <td>${escapeHtml(row[K.competition])}</td>
                  <td>${numberText(row.O)}</td>
                  <td>${numberText(row.G)}</td>
                  <td>${numberText(row.M)}</td>
                  <td>${numberText(row.A)}</td>
                  <td>${numberText(row.V)}</td>
                  <td><strong>${numberText(row.P)}</strong></td>
                  <td>${numberText(row.SAV)}</td>
                  <td>${numberText(row.ASP)}</td>
                  <td>${numberText(row.VSP)}</td>
                  <td>${numberText(row.SPAV)}</td>
                  <td>${numberText(row["3-0"])}</td>
                  <td>${numberText(row["3-1"])}</td>
                  <td>${numberText(row["3-2"])}</td>
                  <td>${numberText(row["2-3"])}</td>
                  <td>${numberText(row["1-3"])}</td>
                  <td>${numberText(row["0-3"])}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="mobile-cards">
      ${limitedRows.map(renderStandingCard).join("")}
    </div>
    ${rows.length > limitedRows.length ? `<p class="limit-note">Performans için ilk ${limitedRows.length} kayıt gösteriliyor. Filtreyi daraltarak daha özel sonuç alın.</p>` : ""}
  `;
}

function renderStandingCard(row) {
  return `
    <article class="result-card">
      <div class="card-topline">
        <span>${numberText(row[K.rank])}. sıra</span>
        <strong>${numberText(row.P)} puan</strong>
      </div>
      <div class="card-team-title">${renderLogo(row[K.team])}<h3>${escapeHtml(row[K.team])}</h3></div>
      <p>${escapeHtml(row[K.competition])}</p>
      <div class="mini-stats">
        <span>O ${numberText(row.O)}</span>
        <span>G ${numberText(row.G)}</span>
        <span>M ${numberText(row.M)}</span>
        <span>SAV ${numberText(row.SAV)}</span>
        <span>ASP ${numberText(row.ASP)}</span>
        <span>VSP ${numberText(row.VSP)}</span>
      </div>
      <div class="set-breakdown compact">
        <span>Galibiyet: <strong>3-0 ${numberText(row["3-0"])}</strong></span>
        <span><strong>3-1 ${numberText(row["3-1"])}</strong></span>
        <span><strong>3-2 ${numberText(row["3-2"])}</strong></span>
        <span>Mağlubiyet: <strong>2-3 ${numberText(row["2-3"])}</strong></span>
        <span><strong>1-3 ${numberText(row["1-3"])}</strong></span>
        <span><strong>0-3 ${numberText(row["0-3"])}</strong></span>
      </div>
    </article>
  `;
}

function renderMatches() {
  const filteredRows = getMatches();
  const scoredRows = filteredRows.filter(hasMatchScore);
  const rows = scoredRows.length ? scoredRows : filteredRows;
  if (!rows.length) return emptyState("Bu filtrelere uygun maç sonucu bulunamadı.");
  const limitedRows = rows.slice(0, 120);
  return `
    <div class="match-grid">
      ${limitedRows.map(renderMatchCard).join("")}
    </div>
    ${rows.length > limitedRows.length ? `<p class="limit-note">İlk ${limitedRows.length} maç gösteriliyor. Arama veya filtre ile listeyi daraltabilirsiniz.</p>` : ""}
  `;
}

function renderMatchCard(row) {
  return `
    <article class="match-card">
      <div class="match-meta">
        <span>${escapeHtml(row[K.competition])}</span>
        <span>${escapeHtml(row.Tarih)} ${escapeHtml(row.Saat)}</span>
        <span>${escapeHtml(row[K.hall])}</span>
      </div>
      <div class="score-board">
        <div class="match-team">
          ${renderLogo(row[K.home], "match-logo")}
          <strong>${escapeHtml(row[K.home])}</strong>
        </div>
        <div class="score-box">
          <span>${numberText(row["Set A"])}</span>
          <b>:</b>
          <span>${numberText(row["Set B"])}</span>
        </div>
        <div class="match-team">
          ${renderLogo(row[K.away], "match-logo")}
          <strong>${escapeHtml(row[K.away])}</strong>
        </div>
      </div>
      ${renderSetBreakdown(row)}
      <div class="match-actions">
        <button type="button" data-share-match="${dataAttr(JSON.stringify(row))}">Paylaş</button>
        <button type="button" class="report-button" data-report-match="${dataAttr(JSON.stringify(row))}">Rapor</button>
      </div>
    </article>
  `;
}

function renderCompetitions() {
  const rows = getCompetitions();
  if (!rows.length) return emptyState("Bu filtrelere uygun yarışma bulunamadı.");
  return `
    <div class="competition-grid">
      ${rows
        .map(
          (row) => `
            <article class="competition-card">
              <span>${escapeHtml(row[K.gender])} / ${escapeHtml(row[K.category])}</span>
              <h3>${escapeHtml(row[K.competition])}</h3>
              <p>${escapeHtml(row[K.cluster])}</p>
              <strong>${numberText(row["Puan Tablosu Takım Sayısı"] ?? row["Takım Sayısı"])} takım</strong>
              <button
                class="card-action"
                type="button"
                data-show-standings
                data-gender="${dataAttr(row[K.gender])}"
                data-category="${dataAttr(row[K.category])}"
                data-cluster="${dataAttr(row[K.cluster])}"
                data-competition="${dataAttr(row[K.competition])}"
              >
                Puan durumunu gör
              </button>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function emptyState(message) {
  return `<div class="empty-state"><strong>Kayıt yok</strong><p>${message}</p></div>`;
}

function bindGhostScroll(selector) {
  document.querySelectorAll(selector).forEach((rail) => {
    let dragging = false;
    let startX = 0;
    let startLeft = 0;

    rail.addEventListener("pointerdown", (event) => {
      dragging = true;
      startX = event.clientX;
      startLeft = rail.scrollLeft;
      rail.classList.add("dragging");
      rail.setPointerCapture?.(event.pointerId);
    });

    rail.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      rail.scrollLeft = startLeft - (event.clientX - startX);
    });

    const stopDragging = (event) => {
      if (!dragging) return;
      dragging = false;
      rail.classList.remove("dragging");
      if (event?.pointerId) rail.releasePointerCapture?.(event.pointerId);
    };

    rail.addEventListener("pointerup", stopDragging);
    rail.addEventListener("pointercancel", stopDragging);
    rail.addEventListener("pointerleave", stopDragging);

    rail.addEventListener(
      "wheel",
      (event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        rail.scrollLeft += event.deltaY;
      },
      { passive: false }
    );
  });
}

function bindEvents() {
  document.querySelector("[data-action='refresh']")?.addEventListener("click", () => loadData(true));

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      renderShell();
    });
  });

  document.querySelectorAll("[data-region]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.region = button.dataset.region || "istanbul";
      state.selectedTeam = "";
      state.selectedAlphabet = "";
      state.currentDate = "";
      state.dateTouched = false;
      await loadRegionMatches(true);
      state.tab = "matches";
      renderShell();
    });
  });

  document.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedStatus = button.dataset.status || "all";
      state.tab = "matches";
      renderShell();
    });
  });

  document.querySelectorAll("[data-date]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentDate = button.dataset.date || "";
      state.dateTouched = true;
      state.selectedTeam = "";
      state.tab = "matches";
      renderShell();
    });
  });

  document.querySelectorAll("[data-letter]").forEach((button) => {
    button.addEventListener("click", () => {
      const letter = button.dataset.letter || "";
      state.selectedAlphabet = state.selectedAlphabet === letter ? "" : letter;
      renderShell();
    });
  });

  document.querySelectorAll("[data-team]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTeam = button.dataset.team || "";
      state.filters.q = state.selectedTeam;
      state.tab = "matches";
      renderShell();
    });
  });

  document.querySelector("[data-clear-team]")?.addEventListener("click", () => {
    state.selectedTeam = "";
    state.filters.q = "";
    renderShell();
  });

  document.querySelectorAll("[data-share-match]").forEach((button) => {
    button.addEventListener("click", () => {
      openShareModal(JSON.parse(decodeURIComponent(button.dataset.shareMatch || "{}")));
    });
  });

  document.querySelectorAll("[data-report-match]").forEach((button) => {
    button.addEventListener("click", () => {
      openReportModal(JSON.parse(decodeURIComponent(button.dataset.reportMatch || "{}")));
    });
  });

  document.querySelector("[data-close-modal]")?.addEventListener("click", closeModal);
  document.querySelector("#action-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "action-modal") closeModal();
  });

  document.querySelectorAll("[data-show-standings]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filters.gender = decodeURIComponent(button.dataset.gender || "");
      state.filters.category = decodeURIComponent(button.dataset.category || "");
      state.filters.cluster = decodeURIComponent(button.dataset.cluster || "");
      state.filters.competition = decodeURIComponent(button.dataset.competition || "");
      state.filters.q = "";
      state.tab = "standings";
      renderShell();
      document.querySelector("#puan")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  const bindFilter = (id, key) => {
    document.querySelector(`#${id}`)?.addEventListener("input", (event) => {
      state.filters[key] = event.target.value;
      if (key === "gender") {
        state.filters.category = "";
        state.filters.cluster = "";
        state.filters.competition = "";
      }
      if (key === "category") {
        state.filters.cluster = "";
        state.filters.competition = "";
      }
      if (key === "cluster") state.filters.competition = "";
      renderShell();
      document.querySelector(`#${id}`)?.focus();
    });
  };

  bindFilter("q", "q");
  bindFilter("gender", "gender");
  bindFilter("category", "category");
  bindFilter("cluster", "cluster");
  bindFilter("competition", "competition");

  bindGhostScroll(".logo-rail, .date-row, .letter-row");

  requestAnimationFrame(() => {
    const targetDate = state.dateTouched
      ? document.querySelector(".date-chip.active") || document.querySelector(".date-chip.today")
      : document.querySelector(".date-chip.today") || document.querySelector(".date-chip.active");
    targetDate?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  });
}

async function loadData(force = false) {
  state.refreshing = true;
  if (!state.payload) state.loading = true;
  state.error = "";
  renderShell();

  try {
    const response = await fetch(`${API_URL}${force ? "?refresh=1" : ""}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `API ${response.status} hatası`);
    }
    state.payload = await response.json();
    await Promise.all([loadLogos(force), loadRegionMatches(force), loadRosters(force)]);
  } catch (error) {
    state.error =
      error?.message ||
      "Veri alınamadı. Sunucuyu `npm start` komutu ile çalıştırdığınızdan emin olun.";
  } finally {
    state.loading = false;
    state.refreshing = false;
    renderShell();
  }
}

async function loadRegionMatches(force = false) {
  const response = await fetch(`${REGION_API_URL}?region=${encodeURIComponent(state.region)}${force ? "&refresh=1" : ""}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) return;

  const payload = await response.json();
  state.liveMatches = payload.matches || [];
  if (!state.currentDate && state.liveMatches.length) {
    const dates = [...new Set(state.liveMatches.map((match) => match.date).filter(Boolean))].sort((a, b) => dateKey(a) - dateKey(b));
    const today = todayString();
    state.currentDate = dates.includes(today) ? today : dates[0] || "";
  }
}

async function loadRosters(force = false) {
  const response = await fetch(`${ROSTER_API_URL}${force ? "?refresh=1" : ""}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) return;
  const payload = await response.json();
  state.rosters = payload.rows || [];
}

async function loadLogos(force = false) {
  const response = await fetch(`${LOGO_API_URL}${force ? "?refresh=1" : ""}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) return;

  const payload = await response.json();
  state.logos = payload.logos || [];
  state.logoMap = new Map();
  state.logos.forEach((logo) => {
    state.logoMap.set(text(logo.teamName).toLocaleLowerCase("tr-TR"), logo);
    state.logoMap.set(normalizeName(logo.teamName), logo);
  });
}

loadData();
window.setInterval(() => loadData(false), REFRESH_MS);

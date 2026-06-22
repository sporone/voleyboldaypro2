const http = require("node:http");
const { get: httpsGet, request: httpsRequest } = require("node:https");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const SCRAPER = path.join(ROOT, "scrape_puandurumu_detailed.py");
const CACHE_DIR = path.join(ROOT, ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "puandurumu-cache.json");
const FALLBACK_CACHE_FILE = "C:\\tmp\\puandurumu_live.json";
const MAX_AGE_MS = Number(process.env.DATA_MAX_AGE_MS || 5 * 60 * 1000);
const SCRAPER_TIMEOUT_MS = Number(process.env.SCRAPER_TIMEOUT_MS || 4 * 60 * 1000);
const OFFICIAL_SOURCES = {
  standings: "https://istanbul.voleyboliltemsilciligi.com/PuanDurumu",
  fixtures: "https://istanbul.voleyboliltemsilciligi.com/Fiksturler",
  calendar: "https://istanbul.voleyboliltemsilciligi.com/MacTakvimi",
};
const LOGO_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1tze95HAdE5QzRbag--RnpzDQPlLBqHZlARJ8TuBp5Fw/gviz/tq?tqx=out:csv&sheet=Sayfa1";
const ROSTER_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1mxNG1uveIfoxFE3G0hXgJpB31XRya3anaO96cBFKZY0/export?format=csv&gid=0";
const REGION_SOURCES = {
  istanbul: {
    name: "TVF İstanbul",
    matches:
      "https://docs.google.com/spreadsheets/d/1czqD3fVZD-P8zuefoikXfIisTmqSbSxN-4YXiibxkic/export?format=csv&gid=0",
  },
  kocaeli: {
    name: "TVF Kocaeli",
    matches:
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vQL7iZm3gPNyfRhAqJgbETM9o90dnZL5dhRRiw8nwi7iRFSRerVJQS6_1DvtJfjnvd9sUjf4qTpzQNf/pub?gid=0&single=true&output=csv",
  },
  ankara: {
    name: "TVF Ankara",
    matches:
      "https://docs.google.com/spreadsheets/d/1VkQ0KW4gRmc21O7R9CHb-nj5Cedajr1-ZosP09Y0CVY/export?format=csv&gid=0",
  },
  izmir: {
    name: "TVF İzmir",
    matches:
      "https://docs.google.com/spreadsheets/d/15ZMyMFlsoWZm-LaDUv-5gLoPQEKElGk4T8levp9oThI/export?format=csv&gid=0",
  },
};
const LOGO_MAX_AGE_MS = Number(process.env.LOGO_MAX_AGE_MS || 30 * 60 * 1000);
const AUX_MAX_AGE_MS = Number(process.env.AUX_MAX_AGE_MS || 10 * 60 * 1000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const cache = {
  payload: null,
  fetchedAt: 0,
  refreshPromise: null,
  lastError: "",
};

const logoCache = {
  rows: [],
  fetchedAt: 0,
  refreshPromise: null,
  lastError: "",
};

const csvCache = new Map();

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function driveImageUrl(url) {
  const match = String(url || "").match(/\/file\/d\/([^/]+)/);
  return match
    ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(match[1])}&sz=w220`
    : url;
}

function cleanCell(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function decodeHtml(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ccedil: "ç",
    Ccedil: "Ç",
    uuml: "ü",
    Uuml: "Ü",
    ouml: "ö",
    Ouml: "Ö",
    iuml: "ï",
  };

  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => named[name] ?? match);
}

function cleanHtml(value) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hiddenValue(page, name) {
  const match = String(page || "").match(new RegExp(`name="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*value="([^"]*)"`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function spanValue(page, prefix, field, rowIndex) {
  const pattern = new RegExp(
    `id="${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_${rowIndex}[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:span|a)>`,
    "i"
  );
  const match = String(page || "").match(pattern);
  return match ? cleanHtml(match[1]) : "";
}

function normalizeTeamKey(value) {
  return cleanCell(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(sk|spor|voleybol|akademi|kulubu|kulübü|bld|belediye|ortaokulu|lisesi)\b/g, " ")
    .replace(/[^a-z0-9ığüşöçİĞÜŞÖÇ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRegionMatch(row) {
  return {
    date: cleanCell(row[0]),
    venue: cleanCell(row[1]),
    time: cleanCell(row[2]),
    t1: cleanCell(row[3]),
    s1: cleanCell(row[4]) || "-",
    s2: cleanCell(row[5]) || "-",
    t2: cleanCell(row[6]),
    sets: cleanCell(row[7]),
    c: cleanCell(row[9]),
    league: cleanCell(row[10]) || "Lig",
    kume: cleanCell(row[10]),
    ktg: cleanCell(row[11]),
    tur: cleanCell(row[12]),
    gr: cleanCell(row[13]),
  };
}

function getGroupCode(match) {
  return [match.kume, match.ktg, match.tur, match.gr].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || "Genel";
}

function officialMatchKey(match) {
  return [
    match.date,
    cleanCell(match.time),
    normalizeTeamKey(match.venue),
    normalizeTeamKey(match.t1),
    normalizeTeamKey(match.t2),
    cleanCell(match.kume),
    cleanCell(match.ktg),
    cleanCell(match.tur),
    cleanCell(match.gr),
  ].join("|");
}

function officialMatchFromPayload(row) {
  const match = {
    date: cleanCell(row["Tarih"]),
    venue: cleanCell(row["Salon Adı"]),
    time: cleanCell(row["Saat"]),
    t1: cleanCell(row["Ev Sahibi (A)"]),
    s1: cleanCell(row["Set A"]) || "-",
    s2: cleanCell(row["Set B"]) || "-",
    t2: cleanCell(row["Misafir (B)"]),
    sets: cleanCell(row["Set Sonuçları"]),
    c: cleanCell(row["Cinsiyet"] || row["C"]),
    league: cleanCell(row["Yarışma"] || row["Küme"]),
    kume: cleanCell(row["Küme"]),
    ktg: cleanCell(row["Kategori"] || row["Ktg."]),
    tur: cleanCell(row["Tür"]),
    gr: cleanCell(row["Gr."] || row["Gr"]),
    source: cleanCell(row["Kaynak URL"] || OFFICIAL_SOURCES.standings),
  };
  return { ...match, groupCode: getGroupCode(match) };
}

function parseOfficialRows(page, prefix, fields) {
  const indexes = sortedUniqueIndexes(page, `${prefix}_${Object.keys(fields)[0]}`);
  return indexes
    .map((index) => {
      const row = {};
      for (const [field, label] of Object.entries(fields)) {
        row[label] = spanValue(page, prefix, field, index);
      }
      return row;
    })
    .filter((row) => Object.values(row).some(Boolean));
}

function sortedUniqueIndexes(page, idPrefix) {
  const escaped = idPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...new Set([...String(page || "").matchAll(new RegExp(`id="${escaped}_(\\d+)`, "g"))].map((match) => Number(match[1])))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function fixtureRowToMatch(row) {
  const match = {
    date: cleanCell(row.date),
    venue: cleanCell(row.venue),
    time: cleanCell(row.time),
    t1: cleanCell(row.home),
    s1: "-",
    s2: "-",
    t2: cleanCell(row.away),
    sets: "",
    c: cleanCell(row.gender),
    league: cleanCell(row.kume),
    kume: cleanCell(row.kume),
    ktg: cleanCell(row.category),
    tur: cleanCell(row.type),
    gr: cleanCell(row.group),
    source: OFFICIAL_SOURCES.fixtures,
  };
  return { ...match, groupCode: getGroupCode(match) };
}

function calendarRowToMatch(row) {
  const match = {
    date: cleanCell(row.date),
    venue: cleanCell(row.venue),
    time: cleanCell(row.time),
    t1: cleanCell(row.home),
    s1: cleanCell(row.homeScore) || "-",
    s2: cleanCell(row.awayScore) || "-",
    t2: cleanCell(row.away),
    sets: cleanCell(row.sets),
    c: cleanCell(row.gender),
    league: cleanCell(row.kume),
    kume: cleanCell(row.kume),
    ktg: cleanCell(row.category),
    tur: cleanCell(row.type),
    gr: cleanCell(row.group),
    source: OFFICIAL_SOURCES.calendar,
  };
  return { ...match, groupCode: getGroupCode(match) };
}

async function getOfficialFixtures(force = false) {
  const cacheKey = "official:fixtures";
  const cached = csvCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.fetchedAt < AUX_MAX_AGE_MS) return cached;

  const firstPage = await fetchText(OFFICIAL_SOURCES.fixtures);
  const fields = {
    "__EVENTTARGET": "ctl00$icerik$txtbitistrh",
    "__EVENTARGUMENT": "",
    "__LASTFOCUS": "",
    "__VIEWSTATE": hiddenValue(firstPage, "__VIEWSTATE"),
    "__VIEWSTATEGENERATOR": hiddenValue(firstPage, "__VIEWSTATEGENERATOR"),
    "__VIEWSTATEENCRYPTED": hiddenValue(firstPage, "__VIEWSTATEENCRYPTED"),
    "__EVENTVALIDATION": hiddenValue(firstPage, "__EVENTVALIDATION"),
    "ctl00$icerik$ddlSil": "34",
    "ctl00$icerik$ddlsezon": "2025-2026",
    "ctl00$icerik$txttarih": "01.07.2025",
    "ctl00$icerik$txtbitistrh": "30.06.2026",
    "ctl00$icerik$ddlsbe": "0",
    "ctl00$icerik$ddlskategori": "0",
    "ctl00$icerik$ddlskume": "-1",
    "ctl00$icerik$ddlsturu": "0",
    "ctl00$icerik$ddlsgrubu": "0",
    "ctl00$icerik$ddlskurumadi": "0",
    "ctl00$icerik$ddlstakim": "0",
    "ctl00$icerik$ddlsyarismaadi": "0",
  };
  const page = await postFormText(OFFICIAL_SOURCES.fixtures, fields);
  const rows = parseOfficialRows(page, "icerik_gvliste", {
    gtarih: "date",
    gsaat: "time",
    gyer: "venue",
    gevsahibi: "home",
    gmisafir: "away",
    geb: "gender",
    gkume: "kume",
    gkategori: "category",
    gturu: "type",
    ggrubu: "group",
    gdevre: "period",
    gtv: "court",
    ghafta: "week",
  })
    .map(fixtureRowToMatch)
    .filter((match) => match.date && match.t1 && match.t2);

  const entry = { rows, fetchedAt: Date.now(), sourceUrl: OFFICIAL_SOURCES.fixtures };
  csvCache.set(cacheKey, entry);
  return entry;
}

async function getOfficialCalendar(force = false) {
  const cacheKey = "official:calendar";
  const cached = csvCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.fetchedAt < AUX_MAX_AGE_MS) return cached;

  const page = await fetchText(OFFICIAL_SOURCES.calendar);
  const prefixes = [
    ...new Set([...page.matchAll(/id="(icerik_[^"]+)_gtarih_\d+"/g)].map((match) => match[1])),
  ];
  const rows = prefixes
    .flatMap((prefix) =>
      parseOfficialRows(page, prefix, {
        gtarih: "date",
        gsaat: "time",
        gyer: "venue",
        gevsahibi: "home",
        gseta: "homeScore",
        gsetb: "awayScore",
        gmisafir: "away",
        gsetsonuclari: "sets",
        geb: "gender",
        gkume: "kume",
        gkategori: "category",
        gturu: "type",
        ggrubu: "group",
      })
    )
    .map(calendarRowToMatch)
    .filter((match) => match.date && match.t1 && match.t2);

  const entry = { rows, fetchedAt: Date.now(), sourceUrl: OFFICIAL_SOURCES.calendar };
  csvCache.set(cacheKey, entry);
  return entry;
}

async function getOfficialIstanbulMatches(force = false) {
  const [fixtures, calendar, payload] = await Promise.all([
    getOfficialFixtures(force),
    getOfficialCalendar(force).catch((error) => ({ rows: [], fetchedAt: 0, sourceUrl: OFFICIAL_SOURCES.calendar, error: error.message })),
    getPayload(force).catch((error) => ({ matches: [], metadata: { last_error: error.message } })),
  ]);

  const byKey = new Map();
  const upsert = (match) => {
    if (!match?.date || !match?.t1 || !match?.t2) return;
    const textBlob = `${match.time} ${match.sets} ${match.t1} ${match.t2}`.toLocaleLowerCase("tr-TR");
    if (textBlob.includes("iptal")) return;
    const key = officialMatchKey(match);
    const existing = byKey.get(key) || {};
    byKey.set(key, {
      ...existing,
      ...match,
      s1: match.s1 && match.s1 !== "-" ? match.s1 : existing.s1 || "-",
      s2: match.s2 && match.s2 !== "-" ? match.s2 : existing.s2 || "-",
      sets: match.sets || existing.sets || "",
      source: [existing.source, match.source].filter(Boolean).join(" + "),
      groupCode: getGroupCode({ ...existing, ...match }),
    });
  };

  fixtures.rows.forEach(upsert);
  (payload.matches || []).map(officialMatchFromPayload).forEach(upsert);
  calendar.rows.forEach(upsert);

  const matches = [...byKey.values()].sort((a, b) => dateKeyForServer(a.date) - dateKeyForServer(b.date) || cleanCell(a.time).localeCompare(cleanCell(b.time), "tr-TR"));

  return {
    metadata: {
      region: "istanbul",
      region_name: "TVF İstanbul",
      source_url: OFFICIAL_SOURCES,
      match_count: matches.length,
      fixture_count: fixtures.rows.length,
      calendar_count: calendar.rows.length,
      puandurumu_match_count: payload.matches?.length || 0,
      fetched_at: new Date(Math.max(fixtures.fetchedAt || 0, calendar.fetchedAt || 0, Date.now())).toISOString(),
      calendar_error: calendar.error || "",
      puandurumu_error: payload.metadata?.last_error || "",
    },
    regions: Object.fromEntries(Object.entries(REGION_SOURCES).map(([key, value]) => [key, value.name])),
    matches,
  };
}

function dateKeyForServer(value) {
  const [day, month, year] = cleanCell(value).split(".").map(Number);
  if (!day || !month || !year) return 0;
  return new Date(year, month - 1, day).getTime();
}

async function fetchCachedCsv(cacheKey, url, maxAgeMs = AUX_MAX_AGE_MS, force = false) {
  const cached = csvCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.fetchedAt < maxAgeMs) return cached;

  const csv = await fetchText(`${url}${url.includes("?") ? "&" : "?"}cb=${Date.now()}`);
  if (csv.toLowerCase().includes("<!doctype html>")) {
    throw new Error(`${cacheKey} CSV yerine HTML döndürdü`);
  }

  const rows = parseCsvRows(csv);
  const entry = { rows, fetchedAt: Date.now(), sourceUrl: url };
  csvCache.set(cacheKey, entry);
  return entry;
}

async function getRegionMatches(regionKey = "istanbul", force = false) {
  if (regionKey === "istanbul") {
    return getOfficialIstanbulMatches(force);
  }

  const region = REGION_SOURCES[regionKey] || REGION_SOURCES.istanbul;
  const entry = await fetchCachedCsv(`region:${regionKey}`, region.matches, AUX_MAX_AGE_MS, force);
  const matches = entry.rows
    .slice(1)
    .map(normalizeRegionMatch)
    .filter((match) => match.t1 && match.t2 && !`${match.time} ${match.sets} ${match.t1} ${match.t2}`.toLocaleLowerCase("tr-TR").includes("iptal"))
    .map((match) => ({ ...match, groupCode: getGroupCode(match) }));

  return {
    metadata: {
      region: regionKey,
      region_name: region.name,
      source_url: region.matches,
      match_count: matches.length,
      fetched_at: new Date(entry.fetchedAt).toISOString(),
    },
    regions: Object.fromEntries(Object.entries(REGION_SOURCES).map(([key, value]) => [key, value.name])),
    matches,
  };
}

async function getRosters(force = false) {
  const entry = await fetchCachedCsv("rosters", ROSTER_CSV_URL, AUX_MAX_AGE_MS, force);
  let lastTeam = "";
  let lastGroup = "";
  let lastCoach = "";
  const rows = entry.rows
    .slice(1)
    .map((row) => {
      const team = cleanCell(row[0]) || lastTeam;
      const group = cleanCell(row[1]) || lastGroup;
      const coach = cleanCell(row[2]) || lastCoach;
      if (team) lastTeam = team;
      if (group) lastGroup = group;
      if (coach) lastCoach = coach;
      return {
        team,
        group,
        coach,
        number: cleanCell(row[3]),
        name: cleanCell(row[4]),
        position: cleanCell(row[5]),
        image: cleanCell(row[6]),
      };
    })
    .filter((row) => row.team && row.name);

  return {
    metadata: {
      source_url: ROSTER_CSV_URL,
      row_count: rows.length,
      fetched_at: new Date(entry.fetchedAt).toISOString(),
    },
    rows,
  };
}

function fetchText(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    httpsGet(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirectCount > 5) {
          reject(new Error("Çok fazla yönlendirme"));
          return;
        }
        const nextUrl = new URL(response.headers.location, url).toString();
        fetchText(nextUrl, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`Google Sheet yanıt kodu ${response.statusCode}`));
        response.resume();
        return;
      }

      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

function postFormText(url, fields, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(fields).toString();
    const parsed = new URL(url);
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          Referer: url,
        },
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume();
          if (redirectCount > 5) {
            reject(new Error("Çok fazla yönlendirme"));
            return;
          }
          const nextUrl = new URL(response.headers.location, url).toString();
          postFormText(nextUrl, fields, redirectCount + 1).then(resolve, reject);
          return;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Resmi site yanıt kodu ${response.statusCode}`));
          response.resume();
          return;
        }

        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => resolve(responseBody));
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function isFresh() {
  return cache.payload && Date.now() - cache.fetchedAt < MAX_AGE_MS;
}

function decoratePayload(payload, options = {}) {
  const metadata = {
    ...(payload.metadata || {}),
    server_checked_at: new Date().toISOString(),
    cache_age_seconds: cache.fetchedAt ? Math.round((Date.now() - cache.fetchedAt) / 1000) : null,
    updating: Boolean(cache.refreshPromise),
    stale: options.stale || false,
    last_error: cache.lastError || "",
  };
  return { ...payload, metadata };
}

async function readDiskCache() {
  for (const filePath of [CACHE_FILE, FALLBACK_CACHE_FILE]) {
    try {
      const payload = JSON.parse(await fsp.readFile(filePath, "utf8"));
      cache.payload = payload;
      cache.fetchedAt = Number(payload.metadata?.server_cached_at || Date.now());
      return true;
    } catch {
      // Try the next cache location.
    }
  }
  return false;
}

async function writeDiskCache(payload) {
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  const withCacheMeta = {
    ...payload,
    metadata: {
      ...(payload.metadata || {}),
      server_cached_at: Date.now(),
    },
  };
  await fsp.writeFile(CACHE_FILE, JSON.stringify(withCacheMeta, null, 2), "utf8");
}

function pythonCandidates() {
  const homeFromProject = path.resolve(ROOT, "..", "..", "..");
  const bundledPython = path.join(
    homeFromProject,
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "python.exe"
  );
  const configured = process.env.PYTHON_BIN ? [{ command: process.env.PYTHON_BIN, args: [] }] : [];
  return [
    ...configured,
    { command: bundledPython, args: [] },
    { command: "python", args: [] },
    { command: "python3", args: [] },
    { command: "py", args: ["-3"] },
  ];
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: ROOT,
      windowsHide: true,
      shell: false,
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Tarayıcı zaman aşımına uğradı: ${command}`));
    }, SCRAPER_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(" ")} çıkış kodu ${code}\n${stderr || stdout}`));
      }
    });
  });
}

async function runScraper() {
  const outputPath = path.join(os.tmpdir(), `istanbul-voleybol-${Date.now()}.json`);
  const errors = [];

  for (const candidate of pythonCandidates()) {
    const args = [...candidate.args, SCRAPER, outputPath];
    try {
      await runCommand(candidate.command, args);
      const payload = JSON.parse(await fsp.readFile(outputPath, "utf8"));
      await fsp.rm(outputPath, { force: true });
      payload.metadata = {
        ...(payload.metadata || {}),
        server_source: "scrape_puandurumu_detailed.py",
      };
      return payload;
    } catch (error) {
      errors.push(`${candidate.command}: ${error.message}`);
    }
  }

  throw new Error(errors.join("\n"));
}

async function refreshCache() {
  if (cache.refreshPromise) return cache.refreshPromise;

  cache.refreshPromise = (async () => {
    const payload = await runScraper();
    cache.payload = payload;
    cache.fetchedAt = Date.now();
    cache.lastError = "";
    await writeDiskCache(payload);
    return payload;
  })()
    .catch((error) => {
      cache.lastError = error.message;
      throw error;
    })
    .finally(() => {
      cache.refreshPromise = null;
    });

  return cache.refreshPromise;
}

async function getPayload(force = false) {
  if (!cache.payload) await readDiskCache();

  if (force || !cache.payload) {
    const payload = await refreshCache();
    return decoratePayload(payload);
  }

  if (!isFresh() && !cache.refreshPromise) {
    refreshCache().catch((error) => {
      console.error("Veri yenileme hatası:", error.message);
    });
  }

  return decoratePayload(cache.payload, { stale: !isFresh() });
}

function logosAreFresh() {
  return logoCache.rows.length && Date.now() - logoCache.fetchedAt < LOGO_MAX_AGE_MS;
}

async function refreshLogos() {
  if (logoCache.refreshPromise) return logoCache.refreshPromise;

  logoCache.refreshPromise = (async () => {
    const csv = await fetchText(LOGO_SHEET_CSV_URL);
    const rows = parseCsvRows(csv)
      .slice(1)
      .map(([teamName, logoLink]) => ({
        teamName: String(teamName || "").trim(),
        logoLink: String(logoLink || "").trim(),
        logoUrl: driveImageUrl(logoLink),
      }))
      .filter((row) => row.teamName && row.logoUrl);

    logoCache.rows = rows;
    logoCache.fetchedAt = Date.now();
    logoCache.lastError = "";
    return rows;
  })()
    .catch((error) => {
      logoCache.lastError = error.message;
      throw error;
    })
    .finally(() => {
      logoCache.refreshPromise = null;
    });

  return logoCache.refreshPromise;
}

async function getLogos(force = false) {
  if (force || !logosAreFresh()) {
    await refreshLogos();
  }

  return {
    metadata: {
      source_url: LOGO_SHEET_CSV_URL,
      logo_count: logoCache.rows.length,
      fetched_at: logoCache.fetchedAt ? new Date(logoCache.fetchedAt).toISOString() : null,
      last_error: logoCache.lastError,
    },
    logos: logoCache.rows,
  };
}

function safeStaticPath(requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const normalized = path.normalize(decoded === "/" ? "/index.html" : decoded);
  const relative = normalized.replace(/^([/\\])+/, "");
  const filePath = path.join(ROOT, relative);
  return filePath.startsWith(ROOT) ? filePath : null;
}

async function serveStatic(req, res, pathname) {
  const filePath = safeStaticPath(pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error("Not a file");
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Dosya bulunamadı.");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/health") {
    jsonResponse(res, 200, {
      ok: true,
      has_cache: Boolean(cache.payload),
      fresh: isFresh(),
      updating: Boolean(cache.refreshPromise),
    });
    return;
  }

  if (url.pathname === "/api/standings") {
    try {
      const payload = await getPayload(url.searchParams.get("refresh") === "1");
      jsonResponse(res, 200, payload);
    } catch (error) {
      if (cache.payload) {
        jsonResponse(res, 200, decoratePayload(cache.payload, { stale: true }));
        return;
      }
      jsonResponse(res, 502, {
        error:
          "Kaynak siteden veri çekilemedi. İnternet bağlantısını ve Python kurulumunu kontrol edin.",
        detail: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/logos") {
    try {
      const payload = await getLogos(url.searchParams.get("refresh") === "1");
      jsonResponse(res, 200, payload);
    } catch (error) {
      jsonResponse(res, logoCache.rows.length ? 200 : 502, {
        metadata: {
          source_url: LOGO_SHEET_CSV_URL,
          logo_count: logoCache.rows.length,
          fetched_at: logoCache.fetchedAt ? new Date(logoCache.fetchedAt).toISOString() : null,
          last_error: error.message,
        },
        logos: logoCache.rows,
      });
    }
    return;
  }

  if (url.pathname === "/api/region-matches") {
    try {
      const region = url.searchParams.get("region") || "istanbul";
      const payload = await getRegionMatches(region, url.searchParams.get("refresh") === "1");
      jsonResponse(res, 200, payload);
    } catch (error) {
      jsonResponse(res, 502, { error: "Bölge maç verisi alınamadı.", detail: error.message });
    }
    return;
  }

  if (url.pathname === "/api/rosters") {
    try {
      const payload = await getRosters(url.searchParams.get("refresh") === "1");
      jsonResponse(res, 200, payload);
    } catch (error) {
      jsonResponse(res, 502, { error: "Kadro verisi alınamadı.", detail: error.message });
    }
    return;
  }

  await serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`İstanbul Voleybol paneli: http://localhost:${PORT}`);
  console.log(`Veri kaynağı her ${Math.round(MAX_AGE_MS / 1000)} saniyede tazelenir.`);
});

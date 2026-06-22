import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const dataPath = process.argv[2] || "C:/tmp/puandurumu_detailed.json";
const outputPath = process.argv[3] || "C:/tmp/puandurumu_detayli.xlsx";
const previewDir = process.argv[4] || "C:/tmp/puandurumu_detayli_previews";

const K = Object.freeze({
  CINSIYET: "Cinsiyet",
  CINSIYET_KODU: "Cinsiyet Kodu",
  KATEGORI: "Kategori",
  KATEGORI_KODU: "Kategori Kodu",
  KUME: "K\u00fcme",
  KUME_KODU: "K\u00fcme Kodu",
  YARISMA: "Yar\u0131\u015fma",
  YARISMA_DEGERI: "Yar\u0131\u015fma De\u011feri",
  PUAN_TABLOSU_TAKIM_SAYISI: "Puan Tablosu Tak\u0131m Say\u0131s\u0131",
  PUAN_TABLOSU_KAYDI: "Puan Tablosu Kayd\u0131",
  YARISMA_SAYISI: "Yar\u0131\u015fma Say\u0131s\u0131",
  TAKIM_ADI: "Tak\u0131m Ad\u0131",
  TAKIM_SAYISI: "Tak\u0131m Say\u0131s\u0131",
  BENZERSIZ_TAKIM: "Benzersiz Tak\u0131m",
  MAC_SAYISI: "Ma\u00e7 Say\u0131s\u0131",
  TOPLAM_MAC: "Toplam Ma\u00e7",
  EV_SAHIBI: "Ev Sahibi (A)",
  EV_SAHIBI_SAYISI: "Ev Sahibi",
  MISAFIR: "Misafir (B)",
  MISAFIR_SAYISI: "Misafir",
  GALIBIYET: "Galibiyet",
  MAGLUBIYET: "Ma\u011flubiyet",
  SONUCSUZ_MAC: "Sonu\u00e7suz Ma\u00e7",
  SIRA: "S\u0131ra",
  SALON_ADI: "Salon Ad\u0131",
  SALON_SAYISI: "Salon Say\u0131s\u0131",
  SET_SONUCLARI: "Set Sonu\u00e7lar\u0131",
  KAZANAN: "Kazanan",
  KAYNAK_URL: "Kaynak URL",
  KATEGORILER: "Kategoriler",
  YARISMALAR: "Yar\u0131\u015fmalar",
  ALAN: "Alan",
  DEGER: "De\u011fer",
});

const payload = JSON.parse(await fs.readFile(dataPath, "utf8"));
const meta = payload.metadata;
const competitions = payload.competitions || [];
const standings = payload.standings || [];
const matches = payload.matches || [];
const teamSummaryFromStandings = payload.team_summary || [];
const errors = payload.errors || [];

function colName(index) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function rangeAddress(startRow, startCol, rows, cols) {
  return `${colName(startCol)}${startRow}:${colName(startCol + cols - 1)}${startRow + rows - 1}`;
}

function asMatrix(rows, headers) {
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
}

function numberOrText(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return value;
  const text = String(value).trim();
  if (!text || /^max$/i.test(text)) return text;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function pick(row, headers, numericHeaders = new Set()) {
  const out = {};
  for (const header of headers) {
    out[header] = numericHeaders.has(header) ? numberOrText(row[header]) : row[header] ?? "";
  }
  return out;
}

function parseDateTR(value) {
  const [day, month, year] = String(value || "").split(".").map(Number);
  if (!day || !month || !year) return new Date(0);
  return new Date(year, month - 1, day);
}

function addTitle(sheet, title, subtitle, lastCol) {
  sheet.showGridLines = false;
  const titleRange = sheet.getRange(`A1:${lastCol}1`);
  titleRange.merge();
  titleRange.values = [[title]];
  titleRange.format = {
    fill: "#17324D",
    font: { bold: true, color: "#FFFFFF", size: 16 },
    horizontalAlignment: "Center",
    verticalAlignment: "Center",
  };
  titleRange.format.rowHeightPx = 34;

  const subtitleRange = sheet.getRange(`A2:${lastCol}2`);
  subtitleRange.merge();
  subtitleRange.values = [[subtitle]];
  subtitleRange.format = {
    fill: "#EAF1F7",
    font: { color: "#17324D", size: 10 },
    horizontalAlignment: "Center",
    verticalAlignment: "Center",
    wrapText: true,
  };
  subtitleRange.format.rowHeightPx = 28;
}

function styleHeader(range) {
  range.format = {
    fill: "#C62828",
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "Center",
    verticalAlignment: "Center",
    wrapText: true,
  };
  range.format.rowHeightPx = 28;
}

function setWidths(sheet, widths) {
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidthPx = width;
  });
}

function addTable(sheet, startRow, headers, rows, tableName) {
  const range = rangeAddress(startRow, 0, rows.length + 1, headers.length);
  sheet.getRange(range).values = asMatrix(rows, headers);
  styleHeader(sheet.getRange(rangeAddress(startRow, 0, 1, headers.length)));
  const table = sheet.tables.add(range, true, tableName);
  table.showFilterButton = true;
  table.showBandedRows = true;
  return table;
}

function countBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function setJoin(values) {
  return [...values].filter(Boolean).sort((a, b) => a.localeCompare(b, "tr")).join(", ");
}

function addCategoryAggregate(map, keyParts, sourceRow, teamNames = []) {
  const key = keyParts.join("||");
  const row = map.get(key) || {
    [K.CINSIYET]: sourceRow[K.CINSIYET] || "",
    [K.KATEGORI]: sourceRow[K.KATEGORI] || "",
    [K.KUME]: sourceRow[K.KUME] || "",
    [K.YARISMA_SAYISI]: new Set(),
    [K.PUAN_TABLOSU_TAKIM_SAYISI]: 0,
    [K.MAC_SAYISI]: 0,
    [K.BENZERSIZ_TAKIM]: new Set(),
  };
  if (sourceRow[K.YARISMA]) row[K.YARISMA_SAYISI].add(sourceRow[K.YARISMA]);
  row[K.PUAN_TABLOSU_TAKIM_SAYISI] += Number(sourceRow[K.PUAN_TABLOSU_TAKIM_SAYISI] || 0);
  row[K.MAC_SAYISI] += Number(sourceRow[K.MAC_SAYISI] || 0);
  for (const team of teamNames) {
    if (team) row[K.BENZERSIZ_TAKIM].add(team);
  }
  map.set(key, row);
}

const standingsHeaders = [
  K.CINSIYET,
  K.KATEGORI,
  K.KUME,
  K.YARISMA,
  K.SIRA,
  K.TAKIM_ADI,
  "O",
  "G",
  "M",
  "A",
  "V",
  "P",
  "SAV",
  "ASP",
  "VSP",
  "SPAV",
  "3-0",
  "3-1",
  "3-2",
  "2-3",
  "1-3",
  "0-3",
  K.CINSIYET_KODU,
  K.KATEGORI_KODU,
  K.KUME_KODU,
  K.YARISMA_DEGERI,
  K.KAYNAK_URL,
];
const numericStandingHeaders = new Set([
  K.SIRA,
  "O",
  "G",
  "M",
  "A",
  "V",
  "P",
  "ASP",
  "VSP",
  "SPAV",
  "3-0",
  "3-1",
  "3-2",
  "2-3",
  "1-3",
  "0-3",
]);
const standingsRows = standings
  .map((row) => pick(row, standingsHeaders, numericStandingHeaders))
  .sort(
    (a, b) =>
      String(a[K.CINSIYET]).localeCompare(String(b[K.CINSIYET]), "tr") ||
      String(a[K.KATEGORI]).localeCompare(String(b[K.KATEGORI]), "tr") ||
      String(a[K.KUME]).localeCompare(String(b[K.KUME]), "tr") ||
      String(a[K.YARISMA]).localeCompare(String(b[K.YARISMA]), "tr") ||
      Number(a[K.SIRA] || 0) - Number(b[K.SIRA] || 0)
  );

const matchHeaders = [
  K.CINSIYET,
  K.KATEGORI,
  K.KUME,
  K.YARISMA,
  "S.No",
  "Tarih",
  "Saat",
  K.SALON_ADI,
  K.EV_SAHIBI,
  "Set A",
  "Set B",
  K.MISAFIR,
  K.SET_SONUCLARI,
  "Set 1 A",
  "Set 1 B",
  "Set 2 A",
  "Set 2 B",
  "Set 3 A",
  "Set 3 B",
  "Set 4 A",
  "Set 4 B",
  "Set 5 A",
  "Set 5 B",
  K.KAZANAN,
  K.CINSIYET_KODU,
  K.KATEGORI_KODU,
  K.KUME_KODU,
  K.YARISMA_DEGERI,
  K.KAYNAK_URL,
];
const numericMatchHeaders = new Set([
  "S.No",
  "Set A",
  "Set B",
  "Set 1 A",
  "Set 1 B",
  "Set 2 A",
  "Set 2 B",
  "Set 3 A",
  "Set 3 B",
  "Set 4 A",
  "Set 4 B",
  "Set 5 A",
  "Set 5 B",
]);
const matchRows = matches
  .map((row) => pick(row, matchHeaders, numericMatchHeaders))
  .sort(
    (a, b) =>
      parseDateTR(a.Tarih) - parseDateTR(b.Tarih) ||
      String(a.Saat).localeCompare(String(b.Saat), "tr") ||
      String(a[K.SALON_ADI]).localeCompare(String(b[K.SALON_ADI]), "tr")
  );

const competitionHeaders = [
  K.CINSIYET,
  K.CINSIYET_KODU,
  K.KATEGORI,
  K.KATEGORI_KODU,
  K.KUME,
  K.KUME_KODU,
  K.YARISMA,
  K.YARISMA_DEGERI,
  K.PUAN_TABLOSU_TAKIM_SAYISI,
  K.MAC_SAYISI,
];
const competitionRows = competitions
  .map((row) => pick(row, competitionHeaders, new Set([K.PUAN_TABLOSU_TAKIM_SAYISI, K.MAC_SAYISI])))
  .sort(
    (a, b) =>
      String(a[K.CINSIYET]).localeCompare(String(b[K.CINSIYET]), "tr") ||
      String(a[K.KATEGORI]).localeCompare(String(b[K.KATEGORI]), "tr") ||
      String(a[K.KUME]).localeCompare(String(b[K.KUME]), "tr") ||
      String(a[K.YARISMA]).localeCompare(String(b[K.YARISMA]), "tr")
  );

const hallRows = [...countBy(matches, (row) => row[K.SALON_ADI]).entries()]
  .map(([name, count]) => ({ [K.SALON_ADI]: name, [K.MAC_SAYISI]: count }))
  .sort((a, b) => b[K.MAC_SAYISI] - a[K.MAC_SAYISI] || a[K.SALON_ADI].localeCompare(b[K.SALON_ADI], "tr"));

const categoryMap = new Map();
for (const row of competitions) {
  addCategoryAggregate(categoryMap, [row[K.CINSIYET], row[K.KATEGORI], row[K.KUME]], row);
}
for (const row of standings) {
  addCategoryAggregate(categoryMap, [row[K.CINSIYET], row[K.KATEGORI], row[K.KUME]], row, [row[K.TAKIM_ADI]]);
}
for (const row of matches) {
  addCategoryAggregate(categoryMap, [row[K.CINSIYET], row[K.KATEGORI], row[K.KUME]], row, [
    row[K.EV_SAHIBI],
    row[K.MISAFIR],
  ]);
}
const categoryRows = [...categoryMap.values()]
  .map((row) => ({
    [K.CINSIYET]: row[K.CINSIYET],
    [K.KATEGORI]: row[K.KATEGORI],
    [K.KUME]: row[K.KUME],
    [K.YARISMA_SAYISI]: row[K.YARISMA_SAYISI].size,
    [K.PUAN_TABLOSU_TAKIM_SAYISI]: row[K.PUAN_TABLOSU_TAKIM_SAYISI],
    [K.MAC_SAYISI]: row[K.MAC_SAYISI],
    [K.BENZERSIZ_TAKIM]: row[K.BENZERSIZ_TAKIM].size,
  }))
  .sort(
    (a, b) =>
      String(a[K.CINSIYET]).localeCompare(String(b[K.CINSIYET]), "tr") ||
      String(a[K.KATEGORI]).localeCompare(String(b[K.KATEGORI]), "tr") ||
      String(a[K.KUME]).localeCompare(String(b[K.KUME]), "tr")
  );

const teams = new Map();
function ensureTeam(name) {
  if (!name) return null;
  const row =
    teams.get(name) ||
    {
      [K.TAKIM_ADI]: name,
      [K.PUAN_TABLOSU_KAYDI]: 0,
      [K.YARISMA_SAYISI]: new Set(),
      [K.CINSIYET]: new Set(),
      [K.KATEGORILER]: new Set(),
      [K.TOPLAM_MAC]: 0,
      [K.EV_SAHIBI_SAYISI]: 0,
      [K.MISAFIR_SAYISI]: 0,
      [K.GALIBIYET]: 0,
      [K.MAGLUBIYET]: 0,
      [K.SONUCSUZ_MAC]: 0,
      [K.SALON_SAYISI]: new Set(),
      [K.YARISMALAR]: new Set(),
    };
  teams.set(name, row);
  return row;
}
for (const row of standings) {
  const team = ensureTeam(row[K.TAKIM_ADI]);
  if (!team) continue;
  team[K.PUAN_TABLOSU_KAYDI] += 1;
  team[K.YARISMA_SAYISI].add(row[K.YARISMA]);
  team[K.CINSIYET].add(row[K.CINSIYET]);
  team[K.KATEGORILER].add(row[K.KATEGORI]);
  team[K.YARISMALAR].add(row[K.YARISMA]);
}
for (const row of teamSummaryFromStandings) {
  const team = ensureTeam(row[K.TAKIM_ADI]);
  if (!team) continue;
  if (team[K.PUAN_TABLOSU_KAYDI] === 0) {
    team[K.PUAN_TABLOSU_KAYDI] = Number(row[K.PUAN_TABLOSU_KAYDI] || 0);
  }
}
for (const row of matches) {
  const home = ensureTeam(row[K.EV_SAHIBI]);
  const away = ensureTeam(row[K.MISAFIR]);
  const scoreA = Number(row["Set A"]);
  const scoreB = Number(row["Set B"]);
  const hasScore = Number.isFinite(scoreA) && Number.isFinite(scoreB);
  const winner = row[K.KAZANAN] || "";
  for (const team of [home, away]) {
    if (!team) continue;
    team[K.TOPLAM_MAC] += 1;
    team[K.YARISMA_SAYISI].add(row[K.YARISMA]);
    team[K.CINSIYET].add(row[K.CINSIYET]);
    team[K.KATEGORILER].add(row[K.KATEGORI]);
    team[K.YARISMALAR].add(row[K.YARISMA]);
    if (row[K.SALON_ADI]) team[K.SALON_SAYISI].add(row[K.SALON_ADI]);
    if (!hasScore || !winner) team[K.SONUCSUZ_MAC] += 1;
  }
  if (home) {
    home[K.EV_SAHIBI_SAYISI] += 1;
    if (hasScore && winner) {
      if (winner === row[K.EV_SAHIBI]) home[K.GALIBIYET] += 1;
      else home[K.MAGLUBIYET] += 1;
    }
  }
  if (away) {
    away[K.MISAFIR_SAYISI] += 1;
    if (hasScore && winner) {
      if (winner === row[K.MISAFIR]) away[K.GALIBIYET] += 1;
      else away[K.MAGLUBIYET] += 1;
    }
  }
}
const teamRows = [...teams.values()]
  .map((row) => ({
    [K.TAKIM_ADI]: row[K.TAKIM_ADI],
    [K.PUAN_TABLOSU_KAYDI]: row[K.PUAN_TABLOSU_KAYDI],
    [K.YARISMA_SAYISI]: row[K.YARISMA_SAYISI].size,
    [K.TOPLAM_MAC]: row[K.TOPLAM_MAC],
    [K.EV_SAHIBI_SAYISI]: row[K.EV_SAHIBI_SAYISI],
    [K.MISAFIR_SAYISI]: row[K.MISAFIR_SAYISI],
    [K.GALIBIYET]: row[K.GALIBIYET],
    [K.MAGLUBIYET]: row[K.MAGLUBIYET],
    [K.SONUCSUZ_MAC]: row[K.SONUCSUZ_MAC],
    [K.CINSIYET]: setJoin(row[K.CINSIYET]),
    [K.KATEGORILER]: setJoin(row[K.KATEGORILER]),
    [K.SALON_SAYISI]: row[K.SALON_SAYISI].size,
    [K.YARISMALAR]: setJoin(row[K.YARISMALAR]),
  }))
  .sort((a, b) => a[K.TAKIM_ADI].localeCompare(b[K.TAKIM_ADI], "tr"));

const sourceRows = [
  { [K.ALAN]: "Kaynak URL", [K.DEGER]: meta.source_url },
  { [K.ALAN]: "Veri \u00e7ekim zaman\u0131", [K.DEGER]: meta.scraped_at },
  { [K.ALAN]: "Yar\u0131\u015fma say\u0131s\u0131", [K.DEGER]: meta.competition_count },
  { [K.ALAN]: "Puan tablosu sat\u0131r\u0131", [K.DEGER]: meta.standing_row_count },
  { [K.ALAN]: "Ma\u00e7/sonu\u00e7 sat\u0131r\u0131", [K.DEGER]: meta.match_row_count },
  { [K.ALAN]: "Tak\u0131m say\u0131s\u0131", [K.DEGER]: meta.team_count },
  { [K.ALAN]: "Hata say\u0131s\u0131", [K.DEGER]: meta.error_count },
  {
    [K.ALAN]: "Not",
    [K.DEGER]:
      "Puan tablolar\u0131 ve ma\u00e7 sonu\u00e7lar\u0131 PuanDurumu sayfas\u0131ndaki resmi se\u00e7im zinciri \u00fczerinden taranm\u0131\u015ft\u0131r.",
  },
];
const errorRows = errors.length
  ? errors.map((row) => ({ Kapsam: row.scope || "", Hata: row.error || "" }))
  : [{ Kapsam: "Genel", Hata: "Hata yok" }];

const workbook = Workbook.create();

const overview = workbook.worksheets.add("Ozet");
addTitle(
  overview,
  "\u0130stanbul Voleybol Puan Durumu 2025-2026",
  `${meta.source_url} | \u00c7ekim: ${meta.scraped_at}`,
  "H"
);
const overviewRows = [
  { Metrik: "Yar\u0131\u015fma say\u0131s\u0131", [K.DEGER]: meta.competition_count },
  { Metrik: "Puan tablosu sat\u0131r\u0131", [K.DEGER]: meta.standing_row_count },
  { Metrik: "Ma\u00e7/sonu\u00e7 sat\u0131r\u0131", [K.DEGER]: meta.match_row_count },
  { Metrik: "Benzersiz tak\u0131m", [K.DEGER]: meta.team_count },
  { Metrik: "Salon say\u0131s\u0131", [K.DEGER]: hallRows.length },
  { Metrik: "Kategori/k\u00fcme sat\u0131r\u0131", [K.DEGER]: categoryRows.length },
  { Metrik: "Hata say\u0131s\u0131", [K.DEGER]: meta.error_count },
];
addTable(overview, 4, ["Metrik", K.DEGER], overviewRows, "OzetMetrikler");
overview.getRange("D4:H4").values = [["En Yo\u011fun Salonlar", K.MAC_SAYISI, "", "En Yo\u011fun Tak\u0131mlar", K.TOPLAM_MAC]];
styleHeader(overview.getRange("D4:H4"));
const topHalls = hallRows.slice(0, 10);
overview.getRange(`D5:E${4 + topHalls.length}`).values = topHalls.map((row) => [row[K.SALON_ADI], row[K.MAC_SAYISI]]);
const topTeams = [...teamRows]
  .sort((a, b) => b[K.TOPLAM_MAC] - a[K.TOPLAM_MAC] || a[K.TAKIM_ADI].localeCompare(b[K.TAKIM_ADI], "tr"))
  .slice(0, 10);
overview.getRange(`G5:H${4 + topTeams.length}`).values = topTeams.map((row) => [row[K.TAKIM_ADI], row[K.TOPLAM_MAC]]);
setWidths(overview, [230, 120, 30, 270, 100, 30, 270, 100]);
overview.freezePanes.freezeRows(4);

const competitionSheet = workbook.worksheets.add("Yarismalar");
addTitle(competitionSheet, "Yar\u0131\u015fmalar", "Sitedeki t\u00fcm yar\u0131\u015fma se\u00e7enekleri ve sat\u0131r say\u0131lar\u0131.", "J");
addTable(competitionSheet, 4, competitionHeaders, competitionRows, "Yarismalar");
setWidths(competitionSheet, [95, 95, 130, 105, 250, 95, 320, 310, 120, 95]);
competitionSheet.freezePanes.freezeRows(4);

const standingsSheet = workbook.worksheets.add("Puan Tablosu");
addTitle(standingsSheet, "Puan Tablosu", "Tak\u0131m baz\u0131nda puan durumu ve set istatistikleri.", colName(standingsHeaders.length - 1));
addTable(standingsSheet, 4, standingsHeaders, standingsRows, "PuanTablosu");
setWidths(standingsSheet, [
  90, 125, 220, 290, 60, 245, 48, 48, 48, 48, 48, 55, 70, 65, 65, 70, 48, 48, 48,
  48, 48, 48, 95, 105, 95, 310, 330,
]);
standingsSheet.getRange(`F5:F${standingsRows.length + 4}`).format = { font: { bold: true, color: "#17324D" } };
standingsSheet.freezePanes.freezeRows(4);

const matchSheet = workbook.worksheets.add("Mac Sonuclari");
addTitle(matchSheet, "Ma\u00e7 Sonu\u00e7lar\u0131", "PuanDurumu sayfas\u0131nda listelenen ma\u00e7lar, set skorlar\u0131 ve kazanan tak\u0131m.", colName(matchHeaders.length - 1));
addTable(matchSheet, 4, matchHeaders, matchRows, "MacSonuclari");
setWidths(matchSheet, [
  90, 125, 220, 290, 55, 95, 65, 220, 245, 55, 55, 245, 210, 65, 65, 65, 65, 65,
  65, 65, 65, 65, 65, 245, 95, 105, 95, 310, 330,
]);
matchSheet.getRange(`F5:F${matchRows.length + 4}`).setNumberFormat("@");
matchSheet.freezePanes.freezeRows(4);

const teamSheet = workbook.worksheets.add("Takim Ozet");
const teamHeaders = [
  K.TAKIM_ADI,
  K.PUAN_TABLOSU_KAYDI,
  K.YARISMA_SAYISI,
  K.TOPLAM_MAC,
  K.EV_SAHIBI_SAYISI,
  K.MISAFIR_SAYISI,
  K.GALIBIYET,
  K.MAGLUBIYET,
  K.SONUCSUZ_MAC,
  K.CINSIYET,
  K.KATEGORILER,
  K.SALON_SAYISI,
  K.YARISMALAR,
];
addTitle(teamSheet, "Tak\u0131m \u00d6zeti", "Tak\u0131mlar\u0131n kat\u0131ld\u0131\u011f\u0131 kategoriler, yar\u0131\u015fmalar ve ma\u00e7 performans\u0131.", colName(teamHeaders.length - 1));
addTable(teamSheet, 4, teamHeaders, teamRows, "TakimOzet");
setWidths(teamSheet, [260, 105, 105, 95, 80, 80, 80, 85, 95, 100, 360, 95, 520]);
teamSheet.getRange(`K5:M${teamRows.length + 4}`).format = { wrapText: true };
teamSheet.freezePanes.freezeRows(4);

const categorySheet = workbook.worksheets.add("Kategori Ozet");
const categoryHeaders = [
  K.CINSIYET,
  K.KATEGORI,
  K.KUME,
  K.YARISMA_SAYISI,
  K.PUAN_TABLOSU_TAKIM_SAYISI,
  K.MAC_SAYISI,
  K.BENZERSIZ_TAKIM,
];
addTitle(categorySheet, "Kategori \u00d6zeti", "Cinsiyet, kategori ve k\u00fcme k\u0131r\u0131l\u0131m\u0131nda yar\u0131\u015fma, tak\u0131m ve ma\u00e7 say\u0131lar\u0131.", "G");
addTable(categorySheet, 4, categoryHeaders, categoryRows, "KategoriOzet");
setWidths(categorySheet, [95, 130, 260, 105, 135, 95, 110]);
categorySheet.freezePanes.freezeRows(4);

const hallSheet = workbook.worksheets.add("Salon Ozet");
addTitle(hallSheet, "Salon \u00d6zeti", "Salon baz\u0131nda ma\u00e7 say\u0131lar\u0131.", "B");
addTable(hallSheet, 4, [K.SALON_ADI, K.MAC_SAYISI], hallRows, "SalonOzet");
setWidths(hallSheet, [320, 95]);
hallSheet.freezePanes.freezeRows(4);

const sourceSheet = workbook.worksheets.add("Kaynak");
addTitle(sourceSheet, "Kaynak", "Veri kayna\u011f\u0131, kapsam ve hata bilgisi.", "B");
addTable(sourceSheet, 4, [K.ALAN, K.DEGER], sourceRows, "KaynakBilgisi");
sourceSheet.getRange(`B5:B${sourceRows.length + 4}`).format = { wrapText: true };
setWidths(sourceSheet, [210, 720]);

const errorSheet = workbook.worksheets.add("Hatalar");
addTitle(errorSheet, "Hatalar", "Tarama s\u0131ras\u0131nda yakalanan hatalar.", "B");
addTable(errorSheet, 4, ["Kapsam", "Hata"], errorRows, "TaramaHatalari");
setWidths(errorSheet, [450, 520]);

await fs.mkdir(previewDir, { recursive: true });
const previews = {
  Ozet: "A1:H18",
  Yarismalar: "A1:J35",
  "Puan Tablosu": "A1:AA35",
  "Mac Sonuclari": "A1:AC35",
  "Takim Ozet": "A1:M35",
  "Kategori Ozet": "A1:G35",
  "Salon Ozet": "A1:B35",
  Kaynak: "A1:B16",
  Hatalar: "A1:B10",
};
for (const [sheetName, range] of Object.entries(previews)) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(path.join(previewDir, `${sheetName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const errorsScan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
const keyInspect = await workbook.inspect({
  kind: "table",
  range: "Ozet!A4:B11",
  include: "values",
  tableMaxRows: 8,
  tableMaxCols: 2,
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(
  JSON.stringify(
    {
      outputPath,
      competitionCount: meta.competition_count,
      standingRowCount: meta.standing_row_count,
      matchRowCount: meta.match_row_count,
      teamCount: meta.team_count,
      sheets: Object.keys(previews),
      errorScan: errorsScan.ndjson,
      keyInspect: keyInspect.ndjson,
    },
    null,
    2
  )
);

import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const dataPath = process.argv[2] || "C:/tmp/fiksturler_2025_2026_all.json";
const outputPath = process.argv[3] || "C:/tmp/fiksturler_2025_2026.xlsx";
const previewDir = process.argv[4] || "C:/tmp/fiksturler_2025_2026_previews";

const payload = JSON.parse(await fs.readFile(dataPath, "utf8"));
const meta = payload.metadata;
const fixtures = payload.fixtures;

const headers = [
  "Sıra",
  "Sezon",
  "Tarih",
  "Saat",
  "Salon Adı",
  "Ev Sahibi (A)",
  "Misafir (B)",
  "Cinsiyet Kodu",
  "Cinsiyet",
  "Küme",
  "Kategori Kodu",
  "Kategori",
  "Tür",
  "Grup",
  "Devre",
  "TV",
  "Hafta",
  "Sayfa",
  "Sayfa Sırası",
  "Kaynak URL",
];

function parseDateTR(value) {
  const [day, month, year] = String(value || "").split(".").map(Number);
  if (!day || !month || !year) return value || "";
  return new Date(year, month - 1, day);
}

function dateKey(value) {
  return String(value || "");
}

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

function asMatrix(rows, columns) {
  return [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ""))];
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
  };
  subtitleRange.format.rowHeightPx = 24;
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

function addTable(sheet, startRow, columns, rows, tableName) {
  const range = rangeAddress(startRow, 0, rows.length + 1, columns.length);
  sheet.getRange(range).values = asMatrix(rows, columns);
  styleHeader(sheet.getRange(rangeAddress(startRow, 0, 1, columns.length)));
  const table = sheet.tables.add(range, true, tableName);
  table.showFilterButton = true;
  table.showBandedRows = true;
  return table;
}

function setWidths(sheet, widths) {
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidthPx = width;
  });
}

function countBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function sortedRowsFromMap(map, columns) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "tr"))
    .map(([name, count]) => ({ [columns[0]]: name, [columns[1]]: count }));
}

const normalizedFixtures = fixtures.map((row) => ({ ...row }));

const byDate = new Map();
const byHall = countBy(fixtures, (row) => row["Salon Adı"] || "Belirtilmemiş");
const byCategory = new Map();
const byTeam = new Map();

for (const row of fixtures) {
  const dKey = dateKey(row.Tarih);
  const daily = byDate.get(dKey) || {
    Tarih: row.Tarih,
    "Maç Sayısı": 0,
    "Salon Sayısı": new Set(),
    "Takım Sayısı": new Set(),
    "İlk Saat": row.Saat || "",
    "Son Saat": row.Saat || "",
  };
  daily["Maç Sayısı"] += 1;
  if (row["Salon Adı"]) daily["Salon Sayısı"].add(row["Salon Adı"]);
  if (row["Ev Sahibi (A)"]) daily["Takım Sayısı"].add(row["Ev Sahibi (A)"]);
  if (row["Misafir (B)"]) daily["Takım Sayısı"].add(row["Misafir (B)"]);
  if (row.Saat && (!daily["İlk Saat"] || row.Saat < daily["İlk Saat"])) daily["İlk Saat"] = row.Saat;
  if (row.Saat && (!daily["Son Saat"] || row.Saat > daily["Son Saat"])) daily["Son Saat"] = row.Saat;
  byDate.set(dKey, daily);

  const categoryKey = [
    row.Cinsiyet,
    row["Kategori Kodu"],
    row.Kategori,
    row.Küme,
    row.Tür,
    row.Grup,
  ].join("||");
  const category = byCategory.get(categoryKey) || {
    Cinsiyet: row.Cinsiyet,
    "Kategori Kodu": row["Kategori Kodu"],
    Kategori: row.Kategori,
    Küme: row.Küme,
    Tür: row.Tür,
    Grup: row.Grup,
    "Maç Sayısı": 0,
  };
  category["Maç Sayısı"] += 1;
  byCategory.set(categoryKey, category);

  for (const side of ["Ev Sahibi (A)", "Misafir (B)"]) {
    const teamName = row[side];
    if (!teamName) continue;
    const team = byTeam.get(teamName) || {
      "Takım Adı": teamName,
      "Toplam Maç": 0,
      "Ev Sahibi": 0,
      Misafir: 0,
      Kategoriler: new Set(),
      Salonlar: new Set(),
    };
    team["Toplam Maç"] += 1;
    team[side === "Ev Sahibi (A)" ? "Ev Sahibi" : "Misafir"] += 1;
    if (row.Kategori) team.Kategoriler.add(row.Kategori);
    if (row["Salon Adı"]) team.Salonlar.add(row["Salon Adı"]);
    byTeam.set(teamName, team);
  }
}

const dailyRows = [...byDate.values()]
  .sort((a, b) => parseDateTR(a.Tarih) - parseDateTR(b.Tarih))
  .map((row) => ({
    Tarih: typeof row.Tarih === "string" ? row.Tarih : "",
    "Maç Sayısı": row["Maç Sayısı"],
    "Salon Sayısı": row["Salon Sayısı"].size,
    "Takım Sayısı": row["Takım Sayısı"].size,
    "İlk Saat": row["İlk Saat"],
    "Son Saat": row["Son Saat"],
  }));

const hallRows = sortedRowsFromMap(byHall, ["Salon Adı", "Maç Sayısı"]);

const categoryRows = [...byCategory.values()].sort(
  (a, b) =>
    String(a.Cinsiyet).localeCompare(String(b.Cinsiyet), "tr") ||
    String(a.Kategori).localeCompare(String(b.Kategori), "tr") ||
    String(a.Küme).localeCompare(String(b.Küme), "tr") ||
    String(a.Grup).localeCompare(String(b.Grup), "tr")
);

const teamRows = [...byTeam.values()]
  .map((row) => ({
    "Takım Adı": row["Takım Adı"],
    "Toplam Maç": row["Toplam Maç"],
    "Ev Sahibi": row["Ev Sahibi"],
    Misafir: row.Misafir,
    Kategoriler: [...row.Kategoriler].sort((a, b) => a.localeCompare(b, "tr")).join(", "),
    "Salon Sayısı": row.Salonlar.size,
  }))
  .sort((a, b) => b["Toplam Maç"] - a["Toplam Maç"] || a["Takım Adı"].localeCompare(b["Takım Adı"], "tr"));

const sourceRows = [
  { Alan: "Kaynak URL", Değer: meta.source_url },
  { Alan: "Sezon", Değer: meta.season },
  { Alan: "Başlangıç", Değer: meta.start_date },
  { Alan: "Bitiş", Değer: meta.end_date },
  { Alan: "Veri çekim zamanı", Değer: meta.scraped_at },
  { Alan: "Sitedeki kayıt sayısı", Değer: meta.site_record_count },
  { Alan: "Çekilen kayıt sayısı", Değer: meta.parsed_record_count },
  { Alan: "Sayfa sayısı", Değer: meta.page_count },
  { Alan: "Benzersiz takım sayısı", Değer: meta.unique_team_count },
];

const workbook = Workbook.create();

const overview = workbook.worksheets.add("Ozet");
addTitle(
  overview,
  "İstanbul Voleybol Fikstürleri 2025-2026",
  `${meta.source_url} | ${meta.start_date} - ${meta.end_date} | Çekim: ${meta.scraped_at}`,
  "H"
);
const overviewRows = [
  { Metrik: "Toplam maç", Değer: meta.parsed_record_count },
  { Metrik: "Sitedeki kayıt sayısı", Değer: meta.site_record_count },
  { Metrik: "Benzersiz takım", Değer: meta.unique_team_count },
  { Metrik: "Salon sayısı", Değer: byHall.size },
  { Metrik: "Gün sayısı", Değer: byDate.size },
  { Metrik: "Kategori/küme kombinasyonu", Değer: byCategory.size },
];
addTable(overview, 4, ["Metrik", "Değer"], overviewRows, "OzetMetrikler");
overview.getRange("D4:H4").values = [["En Yoğun Salonlar", "Maç Sayısı", "", "En Yoğun Takımlar", "Toplam Maç"]];
styleHeader(overview.getRange("D4:H4"));
const topHalls = hallRows.slice(0, 10);
overview.getRange(`D5:E${4 + topHalls.length}`).values = topHalls.map((row) => [row["Salon Adı"], row["Maç Sayısı"]]);
const topTeams = teamRows.slice(0, 10);
overview.getRange(`G5:H${4 + topTeams.length}`).values = topTeams.map((row) => [row["Takım Adı"], row["Toplam Maç"]]);
setWidths(overview, [230, 120, 30, 260, 100, 30, 260, 100]);
overview.freezePanes.freezeRows(4);

const games = workbook.worksheets.add("Maclar");
addTitle(games, "Tüm Maçlar", "2025-2026 sezonu için Fiksturler sayfasından çekilen tüm kayıtlar.", "T");
addTable(games, 4, headers, normalizedFixtures, "TumMaclar");
setWidths(games, [60, 90, 95, 70, 230, 220, 220, 95, 95, 85, 100, 125, 70, 65, 70, 55, 60, 60, 90, 330]);
games.getRange(`C5:C${normalizedFixtures.length + 4}`).setNumberFormat("@");
games.freezePanes.freezeRows(4);

const daily = workbook.worksheets.add("Gunluk Ozet");
addTitle(daily, "Günlük Özet", "Gün bazında maç, salon ve takım yoğunluğu.", "F");
addTable(daily, 4, ["Tarih", "Maç Sayısı", "Salon Sayısı", "Takım Sayısı", "İlk Saat", "Son Saat"], dailyRows, "GunlukOzet");
daily.getRange(`A5:A${dailyRows.length + 4}`).setNumberFormat("@");
setWidths(daily, [110, 95, 95, 95, 80, 80]);
daily.freezePanes.freezeRows(4);

const halls = workbook.worksheets.add("Salon Ozet");
addTitle(halls, "Salon Özeti", "Salon bazında maç sayıları.", "B");
addTable(halls, 4, ["Salon Adı", "Maç Sayısı"], hallRows, "SalonOzet");
setWidths(halls, [320, 100]);
halls.freezePanes.freezeRows(4);

const categories = workbook.worksheets.add("Kategori Ozet");
addTitle(categories, "Kategori Özeti", "Cinsiyet, kategori, küme, tür ve grup kırılımında maç sayıları.", "G");
addTable(categories, 4, ["Cinsiyet", "Kategori Kodu", "Kategori", "Küme", "Tür", "Grup", "Maç Sayısı"], categoryRows, "KategoriOzet");
setWidths(categories, [95, 105, 130, 110, 70, 70, 95]);
categories.freezePanes.freezeRows(4);

const teams = workbook.worksheets.add("Takim Ozet");
addTitle(teams, "Takım Özeti", "Takım bazında ev sahibi, misafir ve kategori bilgileri.", "F");
addTable(teams, 4, ["Takım Adı", "Toplam Maç", "Ev Sahibi", "Misafir", "Kategoriler", "Salon Sayısı"], teamRows, "TakimOzet");
setWidths(teams, [260, 95, 90, 90, 360, 95]);
teams.getRange(`E5:E${teamRows.length + 4}`).format = { wrapText: true };
teams.freezePanes.freezeRows(4);

const source = workbook.worksheets.add("Kaynak");
addTitle(source, "Kaynak", "Veri kaynağı ve çekim kapsamı.", "B");
addTable(source, 4, ["Alan", "Değer"], sourceRows, "KaynakBilgisi");
setWidths(source, [210, 620]);
source.getRange(`B5:B${sourceRows.length + 4}`).format = { wrapText: true };

await fs.mkdir(previewDir, { recursive: true });
const previews = {
  Ozet: "A1:H18",
  Maclar: "A1:T35",
  "Gunluk Ozet": "A1:F35",
  "Salon Ozet": "A1:B35",
  "Kategori Ozet": "A1:G35",
  "Takim Ozet": "A1:F35",
  Kaynak: "A1:B16",
};
for (const [sheetName, range] of Object.entries(previews)) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(path.join(previewDir, `${sheetName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
const keyInspect = await workbook.inspect({
  kind: "table",
  range: "Ozet!A4:B10",
  include: "values",
  tableMaxRows: 10,
  tableMaxCols: 2,
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(
  JSON.stringify(
    {
      outputPath,
      recordCount: meta.parsed_record_count,
      siteRecordCount: meta.site_record_count,
      uniqueTeamCount: meta.unique_team_count,
      sheets: Object.keys(previews),
      errorScan: errors.ndjson,
      keyInspect: keyInspect.ndjson,
    },
    null,
    2
  )
);

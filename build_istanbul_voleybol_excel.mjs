import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const dataPath = process.argv[2] || "C:/tmp/istanbul_voleybol_data.json";
const outputPath =
  process.argv[3] || "C:/tmp/istanbul_voleybol_takim_kategorileri.xlsx";
const previewDir = process.argv[4] || "C:/tmp/istanbul_voleybol_previews";

const raw = await fs.readFile(dataPath, "utf8");
const data = JSON.parse(raw);

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

function tableRange(startRow, startCol, rows, cols) {
  const first = `${colName(startCol)}${startRow}`;
  const last = `${colName(startCol + cols - 1)}${startRow + rows - 1}`;
  return `${first}:${last}`;
}

function asMatrix(rows, headers) {
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
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

function setWidths(sheet, widths) {
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidthPx = width;
  });
}

function addTable(sheet, startRow, headers, rows, tableName) {
  const range = tableRange(startRow, 0, rows.length + 1, headers.length);
  sheet.getRange(range).values = asMatrix(rows, headers);
  styleHeader(sheet.getRange(tableRange(startRow, 0, 1, headers.length)));
  const table = sheet.tables.add(range, true, tableName);
  table.showFilterButton = true;
  table.showBandedRows = true;
  return table;
}

const workbook = Workbook.create();

const meta = data.metadata;
const summaryRows = data.summary;
const detailRows = data.details;
const competitionRows = data.competitions;
const sourceRows = [
  { Alan: "Kaynak URL", Deger: meta.source_url },
  { Alan: "Veri çekim zamanı", Deger: meta.scraped_at },
  { Alan: "Takım sayısı", Deger: meta.team_count },
  { Alan: "Takım-yarışma satırı", Deger: meta.detail_row_count },
  { Alan: "Yarışma sayısı", Deger: meta.competition_count },
  { Alan: "Hata sayısı", Deger: meta.error_count },
  {
    Alan: "Not",
    Deger:
      "Takım-kategori eşleşmeleri PuanDurumu sayfasındaki resmi puan tablolarından çıkarılmıştır.",
  },
];

const summary = workbook.worksheets.add("Ozet");
addTitle(
  summary,
  "Istanbul Voleybol Takim-Kategori Eslesmesi",
  `Kaynak: ${meta.source_url} | Veri cekim zamani: ${meta.scraped_at}`,
  "F"
);
summary.getRange("A4:F4").values = [[
  "Takim Sayisi",
  meta.team_count,
  "Kategori/Yarisma Detay Satiri",
  meta.detail_row_count,
  "Yarisma Sayisi",
  meta.competition_count,
]];
summary.getRange("A4:F4").format = {
  fill: "#F4F7FA",
  font: { bold: true, color: "#17324D" },
  horizontalAlignment: "Center",
};
summary.getRange("A4:F4").format.rowHeightPx = 28;
const summaryHeaders = [
  "Takım Adı",
  "Kategori Sayısı",
  "Yarışma Sayısı",
  "Cinsiyet",
  "Kategoriler",
  "Yarışmalar",
];
addTable(summary, 6, summaryHeaders, summaryRows, "TakimKategoriOzet");
setWidths(summary, [210, 95, 135, 110, 270, 520]);
summary.getRange(`A7:A${summaryRows.length + 6}`).format = {
  font: { bold: true, color: "#17324D" },
};
summary.getRange(`E7:F${summaryRows.length + 6}`).format = { wrapText: true };
summary.freezePanes.freezeRows(6);

const details = workbook.worksheets.add("Detay");
addTitle(
  details,
  "Takim-Yarisma Detaylari",
  "Her satir bir takim ve katildigi yarisma/puan tablosu eslesmesini gosterir.",
  "Y"
);
const detailHeaders = [
  "Takım Adı",
  "Cinsiyet",
  "Kategori",
  "Küme",
  "Yarışma",
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
  "Kategori Kodu",
  "Küme Kodu",
  "Yarışma Değeri",
  "Kaynak URL",
];
addTable(details, 4, detailHeaders, detailRows, "TakimYarismaDetay");
setWidths(details, [
  220, 90, 130, 210, 290, 48, 48, 48, 48, 48, 60, 70, 60, 60, 70, 48, 48, 48,
  48, 48, 48, 90, 90, 250, 330,
]);
details.getRange(`A5:A${detailRows.length + 4}`).format = {
  font: { bold: true, color: "#17324D" },
};
details.getRange(`E5:E${detailRows.length + 4}`).format = { wrapText: true };
details.freezePanes.freezeRows(4);

const competitions = workbook.worksheets.add("Yarismalar");
addTitle(
  competitions,
  "Yarisma Listesi",
  "Siteden okunan tum yarisma secenekleri ve puan tablosunda bulunan takim sayilari.",
  "I"
);
const competitionHeaders = [
  "Cinsiyet",
  "Cinsiyet Kodu",
  "Kategori",
  "Kategori Kodu",
  "Küme",
  "Küme Kodu",
  "Yarışma",
  "Yarışma Değeri",
  "Takım Sayısı",
];
addTable(competitions, 4, competitionHeaders, competitionRows, "YarismaListesi");
setWidths(competitions, [90, 90, 130, 105, 240, 90, 300, 290, 90]);
competitions.freezePanes.freezeRows(4);

const source = workbook.worksheets.add("Kaynak");
addTitle(source, "Kaynak ve Notlar", "Veri izi ve kapsam bilgisi.", "B");
addTable(source, 4, ["Alan", "Deger"], sourceRows, "KaynakNotlar");
setWidths(source, [190, 760]);
source.getRange(`B5:B${sourceRows.length + 4}`).format = { wrapText: true };

await fs.mkdir(previewDir, { recursive: true });
const previewRanges = {
  Ozet: "A1:F25",
  Detay: "A1:Y35",
  Yarismalar: "A1:I35",
  Kaynak: "A1:B15",
};
for (const [sheetName, range] of Object.entries(previewRanges)) {
  const preview = await workbook.render({
    sheetName,
    range,
    scale: 1,
    format: "png",
  });
  await fs.writeFile(
    path.join(previewDir, `${sheetName}.png`),
    new Uint8Array(await preview.arrayBuffer())
  );
}

const errorScan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});

const keyInspect = await workbook.inspect({
  kind: "table",
  range: "Ozet!A6:F16",
  include: "values",
  tableMaxRows: 12,
  tableMaxCols: 6,
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(
  JSON.stringify(
    {
      outputPath,
      previewDir,
      teamCount: meta.team_count,
      detailRows: meta.detail_row_count,
      competitions: meta.competition_count,
      errorScan: errorScan.ndjson,
      keyInspect: keyInspect.ndjson,
    },
    null,
    2
  )
);

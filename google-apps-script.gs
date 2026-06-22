const SHEET_NAME = "Basvurular";

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const payload = JSON.parse(e.postData.contents);

  sheet.appendRow([
    new Date(),
    payload.parentName || "",
    payload.phone || "",
    payload.childName || "",
    payload.age || "",
    payload.sport || "",
    payload.district || "",
    payload.preferredDay || "",
    payload.note || "",
    payload.status || "Yeni",
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

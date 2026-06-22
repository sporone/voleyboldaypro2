import html
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime


BASE_URL = "https://istanbul.voleyboliltemsilciligi.com/Fiksturler"
START_DATE = "01.09.2025"
END_DATE = "31.08.2026"
SEASON = "2025-2026"
USER_AGENT = "Mozilla/5.0"


GENDER_MAP = {
    "B": "Kadın",
    "E": "Erkek",
}

CATEGORY_MAP = {
    "BB": "Büyük Kadın",
    "BE": "Büyük Erkek",
    "GK": "Genç Kız",
    "GE": "Genç Erkek",
    "KK": "Küçük Kız",
    "KE": "Küçük Erkek",
    "MdK": "Midi Kız",
    "MdE": "Midi Erkek",
    "MnK": "Mini Kız",
    "MnE": "Mini Erkek",
    "YK": "Yıldız Kız",
    "YE": "Yıldız Erkek",
}


def clean_text(value):
    value = html.unescape(value or "")
    value = re.sub(r"<script[\s\S]*?</script>", " ", value)
    value = re.sub(r"<style[\s\S]*?</style>", " ", value)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def request_text(opener, data=None):
    headers = {"User-Agent": USER_AGENT}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        headers["Referer"] = BASE_URL
    req = urllib.request.Request(BASE_URL, data=data, headers=headers)
    with opener.open(req, timeout=60) as response:
        return response.read().decode("utf-8", "replace")


def hidden_value(page, name):
    match = re.search(
        r'name="' + re.escape(name) + r'"[^>]*value="([^"]*)"', page
    )
    return html.unescape(match.group(1)) if match else ""


def postback(opener, page, event_target, values):
    fields = {
        "__EVENTTARGET": event_target,
        "__EVENTARGUMENT": "",
        "__LASTFOCUS": "",
        "__VIEWSTATE": hidden_value(page, "__VIEWSTATE"),
        "__VIEWSTATEGENERATOR": hidden_value(page, "__VIEWSTATEGENERATOR"),
        "__VIEWSTATEENCRYPTED": hidden_value(page, "__VIEWSTATEENCRYPTED"),
        "ctl00$icerik$ddlSil": "34",
        "ctl00$icerik$ddlsezon": SEASON,
        "ctl00$icerik$txttarih": "",
        "ctl00$icerik$txtbitistrh": "",
        "ctl00$icerik$ddlsbe": "0",
        "ctl00$icerik$ddlskategori": "0",
        "ctl00$icerik$ddlskume": "-1",
        "ctl00$icerik$ddlsturu": "0",
        "ctl00$icerik$ddlsgrubu": "0",
        "ctl00$icerik$ddlskurumadi": "0",
        "ctl00$icerik$ddlstakim": "0",
        "ctl00$icerik$ddlsyarismaadi": "0",
    }
    fields.update(values)
    return request_text(opener, urllib.parse.urlencode(fields).encode("utf-8"))


def parse_table(page):
    match = re.search(r'<table[^>]*id="icerik_gvliste"[\s\S]*?</table>', page)
    if not match:
        return [], []

    rows = []
    for row_html in re.findall(r"<tr[^>]*>([\s\S]*?)</tr>", match.group(0)):
        cells = [
            clean_text(cell)
            for cell in re.findall(r"<t[hd][^>]*>([\s\S]*?)</t[hd]>", row_html)
        ]
        if cells:
            rows.append(cells)

    if not rows:
        return [], []

    headers = rows[0]
    records = []
    for cells in rows[1:]:
        if len(cells) < len(headers):
            cells = cells + [""] * (len(headers) - len(cells))
        record = dict(zip(headers, cells[: len(headers)]))
        records.append(record)
    return headers, records


def parse_count(page):
    match = re.search(r'id="icerik_lblkayitsayisi"[^>]*>(.*?)</span>', page)
    if not match:
        return None
    text = clean_text(match.group(1))
    return int(text) if text.isdigit() else None


def normalize_record(record, index):
    category_code = record.get("Ktg.", "")
    gender_code = record.get("C", "")
    normalized = {
        "Sıra": index,
        "Sezon": SEASON,
        "Tarih": record.get("Tarih", ""),
        "Saat": record.get("Saat", ""),
        "Salon Adı": record.get("Salon Adı", ""),
        "Ev Sahibi (A)": record.get("Ev Sahibi (A)", ""),
        "Misafir (B)": record.get("Misafir (B)", ""),
        "Cinsiyet Kodu": gender_code,
        "Cinsiyet": GENDER_MAP.get(gender_code, gender_code),
        "Küme": record.get("Küme", ""),
        "Kategori Kodu": category_code,
        "Kategori": CATEGORY_MAP.get(category_code, category_code),
        "Tür": record.get("Tür", ""),
        "Grup": record.get("Gr.", ""),
        "Devre": record.get("Dv.", ""),
        "TV": record.get("Tv", ""),
        "Hafta": record.get("Hft.", ""),
        "Kaynak URL": BASE_URL,
    }
    return normalized


def main():
    output_json = sys.argv[1] if len(sys.argv) > 1 else "fiksturler_2025_2026.json"
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())

    first_page = request_text(opener)
    page = postback(
        opener,
        first_page,
        "ctl00$icerik$txtbitistrh",
        {
            "ctl00$icerik$txttarih": START_DATE,
            "ctl00$icerik$txtbitistrh": END_DATE,
        },
    )

    headers, raw_records = parse_table(page)
    records = [normalize_record(record, i + 1) for i, record in enumerate(raw_records)]
    site_count = parse_count(page)

    unique_teams = sorted(
        {
            team
            for record in records
            for team in (record["Ev Sahibi (A)"], record["Misafir (B)"])
            if team
        },
        key=str.casefold,
    )

    payload = {
        "metadata": {
            "source_url": BASE_URL,
            "season": SEASON,
            "start_date": START_DATE,
            "end_date": END_DATE,
            "scraped_at": datetime.now().isoformat(timespec="seconds"),
            "site_record_count": site_count,
            "parsed_record_count": len(records),
            "unique_team_count": len(unique_teams),
            "raw_headers": headers,
        },
        "fixtures": records,
        "teams": [{"Takım Adı": team} for team in unique_teams],
    }

    with open(output_json, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)

    print(json.dumps(payload["metadata"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

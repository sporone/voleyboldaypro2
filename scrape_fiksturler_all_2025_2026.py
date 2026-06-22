import html
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from http.cookiejar import CookieJar


BASE_URL = "https://istanbul.voleyboliltemsilciligi.com/Fiksturler"
START_DATE = "01.09.2025"
END_DATE = "31.08.2026"
SEASON = "2025-2026"
USER_AGENT = "Mozilla/5.0"

COL_SEQ = "\u0053\u0131\u0072\u0061"
COL_HALL = "\u0053\u0061\u006c\u006f\u006e\u0020\u0041\u0064\u0131"
COL_HOME = "\u0045\u0076\u0020\u0053\u0061\u0068\u0069\u0062\u0069\u0020\u0028\u0041\u0029"
COL_AWAY = "\u004d\u0069\u0073\u0061\u0066\u0069\u0072\u0020\u0028\u0042\u0029"
COL_GENDER_CODE = "\u0043\u0069\u006e\u0073\u0069\u0079\u0065\u0074\u0020\u004b\u006f\u0064\u0075"
COL_GENDER = "\u0043\u0069\u006e\u0073\u0069\u0079\u0065\u0074"
COL_CLUSTER = "\u004b\u00fc\u006d\u0065"
COL_CAT_CODE = "\u004b\u0061\u0074\u0065\u0067\u006f\u0072\u0069\u0020\u004b\u006f\u0064\u0075"
COL_CAT = "\u004b\u0061\u0074\u0065\u0067\u006f\u0072\u0069"
COL_TYPE = "\u0054\u00fc\u0072"
COL_PAGE_SEQ = "\u0053\u0061\u0079\u0066\u0061\u0020\u0053\u0131\u0072\u0061\u0073\u0131"
COL_TEAM = "\u0054\u0061\u006b\u0131\u006d\u0020\u0041\u0064\u0131"

GENDER_MAP = {
    "B": "\u004b\u0061\u0064\u0131\u006e",
    "E": "\u0045\u0072\u006b\u0065\u006b",
}

CATEGORY_MAP = {
    "BB": "\u0042\u00fc\u0079\u00fc\u006b\u0020\u004b\u0061\u0064\u0131\u006e",
    "BE": "\u0042\u00fc\u0079\u00fc\u006b\u0020\u0045\u0072\u006b\u0065\u006b",
    "GK": "\u0047\u0065\u006e\u00e7\u0020\u004b\u0131\u007a",
    "GE": "\u0047\u0065\u006e\u00e7\u0020\u0045\u0072\u006b\u0065\u006b",
    "KK": "\u004b\u00fc\u00e7\u00fc\u006b\u0020\u004b\u0131\u007a",
    "KE": "\u004b\u00fc\u00e7\u00fc\u006b\u0020\u0045\u0072\u006b\u0065\u006b",
    "MdK": "\u004d\u0069\u0064\u0069\u0020\u004b\u0131\u007a",
    "MdE": "\u004d\u0069\u0064\u0069\u0020\u0045\u0072\u006b\u0065\u006b",
    "MnK": "\u004d\u0069\u006e\u0069\u0020\u004b\u0131\u007a",
    "MnE": "\u004d\u0069\u006e\u0069\u0020\u0045\u0072\u006b\u0065\u006b",
    "YK": "\u0059\u0131\u006c\u0064\u0131\u007a\u0020\u004b\u0131\u007a",
    "YE": "\u0059\u0131\u006c\u0064\u0131\u007a\u0020\u0045\u0072\u006b\u0065\u006b",
}

SPAN_FIELDS = {
    "gtarih": "Tarih",
    "gsaat": "Saat",
    "gyer": COL_HALL,
    "gevsahibi": COL_HOME,
    "gmisafir": COL_AWAY,
    "geb": COL_GENDER_CODE,
    "gkume": COL_CLUSTER,
    "gkategori": COL_CAT_CODE,
    "gturu": COL_TYPE,
    "ggrubu": "Grup",
    "gdevre": "Devre",
    "gtv": "TV",
    "ghafta": "Hafta",
}


def clean_text(value):
    value = html.unescape(value or "")
    value = re.sub(r"<script[\s\S]*?</script>", " ", value)
    value = re.sub(r"<style[\s\S]*?</style>", " ", value)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def request_text(opener, data=None, cookie_header=""):
    headers = {"User-Agent": USER_AGENT}
    if cookie_header:
        headers["Cookie"] = cookie_header
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        headers["Referer"] = BASE_URL
    req = urllib.request.Request(BASE_URL, data=data, headers=headers)
    if opener is None:
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.read().decode("utf-8", "replace")
    with opener.open(req, timeout=60) as response:
        return response.read().decode("utf-8", "replace")


def hidden_value(page, name):
    match = re.search(
        r'name="' + re.escape(name) + r'"[^>]*value="([^"]*)"', page
    )
    return html.unescape(match.group(1)) if match else ""


def postback(opener, page, event_target, event_argument, values):
    fields = {
        "__EVENTTARGET": event_target,
        "__EVENTARGUMENT": event_argument,
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
    payload = urllib.parse.urlencode(fields).encode("utf-8")
    return request_text(opener, payload)


def parse_count(page):
    match = re.search(r'id="icerik_lblkayitsayisi"[^>]*>(.*?)</span>', page)
    if not match:
        return 0
    text = clean_text(match.group(1))
    return int(text) if text.isdigit() else 0


def span_value(page, field, row_index):
    pattern = (
        r'id="icerik_gvliste_'
        + re.escape(field)
        + r"_"
        + str(row_index)
        + r'">([\s\S]*?)</span>'
    )
    match = re.search(pattern, page)
    return clean_text(match.group(1)) if match else ""


def parse_fixture_page(page, page_number):
    indexes = sorted(
        {int(value) for value in re.findall(r"icerik_gvliste_gtarih_(\d+)", page)}
    )
    records = []
    for row_index in indexes:
        record = {
            label: span_value(page, field, row_index)
            for field, label in SPAN_FIELDS.items()
        }
        record["Sayfa"] = page_number
        record[COL_PAGE_SEQ] = row_index + 1
        records.append(record)
    return records


def base_grid_fields(page1):
    return {
        "__EVENTTARGET": "ctl00$icerik$gvliste",
        "__EVENTARGUMENT": "",
        "__LASTFOCUS": "",
        "__VIEWSTATE": hidden_value(page1, "__VIEWSTATE"),
        "__VIEWSTATEGENERATOR": hidden_value(page1, "__VIEWSTATEGENERATOR"),
        "__VIEWSTATEENCRYPTED": hidden_value(page1, "__VIEWSTATEENCRYPTED"),
        "ctl00$icerik$ddlSil": "34",
        "ctl00$icerik$ddlsezon": SEASON,
        "ctl00$icerik$txttarih": START_DATE,
        "ctl00$icerik$txtbitistrh": END_DATE,
        "ctl00$icerik$ddlsbe": "0",
        "ctl00$icerik$ddlskategori": "0",
        "ctl00$icerik$ddlskume": "-1",
        "ctl00$icerik$ddlsturu": "0",
        "ctl00$icerik$ddlsgrubu": "0",
        "ctl00$icerik$ddlskurumadi": "0",
        "ctl00$icerik$ddlstakim": "0",
        "ctl00$icerik$ddlsyarismaadi": "0",
    }


def normalize_record(record, index):
    category_code = record.get(COL_CAT_CODE, "")
    gender_code = record.get(COL_GENDER_CODE, "")
    return {
        COL_SEQ: index,
        "Sezon": SEASON,
        "Tarih": record.get("Tarih", ""),
        "Saat": record.get("Saat", ""),
        COL_HALL: record.get(COL_HALL, ""),
        COL_HOME: record.get(COL_HOME, ""),
        COL_AWAY: record.get(COL_AWAY, ""),
        COL_GENDER_CODE: gender_code,
        COL_GENDER: GENDER_MAP.get(gender_code, gender_code),
        COL_CLUSTER: record.get(COL_CLUSTER, ""),
        COL_CAT_CODE: category_code,
        COL_CAT: CATEGORY_MAP.get(category_code, category_code),
        COL_TYPE: record.get(COL_TYPE, ""),
        "Grup": record.get("Grup", ""),
        "Devre": record.get("Devre", ""),
        "TV": record.get("TV", ""),
        "Hafta": record.get("Hafta", ""),
        "Sayfa": record.get("Sayfa", ""),
        COL_PAGE_SEQ: record.get(COL_PAGE_SEQ, ""),
        "Kaynak URL": BASE_URL,
    }


def main():
    output_json = sys.argv[1] if len(sys.argv) > 1 else "fiksturler_2025_2026.json"
    cookie_jar = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))

    first_page = request_text(opener)
    page1 = postback(
        opener,
        first_page,
        "ctl00$icerik$txtbitistrh",
        "",
        {
            "ctl00$icerik$txttarih": START_DATE,
            "ctl00$icerik$txtbitistrh": END_DATE,
        },
    )

    site_count = parse_count(page1)
    first_page_records = parse_fixture_page(page1, 1)
    page_size = len(first_page_records)
    page_count = math.ceil(site_count / page_size) if page_size else 0
    cookie_header = "; ".join(
        f"{cookie.name}={cookie.value}" for cookie in cookie_jar
    )
    grid_fields = base_grid_fields(page1)

    def fetch_page(page_number):
        if page_number == 1:
            return page_number, first_page_records
        fields = dict(grid_fields)
        fields["__EVENTARGUMENT"] = f"Page${page_number}"
        payload = urllib.parse.urlencode(fields).encode("utf-8")
        last_error = None
        for attempt in range(3):
            try:
                fetched = request_text(None, payload, cookie_header=cookie_header)
                rows = parse_fixture_page(fetched, page_number)
                return page_number, rows
            except Exception as exc:
                last_error = exc
                time.sleep(0.5 + attempt)
        raise RuntimeError(f"Page {page_number} failed: {last_error!r}")

    raw_by_page = {1: first_page_records}
    if page_count > 1:
        completed = 1
        with ThreadPoolExecutor(max_workers=10) as pool:
            futures = [
                pool.submit(fetch_page, page_number)
                for page_number in range(2, page_count + 1)
            ]
            for future in as_completed(futures):
                page_number, rows = future.result()
                raw_by_page[page_number] = rows
                completed += 1
                if completed % 25 == 0 or completed == page_count:
                    print(
                        f"Fetched {completed}/{page_count} pages",
                        file=sys.stderr,
                        flush=True,
                    )

    raw_records = []
    for page_number in range(1, page_count + 1):
        raw_records.extend(raw_by_page.get(page_number, []))

    records = [normalize_record(record, i + 1) for i, record in enumerate(raw_records)]
    unique_teams = sorted(
        {
            team
            for record in records
            for team in (record[COL_HOME], record[COL_AWAY])
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
            "page_size": page_size,
            "page_count": page_count,
            "unique_team_count": len(unique_teams),
            "raw_headers": list(SPAN_FIELDS.values()),
        },
        "fixtures": records,
        "teams": [{COL_TEAM: team} for team in unique_teams],
    }

    with open(output_json, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)

    print(json.dumps(payload["metadata"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

import csv
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime


BASE_URL = "https://istanbul.voleyboliltemsilciligi.com/PuanDurumu"
USER_AGENT = "Mozilla/5.0"


def clean_text(value):
    value = html.unescape(value or "")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def request_text(opener, url, data=None):
    headers = {"User-Agent": USER_AGENT}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        headers["Referer"] = BASE_URL
    req = urllib.request.Request(url, data=data, headers=headers)
    with opener.open(req, timeout=45) as response:
        return response.read().decode("utf-8", "replace")


def hidden_value(page, name):
    match = re.search(
        r'name="' + re.escape(name) + r'"[^>]*value="([^"]*)"', page
    )
    return html.unescape(match.group(1)) if match else ""


def select_options(page, select_id):
    match = re.search(
        r'<select[^>]*id="' + re.escape(select_id) + r'"[\s\S]*?</select>', page
    )
    if not match:
        return []
    options = []
    for option in re.finditer(
        r'<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)</option>', match.group(0)
    ):
        value = html.unescape(option.group(1))
        text = clean_text(re.sub(r"<[^>]+>", " ", option.group(2)))
        options.append({"value": value, "text": text})
    return options


def postback(opener, page, event_target, values):
    fields = {
        "__EVENTTARGET": event_target,
        "__EVENTARGUMENT": "",
        "__LASTFOCUS": "",
        "__VIEWSTATE": hidden_value(page, "__VIEWSTATE"),
        "__VIEWSTATEGENERATOR": hidden_value(page, "__VIEWSTATEGENERATOR"),
        "__VIEWSTATEENCRYPTED": hidden_value(page, "__VIEWSTATEENCRYPTED"),
        "ctl00$icerik$ddlSil": "34",
        "ctl00$icerik$ddlsbe": "0",
        "ctl00$icerik$ddlSkategori": "0",
        "ctl00$icerik$ddlskume": "-1",
        "ctl00$icerik$ddlSyarismaadi": "-1",
    }
    fields.update(values)
    data = urllib.parse.urlencode(fields).encode("utf-8")
    return request_text(opener, BASE_URL, data=data)


def parse_standing_table(page):
    match = re.search(
        r'<table[^>]*id="icerik_GvTemplate_1"[\s\S]*?</table>', page
    )
    if not match:
        return [], []

    table = match.group(0)
    rows = []
    for row_html in re.findall(r"<tr[^>]*>([\s\S]*?)</tr>", table):
        cells = []
        for cell in re.findall(r"<t[hd][^>]*>([\s\S]*?)</t[hd]>", row_html):
            text = re.sub(r"<script[\s\S]*?</script>", " ", cell)
            text = re.sub(r"<style[\s\S]*?</style>", " ", text)
            text = re.sub(r"<[^>]+>", " ", text)
            cells.append(clean_text(text))
        if cells:
            rows.append(cells)

    if not rows:
        return [], []

    headers = rows[0]
    if headers and headers[0].lower() == "logo":
        headers = headers[1:]

    parsed = []
    for cells in rows[1:]:
        if len(cells) == len(headers) + 1:
            cells = cells[1:]
        if len(cells) < len(headers):
            cells = cells + [""] * (len(headers) - len(cells))
        parsed.append(dict(zip(headers, cells[: len(headers)])))
    return headers, parsed


def option_items(options, skip_values=("0", "-1")):
    return [item for item in options if item["value"] not in skip_values]


def main():
    output_json = sys.argv[1] if len(sys.argv) > 1 else "istanbul_voleybol_data.json"
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())

    first_page = request_text(opener, BASE_URL)
    all_rows = []
    competitions = []
    errors = []
    sexes = [
        {"value": "E", "text": "Erkek"},
        {"value": "B", "text": "Kadın"},
    ]

    for sex in sexes:
        try:
            sex_page = postback(
                opener,
                first_page,
                "ctl00$icerik$ddlsbe",
                {"ctl00$icerik$ddlsbe": sex["value"]},
            )
            categories = option_items(select_options(sex_page, "icerik_ddlSkategori"))
        except Exception as exc:
            errors.append({"scope": sex["text"], "error": repr(exc)})
            continue

        for category in categories:
            try:
                category_page = postback(
                    opener,
                    sex_page,
                    "ctl00$icerik$ddlSkategori",
                    {
                        "ctl00$icerik$ddlsbe": sex["value"],
                        "ctl00$icerik$ddlSkategori": category["value"],
                    },
                )
                clusters = option_items(select_options(category_page, "icerik_ddlskume"))
            except Exception as exc:
                errors.append(
                    {
                        "scope": f'{sex["text"]} / {category["text"]}',
                        "error": repr(exc),
                    }
                )
                continue

            for cluster in clusters:
                try:
                    cluster_page = postback(
                        opener,
                        category_page,
                        "ctl00$icerik$ddlskume",
                        {
                            "ctl00$icerik$ddlsbe": sex["value"],
                            "ctl00$icerik$ddlSkategori": category["value"],
                            "ctl00$icerik$ddlskume": cluster["value"],
                        },
                    )
                    races = option_items(
                        select_options(cluster_page, "icerik_ddlSyarismaadi")
                    )
                except Exception as exc:
                    errors.append(
                        {
                            "scope": f'{sex["text"]} / {category["text"]} / {cluster["text"]}',
                            "error": repr(exc),
                        }
                    )
                    continue

                race_page = cluster_page
                for race in races:
                    scope = (
                        f'{sex["text"]} / {category["text"]} / '
                        f'{cluster["text"]} / {race["text"]}'
                    )
                    try:
                        race_page = postback(
                            opener,
                            race_page,
                            "ctl00$icerik$ddlSyarismaadi",
                            {
                                "ctl00$icerik$ddlsbe": sex["value"],
                                "ctl00$icerik$ddlSkategori": category["value"],
                                "ctl00$icerik$ddlskume": cluster["value"],
                                "ctl00$icerik$ddlSyarismaadi": race["value"],
                            },
                        )
                        headers, standings = parse_standing_table(race_page)
                        competition_record = {
                            "Cinsiyet": sex["text"],
                            "Cinsiyet Kodu": sex["value"],
                            "Kategori": category["text"],
                            "Kategori Kodu": category["value"],
                            "Küme": cluster["text"],
                            "Küme Kodu": cluster["value"],
                            "Yarışma": race["text"],
                            "Yarışma Değeri": race["value"],
                            "Takım Sayısı": len(standings),
                        }
                        competitions.append(competition_record)
                        for item in standings:
                            team = clean_text(item.get("Takım Adı", ""))
                            if not team:
                                continue
                            row = {
                                **competition_record,
                                "Takım Adı": team,
                                "Kaynak URL": BASE_URL,
                            }
                            for header in headers:
                                if header != "Takım Adı":
                                    row[header] = item.get(header, "")
                            all_rows.append(row)
                        time.sleep(0.04)
                    except Exception as exc:
                        errors.append({"scope": scope, "error": repr(exc)})

    team_map = {}
    for row in all_rows:
        team = row["Takım Adı"]
        entry = team_map.setdefault(
            team,
            {
                "Takım Adı": team,
                "Kategori Sayısı": 0,
                "Yarışma Sayısı": 0,
                "Kategoriler": set(),
                "Yarışmalar": set(),
                "Cinsiyetler": set(),
            },
        )
        entry["Kategoriler"].add(row["Kategori"])
        entry["Yarışmalar"].add(row["Yarışma"])
        entry["Cinsiyetler"].add(row["Cinsiyet"])

    summary = []
    for entry in team_map.values():
        categories = sorted(entry["Kategoriler"])
        races = sorted(entry["Yarışmalar"])
        sexes_text = sorted(entry["Cinsiyetler"])
        summary.append(
            {
                "Takım Adı": entry["Takım Adı"],
                "Kategori Sayısı": len(categories),
                "Yarışma Sayısı": len(races),
                "Cinsiyet": ", ".join(sexes_text),
                "Kategoriler": ", ".join(categories),
                "Yarışmalar": ", ".join(races),
            }
        )

    summary.sort(key=lambda item: item["Takım Adı"].casefold())
    all_rows.sort(
        key=lambda item: (
            item["Takım Adı"].casefold(),
            item["Kategori"].casefold(),
            item["Yarışma"].casefold(),
        )
    )
    competitions.sort(
        key=lambda item: (
            item["Cinsiyet"],
            item["Kategori"],
            item["Küme"],
            item["Yarışma"],
        )
    )

    payload = {
        "metadata": {
            "source_url": BASE_URL,
            "scraped_at": datetime.now().isoformat(timespec="seconds"),
            "team_count": len(summary),
            "detail_row_count": len(all_rows),
            "competition_count": len(competitions),
            "error_count": len(errors),
        },
        "summary": summary,
        "details": all_rows,
        "competitions": competitions,
        "errors": errors,
    }

    with open(output_json, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)

    csv_path = output_json.rsplit(".", 1)[0] + "_summary.csv"
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(summary[0].keys()) if summary else [])
        if summary:
            writer.writeheader()
            writer.writerows(summary)

    print(json.dumps(payload["metadata"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

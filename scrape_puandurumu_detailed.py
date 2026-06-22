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

COL_GENDER = "\u0043\u0069\u006e\u0073\u0069\u0079\u0065\u0074"
COL_GENDER_CODE = "\u0043\u0069\u006e\u0073\u0069\u0079\u0065\u0074\u0020\u004b\u006f\u0064\u0075"
COL_CATEGORY = "\u004b\u0061\u0074\u0065\u0067\u006f\u0072\u0069"
COL_CATEGORY_CODE = "\u004b\u0061\u0074\u0065\u0067\u006f\u0072\u0069\u0020\u004b\u006f\u0064\u0075"
COL_CLUSTER = "\u004b\u00fc\u006d\u0065"
COL_CLUSTER_CODE = "\u004b\u00fc\u006d\u0065\u0020\u004b\u006f\u0064\u0075"
COL_COMP = "\u0059\u0061\u0072\u0131\u015f\u006d\u0061"
COL_COMP_VALUE = "\u0059\u0061\u0072\u0131\u015f\u006d\u0061\u0020\u0044\u0065\u011f\u0065\u0072\u0069"
COL_TEAM = "\u0054\u0061\u006b\u0131\u006d\u0020\u0041\u0064\u0131"
COL_MATCH_COUNT = "\u004d\u0061\u00e7\u0020\u0053\u0061\u0079\u0131\u0073\u0131"
COL_STANDING_COUNT = "\u0050\u0075\u0061\u006e\u0020\u0054\u0061\u0062\u006c\u006f\u0073\u0075\u0020\u0054\u0061\u006b\u0131\u006d\u0020\u0053\u0061\u0079\u0131\u0073\u0131"
COL_SEQ = "\u0053\u0131\u0072\u0061"
COL_HALL = "\u0053\u0061\u006c\u006f\u006e\u0020\u0041\u0064\u0131"
COL_HOME = "\u0045\u0076\u0020\u0053\u0061\u0068\u0069\u0062\u0069\u0020\u0028\u0041\u0029"
COL_AWAY = "\u004d\u0069\u0073\u0061\u0066\u0069\u0072\u0020\u0028\u0042\u0029"
COL_SET_RESULTS = "\u0053\u0065\u0074\u0020\u0053\u006f\u006e\u0075\u00e7\u006c\u0061\u0072\u0131"
COL_WINNER = "\u004b\u0061\u007a\u0061\u006e\u0061\u006e"
COL_SOURCE = "\u004b\u0061\u0079\u006e\u0061\u006b\u0020\u0055\u0052\u004c"

STANDING_FIELDS = {
    "gO": "O",
    "gG": "G",
    "gM": "M",
    "gA": "A",
    "gV": "V",
    "gP": "P",
    "gSAV": "SAV",
    "gASP": "ASP",
    "gVSP": "VSP",
    "gSPAV": "SPAV",
    "gA3_0": "3-0",
    "gA3_1": "3-1",
    "gA3_2": "3-2",
    "gV2_3": "2-3",
    "gV1_3": "1-3",
    "gV0_3": "0-3",
}

MATCH_FIELDS = {
    "gsno": "S.No",
    "gtarih": "Tarih",
    "gsaat": "Saat",
    "gyer": COL_HALL,
    "gevsahibi": COL_HOME,
    "gseta": "Set A",
    "gsetb": "Set B",
    "gmisafir": COL_AWAY,
    "gsetsonuclari": COL_SET_RESULTS,
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
        "ctl00$icerik$ddlsbe": "0",
        "ctl00$icerik$ddlSkategori": "0",
        "ctl00$icerik$ddlskume": "-1",
        "ctl00$icerik$ddlSyarismaadi": "-1",
    }
    fields.update(values)
    payload = urllib.parse.urlencode(fields).encode("utf-8")
    return request_text(opener, payload)


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
        options.append(
            {
                "value": html.unescape(option.group(1)),
                "text": clean_text(option.group(2)),
            }
        )
    return options


def useful_options(options, skip=("0", "-1")):
    return [option for option in options if option["value"] not in skip]


def span_value(page, prefix, field, row_index):
    pattern = (
        r'id="'
        + re.escape(prefix)
        + r"_"
        + re.escape(field)
        + r"_"
        + str(row_index)
        + r'[^"]*"[^>]*>([\s\S]*?)</(?:span|a)>'
    )
    match = re.search(pattern, page)
    return clean_text(match.group(1)) if match else ""


def parse_standings(page, context):
    indexes = sorted(
        {int(value) for value in re.findall(r"icerik_GvTemplate_1_lnkSubmit_(\d+)", page)}
    )
    rows = []
    for rank, index in enumerate(indexes, start=1):
        team = span_value(page, "icerik_GvTemplate_1", "lnkSubmit", index)
        if not team:
            continue
        row = dict(context)
        row[COL_SEQ] = rank
        row[COL_TEAM] = team
        for field, label in STANDING_FIELDS.items():
            row[label] = span_value(page, "icerik_GvTemplate_1", field, index)
        row[COL_SOURCE] = BASE_URL
        rows.append(row)
    return rows


def parse_match_sets(set_results):
    pairs = re.findall(r"\((\d+)-(\d+)\)", set_results or "")
    data = {}
    for set_index in range(1, 6):
        if set_index <= len(pairs):
            data[f"Set {set_index} A"] = pairs[set_index - 1][0]
            data[f"Set {set_index} B"] = pairs[set_index - 1][1]
        else:
            data[f"Set {set_index} A"] = ""
            data[f"Set {set_index} B"] = ""
    return data


def parse_winner(home, away, set_a, set_b):
    try:
        score_a = int(set_a)
        score_b = int(set_b)
    except (TypeError, ValueError):
        return ""
    if score_a > score_b:
        return home
    if score_b > score_a:
        return away
    return ""


def parse_matches(page, context):
    indexes = sorted(
        {int(value) for value in re.findall(r"icerik_gvmusabakaliste_gsno_(\d+)", page)}
    )
    rows = []
    for index in indexes:
        row = dict(context)
        for field, label in MATCH_FIELDS.items():
            row[label] = span_value(page, "icerik_gvmusabakaliste", field, index)
        row.update(parse_match_sets(row.get(COL_SET_RESULTS, "")))
        row[COL_WINNER] = parse_winner(
            row.get(COL_HOME, ""),
            row.get(COL_AWAY, ""),
            row.get("Set A", ""),
            row.get("Set B", ""),
        )
        row[COL_SOURCE] = BASE_URL
        rows.append(row)
    return rows


def make_context(sex, category, cluster, race):
    return {
        COL_GENDER: sex["text"],
        COL_GENDER_CODE: sex["value"],
        COL_CATEGORY: category["text"],
        COL_CATEGORY_CODE: category["value"],
        COL_CLUSTER: cluster["text"],
        COL_CLUSTER_CODE: cluster["value"],
        COL_COMP: race["text"],
        COL_COMP_VALUE: race["value"],
    }


def main():
    output_json = sys.argv[1] if len(sys.argv) > 1 else "puandurumu_detailed.json"
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    first_page = request_text(opener)

    sexes = [
        {"value": "E", "text": "\u0045\u0072\u006b\u0065\u006b"},
        {"value": "B", "text": "\u004b\u0061\u0064\u0131\u006e"},
    ]
    standings = []
    matches = []
    competitions = []
    errors = []
    race_count = 0

    for sex in sexes:
        try:
            sex_page = postback(
                opener,
                first_page,
                "ctl00$icerik$ddlsbe",
                {"ctl00$icerik$ddlsbe": sex["value"]},
            )
            categories = useful_options(select_options(sex_page, "icerik_ddlSkategori"))
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
                clusters = useful_options(select_options(category_page, "icerik_ddlskume"))
            except Exception as exc:
                errors.append(
                    {"scope": f'{sex["text"]} / {category["text"]}', "error": repr(exc)}
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
                    races = useful_options(
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

                for race in races:
                    context = make_context(sex, category, cluster, race)
                    scope = " / ".join(
                        [sex["text"], category["text"], cluster["text"], race["text"]]
                    )
                    try:
                        race_page = postback(
                            opener,
                            cluster_page,
                            "ctl00$icerik$ddlSyarismaadi",
                            {
                                "ctl00$icerik$ddlsbe": sex["value"],
                                "ctl00$icerik$ddlSkategori": category["value"],
                                "ctl00$icerik$ddlskume": cluster["value"],
                                "ctl00$icerik$ddlSyarismaadi": race["value"],
                            },
                        )
                        race_standings = parse_standings(race_page, context)
                        race_matches = parse_matches(race_page, context)
                        standings.extend(race_standings)
                        matches.extend(race_matches)
                        competitions.append(
                            {
                                **context,
                                COL_STANDING_COUNT: len(race_standings),
                                COL_MATCH_COUNT: len(race_matches),
                            }
                        )
                        race_count += 1
                        if race_count % 50 == 0:
                            print(
                                f"Fetched {race_count} competitions",
                                file=sys.stderr,
                                flush=True,
                            )
                        time.sleep(0.03)
                    except Exception as exc:
                        errors.append({"scope": scope, "error": repr(exc)})

    teams = {}
    for row in standings:
        team = row.get(COL_TEAM, "")
        if not team:
            continue
        entry = teams.setdefault(
            team,
            {
                COL_TEAM: team,
                "\u0050\u0075\u0061\u006e\u0020\u0054\u0061\u0062\u006c\u006f\u0073\u0075\u0020\u004b\u0061\u0079\u0064\u0131": 0,
                "\u0059\u0061\u0072\u0131\u015f\u006d\u0061\u0020\u0053\u0061\u0079\u0131\u0073\u0131": set(),
                "\u004b\u0061\u0074\u0065\u0067\u006f\u0072\u0069\u006c\u0065\u0072": set(),
                COL_GENDER: set(),
            },
        )
        entry["\u0050\u0075\u0061\u006e\u0020\u0054\u0061\u0062\u006c\u006f\u0073\u0075\u0020\u004b\u0061\u0079\u0064\u0131"] += 1
        entry["\u0059\u0061\u0072\u0131\u015f\u006d\u0061\u0020\u0053\u0061\u0079\u0131\u0073\u0131"].add(row.get(COL_COMP, ""))
        entry["\u004b\u0061\u0074\u0065\u0067\u006f\u0072\u0069\u006c\u0065\u0072"].add(row.get(COL_CATEGORY, ""))
        entry[COL_GENDER].add(row.get(COL_GENDER, ""))

    team_summary = []
    for row in teams.values():
        team_summary.append(
            {
                COL_TEAM: row[COL_TEAM],
                "\u0050\u0075\u0061\u006e\u0020\u0054\u0061\u0062\u006c\u006f\u0073\u0075\u0020\u004b\u0061\u0079\u0064\u0131": row[
                    "\u0050\u0075\u0061\u006e\u0020\u0054\u0061\u0062\u006c\u006f\u0073\u0075\u0020\u004b\u0061\u0079\u0064\u0131"
                ],
                "\u0059\u0061\u0072\u0131\u015f\u006d\u0061\u0020\u0053\u0061\u0079\u0131\u0073\u0131": len(
                    row["\u0059\u0061\u0072\u0131\u015f\u006d\u0061\u0020\u0053\u0061\u0079\u0131\u0073\u0131"]
                ),
                COL_GENDER: ", ".join(sorted(row[COL_GENDER])),
                "\u004b\u0061\u0074\u0065\u0067\u006f\u0072\u0069\u006c\u0065\u0072": ", ".join(
                    sorted(row["\u004b\u0061\u0074\u0065\u0067\u006f\u0072\u0069\u006c\u0065\u0072"])
                ),
            }
        )
    team_summary.sort(key=lambda item: item[COL_TEAM].casefold())

    payload = {
        "metadata": {
            "source_url": BASE_URL,
            "scraped_at": datetime.now().isoformat(timespec="seconds"),
            "competition_count": len(competitions),
            "standing_row_count": len(standings),
            "match_row_count": len(matches),
            "team_count": len(team_summary),
            "error_count": len(errors),
        },
        "competitions": competitions,
        "standings": standings,
        "matches": matches,
        "team_summary": team_summary,
        "errors": errors,
    }

    with open(output_json, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)

    print(json.dumps(payload["metadata"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Synchronise les perturbations planifiees TAM vers un JSON local
consommable par le simulateur (sans CORS navigateur).
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import urlopen

TAM_URL = "https://www.tam-voyages.com/perturbation/?ptano=1106&rub_code=17"
OUT_PATH = Path(__file__).with_name("tam_perturbations.json")


def normalize_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def extract_line_codes(text: str) -> list[str]:
    out = []
    for m in re.finditer(r"\b(?:L|T)?\s*(A|\d{1,3})\b", (text or "").upper()):
        code = m.group(1).strip()
        if code and code not in out:
            out.append(code)
    return out


class TamInfoTraficParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.items: list[dict] = []
        self.in_h2 = False
        self.current_title = ""
        self.current_chunks: list[str] = []

    def _flush(self) -> None:
        title = normalize_spaces(self.current_title)
        body = normalize_spaces(" ".join(self.current_chunks))
        if not title:
            self.current_title = ""
            self.current_chunks = []
            return
        body_lower = body.lower()
        self.items.append(
            {
                "title": title,
                "line_codes": extract_line_codes(title),
                "body": body,
                "is_coming_soon": "a venir" in body_lower,
                "is_active": "a venir" not in body_lower,
                "has_non_served_stop": "non desserv" in body_lower,
                "has_works": "travaux" in body_lower,
                "has_deviation": ("deviation" in body_lower) or ("detour" in body_lower),
            }
        )
        self.current_title = ""
        self.current_chunks = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() == "h2":
            self._flush()
            self.in_h2 = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "h2":
            self.in_h2 = False

    def handle_data(self, data: str) -> None:
        txt = normalize_spaces(data)
        if not txt:
            return
        if self.in_h2:
            if self.current_title:
                self.current_title += " " + txt
            else:
                self.current_title = txt
        else:
            self.current_chunks.append(txt)

    def finalize(self) -> None:
        self._flush()


def main() -> None:
    html = urlopen(TAM_URL, timeout=30).read().decode("utf-8", "ignore")
    p = TamInfoTraficParser()
    p.feed(html)
    p.finalize()

    # On ne garde que les perturbations utiles pour le mode planifie.
    plan_items = []
    for it in p.items:
        if not it["line_codes"]:
            continue
        if it["is_coming_soon"]:
            continue
        if not (it["has_non_served_stop"] or it["has_works"] or it["has_deviation"]):
            continue
        plan_items.append(it)

    payload = {
        "source_url": TAM_URL,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "count": len(plan_items),
        "items": plan_items,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {OUT_PATH} ({len(plan_items)} perturbations)")


if __name__ == "__main__":
    main()

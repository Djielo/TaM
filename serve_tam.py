#!/usr/bin/env python3
"""
Serveur local unique pour le simulateur TAM:
- Sert les fichiers statiques (simulateur_sae.html, JS, JSON, etc.)
- Expose /api/tam/proxy pour contourner CORS sur les sources Open Data
- Expose /api/tam/perturbations pour les perturbations planifiees
"""

from __future__ import annotations

import json
import re
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8000
TAM_INFOS_TRAFIC_URL = "https://www.tam-voyages.com/perturbation/?ptano=1106&rub_code=17"

ALLOWED_PROXY_HOSTS = {
    "data.montpellier3m.fr",
    "www.tam-voyages.com",
    "tam-voyages.com",
}


def normalize_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def extract_line_codes(text: str) -> list[str]:
    out: list[str] = []
    for m in re.finditer(r"\b(?:L|T)?\s*(A|\d{1,3})\b", (text or "").upper()):
        code = m.group(1).strip()
        if code and code not in out:
            out.append(code)
    return out


@dataclass
class PerturbationItem:
    title: str
    body: str
    line_codes: list[str]
    is_coming_soon: bool
    is_active: bool
    has_non_served_stop: bool
    has_works: bool
    has_deviation: bool

    def as_dict(self) -> dict:
        return {
            "title": self.title,
            "body": self.body,
            "line_codes": self.line_codes,
            "is_coming_soon": self.is_coming_soon,
            "is_active": self.is_active,
            "has_non_served_stop": self.has_non_served_stop,
            "has_works": self.has_works,
            "has_deviation": self.has_deviation,
        }


class TamInfosTraficParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.items: list[PerturbationItem] = []
        self._in_h2 = False
        self._title = ""
        self._chunks: list[str] = []

    def _flush(self) -> None:
        title = normalize_spaces(self._title)
        body = normalize_spaces(" ".join(self._chunks))
        if not title:
            self._title = ""
            self._chunks = []
            return
        b = body.lower()
        self.items.append(
            PerturbationItem(
                title=title,
                body=body,
                line_codes=extract_line_codes(title),
                is_coming_soon=("a venir" in b),
                is_active=("a venir" not in b),
                has_non_served_stop=("non desserv" in b),
                has_works=("travaux" in b),
                has_deviation=("deviation" in b) or ("detour" in b),
            )
        )
        self._title = ""
        self._chunks = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() == "h2":
            self._flush()
            self._in_h2 = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "h2":
            self._in_h2 = False

    def handle_data(self, data: str) -> None:
        txt = normalize_spaces(data)
        if not txt:
            return
        if self._in_h2:
            self._title = f"{self._title} {txt}".strip() if self._title else txt
        else:
            self._chunks.append(txt)

    def finalize(self) -> None:
        self._flush()


def fetch_url_bytes(url: str, timeout: int = 25) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "tam-local-server/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
        ctype = resp.headers.get("Content-Type", "application/octet-stream")
    return body, ctype


def build_perturbations_payload() -> dict:
    raw, _ = fetch_url_bytes(TAM_INFOS_TRAFIC_URL, timeout=25)
    html = raw.decode("utf-8", "ignore")
    p = TamInfosTraficParser()
    p.feed(html)
    p.finalize()
    items = []
    for it in p.items:
        if not it.line_codes:
            continue
        if not (it.has_non_served_stop or it.has_works or it.has_deviation):
            continue
        items.append(it.as_dict())
    return {
        "source": TAM_INFOS_TRAFIC_URL,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "count": len(items),
        "items": items,
    }


class TamHandler(SimpleHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict) -> None:
        blob = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(blob)))
        self.end_headers()
        self.wfile.write(blob)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/tam/perturbations":
            try:
                payload = build_perturbations_payload()
                self._send_json(200, payload)
            except Exception as exc:
                self._send_json(502, {"error": "perturbations_fetch_failed", "detail": str(exc)})
            return

        if parsed.path == "/api/tam/proxy":
            q = urllib.parse.parse_qs(parsed.query)
            target = (q.get("url") or [""])[0].strip()
            try:
                u = urllib.parse.urlparse(target)
                if u.scheme not in {"http", "https"}:
                    raise ValueError("invalid_scheme")
                if (u.hostname or "").lower() not in ALLOWED_PROXY_HOSTS:
                    raise ValueError("host_not_allowed")
                body, ctype = fetch_url_bytes(target, timeout=25)
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as exc:
                self._send_json(400, {"error": "proxy_failed", "detail": str(exc)})
            return

        super().do_GET()


def main() -> None:
    root = Path(__file__).resolve().parent
    print(f"Serving from: {root}")
    print(f"Open: http://{HOST}:{PORT}/simulateur_sae.html")
    server = ThreadingHTTPServer((HOST, PORT), TamHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        PORT = int(sys.argv[1])
    main()

#!/usr/bin/env python3
"""docs/ 를 로컬에서 서빙한다. **Range 요청(206)을 지원한다.**

    python3 scripts/serve_docs.py            # http://localhost:8788
    python3 scripts/serve_docs.py --port 9000

`python3 -m http.server` 를 쓰면 안 된다. Range 를 지원하지 않아 전체 응답(200)을 돌려주고,
Chrome 은 그 미디어를 **seek 불가**로 판단한다 (`audio.seekable` 이 [0, 0] 이 된다). 그러면
스크립트 리더에서 문장 클릭·문장 이동·±10초가 전부 먹지 않는다 — 코드가 아니라 서버 탓인데
증상은 플레이어 버그처럼 보인다.

배포된 페이지에서는 문제가 없다. 음원은 GitHub Release 자산이고 Release 는 206 을 돌려준다.
이 스크립트는 **로컬에서 그 동작을 재현**하기 위한 것이다.
"""

from __future__ import annotations

import argparse
import http.server
import os
import re
import socketserver
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"

_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


class RangeHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler + Range. GET 만 다룬다 (HEAD 는 상위 구현으로 충분)."""

    # Chrome 이 미디어를 이어 받을 때 연결을 재사용한다. 1.0 이면 매 요청마다 끊긴다.
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        # 미디어가 아니어도 붙여 둔다. 이 헤더가 없으면 Chrome 이 Range 를 시도하지 않는다.
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):  # noqa: N802  (표준 라이브러리 규약)
        raw = self.headers.get("Range")
        if not raw:
            return super().do_GET()

        match = _RANGE_RE.match(raw.strip())
        path = self.translate_path(self.path)
        if not match or not os.path.isfile(path):
            # 모양이 다른 Range(멀티파트 등)는 전체를 돌려준다. 허용된 응답이다.
            return super().do_GET()

        size = os.path.getsize(path)
        first, last = match.group(1), match.group(2)
        if first == "":
            # bytes=-500 → 끝에서 500바이트
            length = min(int(last or 0), size)
            start, end = size - length, size - 1
        else:
            start = int(first)
            end = int(last) if last else size - 1
            end = min(end, size - 1)

        if start >= size or start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        length = end - start + 1
        ctype = self.guess_type(path)
        try:
            handle = open(path, "rb")
        except OSError:
            self.send_error(404)
            return None

        with handle:
            handle.seek(start)
            self.send_response(206)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(length))
            self.end_headers()
            remaining = length
            while remaining > 0:
                chunk = handle.read(min(1 << 16, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    # 브라우저가 seek 하면 받던 응답을 끊는다. 정상이다.
                    return None
                remaining -= len(chunk)
        return None

    def log_message(self, fmt, *args):
        # 미디어를 받을 때 요청이 수십 개씩 쏟아져 화면을 덮는다
        if self.path.endswith((".mp3", ".wav", ".m4a")):
            return
        super().log_message(fmt, *args)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8788)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    if not DOCS.is_dir():
        sys.exit(f"docs 폴더가 없습니다: {DOCS}")
    os.chdir(DOCS)

    print(f"docs → http://{'localhost' if args.host == '127.0.0.1' else args.host}:{args.port}")
    print("Range 요청(206) 지원 — 문장 클릭·문장 이동·±10초가 동작합니다. Ctrl+C 로 중지.")
    try:
        Server((args.host, args.port), RangeHandler).serve_forever()
    except KeyboardInterrupt:
        print("\n중지")


if __name__ == "__main__":
    main()

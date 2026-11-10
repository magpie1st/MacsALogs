"""오디오북 빌드·음원 게시가 함께 쓰는 것: 암호(열쇠), 본문 해시, 경로.

암호화: 열쇠 = PBKDF2-SHA256(암호, salt, 60만 회) → AES-256-GCM. salt 는 scripts/audiobook_crypto.json (비밀 아님, 커밋).
같은 암호면 같은 열쇠라 이미 올린 음원을 다시 암호화하지 않는다.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"
CRYPTO_FILE = REPO / "scripts" / "audiobook_crypto.json"
PASSWORD_FILE = Path(os.path.expanduser("~/.config/macsalogs/audiobook_password"))
ITERATIONS = 600_000
CODE_ROOT = REPO.parent
DEFAULT_BOOKS = CODE_ROOT / "book-maker" / "output" / "audiobook"
BOOK_CONFIG = DOCS / "audio" / "audiobook"      # <책 id>/config.json


def text_hash(chapter: dict) -> str:
    """tts-maker gemini/audiobook_gemini.py 의 text_hash 와 같은 계산이어야 한다."""
    rows = [[p["text"], p["sentences"]] for p in chapter["paragraphs"]]
    return hashlib.sha256(json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def book_config(book_id: str) -> dict:
    p = BOOK_CONFIG / book_id / "config.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


class Sealer:
    def __init__(self, password: str):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # 암호화 빌드에서만 필요
        if not CRYPTO_FILE.exists():
            CRYPTO_FILE.write_text(json.dumps({"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITERATIONS,
                                               "salt": b64(os.urandom(16))}, indent=1) + "\n")
        cfg = json.loads(CRYPTO_FILE.read_text())
        self.salt_b64, self.iter = cfg["salt"], cfg["iter"]
        self.key = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(self.salt_b64), self.iter, 32)
        self.aes = AESGCM(self.key)

    def seal_text(self, plain: str) -> dict:
        iv = os.urandom(12)
        return {"v": 1, "iter": self.iter, "salt": self.salt_b64, "iv": b64(iv),
                "ct": b64(self.aes.encrypt(iv, plain.encode(), None))}

    def seal_bytes(self, data: bytes) -> bytes:
        """파일 형식: iv(12바이트) + 암호문. 브라우저(audiobook.js openBox)가 같은 방식으로 푼다."""
        iv = os.urandom(12)
        return iv + self.aes.encrypt(iv, data, None)

    def open_bytes(self, blob: bytes) -> bytes:
        return self.aes.decrypt(blob[:12], blob[12:], None)

    def seal_file(self, src: Path, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".tmp")
        tmp.write_bytes(self.seal_bytes(src.read_bytes()))
        tmp.replace(dest)

    def asset_name(self, chapter_id: str, mp3_sha: str) -> str:
        tag = hmac.new(self.key, mp3_sha.encode(), hashlib.sha256).hexdigest()[:12]
        return f"{chapter_id}-{tag}.bin"


def read_password() -> str:
    pw = os.environ.get("AUDIOBOOK_PASSWORD") or (PASSWORD_FILE.read_text().rstrip("\n") if PASSWORD_FILE.exists() else "")
    if len(pw) < 12:
        sys.exit(f"암호가 없거나 12자보다 짧습니다. 먼저 `python3 scripts/audiobook_password.py` 로 정하세요 ({PASSWORD_FILE})")
    return pw

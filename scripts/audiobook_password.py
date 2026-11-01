#!/usr/bin/env python3
"""오디오북 페이지 암호를 정한다 → ~/.config/macsalogs/audiobook_password (권한 600, 저장소 밖).

    python3 scripts/audiobook_password.py

입력은 화면에 보이지 않는다. 12자 이상. 정한 뒤 scripts/build_audiobook.py 를 다시 돌리면 새 암호로 잠긴다.
암호를 바꾸면 이미 올린 음원(.bin)도 새 열쇠로 다시 만들어 올려야 한다 (파일 이름이 바뀐다).
잊어버리면 되살릴 방법이 없다 — 새로 정하고 다시 빌드하면 된다 (원본은 저장소 밖에 그대로 있다).
"""

import getpass
import os
import sys
from pathlib import Path

PASSWORD_FILE = Path(os.path.expanduser("~/.config/macsalogs/audiobook_password"))


def main() -> int:
    if PASSWORD_FILE.exists():
        print(f"이미 암호가 있습니다: {PASSWORD_FILE}  (새로 정하면 덮어씁니다)")
    pw = getpass.getpass("새 암호 (12자 이상): ")
    if len(pw) < 12:
        print("12자보다 짧습니다. 저장하지 않았습니다.", file=sys.stderr)
        return 1
    if getpass.getpass("한 번 더: ") != pw:
        print("두 번 입력한 암호가 다릅니다. 저장하지 않았습니다.", file=sys.stderr)
        return 1
    PASSWORD_FILE.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(PASSWORD_FILE.parent, 0o700)
    fd = os.open(PASSWORD_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(pw + "\n")
    os.chmod(PASSWORD_FILE, 0o600)
    print(f"저장했습니다: {PASSWORD_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

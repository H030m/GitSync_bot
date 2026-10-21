"""GitSync Bot /live-alert ask：用 upstream/ask.py 的 ask() 回答一題（prompt、輸出格式與 Windows 版相同）。

用法：python ask_once.py <逐字稿.txt> [--model sonnet] [--effort medium]
題目從 stdin 讀，答案印到 stdout。
"""
import argparse
import os
import shutil
import subprocess  # noqa: F401  必須在放 msvcrt stub 之前載入：subprocess 用「能否 import msvcrt」判斷是否為 Windows
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "upstream"))
# ask.py 頂層 import msvcrt（Windows 專用），只有互動模式的 flush_keys 用到
sys.modules.setdefault("msvcrt", types.ModuleType("msvcrt"))
import ask  # noqa: E402  upstream/ask.py

os.umask(0o077)

IDEAS_SYSTEM = (
    "你在幫一位大學生想要在課堂上問老師的問題。<transcript> 是老師最近講的內容（任何科目都可能），由語音辨識產生，錯字很多，請依上下文理解。"
    "請根據老師『實際講到的內容』，想出學生可以現場舉手問的問題。"
    "問題的程度與口吻：像普通學生日常會問的，口語、白話、好懂；從自己的生活經驗或實際遇到的狀況出發，或問『那我該怎麼做』『為什麼會這樣』；"
    "不要堆專有名詞、不要艱澀、不要刁鑽或奇怪的問法。"
    "以下範例只示範『程度與口吻』，主題各不相同，絕對不要照抄範例的題材，一定要換成老師實際講到的內容：\n"
    "- 老師，我壓力大的時候會一直滑手機停不下來，這算是成癮嗎？還是只是習慣？\n"
    "- 老師，如果一整個禮拜都沒睡好，週末一次補眠有用嗎？\n"
    "- 老師，我背東西常常背完就忘，是不是我的方法有問題？有比較簡單的記法嗎？\n"
    "- 老師，戒掉一個很愛的東西，過幾個月會不會又變回來？\n"
    "- 老師，為什麼心情不好的時候特別想吃東西？\n"
    "輸出要求：每題一到兩句，用「老師，」開頭；每題後面用括號簡短註明接的是老師講到的哪一點；"
    "題目之間切入點要不同；繁體中文；只輸出編號清單（1. 2. 3. …），不要前言、不要結尾。"
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("transcript", type=Path)
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--effort", default="medium")
    ap.add_argument("--ideas", type=int, default=0, help="改成產生這麼多個課堂提問建議（忽略 stdin 題目）")
    ap.add_argument("--tail", type=int, default=160, help="--ideas 只看逐字稿最後這麼多行（約最近十幾分鐘）")
    args = ap.parse_args()

    question = sys.stdin.read().strip()
    if not args.ideas and not question:
        print("（沒有題目）")
        return 1
    claude = os.environ.get("STREAM2TXT_CLAUDE") or shutil.which("claude")
    if not claude or not os.path.exists(claude):
        print("找不到 claude 指令（Claude Code CLI）。")
        return 1
    # ask() 以 OUTDIR 當 claude 的 cwd；upstream/output 不一定存在，改用工作區內的私有目錄
    work = HERE / "cache" / "ask"
    work.mkdir(parents=True, exist_ok=True, mode=0o700)
    ask.OUTDIR = str(work)
    if args.ideas:
        lines = args.transcript.read_text(encoding="utf-8", errors="replace").splitlines()[-args.tail:]
        excerpt = work / f"ideas-{os.getpid()}.txt"
        excerpt.write_text("\n".join(lines) + "\n", encoding="utf-8")
        ask.SYSTEM = IDEAS_SYSTEM
        try:
            print(ask.ask(f"請想出 {args.ideas} 個我可以在課堂上問老師的問題。", [str(excerpt)], args.model, args.effort, claude))
        finally:
            excerpt.unlink(missing_ok=True)
        return 0
    print(ask.ask(question, [str(args.transcript)], args.model, args.effort, claude))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

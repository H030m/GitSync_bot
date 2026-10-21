"""LLM 判斷：最近一段逐字稿裡，教授是否正在宣布／開始一個課堂 quiz（不依賴 "Quiz" 字樣）。
worker 與評估共用，所以 prompt 只寫在這裡。"""
import json, os, re, shutil, subprocess

SYSTEM = (
    "你是課堂直播的偵測助手。使用者會給你一段最近約 90 秒的語音辨識逐字稿（辨識品質差，同音錯字很多，"
    "例如 Quiz 常被聽成「跪子」「褪子」「規則」「CREASE」，也可能完全沒提到 quiz 這個字）。"
    "任務：判斷教授『現在』是不是正在宣布、準備或開始一個要同學作答的課堂小測驗／即時問答／投票"
    "（例如：接下來我們就進行今天的第N個…、等一下問大家一個問題請大家回答、給大家一分鐘作答、請選一個選項）。"
    "不算：教授講解課程內容、回答同學的提問、閒聊、只是提到考試這個詞、公布成績或解答已經結束的題目。"
    "不確定時傾向回答 true。只輸出一行 JSON，不要多寫："
    '{"quiz": true 或 false, "why": "二十字內理由"}'
)

def build_prompt(lines):
    return "<transcript>\n" + "\n".join(lines) + "\n</transcript>"

MIN_CHARS = 15  # 視窗幾乎沒字（教授沒在講話）就不問：2026-10-21 評估時空視窗讓模型亂回 true／照抄格式


def ask_llm(lines, claude=None, model="haiku", effort="low", cwd=".", timeout=40):
    if sum(len(x) for x in lines) < MIN_CHARS:
        return False, "(視窗太短，略過)"
    claude = claude or os.environ.get("STREAM2TXT_CLAUDE") or shutil.which("claude")
    r = subprocess.run(
        [claude, "-p", "--model", model, "--effort", effort, "--tools", "", "--strict-mcp-config",
         "--disable-slash-commands", "--no-session-persistence", "--system-prompt", SYSTEM],
        input=build_prompt(lines), capture_output=True, encoding="utf-8", errors="replace", cwd=cwd, timeout=timeout)
    out = (r.stdout or "").strip()
    m = re.search(r'\{[^{}]*"quiz"\s*:\s*(true|false)[^{}]*\}', out)
    if not m:
        return None, out[:200]
    try:
        j = json.loads(m.group(0)); return bool(j["quiz"]), str(j.get("why", ""))
    except Exception:
        return (m.group(1) == "true"), m.group(0)[:200]

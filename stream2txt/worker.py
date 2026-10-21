"""GitSync Bot /live-alert 的轉錄 worker。

轉錄沿用 upstream/run.py（transcribe_stream），偵測沿用 upstream/alert.py（Detector），
兩者都不修改；這裡只把 alert.py 的 Windows toast 換成 stdout JSON 事件交給 bot。
協定見 bot 的 src/live/liveAlertManager.ts 開頭註解。

stdout 只輸出 JSON 行；run.py 原本印到 stdout 的進度改寫進 <output>.log。
"""
from __future__ import annotations

import _thread
import argparse
import json
import os
import re
import shutil
import signal
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "upstream"))

os.umask(0o077)
JSON_OUT = sys.stdout
_emit_lock = threading.Lock()


def emit(**event) -> None:
    with _emit_lock:
        JSON_OUT.write(json.dumps(event, ensure_ascii=False) + "\n")
        JSON_OUT.flush()


class StreamEnded(Exception):
    """原本是直播，重新解析後已不是直播（直播結束，yt-dlp 改回傳錄影）。"""


class NotLive(Exception):
    """一開始給的就不是進行中的直播（已結束的直播錄影或一般影片）。"""


class FfmpegFailing(Exception):
    """ffmpeg 一開就死（例如 segfault、持續 403）；run.py 會無限重開，必須由這裡中止。"""


RAPID_REOPEN_SECONDS = 5.0  # 正常每 refresh-seconds（25s）才重開
RAPID_REOPEN_LIMIT = 3


def crashed(process) -> bool:
    """被 signal 殺掉但不是 run.py 自己送的 SIGTERM／SIGKILL。"""
    rc = process.poll() if process is not None else None
    return rc is not None and rc < 0 and rc not in (-signal.SIGTERM, -signal.SIGKILL)


def patch_ydl_opts(opts: dict, node: str) -> dict:
    """run.py 的 "worst[acodec!=none]" 只選影音合一格式；yt-dlp 2026.08 起部分 VOD 只剩 DASH，
    所以 audio-only 優先，原選擇器留作 fallback（直播 HLS 是影音合一）。"""
    patched = {**opts, "js_runtimes": {"node": {"path": node}}}
    if "format" in opts:
        patched["format"] = "worstaudio/" + opts["format"]
    return patched


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--max-seconds", required=True, type=int)
    ap.add_argument("--model", default="base")
    ap.add_argument("--language", default="auto")
    ap.add_argument("--refresh-seconds", type=float, default=25.0)
    ap.add_argument("--chunk-seconds", type=float, default=5.0)
    ap.add_argument("--cpu-threads", type=int, default=min(4, os.cpu_count() or 1))
    # 2026-10-21 實驗（research/exp）：教授實際說法當提示，quiz 片段轉出 Quiz 10/18 → 17/18，對照組誤報 0/30（含 LEAK 過濾）
    ap.add_argument("--hotwords", default=HOTWORDS)
    ap.add_argument("--llm-model", default=os.environ.get("STREAM2TXT_LLM_MODEL", "haiku"))
    ap.add_argument("--no-llm", action="store_true", default=os.environ.get("STREAM2TXT_LLM") == "0")
    ap.add_argument("--allow-vod", action="store_true", help="測試用：允許非直播影片")
    return ap.parse_args()


# 補 alert.py：教授宣布 quiz 的固定句型，不管 Quiz 被聽成什麼字（跪子、褪子、規則…）。
# 2026-10-21 在 5 份逐字稿上驗證：0 誤報，補到 10/14 VOD 漏的第 4 個。句子常被切兩行，所以看最近 3 行。
ANNOUNCE = re.compile(r"(進行|进行|進入|进入)\s*(今天的?)?\s*第[一二三四五六七八九十\d]+\s*[個个]")
ANNOUNCE_LINES = 3

# 「我們就來先考一個很簡單的題目」「接下來就考驗大家一個問題」：教授沒說 Quiz 也沒說第 N 個的出題講法。
# 要有 先／來／就／要 開頭的「考」再接 大家／你們／一個…，所以「思考」「考過」「考試」「參考」都不會中。
ASK_TEST = re.compile(r"[先來来就要]考(驗|验)?(大家|你們|你们|各位|一[個个題题]|[個个])")

HOTWORDS = "接下來我們就進行今天的第一個 Quiz。第二個 Quiz。最後一個 Quiz。Quiz 小考 同學"

# hotwords 會被放進 Whisper 的前文提示；遇到聽不懂的聲音時，Whisper 偶爾把提示原文抄出來
# （2026-10-21 對照組實測：「Quiz 小考 同學 我現在聽到已經」）。偵測前先刪掉一字不差的提示片段；
# 正常講話不會連著說「第二個 Quiz。最後一個 Quiz。」，所以不會擋到真的 quiz。
LEAK = re.compile(r"Quiz\s*小考\s*同[學学]|(第一個 Quiz。)?第二個 Quiz。最後一個 Quiz。|(?:Quiz[\s.。,，]*){2,}")
# 最後一段：「Quiz.Quiz.」連續重複只隔標點／空白，是提示抄寫的變形（2026-10-21 16:06 誤報「另外一篇 Quiz.Quiz.」）
ANNOUNCE_COOLDOWN_LINES = 20


LLM_INTERVAL = 15.0      # 秒；每次看最近 LLM_SPAN 秒的逐字稿（使用者 2026-10-21 要求由 30 改 15）
LLM_SPAN = 90.0
LLM_COOLDOWN = 180.0     # LLM 通知之間
RULE_SUPPRESS = 120.0    # 規則剛通知過 quiz，LLM 不重複（規則漏掉的才由 LLM 補）
LLM_FAILS_MAX = 8        # 連續失敗這麼多次就停用（例如 claude 沒登入），不影響規則偵測

# 規則命中這些類別時，先請 LLM 複審再通知：教授在回答／轉述同學提問時，「同學問題」會一直響（使用者 2026-10-21）。
# 只有 LLM 明確回答 false 才擋；回答 true、無法解析、逾時、呼叫失敗一律照常通知（寧可多通知）。
REVIEW_CATEGORIES = {"同學問題", "小考", "疑似 Quiz（3分：Quiz字樣）"}   # 後者＝只靠「Quiz」字樣、沒有其他線索的弱通知
# 2026-10-21 在 6 堂課實測（review_all_eval）：全部通知都審會掉 1/30 個真 quiz；只審這三類 0/30 掉、誤報大多擋掉。
# 有「第 N 個」「接下來進入」等額外線索的計分≥4、宣布句型、考題句型一律直接放行。
REVIEW_MAX_PENDING = 2   # 同時複審超過這麼多筆就直接放行，避免積壓

# 通知過 quiz（規則的 Quiz 類、宣布句型、LLM 判斷）之後，這段時間內不再通知「同學問題」：
# 出題期間教授會一直說「請同學回答」，但 quiz 之間最短也隔 13.6 分鐘（6 堂課 30 個標註，中位數 31 分鐘）。
# 使用者 2026-10-21 指定約 3 分鐘（原本我設 10 分鐘；宣布後 3 分鐘內佔「同學問題」命中的 45%，10 分鐘 85%）。
# 只靜音這一類，Quiz／LLM／小考／點名不受影響。
QUIZ_QUIET = 180.0
QUIET_CATEGORIES = {"同學問題"}


class Tailer:
    """跟 alert.py watch() 一樣：從檔尾開始讀新增的完整行，餵給 Detector。"""

    def __init__(self, path: Path, detector):
        self.fh = open(path, encoding="utf-8", errors="replace")
        self.fh.seek(0, os.SEEK_END)  # 續跑（bot 重啟）時不重複通知舊內容
        self.detector = detector
        self.lock = threading.Lock()
        self.recent: list[str] = []
        self.lines = 0
        self.last_pattern: dict[str, int] = {}
        self.review = None                                  # 設了才會對 REVIEW_CATEGORIES 複審：(category, body, t, window) -> None
        self.recent_lines: list[tuple[float, str]] = []   # (monotonic, 文字)，給 LLM 用
        self.last_rule_quiz = -1e9                          # 規則最後一次發 quiz 類通知的 monotonic
        self.last_quiz_any = -1e9                           # 任何來源（規則／宣布句型／LLM）最後一次 quiz 通知
        self.seq = 0

    def poll(self, parse) -> None:
        with self.lock:
            while True:
                pos = self.fh.tell()
                line = self.fh.readline()
                if not line:
                    return
                if not line.endswith("\n"):
                    self.fh.seek(pos)
                    return
                t, text = parse(line)
                if t is None:
                    continue
                text = LEAK.sub("", text).strip()
                if not text:
                    continue
                now = time.monotonic()
                self.recent_lines = [(m, x) for m, x in self.recent_lines if now - m <= LLM_SPAN] + [(now, text)]
                self.seq += 1
                for category, body in self.detector.feed(t, text):
                    if category in QUIET_CATEGORIES and now - self.last_quiz_any < QUIZ_QUIET:
                        print(f"quiet: {category} suppressed {now - self.last_quiz_any:.0f}s after a quiz alert :: {body[:50]}", file=sys.stderr)
                        continue
                    if self.review is not None and category in REVIEW_CATEGORIES:
                        self.review(category, body, t, [x for _, x in self.recent_lines])
                        continue
                    emit(type="quiz", category=category, text=body, stream_time=t)
                    if "Quiz" in category:
                        self.last_rule_quiz = now
                        self.last_quiz_any = now
                self.lines += 1
                self.recent = (self.recent + [text])[-ANNOUNCE_LINES:]
                joined = " / ".join(self.recent)
                for name, rx in (("宣布句型", ANNOUNCE), ("考題句型", ASK_TEST)):
                    if rx.search("".join(self.recent)) and self.lines - self.last_pattern.get(name, -ANNOUNCE_COOLDOWN_LINES) >= ANNOUNCE_COOLDOWN_LINES:
                        self.last_pattern[name] = self.lines
                        emit(type="quiz", category=f"疑似 Quiz（{name}）", text=joined, stream_time=t)
                        self.last_rule_quiz = now
                        self.last_quiz_any = now


def llm_loop(tailer: "Tailer", stop: dict, model: str) -> None:
    """規則沒抓到時的第二條路：定期把最近 90 秒逐字稿交給 Claude，判斷是不是在宣布 quiz（不需要 Quiz 字樣）。
    只會「多」通知，從不攔截規則的通知（使用者要求：寧可多通知）。"""
    import llm_gate  # noqa: E402  stream2txt/llm_gate.py

    claude = os.environ.get("STREAM2TXT_CLAUDE") or shutil.which("claude")
    if not claude or not os.path.exists(claude):
        emit(type="status", message="llm gate disabled: claude CLI not found")
        return
    cwd = HERE / "cache" / "ask"
    cwd.mkdir(parents=True, exist_ok=True, mode=0o700)
    last_seq, last_alert, fails = -1, -1e9, 0
    while stop["reason"] != "done" and fails < LLM_FAILS_MAX:
        time.sleep(LLM_INTERVAL)
        if stop["reason"] is not None:
            return
        with tailer.lock:
            seq, win = tailer.seq, [x for _, x in tailer.recent_lines]
        now = time.monotonic()
        if seq == last_seq or now - tailer.last_rule_quiz < RULE_SUPPRESS or now - last_alert < LLM_COOLDOWN:
            continue
        last_seq = seq
        try:
            verdict, why = llm_gate.ask_llm(win, claude=claude, model=model, cwd=str(cwd))
        except Exception as e:  # 逾時、CLI 失敗
            verdict, why = None, repr(e)[:120]
        if verdict is None:
            fails += 1
            print(f"llm gate unparsable/failed ({fails}/{LLM_FAILS_MAX}): {why}", file=sys.stderr)
            continue
        fails = 0
        if verdict and time.monotonic() - tailer.last_rule_quiz >= RULE_SUPPRESS:
            last_alert = time.monotonic()
            tailer.last_quiz_any = last_alert
            emit(type="quiz", category="LLM 判斷", text=f"{why}｜{' / '.join(win[-2:])}"[:300], stream_time=0)
    if fails >= LLM_FAILS_MAX:
        emit(type="status", message="llm gate disabled after repeated failures")


def make_reviewer(claude: str, model: str, tailer: "Tailer"):
    """回傳 review(category, body, t, window)：背景執行緒問 LLM，false 才擋，其餘照發。"""
    import llm_gate  # noqa: E402

    cwd = HERE / "cache" / "ask"
    cwd.mkdir(parents=True, exist_ok=True, mode=0o700)
    pending = {"n": 0}
    lock = threading.Lock()

    def work(category, body, t, window):
        verdict, why = None, ""
        try:
            verdict, why = llm_gate.ask_llm(window, claude=claude, model=model, cwd=str(cwd))
        except Exception as e:
            why = repr(e)[:120]
        finally:
            with lock:
                pending["n"] -= 1
        if verdict is False:
            print(f"review: suppressed {category} ({why}) :: {body[:60]}", file=sys.stderr)
            return
        emit(type="quiz", category=category, text=body, stream_time=t)
        if "Quiz" in category:                      # 通過複審才算「通知過 quiz」：啟動 LLM 抑制與同學問題靜音期
            tailer.last_rule_quiz = tailer.last_quiz_any = time.monotonic()

    def review(category, body, t, window):
        with lock:
            if pending["n"] >= REVIEW_MAX_PENDING:
                direct = True
            else:
                pending["n"] += 1
                direct = False
        if direct:
            emit(type="quiz", category=category, text=body, stream_time=t)
            return
        threading.Thread(target=work, args=(category, body, t, window), daemon=True).start()

    return review


def main() -> int:
    args = parse_args()
    output = args.output.resolve()
    log_fh = open(output.with_suffix(".log"), "a", encoding="utf-8", buffering=1)
    sys.stdout = log_fh  # run.py 的 print 全部進 log，stdout 留給 JSON

    import run  # noqa: E402  upstream/run.py
    import alert  # noqa: E402  upstream/alert.py
    from faster_whisper import WhisperModel
    from yt_dlp import YoutubeDL

    # yt-dlp 沒有 JS runtime 時 YouTube 會缺 format；用 bot 那支 node
    node = os.environ.get("STREAM2TXT_NODE") or shutil.which("node")
    if node:
        run.YoutubeDL = lambda opts: YoutubeDL(patch_ydl_opts(opts, node))

    was_live = {"value": False}
    opens = {"last_at": None, "rapid": 0, "process": None}
    original_open = run.open_audio_stream

    def guarded_open(source, buffer_size, input_device=None):
        now = time.monotonic()
        previous = opens["process"]
        if previous is not None and crashed(previous):
            raise FfmpegFailing(f"ffmpeg 異常結束（returncode {previous.returncode}）")
        if opens["last_at"] is not None and now - opens["last_at"] < RAPID_REOPEN_SECONDS:
            opens["rapid"] += 1
            if opens["rapid"] >= RAPID_REOPEN_LIMIT:
                raise FfmpegFailing(f"串流連續 {RAPID_REOPEN_LIMIT} 次開啟後立刻中斷")
        else:
            opens["rapid"] = 0
        opens["last_at"] = now
        process, downloader, live_source = original_open(source, buffer_size, input_device)
        opens["process"] = process
        # 直播結束後 yt-dlp 會改回傳整場錄影；不擋的話會從頭重轉、重發 quiz（crash 重試／bot 重啟後也一樣）
        if not live_source and (was_live["value"] or not args.allow_vod):
            process.kill()
            process.wait()
            raise StreamEnded() if was_live["value"] else NotLive()
        was_live["value"] = was_live["value"] or live_source
        return process, downloader, live_source

    run.open_audio_stream = guarded_open

    if shutil.which("ffmpeg") is None:
        emit(type="error", message="找不到 ffmpeg")
        print("找不到 ffmpeg", file=sys.stderr)
        return 1

    emit(type="status", message=f"loading model {args.model}")
    model = WhisperModel(
        args.model, device="cpu", compute_type="int8",
        cpu_threads=args.cpu_threads, download_root=str(HERE / "models"),
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    output.touch(exist_ok=True)
    tailer = Tailer(output, alert.Detector())

    stop = {"reason": None}
    deadline = time.monotonic() + args.max_seconds
    parent = os.getppid()

    def on_sigterm(signum, frame):
        stop["reason"] = stop["reason"] or "terminated"
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, on_sigterm)

    def watcher():
        while stop["reason"] != "done":
            try:
                tailer.poll(alert.parse)
            except Exception as e:  # 偵測失敗不能拖垮轉錄
                print(f"detector error: {e!r}", file=sys.stderr)
            if stop["reason"] is None:
                if time.monotonic() >= deadline:
                    stop["reason"] = "deadline"
                    _thread.interrupt_main()
                elif os.getppid() != parent:  # bot 被殺掉，不留孤兒
                    stop["reason"] = "parent-gone"
                    _thread.interrupt_main()
            time.sleep(1.0)

    threading.Thread(target=watcher, daemon=True).start()
    if not args.no_llm:
        threading.Thread(target=llm_loop, args=(tailer, stop, args.llm_model), daemon=True).start()
        claude = os.environ.get("STREAM2TXT_CLAUDE") or shutil.which("claude")
        if claude and os.path.exists(claude):
            tailer.review = make_reviewer(claude, args.llm_model, tailer)

    run_args = argparse.Namespace(
        source=args.url, output=output, model=args.model, language=args.language,
        chunk_seconds=args.chunk_seconds, cpu_threads=args.cpu_threads,
        refresh_seconds=args.refresh_seconds, input_device=None, hotwords=args.hotwords,
        download_only=False,
    )
    emit(type="status", message="transcribing")
    try:
        run.transcribe_stream(run_args, model)
    except StreamEnded:
        stop["reason"] = stop["reason"] or "stream-ended"
    except NotLive:
        stop["reason"] = stop["reason"] or "not-live"
    except FfmpegFailing as e:
        stop["reason"] = stop["reason"] or "failed"
        emit(type="error", message=str(e))
        print(f"錯誤：{e}", file=sys.stderr)
    except KeyboardInterrupt:
        pass
    finally:
        tailer.poll(alert.parse)  # 最後幾行也要偵測
        reason = stop["reason"]
        stop["reason"] = "done"

    last = opens["process"]
    if reason is None and last is not None and last.poll() not in (0, None):  # 非直播來源：ffmpeg 失敗（403、crash）不是「播完」
        print(f"錯誤：ffmpeg 異常結束（returncode {opens['process'].returncode}）", file=sys.stderr)
        reason = "failed"
    if reason == "failed":
        return 1

    if reason is None:  # 非直播來源播完
        reason = "stream-ended"
    if reason in ("deadline", "stream-ended", "not-live"):
        emit(type="end", reason=reason)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

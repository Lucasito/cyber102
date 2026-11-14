"""Record real public pages; no account, fixtures, intercepted answers or submitted applications.

Requirements: Python 3.12+, playwright, imageio-ffmpeg, edge-tts, Chrome, internet for voice generation.
Run: python -X utf8 scripts/record-demo.py [--rehearse]
"""
import argparse
import json
import subprocess
import sys
import time
import wave
from datetime import datetime, timedelta, timezone
from pathlib import Path

import imageio_ffmpeg
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/video"
WORK = ROOT / "test-results/demo-recording"
BASE = "https://afisha.193-47-33-213.sslip.io"
SCENES = json.loads((OUT / "scenes.json").read_text(encoding="utf-8"))


def narration(reuse_voice=False):
    voice_dir = WORK / "voice-neural"
    if not reuse_voice:
        subprocess.run([sys.executable, "-X", "utf8", str(ROOT / "scripts/demo-voice.py"),
                        "--output", str(voice_dir)], check=True)
    # Place each spoken section at its chapter boundary. Never truncate speech.
    with wave.open(str(voice_dir / "scene-0.wav"), "rb") as first:
        params = first.getparams()
    frame_size = params.nchannels * params.sampwidth
    audio = bytearray(300 * params.framerate * frame_size)
    durations = []
    for i, scene in enumerate(SCENES):
        with wave.open(str(voice_dir / f"scene-{i}.wav"), "rb") as source:
            assert source.getparams()[:3] == params[:3]
            frames = source.readframes(source.getnframes())
        duration = len(frames) / frame_size / params.framerate
        assert duration + 0.5 < scene["end"] - scene["start"], f"Speech too long: {scene['title']}: {duration}"
        start = int((scene["start"] + 0.5) * params.framerate) * frame_size
        audio[start:start + len(frames)] = frames
        durations.append(round(duration, 2))
    with wave.open(str(WORK / "narration.wav"), "wb") as target:
        target.setparams(params)
        target.writeframes(audio)
    return durations


def record(rehearse=False):
    WORK.mkdir(parents=True, exist_ok=True)
    tomorrow = (datetime.now(timezone(timedelta(hours=5))) + timedelta(days=1)).strftime("%Y-%m-%d")
    evidence = {"site": BASE, "recordedAt": datetime.now(timezone.utc).isoformat(), "voice": "ru-RU-SvetlanaNeural", "cursorOverlay": True, "chapters": [], "clicks": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        options = {"viewport": {"width": 1920, "height": 1080}, "locale": "ru-RU", "timezone_id": "Asia/Yekaterinburg"}
        if not rehearse:
            options.update(record_video_dir=str(WORK), record_video_size={"width": 1920, "height": 1080})
        context = browser.new_context(**options)
        context.add_init_script(path=ROOT / "scripts/demo-pointer.js")
        start = time.monotonic()
        context.expose_function("demoClick", lambda x, y, target: evidence["clicks"].append({
            "second": round(time.monotonic() - start, 2), "x": x, "y": y, "target": target}))
        page_created = time.monotonic()
        page = context.new_page()
        page.set_default_timeout(15000)
        page.goto(BASE, wait_until="networkidle")
        event_url = page.locator('a[href^="/events/"]').first.get_attribute("href")
        page.wait_for_timeout(500)
        start = time.monotonic()
        trim = start - page_created

        def at(second):
            if not rehearse:
                page.wait_for_timeout(max(0, (start + second - time.monotonic()) * 1000))

        def chapter(index):
            scene = SCENES[index]
            at(scene["start"])
            print(f"{scene['start']:03d}s {scene['title']}", flush=True)
            evidence["chapters"].append({"start": scene["start"], "title": scene["title"]})

        def screenshot(name):
            page.screenshot(path=str(WORK / f"{name}.png"))

        def point(locator):
            locator.scroll_into_view_if_needed()
            box = locator.bounding_box()
            if not box:
                raise RuntimeError("Cannot point at a hidden control")
            page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=18)
            page.wait_for_timeout(180)

        def click(locator):
            point(locator)
            locator.click(delay=100)
            page.wait_for_timeout(420)

        def fill(locator, value):
            click(locator)
            locator.fill(value)
            page.wait_for_timeout(200)

        def select(locator, value):
            click(locator)
            locator.press("Escape")
            locator.select_option(value)
            page.wait_for_timeout(300)

        def go(route):
            if route == "/":
                link = page.locator('header a[href="/"]').first
            else:
                link = page.locator(f'a[href="{route}"]').first
            click(link)
            page.wait_for_url(BASE + route)
            page.locator("main").first.wait_for(state="visible")
            page.wait_for_timeout(400)

        def ask(text):
            box = page.locator("textarea")
            click(box)
            box.press_sequentially(text, delay=35)
            click(page.get_by_role("button", name="Отправить", exact=True))
            # A finished request restores focus to the textarea and removes the waiting status.
            page.wait_for_timeout(300)
            page.wait_for_function("!document.querySelector('[role=status]')", timeout=60000)
            page.wait_for_timeout(700)

        try:
            chapter(0)
            at(12)
            page.locator("#events").scroll_into_view_if_needed()
            screenshot("01-catalog")
            at(22)
            page.evaluate("window.scrollTo({top:0,behavior:'smooth'})")

            chapter(1)
            click(page.get_by_role("link", name="Завтра", exact=True))
            page.wait_for_function("[...document.querySelectorAll('a')].some(a => a.textContent === 'Кино' && a.getAttribute('href').includes('dateFrom='))")
            click(page.get_by_role("link", name="Кино", exact=True))
            page.wait_for_function("location.search.includes('category=cinema') && location.search.includes('dateFrom=')")
            page.wait_for_timeout(1000)
            screenshot("02-filtered")
            at(40)
            click(page.get_by_role("link", name="На карте", exact=True))
            page.wait_for_timeout(2000)
            screenshot("03-map")
            at(51)
            click(page.get_by_role("link", name="Списком", exact=True))

            chapter(2)
            go("/")
            ask("Куда сходить?")
            at(68)
            click(page.get_by_role("button", name="Новый разговор", exact=True))
            ask("Уфа, завтра, с ребёнком 6 лет, до 1000 рублей")
            evidence["familyAnswer"] = page.locator("body").inner_text()[:7000]
            if "✓ Уфа" not in evidence["familyAnswer"]:
                raise RuntimeError("Family demonstration did not preserve the city. Retry after the assistant recovers.")
            screenshot("04-family-answer")
            at(94)
            ask("А дешевле?")
            screenshot("05-cheaper")
            evidence["cheaperAnswer"] = page.locator("body").inner_text()[:9000]
            cards = page.locator('a[href^="/events/"]')
            if cards.count():
                event_url = cards.first.get_attribute("href")

            chapter(3)
            go(event_url)
            evidence["event"] = page.url
            screenshot("06-event")
            at(133)
            source = page.locator('main p').filter(has_text="Источник").last
            if source.count():
                source.first.scroll_into_view_if_needed()
                point(source.locator("a").first)
            at(142)
            click(page.locator('main button[aria-label="В избранное"]').first)
            go("/favorites")
            screenshot("07-favorites")
            at(151)
            go(event_url)
            calendar = page.locator('a[href$="/ics"]')
            with page.expect_download():
                click(calendar.first)

            chapter(4)
            go("/plan")
            fill(page.locator('[name="date"]'), tomorrow)
            select(page.locator('[name="city"]'), "Уфа")
            fill(page.locator('[name="persons"]'), "2")
            fill(page.locator('[name="budget"]'), "3000")
            select(page.locator('[name="count"]'), "2")
            for choice in page.locator('[name="types"]').all():
                if choice.is_checked() and choice.get_attribute("value") != "cinema":
                    click(choice)
            screenshot("08-plan-form")
            at(175)
            click(page.get_by_role("button", name="Составить план", exact=True))
            page.locator("#plan").wait_for()
            page.locator("#plan").scroll_into_view_if_needed()
            evidence["plan"] = page.locator("#plan").inner_text()
            screenshot("09-plan-result")

            chapter(5)
            go("/docs/widget")
            selects = page.locator("select")
            select(selects.nth(0), "Уфа")
            select(selects.nth(1), "cinema")
            at(217)
            page.get_by_text("Предпросмотр", exact=True).scroll_into_view_if_needed()
            page.wait_for_timeout(2000)
            screenshot("10-widget-ru")
            at(231)
            # Select by its actual option to avoid relying on translated labels.
            select(page.locator("select").filter(has=page.locator('option[value="ba"]')), "ba")
            page.get_by_text("Предпросмотр", exact=True).scroll_into_view_if_needed()
            page.wait_for_timeout(2000)
            screenshot("11-widget-ba")

            chapter(6)
            go("/docs/format")
            go("/organizers/apply")
            screenshot("12-organizers")
            at(265)
            page.evaluate("window.scrollBy({top:350,behavior:'smooth'})")

            chapter(7)
            go("/")
            at(289)
            page.locator("#events").scroll_into_view_if_needed()
            screenshot("13-finish")
            at(301)
            video = page.video
        finally:
            context.close()
            browser.close()
        (WORK / "evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        if not rehearse:
            return str(video.path()), trim


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rehearse", action="store_true", help="Run all actions without recording or timed pauses")
    parser.add_argument("--reuse-voice", action="store_true", help="Reuse previously generated neural speech")
    args = parser.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    if args.rehearse:
        record(True)
        print("All demonstration actions completed.")
        return
    durations = narration(args.reuse_voice)
    print("Narration seconds per chapter:", durations, flush=True)
    raw, trim = record()
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    output = OUT / "afisha-demo-5min.mp4"
    encoded = WORK / "encoded-demo.mp4"
    metadata = ";FFMETADATA1\n" + "\n".join(
        f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={s['start'] * 1000}\nEND={s['end'] * 1000}\ntitle={s['title']}"
        for s in SCENES)
    (WORK / "chapters.ffmeta").write_text(metadata, encoding="utf-8")
    subprocess.run([ffmpeg, "-y", "-ss", str(trim), "-i", raw, "-i", str(WORK / "narration.wav"),
                    "-i", str(WORK / "chapters.ffmeta"), "-map", "0:v:0", "-map", "1:a:0", "-map_metadata", "2", "-map_chapters", "2",
                    "-t", "300", "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-pix_fmt", "yuv420p",
                    "-r", "25", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(encoded)],
                   check=True, stdout=subprocess.DEVNULL, stderr=(WORK / "encode.log").open("w"))
    subprocess.run([ffmpeg, "-v", "error", "-i", str(encoded), "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], check=True)
    encoded.replace(output)
    print(f"Saved {output} ({output.stat().st_size / 1024 / 1024:.1f} MB)", flush=True)


if __name__ == "__main__":
    main()

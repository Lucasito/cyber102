"""Create neural Russian narration from the public presentation text via Microsoft Edge TTS."""
import argparse
import asyncio
import json
import subprocess
import wave
from pathlib import Path

import edge_tts
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]


async def generate(output, voice):
    output.mkdir(parents=True, exist_ok=True)
    scenes = json.loads((ROOT / 'docs/video/scenes.json').read_text(encoding='utf-8'))
    info = []
    for i, scene in enumerate(scenes):
        # Regenerate slightly faster only when the spoken section does not fit its slot.
        for speed in [0, 8, 16, 24]:
            mp3 = output / f'scene-{i}.mp3'
            await edge_tts.Communicate(scene['text'], voice, rate=f'+{speed}%').save(str(mp3))
            wav = output / f'scene-{i}.wav'
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-loglevel', 'error', '-y', '-i', str(mp3),
                            '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', str(wav)], check=True)
            with wave.open(str(wav), 'rb') as audio:
                seconds = audio.getnframes() / audio.getframerate()
            if seconds + 0.5 < scene['end'] - scene['start']:
                break
        else:
            raise RuntimeError(f'Please shorten narration for {scene["title"]}: {seconds:.1f}s')
        info.append({'scene': i, 'seconds': round(seconds, 2), 'rate': speed})
        print(f'Voice {i + 1}/8: {seconds:.1f}s, rate +{speed}%', flush=True)
    (output / 'voice.json').write_text(json.dumps({'voice': voice, 'scenes': info}, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--voice', default='ru-RU-SvetlanaNeural')
    args = parser.parse_args()
    asyncio.run(generate(args.output, args.voice))

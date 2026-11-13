"""Run the optional local Qwen reference voice with no model downloads."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import wave

MAX_TOKENS = 340
RATE = 24000


def main(request_path):
    os.umask(0o077)
    request = json.loads(request_path.read_text())
    model_path = Path(request['model'])
    wav_path = Path(request['wav'])
    # Check the local assets before importing ML libraries or initializing Metal.
    for row in Path(request['modelLock']).read_text().splitlines():
        filename, size, expected = row.split('\t')
        file = model_path / filename
        if not file.is_file() or file.stat().st_size != int(size):
            raise ValueError('Reference voice model snapshot is incomplete.')
        with file.open('rb') as source:
            if hashlib.file_digest(source, 'sha256').hexdigest() != expected:
                raise ValueError('Reference voice model snapshot failed verification.')
    if not wav_path.is_file() or wav_path.stat().st_size > 30 * RATE * 2 + 4096:
        raise ValueError('Reference WAV must be a regular file no longer than 30 seconds.')
    with wave.open(str(wav_path), 'rb') as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, RATE):
            raise ValueError('Reference WAV needs mono 24 kHz PCM16.')
        frames = audio.getnframes()
        if not 3 * RATE <= frames <= 30 * RATE:
            raise ValueError('Reference WAV must contain 3–30 seconds of speech.')
        pcm = audio.readframes(frames)
        if len(pcm) != frames * 2:
            raise ValueError('Reference WAV is truncated.')
    sys.path.insert(0, request['sitePackages'])
    if importlib.metadata.version('mlx-audio') != '0.6.5':
        raise ValueError('Install MLX Audio 0.6.5 in the selected Python environment.')
    import mlx.core as mx
    import numpy as np
    from mlx_audio.tts.utils import load_model

    if mx.default_device() != mx.gpu or not mx.metal.is_available():
        raise ValueError('Reference narration requires a working MLX Metal environment.')
    reference = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    # Match the TypeScript upload check: 1% of full-scale PCM16 rounds up to 328.
    if np.max(np.abs(reference)) < 328 / 32768:
        raise ValueError('Reference WAV is silent or too quiet.')
    model = load_model(str(model_path))
    if model.config.tts_model_type != 'base' or not model.speech_tokenizer.has_encoder:
        raise ValueError('The reference voice needs the Qwen Base model and speech encoder.')
    for i, words in enumerate(request['utterances'], 1):
        mx.random.seed(7211 + i)
        parts = list(model.generate(text=words, lang_code='English', ref_audio=mx.array(reference),
                                    ref_text=request['transcript'], max_tokens=MAX_TOKENS))
        if not parts or any(part.token_count >= MAX_TOKENS for part in parts):
            raise ValueError(f'Reference narration beat {i} did not finish.')
        samples = np.concatenate([np.asarray(part.audio, dtype=np.float32) for part in parts])
        peak = np.max(np.abs(samples), initial=0)
        if not np.isfinite(samples).all() or not 0.01 <= peak < 1 or model.sample_rate != RATE:
            raise ValueError(f'Reference narration beat {i} did not produce clean PCM.')
        with wave.open(str(request_path.parent / f'reference-beat-{i}.wav'), 'wb') as wav:
            wav.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
            wav.writeframes((samples * 32767).round().astype('<i2').tobytes())


if __name__ == '__main__':
    try:
        main(Path(sys.argv[1]))
    except (ValueError, wave.Error, importlib.metadata.PackageNotFoundError) as error:
        print(f'{error}', file=sys.stderr)
        sys.exit(2)

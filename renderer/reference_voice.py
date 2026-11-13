"""Generate one offline Sesame CSM utterance per Manim beat."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch
import wave

RATE = 24000
MAX_AUDIO_MS = 24000
SEED = 20261113
MIMI_FILE = 'tokenizer-e351c8d8-checkpoint125.safetensors'
SESAME_SOURCE_SHA = '56b56a00e026e74077ee5f740eb8418a642b74dad489d66bb58444f61158d99d'


def sha256(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def block_network(event, _args):
    if event in {'socket.connect', 'socket.getaddrinfo', 'socket.gethostbyname',
                 'socket.gethostbyaddr', 'socket.getnameinfo', 'socket.sendto'}:
        raise PermissionError('Reference narration runs offline.')


def read_reference(path):
    if not path.is_file() or path.stat().st_size > 30 * RATE * 2 + 4096:
        raise ValueError('Reference WAV must be a regular file no longer than 30 seconds.')
    with wave.open(str(path), 'rb') as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, RATE):
            raise ValueError('Reference WAV needs mono 24 kHz PCM16.')
        frames = audio.getnframes()
        if not 3 * RATE <= frames <= 30 * RATE:
            raise ValueError('Reference WAV must contain 3–30 seconds of speech.')
        pcm = audio.readframes(frames)
        if len(pcm) != frames * 2:
            raise ValueError('Reference WAV is truncated.')
    return pcm


def load_model(path, mx):
    from mlx_audio.codec.models.mimi import mimi
    from mlx_audio.tts.models.sesame import sesame
    from mlx_audio.utils import apply_quantization

    config = json.loads((path / 'csm/config.json').read_text())
    config['use_default_voice_prompt'] = False
    from_pretrained = sesame.AutoTokenizer.from_pretrained

    def local_tokenizer(repo):
        if repo != sesame.TOKENIZER_REPO:
            raise ValueError('Unexpected Sesame tokenizer request.')
        return from_pretrained(str(path / 'tokenizer'), local_files_only=True, trust_remote_code=False)

    def local_mimi(repo, filename):
        if (repo, filename) != (sesame.MIMI_REPO, MIMI_FILE):
            raise ValueError('Unexpected Mimi weight request.')
        return str(path / 'mimi' / filename)

    with patch.object(sesame.AutoTokenizer, 'from_pretrained', local_tokenizer), \
            patch.object(mimi, 'hf_hub_download', local_mimi):
        model = sesame.Model(config)
    weights = model.sanitize(mx.load(str(path / 'csm/model.safetensors')))
    apply_quantization(model, config, weights, model.model_quant_predicate)
    # Mimi's own loader checked its codec weights separately.
    if any(not key.startswith('model.') for key in weights):
        raise ValueError('Unexpected Sesame checkpoint keys.')
    model.model.load_weights([(key.removeprefix('model.'), value) for key, value in weights.items()], strict=True)
    model.eval()
    mx.eval(model.parameters())
    return model


def main(request_path):
    os.umask(0o077)
    sys.addaudithook(block_network)
    request = json.loads(request_path.read_text())
    model_path = Path(request['model'])
    for row in Path(request['modelLock']).read_text().splitlines():
        filename, size, expected = row.split('\t')
        file = model_path / filename
        if not file.is_file() or file.stat().st_size != int(size) or sha256(file) != expected:
            raise ValueError('Local Sesame model files are incomplete or failed verification.')
    pcm = read_reference(Path(request['wav']))
    sys.path.insert(0, request['sitePackages'])
    distribution = importlib.metadata.distribution('mlx-audio')
    if (distribution.version != '0.6.5' or sha256(distribution.locate_file('mlx_audio/tts/models/sesame/sesame.py'))
            != SESAME_SOURCE_SHA):
        raise ValueError('Reinstall the verified Sesame voice runtime in Manim settings.')
    import mlx.core as mx
    import numpy as np
    from mlx_audio.lm.sample_utils import make_sampler

    if mx.__version__ != '0.32.4' or mx.default_device() != mx.gpu or not mx.metal.is_available():
        raise ValueError('Reference narration requires the pinned MLX Metal runtime.')
    reference = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    if np.max(np.abs(reference)) < 328 / 32768:
        raise ValueError('Reference WAV is silent or too quiet.')
    reference = mx.array(reference)
    model = load_model(model_path, mx)
    sampler = make_sampler(temp=0.9, top_k=50)
    for i, words in enumerate(request['utterances'], 1):
        mx.random.seed(SEED + i)
        # MLX Audio 0.6.5 resets this state only in streaming mode, but uses
        # the same incremental Mimi decoder for full-utterance generation.
        model._streaming_decoder.reset()
        parts = list(model.generate(words, speaker=0, split_pattern=None, voice_match=True,
                                    ref_audio=reference, ref_text=request['transcript'], sampler=sampler,
                                    max_audio_length_ms=MAX_AUDIO_MS))
        if len(parts) != 1 or parts[0].token_count >= MAX_AUDIO_MS // 80:
            raise ValueError(f'Sesame narration beat {i} did not finish. Shorten that beat’s narration.')
        samples = np.asarray(parts[0].audio, dtype=np.float32)
        peak = np.max(np.abs(samples), initial=0)
        if parts[0].sample_rate != RATE or samples.ndim != 1 or not np.isfinite(samples).all() or peak < 0.01:
            raise ValueError(f'Sesame narration beat {i} did not produce audible mono PCM.')
        # Leave one decibel of headroom without changing the duration.
        gain = 10 ** (-1 / 20) / peak
        with wave.open(str(request_path.parent / f'reference-beat-{i}.wav'), 'wb') as wav:
            wav.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
            wav.writeframes((samples * gain * 32767).round().astype('<i2').tobytes())


if __name__ == '__main__':
    try:
        main(Path(sys.argv[1]))
    except (ValueError, wave.Error, importlib.metadata.PackageNotFoundError) as error:
        print(f'{error}', file=sys.stderr)
        sys.exit(2)

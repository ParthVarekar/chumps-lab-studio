"""Speech-to-text with word-level timestamps (Parakeet TDT 0.6B v3 via onnx-asr).

onnx-asr handles at most ~20-30 s per call, so long audio is cut at its quietest
points into chunks of <= MAX_CHUNK_S, each chunk is transcribed with token
timestamps, and tokens are merged into words with absolute times.

Run:  uv run python -m cls_sidecar.asr path\\to\\audio_16k.wav [--out words.json] [--cpu]
"""

from __future__ import annotations

import argparse
import json
import time
import wave
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

import cls_sidecar  # noqa: F401  (sets cache locations before model downloads)
from cls_sidecar.paths import MODELS_DIR

MODEL_NAME = "nemo-parakeet-tdt-0.6b-v3"
MODEL_REPO = "istupakov/parakeet-tdt-0.6b-v3-onnx"
COMMON_FILES = ["config.json", "vocab.txt"]
MODEL_FILES = {
    None: ["encoder-model.onnx", "encoder-model.onnx.data", "decoder_joint-model.onnx"],  # fp32, ~2.5 GB
    "int8": ["encoder-model.int8.onnx", "decoder_joint-model.int8.onnx"],  # ~0.65 GB
}
# Plain files, not the Hugging Face cache: ONNX Runtime >= 1.31 rejects a model whose external
# weights (.onnx.data) resolve outside the model's own folder, which the HF cache's blob links do.
MODEL_DIR = MODELS_DIR / "parakeet-tdt-0.6b-v3-onnx"
SAMPLE_RATE = 16_000
MAX_CHUNK_S = 24.0  # stay under the model's comfortable window
MIN_CHUNK_S = 12.0  # don't search for a cut before this point
FRAME_S = 0.02  # energy frame for finding quiet cut points


@dataclass
class Word:
    text: str
    start: float  # seconds from the start of the file
    end: float


def read_wav_mono16k(path: Path) -> np.ndarray:
    """Read a 16 kHz mono PCM16 WAV as float32 in [-1, 1]. Convert other audio with ffmpeg first."""
    with wave.open(str(path), "rb") as wf:
        if wf.getframerate() != SAMPLE_RATE or wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise ValueError(
                f"{path} must be 16 kHz mono 16-bit PCM; "
                "convert with: ffmpeg -i in.ext -ac 1 -ar 16000 -c:a pcm_s16le out.wav"
            )
        pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
    return pcm.astype(np.float32) / 32768.0


def find_cuts(audio: np.ndarray) -> list[int]:
    """Sample indices where to cut so every chunk is <= MAX_CHUNK_S, preferring the quietest 20 ms."""
    frame = int(FRAME_S * SAMPLE_RATE)
    n_frames = len(audio) // frame
    rms = np.sqrt(np.mean(audio[: n_frames * frame].reshape(n_frames, frame) ** 2, axis=1))
    cuts, start = [0], 0
    max_len, min_len = int(MAX_CHUNK_S / FRAME_S), int(MIN_CHUNK_S / FRAME_S)
    while n_frames - start > max_len:
        window = rms[start + min_len : start + max_len]
        quietest = start + min_len + int(np.argmin(window))
        cuts.append(quietest * frame)
        start = quietest
    cuts.append(len(audio))
    return cuts


def tokens_to_words(tokens: list[str], times: list[float], offset: float, chunk_end: float) -> list[Word]:
    """Merge SentencePiece-style tokens into words. A token that starts with a space begins a new word."""
    words: list[Word] = []
    for i, (tok, t) in enumerate(zip(tokens, times)):
        begins_word = tok.startswith((" ", "▁")) or not words
        piece = tok.replace("▁", " ")
        if begins_word:
            words.append(Word(piece.strip(), offset + t, offset + t))
        else:
            words[-1].text += piece
        # A word ends where the next token starts (or the chunk ends).
        nxt = times[i + 1] if i + 1 < len(times) else chunk_end - offset
        words[-1].end = offset + nxt
    # Cap absurdly long "ends" that swallow a pause: words rarely exceed 1.2 s.
    for w in words:
        w.end = min(w.end, w.start + 1.2)
    return [w for w in words if w.text]


def ensure_model(quantization: str | None = None) -> Path:
    """Download the model variant as plain files into MODEL_DIR (once)."""
    files = COMMON_FILES + MODEL_FILES[quantization]
    if all((MODEL_DIR / f).is_file() for f in files):
        return MODEL_DIR
    from huggingface_hub import snapshot_download

    snapshot_download(MODEL_REPO, local_dir=MODEL_DIR, allow_patterns=files)
    return MODEL_DIR


def load_model(use_gpu: bool = True, quantization: str | None = None):
    import onnx_asr
    import onnxruntime as ort

    providers: list = ["CPUExecutionProvider"]
    if use_gpu and "CUDAExecutionProvider" in ort.get_available_providers():
        if hasattr(ort, "preload_dlls"):
            ort.preload_dlls()
        # Grow the GPU memory pool only as needed instead of in doubling chunks.
        providers = [("CUDAExecutionProvider", {"arena_extend_strategy": "kSameAsRequested"}), "CPUExecutionProvider"]
    model = onnx_asr.load_model(MODEL_NAME, ensure_model(quantization), quantization=quantization, providers=providers)
    return model.with_timestamps(), [p if isinstance(p, str) else p[0] for p in providers]


def transcribe(path: Path, use_gpu: bool = True, quantization: str | None = None) -> dict:
    audio = read_wav_mono16k(path)
    model, providers = load_model(use_gpu, quantization)
    cuts = find_cuts(audio)
    words: list[Word] = []
    t0 = time.perf_counter()
    for a, b in zip(cuts[:-1], cuts[1:]):
        result = model.recognize(audio[a:b], sample_rate=SAMPLE_RATE)
        words += tokens_to_words(list(result.tokens), list(result.timestamps), a / SAMPLE_RATE, b / SAMPLE_RATE)
    elapsed = time.perf_counter() - t0
    duration = len(audio) / SAMPLE_RATE
    return {
        "model": MODEL_NAME,
        "quantization": quantization or "fp32",
        "providers": providers,
        "audio_seconds": round(duration, 2),
        "chunks": len(cuts) - 1,
        "inference_seconds": round(elapsed, 2),
        "real_time_factor": round(elapsed / duration, 3),
        "text": " ".join(w.text for w in words),
        "words": [asdict(w) | {"start": round(w.start, 3), "end": round(w.end, 3)} for w in words],
    }


def peak_commit_gb() -> float | None:
    """Peak committed (private) memory of this process: what pushes Windows to grow its pagefile."""
    import psutil

    info = psutil.Process().memory_info()
    peak = getattr(info, "peak_pagefile", None) or getattr(info, "peak_wset", None)
    return round(peak / 1024**3, 2) if peak else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("wav", type=Path)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--cpu", action="store_true", help="force CPU inference")
    ap.add_argument("--int8", action="store_true", help="use the int8-quantized model (~4x smaller)")
    args = ap.parse_args()
    result = transcribe(args.wav, use_gpu=not args.cpu, quantization="int8" if args.int8 else None)
    result["peak_commit_gb"] = peak_commit_gb()
    if args.out:
        args.out.write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    summary = {k: v for k, v in result.items() if k != "words"}
    print(json.dumps(summary, indent=1, ensure_ascii=False))
    print("first words:", result["words"][:8])


if __name__ == "__main__":
    main()

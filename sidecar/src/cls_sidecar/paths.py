"""Where the studio keeps its heavy files, and guards that keep them off C:.

Import this module before any library that downloads models (huggingface_hub,
torch hub, onnx-asr): it points their caches at the studio root on D:.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

STUDIO_ROOT = Path(os.environ.get("CLS_STUDIO_ROOT", r"D:\ChumpsLabStudio"))
CACHE_DIR = STUDIO_ROOT / "cache"
PROJECTS_DIR = STUDIO_ROOT / "projects"
LIBRARY_DIR = STUDIO_ROOT / "library"
MODELS_DIR = STUDIO_ROOT / "models"

# Refuse to start heavy work when the cache drive is nearly full (blueprint risk #6).
MIN_FREE_BYTES = 5 * 1024**3


def configure_cache_env() -> None:
    """Point third-party caches at the studio root unless the user already chose a location."""
    os.environ.setdefault("HF_HOME", str(CACHE_DIR / "huggingface"))
    os.environ.setdefault("TORCH_HOME", str(CACHE_DIR / "torch"))
    # CUDA's JIT kernel cache defaults to %APPDATA%\NVIDIA\ComputeCache on C: (~1 GB after one run).
    os.environ.setdefault("CUDA_CACHE_PATH", str(CACHE_DIR / "cuda"))
    os.environ.setdefault("CUDA_CACHE_MAXSIZE", str(4 * 1024**3))
    # Windows symlinks need Developer Mode; without it the HF cache would warn and duplicate files.
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def ensure_free_space(path: Path = STUDIO_ROOT, min_free: int = MIN_FREE_BYTES) -> int:
    """Raise if the drive holding `path` has less than `min_free` bytes free; return bytes free."""
    free = shutil.disk_usage(path).free
    if free < min_free:
        raise RuntimeError(
            f"Only {free / 1024**3:.1f} GB free on the drive holding {path}; "
            f"need at least {min_free / 1024**3:.0f} GB. Free some space first."
        )
    return free

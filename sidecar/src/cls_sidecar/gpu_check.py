"""Phase 0 check: can PyTorch and ONNX Runtime use the RTX 5050 (Blackwell, sm_120)?

Run:  uv run python -m cls_sidecar.gpu_check
"""

from __future__ import annotations

import json
import time

import cls_sidecar  # noqa: F401  (sets cache locations before torch loads)


def torch_report() -> dict:
    import torch

    report: dict = {"torch": torch.__version__, "cuda_build": torch.version.cuda}
    report["cuda_available"] = torch.cuda.is_available()
    if not report["cuda_available"]:
        return report

    report["device"] = torch.cuda.get_device_name(0)
    report["capability"] = list(torch.cuda.get_device_capability(0))
    report["arch_list"] = torch.cuda.get_arch_list()
    free, total = torch.cuda.mem_get_info(0)
    report["vram_total_gb"] = round(total / 1024**3, 2)
    report["vram_free_gb"] = round(free / 1024**3, 2)

    # A real kernel launch, not just device discovery: fp16 matmul, checked against fp32 on CPU.
    a = torch.randn(4096, 4096, device="cuda", dtype=torch.float16)
    b = torch.randn(4096, 4096, device="cuda", dtype=torch.float16)
    torch.matmul(a, b)  # warm-up
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    runs = 20
    for _ in range(runs):
        c = torch.matmul(a, b)
    torch.cuda.synchronize()
    seconds = (time.perf_counter() - t0) / runs
    report["matmul_4096_fp16_ms"] = round(seconds * 1000, 2)
    report["matmul_tflops"] = round(2 * 4096**3 / seconds / 1e12, 1)

    small_a, small_b = a[:256, :256].float().cpu(), b[:256, :256].float().cpu()
    ref = small_a @ small_b
    got = (a[:256, :256] @ b[:256, :256]).float().cpu()
    report["matmul_max_rel_err"] = float(((got - ref).abs().max() / ref.abs().max()).item())
    del c
    return report


def onnxruntime_report() -> dict:
    import onnxruntime as ort

    report = {"onnxruntime": ort.__version__, "available_providers": ort.get_available_providers()}
    # ORT >= 1.21 can load the CUDA/cuDNN DLLs that pip packages (e.g. torch) ship with.
    if hasattr(ort, "preload_dlls"):
        try:
            ort.preload_dlls()
            report["preload_dlls"] = "ok"
        except Exception as exc:  # noqa: BLE001 - report, don't crash the check
            report["preload_dlls"] = f"failed: {exc}"
    return report


def main() -> None:
    result = {"torch": torch_report(), "onnxruntime": onnxruntime_report()}
    print(json.dumps(result, indent=2))
    t = result["torch"]
    ok = t.get("cuda_available") and t.get("capability") == [12, 0] and t.get("matmul_max_rel_err", 1) < 1e-2
    print("\nPHASE 0 GPU CHECK:", "PASS" if ok else "FAIL")


if __name__ == "__main__":
    main()

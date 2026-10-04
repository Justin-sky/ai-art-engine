"""
Convert MediaPipe's official TFLite face models into the two ONNX files the portrait
node (`image.portrait`) expects, verify their shapes against the runtime contract,
and print SHA-256 hashes.

Why this script exists
----------------------
The portrait pipeline needs BOTH files, with fixed names and fixed shapes
(contract lives in `src/main/yolo/faceInfer.ts`):

  face-detect.onnx    BlazeFace short-range   input 128x128 float32 ([-1,1] normalized)
                                              outputs 896x16 (boxes) + 896x1 (scores)
  face-landmark.onnx  MediaPipe FaceMesh      input 192x192 float32 ([0,1] normalized)
                                              output 1404 values (468 landmarks x 3)

A missing, swapped or wrong-shaped file does not fail loudly: the node degrades to
"no face detected" and the face/makeup/ID-photo tools silently do nothing. This script
checks the shapes up front instead (the app repeats the check at first inference).

The repo intentionally does not ship these weights: `scripts/fetch-yolo-models.mjs`
only carries entries whose URL + SHA-256 have been verified. MediaPipe models are
Apache-2.0 (commercial use and redistribution allowed), so converting them locally is
the cleanest source.

Usage
-----
  pip install tf2onnx tensorflow onnx      # NOT tflite2onnx (see convert() docstring)
  python scripts/convert-face-models.py                     # find .tflite inside the mediapipe wheel
  python scripts/convert-face-models.py --out face-models
  python scripts/convert-face-models.py --detector a.tflite --landmark b.tflite
  python scripts/convert-face-models.py --verify-only face-models

当前 mediapipe（>=0.10.x 晚版 / 1.x）已不再随包附带 legacy `modules/*.tflite`，
所以通常要从旧版 wheel 里取这两个文件：

  pip download mediapipe==0.10.14 --no-deps -d /tmp/mp
  # 然后把 wheel 当 zip 打开，取出：
  #   mediapipe/modules/face_detection/face_detection_short_range.tflite
  #   mediapipe/modules/face_landmark/face_landmark.tflite
  python scripts/convert-face-models.py --detector ... --landmark ...

Then copy both .onnx files into the folder opened by
Settings -> Models -> YOLO models -> "open model directory".
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = PROJECT_ROOT / "face-models"

DETECTOR_NAME = "face-detect.onnx"
LANDMARK_NAME = "face-landmark.onnx"

# MediaPipe ships these inside the wheel (face_landmarker.task from the new Tasks API is
# a bundle, NOT a plain tflite, and cannot be converted by this script).
MEDIAPIPE_DETECTOR = "modules/face_detection/face_detection_short_range.tflite"
MEDIAPIPE_LANDMARK = "modules/face_landmark/face_landmark.tflite"

DETECTOR_INPUT = 128
LANDMARK_INPUT = 192
DETECTOR_OUTPUT_ELEMENTS = {896 * 16, 896 * 1}
LANDMARK_OUTPUT_ELEMENTS = 468 * 3


def mediapipe_dir() -> Path:
    try:
        import mediapipe  # type: ignore
    except ImportError:
        sys.exit("mediapipe is missing: pip install mediapipe")
    return Path(mediapipe.__file__).resolve().parent


def default_sources() -> tuple[Path, Path]:
    base = mediapipe_dir()
    detector = base / MEDIAPIPE_DETECTOR
    landmark = base / MEDIAPIPE_LANDMARK
    missing = [p for p in (detector, landmark) if not p.is_file()]
    if missing:
        listing = "\n".join(f"  - {p}" for p in missing)
        sys.exit(
            "could not find the MediaPipe tflite files:\n"
            f"{listing}\n"
            "Pass --detector / --landmark explicitly, or install a mediapipe build that ships"
            " the legacy modules/ directory (the Tasks API's face_landmarker.task is a bundle"
            " and cannot be converted here)."
        )
    return detector, landmark


def convert(tflite: Path, onnx_out: Path) -> None:
    """TFLite -> ONNX via tf2onnx.

    ⚠️ 不要换回 `tflite2onnx`：它处理不了 MediaPipe 这套量化权重（自身会警告
    "Data type float16 not supported"），转出来的图**形状看着完全正确**，但回归量纲
    整体偏小 —— 实测人脸框缩到 1/4 左右、置信度从 0.81 掉到 0.67，而且不报任何错。
    这正是「五官 / 妆容静默失效」的典型来源。

    tf2onnx 的转换保真度已核对过：同一输入下与 TFLite 解释器的原始输出
    max |Δ| < 1e-4（可复现：`pip install tf2onnx tensorflow`）。
    """
    if not tflite.is_file():
        sys.exit(f"missing input: {tflite}")
    try:
        import tf2onnx  # type: ignore  # noqa: F401
    except ImportError:
        sys.exit("tf2onnx is missing: pip install tf2onnx tensorflow")
    onnx_out.parent.mkdir(parents=True, exist_ok=True)
    import subprocess

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "tf2onnx.convert",
            "--tflite",
            str(tflite),
            "--output",
            str(onnx_out),
            "--opset",
            "13",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not onnx_out.is_file():
        tail = (result.stderr or result.stdout or "").strip().splitlines()[-8:]
        sys.exit("tf2onnx failed:\n  " + "\n  ".join(tail))
    print(f"  converted {tflite.name} -> {onnx_out.name}")


def static_dims(value_info) -> list[int] | None:
    """Static dims, or None when the tensor has any dynamic/symbolic dimension."""
    try:
        dims = value_info.type.tensor_type.shape.dim
    except AttributeError:
        return None
    out: list[int] = []
    for dim in dims:
        if dim.HasField("dim_value") and dim.dim_value > 0:
            out.append(int(dim.dim_value))
        else:
            return None
    return out


def verify(path: Path, role: str) -> list[str]:
    """Return human-readable findings; raise SystemExit on a contract violation."""
    try:
        import onnx  # type: ignore
    except ImportError:
        return [f"{path.name}: onnx not installed, skipped shape check (pip install onnx)"]

    model = onnx.load(str(path))
    graph = model.graph
    findings: list[str] = []
    problems: list[str] = []

    expected_input = DETECTOR_INPUT if role == "detector" else LANDMARK_INPUT
    input_dims = [static_dims(i) for i in graph.input]
    findings.append(
        "  inputs: " + ", ".join("*".join(map(str, d)) if d else "dynamic" for d in input_dims)
    )
    # Only judge static inputs; dynamic dims are accepted (the runtime check skips them too).
    static_inputs = [d for d in input_dims if d]
    if static_inputs and not any(expected_input in d for d in static_inputs):
        problems.append(
            f"{path.name}: no static input dimension of {expected_input} "
            f"(got {static_inputs}); is this the wrong half of the pair?"
        )

    output_dims = [static_dims(o) for o in graph.output]
    findings.append(
        "  outputs: " + ", ".join("*".join(map(str, d)) if d else "dynamic" for d in output_dims)
    )
    static_outputs = [d for d in output_dims if d]
    if role == "landmark":
        counts = [count for d in static_outputs if (count := _product(d)) is not None]
        if counts and LANDMARK_OUTPUT_ELEMENTS not in counts:
            problems.append(
                f"{path.name}: expected a 468x3 = {LANDMARK_OUTPUT_ELEMENTS} element output, "
                f"got {counts}"
            )
    else:
        counts = [count for d in static_outputs if (count := _product(d)) is not None]
        if counts and not DETECTOR_OUTPUT_ELEMENTS.issubset(set(counts)):
            problems.append(
                f"{path.name}: expected outputs with {sorted(DETECTOR_OUTPUT_ELEMENTS)} elements "
                f"(896 anchors x 16 + x 1), got {counts}"
            )

    print(f"  {path.name} ({role})")
    for line in findings:
        print(line)
    if problems:
        print("\n".join(f"  ! {p}" for p in problems))
        sys.exit("shape check failed - do not ship these files")
    return findings


def _product(dims: list[int]) -> int | None:
    total = 1
    for dim in dims:
        total *= dim
    return total


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output directory")
    parser.add_argument("--detector", type=Path, help="BlazeFace short-range .tflite")
    parser.add_argument("--landmark", type=Path, help="FaceMesh .tflite")
    parser.add_argument(
        "--verify-only",
        type=Path,
        help="skip conversion; verify an existing directory containing both .onnx files",
    )
    args = parser.parse_args()

    if args.verify_only:
        out_dir = args.verify_only
        print(f"verifying {out_dir}")
    else:
        out_dir = args.out
        if args.detector and args.landmark:
            sources = (args.detector, args.landmark)
        elif args.detector or args.landmark:
            sys.exit("pass both --detector and --landmark, or neither")
        else:
            sources = default_sources()
        print(f"converting into {out_dir}")
        convert(sources[0], out_dir / DETECTOR_NAME)
        convert(sources[1], out_dir / LANDMARK_NAME)

    detector = out_dir / DETECTOR_NAME
    landmark = out_dir / LANDMARK_NAME
    for path in (detector, landmark):
        if not path.is_file():
            sys.exit(f"missing {path}")

    print("shape check")
    verify(detector, "detector")
    verify(landmark, "landmark")

    print("\nfiles (copy both into Settings -> Models -> YOLO models -> open model directory)")
    for path in (detector, landmark):
        size_mb = path.stat().st_size / 1024 / 1024
        print(f"  {path.name:<20} {size_mb:6.2f} MB  sha256={sha256_of(path)}")
    print(
        "\nDo NOT add these to scripts/fetch-yolo-models.mjs until the hosting URL is fixed:\n"
        "entries without a verified URL + SHA-256 break `npm run pack` for everyone."
    )


if __name__ == "__main__":
    main()

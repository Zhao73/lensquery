#!/usr/bin/env python3
"""Discover repeatable, unattributed spatial signals across labelled media groups.

This is a calibration lab, not a single-file AI detector. It reports a candidate
only when a group exceeds a permutation null and, when supplied, survives an
independent re-encode set. Visible overlays and shared encoders remain confounds.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import subprocess
from pathlib import Path

import cv2
import numpy as np

DEFAULT_FRACTIONS = (0.11, 0.29, 0.47, 0.65, 0.83)
DEFAULT_SEED = 260816


def parse_group(value: str) -> tuple[str, list[Path]]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("group must use LABEL=GLOB")
    label, pattern = value.split("=", 1)
    paths = sorted(Path().glob(pattern)) if not Path(pattern).is_absolute() else sorted(
        Path(pattern).parent.glob(Path(pattern).name)
    )
    paths = [path.resolve() for path in paths if path.is_file()]
    if not label.strip() or len(paths) < 2:
        raise argparse.ArgumentTypeError("each group needs a label and at least two files")
    return label.strip(), paths


def parse_size(value: str) -> tuple[int, int]:
    try:
        width, height = (int(part) for part in value.lower().split("x", 1))
    except (TypeError, ValueError) as error:
        raise argparse.ArgumentTypeError("size must look like 256x144") from error
    if width < 32 or height < 32 or width > 2048 or height > 2048:
        raise argparse.ArgumentTypeError("size must stay between 32 and 2048 pixels per side")
    return width, height


def unit(value: np.ndarray) -> np.ndarray:
    normalized = np.asarray(value, dtype=np.float32)
    normalized = normalized - float(normalized.mean())
    scale = float(np.linalg.norm(normalized))
    return normalized / scale if scale > 1e-9 else normalized


def correlation(left: np.ndarray, right: np.ndarray) -> float:
    return float(np.dot(unit(left).ravel(), unit(right).ravel()))


def video_maps(
    path: Path,
    fractions: tuple[float, ...],
    size: tuple[int, int],
) -> tuple[np.ndarray, np.ndarray, dict[str, float | int]]:
    capture = cv2.VideoCapture(str(path))
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    frame_rate = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    residual_maps: list[np.ndarray] = []
    lsb_maps: list[np.ndarray] = []
    for fraction in fractions:
        if frame_count > 1:
            index = min(frame_count - 1, max(0, round((frame_count - 1) * fraction)))
            capture.set(cv2.CAP_PROP_POS_FRAMES, index)
        success, frame = capture.read()
        if not success:
            continue
        gray_bytes = cv2.resize(
            cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY),
            size,
            interpolation=cv2.INTER_AREA,
        )
        gray = gray_bytes.astype(np.float32) / 255.0
        residual_maps.append(unit(gray - cv2.GaussianBlur(gray, (0, 0), 1.25)))
        lsb_maps.append(unit((gray_bytes & 1).astype(np.float32) * 2.0 - 1.0))
    capture.release()
    if not residual_maps:
        raise RuntimeError(f"no decodable frames: {path}")
    return (
        unit(np.mean(residual_maps, axis=0)),
        unit(np.mean(lsb_maps, axis=0)),
        {
            "frames_sampled": len(residual_maps),
            "frame_count": frame_count,
            "frame_rate": frame_rate,
        },
    )


def pairwise_coherence(maps: list[np.ndarray]) -> float:
    values = [
        correlation(maps[left], maps[right])
        for left in range(len(maps))
        for right in range(left + 1, len(maps))
    ]
    return float(np.mean(values)) if values else 0.0


def null_distribution(
    all_maps: list[np.ndarray],
    sample_size: int,
    iterations: int,
    seed: int,
) -> np.ndarray:
    generator = random.Random(seed + sample_size)
    indices = list(range(len(all_maps)))
    return np.asarray(
        [
            pairwise_coherence([all_maps[index] for index in generator.sample(indices, sample_size)])
            for _ in range(iterations)
        ],
        dtype=np.float64,
    )


def permutation_p(null: np.ndarray, observed: float) -> float:
    return float((np.count_nonzero(null >= observed) + 1) / (len(null) + 1))


def write_heatmap(path: Path, value: np.ndarray) -> None:
    maximum = float(np.percentile(np.abs(value), 99.5)) or 1.0
    normalized = np.clip(value / maximum, -1, 1)
    colored = cv2.applyColorMap(
        ((normalized + 1) * 127.5).astype(np.uint8),
        cv2.COLORMAP_TURBO,
    )
    cv2.imwrite(str(path), colored)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def ffprobe(path: Path) -> dict:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,size:format_tags:stream=index,codec_type,codec_name,width,height:stream_tags",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def reencode_lookup(paths: list[Path], pattern: str | None) -> dict[str, Path]:
    if not pattern:
        return {}
    candidates = sorted(Path().glob(pattern)) if not Path(pattern).is_absolute() else sorted(
        Path(pattern).parent.glob(Path(pattern).name)
    )
    lookup: dict[str, Path] = {}
    for path in candidates:
        stem = path.stem
        for suffix in ("-crf28", "-reencoded", "-transcoded"):
            stem = stem.removesuffix(suffix)
        lookup[stem] = path.resolve()
    missing = [path.stem for path in paths if path.stem not in lookup]
    if missing:
        raise ValueError(f"missing re-encode counterparts: {', '.join(missing)}")
    return lookup


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group", action="append", required=True, help="repeat LABEL=GLOB")
    parser.add_argument(
        "--reencoded",
        action="append",
        default=[],
        help="optional LABEL=GLOB counterpart set; suffix -crf28/-reencoded/-transcoded is ignored",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--iterations", type=int, default=5000)
    parser.add_argument("--size", type=parse_size, default=(256, 144))
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = parser.parse_args()
    if args.iterations < 100 or args.iterations > 100_000:
        parser.error("iterations must stay between 100 and 100000")

    groups = dict(parse_group(value) for value in args.group)
    if len(groups) < 2:
        parser.error("supply at least two groups, including a negative control")
    reencoded_patterns = dict(value.split("=", 1) for value in args.reencoded)
    unknown_reencoded = set(reencoded_patterns) - set(groups)
    if unknown_reencoded:
        parser.error(f"reencoded label has no group: {', '.join(sorted(unknown_reencoded))}")

    args.output.mkdir(parents=True, exist_ok=True)
    fractions = DEFAULT_FRACTIONS
    original: dict[Path, tuple[np.ndarray, np.ndarray, dict]] = {}
    for paths in groups.values():
        for path in paths:
            original[path] = video_maps(path, fractions, args.size)
    all_maps = [original[path][0] for paths in groups.values() for path in paths]

    reports = []
    files = []
    for label, paths in groups.items():
        maps = [original[path][0] for path in paths]
        lsb_maps = [original[path][1] for path in paths]
        observed = pairwise_coherence(maps)
        null = null_distribution(all_maps, len(paths), args.iterations, args.seed)
        mean_map = unit(np.mean(maps, axis=0))
        write_heatmap(args.output / f"{label}-fixed-residual.png", mean_map)
        report = {
            "name": label,
            "count": len(paths),
            "high_pass_pairwise_coherence": observed,
            "lsb_pairwise_coherence": pairwise_coherence(lsb_maps),
            "permutation_p_high_pass": permutation_p(null, observed),
            "null_high_pass_p95": float(np.percentile(null, 95)),
            "null_high_pass_p99": float(np.percentile(null, 99)),
        }
        counterparts = reencode_lookup(paths, reencoded_patterns.get(label))
        if counterparts:
            re_maps = [video_maps(counterparts[path.stem], fractions, args.size)[0] for path in paths]
            report["original_reencode_group_pattern_correlation"] = correlation(
                mean_map,
                np.mean(re_maps, axis=0),
            )
            report["reencoded_high_pass_pairwise_coherence"] = pairwise_coherence(re_maps)
        report["fixed_pattern_candidate"] = bool(
            report["permutation_p_high_pass"] < 0.01
            and observed > report["null_high_pass_p99"]
            and report.get("original_reencode_group_pattern_correlation", 0) > 0.5
        )
        report["interpretation"] = (
            "candidate requiring independent decoder attribution; fixed overlays and shared codec pipelines remain confounds"
            if report["fixed_pattern_candidate"]
            else "no robust fixed spatial residual discovered under this protocol; keyed, semantic, temporal, audio, or stripped watermarks remain untested"
        )
        reports.append(report)
        files.extend(
            {
                "group": label,
                "path": str(path),
                "sha256": sha256(path),
                "probe": ffprobe(path),
                "sampling": original[path][2],
            }
            for path in paths
        )

    output = {
        "protocol": {
            "fractions": fractions,
            "normalized_frame_size": args.size,
            "residual": "grayscale minus Gaussian blur sigma=1.25; per-frame and per-video L2 normalization",
            "null": f"{args.iterations} deterministic random same-size subsets across every original group",
            "candidate_gate": "p<0.01, above null p99, and supplied re-encode group-pattern correlation>0.5",
            "limits": [
                "fixed visible overlays and shared encoders can trigger the same signal",
                "content-adaptive, keyed, semantic, temporal, and audio watermarks may not align spatially",
                "absence of a candidate is not absence of a watermark",
            ],
        },
        "reports": reports,
        "files": files,
    }
    report_path = args.output / "blind-watermark-report.json"
    report_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"report": str(report_path), "groups": reports}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

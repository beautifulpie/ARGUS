from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
from typing import Sequence


@dataclass
class SignalSummary:
    sample_count: int
    sample_rate_hz: float
    mean: float
    rms: float
    peak_to_peak: float
    zero_crossing_rate: float


class ArgusEyeProcessor:
    """Lightweight signal feature extractor for ARGUS-Eye."""

    def extract_track_features(self, samples: Sequence[float], sample_rate_hz: float) -> dict[str, float]:
        if sample_rate_hz <= 0:
            raise ValueError("sample_rate_hz must be > 0")

        values = [float(sample) for sample in samples]
        if not values:
            return {
                "sample_count": 0.0,
                "sample_rate_hz": float(sample_rate_hz),
                "mean": 0.0,
                "rms": 0.0,
                "peak_to_peak": 0.0,
                "zero_crossing_rate": 0.0,
            }

        count = len(values)
        mean = sum(values) / count
        rms = sqrt(sum(value * value for value in values) / count)
        peak_to_peak = max(values) - min(values)

        crossings = 0
        for index in range(1, count):
            prev = values[index - 1]
            curr = values[index]
            if (prev < 0 <= curr) or (prev > 0 >= curr):
                crossings += 1

        duration_sec = count / sample_rate_hz
        zcr = crossings / duration_sec if duration_sec > 0 else 0.0

        summary = SignalSummary(
            sample_count=count,
            sample_rate_hz=float(sample_rate_hz),
            mean=mean,
            rms=rms,
            peak_to_peak=peak_to_peak,
            zero_crossing_rate=zcr,
        )

        return {
            "sample_count": float(summary.sample_count),
            "sample_rate_hz": summary.sample_rate_hz,
            "mean": summary.mean,
            "rms": summary.rms,
            "peak_to_peak": summary.peak_to_peak,
            "zero_crossing_rate": summary.zero_crossing_rate,
        }

from __future__ import annotations

import importlib
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Any


@dataclass
class TrackObservation:
    timestamp_ms: int
    x: float
    y: float
    z: float
    speed: float
    distance: float
    object_class: str
    confidence: float


class UavBinaryInferencer:
    def __init__(self, threshold: float, feature_window_ms: int, model_path: str = "") -> None:
        self.threshold = threshold
        self.feature_window_ms = feature_window_ms
        self._buffers: dict[str, deque[TrackObservation]] = defaultdict(deque)
        self._model = None
        self.model_version = "heuristic-uav-v1"
        self._load_optional_model(model_path)

    def _load_optional_model(self, model_path: str) -> None:
        if not model_path:
            return
        path = Path(model_path)
        if not path.exists():
            return
        try:
            joblib = importlib.import_module("joblib")
            self._model = joblib.load(path)
            self.model_version = f"joblib:{path.name}"
        except Exception:
            self._model = None
            self.model_version = "heuristic-uav-v1"

    def update_threshold(self, threshold: float) -> None:
        self.threshold = threshold

    def update_feature_window(self, feature_window_ms: int) -> None:
        self.feature_window_ms = feature_window_ms

    def observe(self, track_id: str, observation: TrackObservation) -> dict[str, Any]:
        buffer = self._buffers[track_id]
        buffer.append(observation)

        cutoff = observation.timestamp_ms - self.feature_window_ms
        while buffer and buffer[0].timestamp_ms < cutoff:
            buffer.popleft()

        probability = self._predict_probability(buffer)
        decision = self._to_decision(probability)
        return {
            "uavDecision": decision,
            "uavProbability": round(probability, 2),
            "uavThreshold": self.threshold,
            "featureWindowMs": self.feature_window_ms,
            "inferenceModelVersion": self.model_version,
        }

    def _to_decision(self, probability: float) -> str:
        if probability >= self.threshold:
            return "UAV"
        if probability <= self.threshold - 20:
            return "NON_UAV"
        return "UNKNOWN"

    def _predict_probability(self, buffer: deque[TrackObservation]) -> float:
        if not buffer:
            return 0.0

        if self._model is not None:
            feature_vector = self._build_feature_vector(buffer)
            try:
                probability = float(self._model.predict_proba([feature_vector])[0][1]) * 100
                return max(0.0, min(100.0, probability))
            except Exception:
                pass

        latest = buffer[-1]
        score = 20.0

        if latest.object_class.upper() in {"UAV", "DRONE", "UAS"}:
            score += 45.0
        if latest.object_class.upper() in {"FIGHTER", "HIGHSPEED", "MISSILE"}:
            score += 20.0
        if latest.object_class.upper() in {"BIRD", "BIRD_FLOCK"}:
            score -= 25.0

        speeds = [sample.speed for sample in buffer]
        avg_speed = mean(speeds)
        speed_variation = max(speeds) - min(speeds) if len(speeds) > 1 else 0.0

        if 10 <= avg_speed <= 220:
            score += 10.0
        if speed_variation < 30:
            score += 5.0
        if latest.distance <= 45:
            score += 6.0
        if latest.confidence >= 80:
            score += 4.0

        return max(0.0, min(100.0, score))

    def _build_feature_vector(self, buffer: deque[TrackObservation]) -> list[float]:
        latest = buffer[-1]
        speeds = [sample.speed for sample in buffer]
        avg_speed = mean(speeds)
        speed_span = max(speeds) - min(speeds) if len(speeds) > 1 else 0.0
        return [
            latest.speed,
            latest.distance,
            latest.confidence,
            avg_speed,
            speed_span,
            float(len(buffer)),
        ]

from __future__ import annotations

import importlib
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
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


@dataclass
class LoadedModel:
    model_id: str
    model_type: str
    model_version: str
    model_path: str
    loaded_at: str
    predictor: Any | None = None


class UavBinaryInferencer:
    def __init__(
        self,
        threshold: float,
        feature_window_ms: int,
        model_path: str = "",
        active_model_id: str = "heuristic-default",
    ) -> None:
        self.threshold = threshold
        self.feature_window_ms = feature_window_ms
        self._buffers: dict[str, deque[TrackObservation]] = defaultdict(deque)
        self._models: dict[str, LoadedModel] = {}
        self._active_model_id = "heuristic-default"
        self._register_heuristic_model("heuristic-default", activate=True)

        if model_path:
            self.register_joblib_model("env-model", model_path, activate=True)

        if active_model_id:
            try:
                self.activate_model(active_model_id)
            except ValueError:
                self.activate_model("heuristic-default")

    def update_threshold(self, threshold: float) -> None:
        self.threshold = threshold

    def update_feature_window(self, feature_window_ms: int) -> None:
        self.feature_window_ms = feature_window_ms

    @property
    def active_model_id(self) -> str:
        return self._active_model_id

    @property
    def model_version(self) -> str:
        return self._get_active_model().model_version

    def list_models(self) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for model in self._models.values():
            entries.append(
                {
                    "modelId": model.model_id,
                    "modelType": model.model_type,
                    "modelVersion": model.model_version,
                    "modelPath": model.model_path,
                    "loadedAt": model.loaded_at,
                    "active": model.model_id == self._active_model_id,
                }
            )
        return sorted(entries, key=lambda item: item["modelId"])

    def activate_model(self, model_id: str) -> None:
        if model_id not in self._models:
            raise ValueError(f"model not found: {model_id}")
        self._active_model_id = model_id

    def register_joblib_model(self, model_id: str, model_path: str, activate: bool = True) -> dict[str, Any]:
        model_id = model_id.strip()
        if not model_id:
            raise ValueError("model_id must not be empty")
        path = Path(model_path).expanduser().resolve()
        if not path.exists():
            raise ValueError(f"model path does not exist: {path}")

        try:
            joblib = importlib.import_module("joblib")
            predictor = joblib.load(path)
        except Exception as error:
            raise ValueError(f"failed to load joblib model: {error}") from error

        self._models[model_id] = LoadedModel(
            model_id=model_id,
            model_type="joblib",
            model_version=f"joblib:{path.name}",
            model_path=str(path),
            loaded_at=datetime.now(timezone.utc).isoformat(),
            predictor=predictor,
        )
        if activate:
            self.activate_model(model_id)
        return self._model_descriptor(model_id)

    def unregister_model(self, model_id: str) -> None:
        if model_id not in self._models:
            raise ValueError(f"model not found: {model_id}")
        if model_id == "heuristic-default":
            raise ValueError("heuristic-default model cannot be removed")

        del self._models[model_id]
        if self._active_model_id == model_id:
            self._active_model_id = "heuristic-default"

    def load_legacy_model_path(self, model_path: str, activate: bool = True) -> dict[str, Any]:
        return self.register_joblib_model("runtime-model", model_path, activate=activate)

    def _register_heuristic_model(self, model_id: str, activate: bool = False) -> None:
        self._models[model_id] = LoadedModel(
            model_id=model_id,
            model_type="heuristic",
            model_version="heuristic-uav-v1",
            model_path="",
            loaded_at=datetime.now(timezone.utc).isoformat(),
            predictor=None,
        )
        if activate:
            self._active_model_id = model_id

    def _get_active_model(self) -> LoadedModel:
        model = self._models.get(self._active_model_id)
        if model is None:
            self._active_model_id = "heuristic-default"
            model = self._models[self._active_model_id]
        return model

    def _model_descriptor(self, model_id: str) -> dict[str, Any]:
        if model_id not in self._models:
            raise ValueError(f"model not found: {model_id}")
        model = self._models[model_id]
        return {
            "modelId": model.model_id,
            "modelType": model.model_type,
            "modelVersion": model.model_version,
            "modelPath": model.model_path,
            "loadedAt": model.loaded_at,
            "active": model.model_id == self._active_model_id,
        }

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

        active_model = self._get_active_model()
        if active_model.model_type == "joblib" and active_model.predictor is not None:
            feature_vector = self._build_feature_vector(buffer)
            try:
                probability = float(active_model.predictor.predict_proba([feature_vector])[0][1]) * 100
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

from __future__ import annotations

import importlib
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any


MULTICLASS_LABELS: tuple[str, ...] = (
    "HELICOPTER",
    "UAV",
    "HIGHSPEED",
    "BIRD_FLOCK",
    "BIRD",
    "CIVIL_AIR",
    "FIGHTER",
)

CLASS_ALIASES: dict[str, str] = {
    "HELICOPTER": "HELICOPTER",
    "HELI": "HELICOPTER",
    "ROTORCRAFT": "HELICOPTER",
    "UAV": "UAV",
    "DRONE": "UAV",
    "UAS": "UAV",
    "HIGHSPEED": "HIGHSPEED",
    "HYPERSONIC": "HIGHSPEED",
    "MISSILE": "HIGHSPEED",
    "BIRD_FLOCK": "BIRD_FLOCK",
    "FLOCK": "BIRD_FLOCK",
    "BIRDS": "BIRD_FLOCK",
    "BIRD": "BIRD",
    "CIVIL_AIR": "CIVIL_AIR",
    "COMMERCIAL_AIRCRAFT": "CIVIL_AIR",
    "AIRLINER": "CIVIL_AIR",
    "FIGHTER": "FIGHTER",
    "MILITARY_JET": "FIGHTER",
}


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


class ArgusBrainInferencer:
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
            model_version="heuristic-multiclass-v1",
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

        probabilities = self._predict_multiclass_probabilities(buffer)
        sorted_probabilities = self._sorted_probabilities(probabilities)
        top_class = sorted_probabilities[0]["className"]
        top_confidence = sorted_probabilities[0]["probability"]

        uav_probability = self._to_uav_probability(probabilities)
        uav_decision = self._to_uav_decision(uav_probability)

        return {
            "class": top_class,
            "confidence": round(top_confidence, 2),
            "probabilities": sorted_probabilities,
            "classificationType": "MULTI_CLASS",
            "uavDecision": uav_decision,
            "uavProbability": round(uav_probability, 2),
            "uavThreshold": self.threshold,
            "featureWindowMs": self.feature_window_ms,
            "inferenceModelVersion": self.model_version,
        }

    def _to_uav_decision(self, probability: float) -> str:
        if probability >= self.threshold:
            return "UAV"
        if probability <= self.threshold - 20:
            return "NON_UAV"
        return "UNKNOWN"

    def _to_uav_probability(self, probabilities: dict[str, float]) -> float:
        # Keep legacy UAV UI compatibility while primary model is multi-class.
        score = probabilities["UAV"] + (probabilities["HELICOPTER"] * 0.35)
        return max(0.0, min(100.0, score))

    def _sorted_probabilities(self, probabilities: dict[str, float]) -> list[dict[str, float | str]]:
        entries: list[dict[str, float | str]] = []
        for class_name, probability in sorted(probabilities.items(), key=lambda item: item[1], reverse=True):
            entries.append(
                {
                    "className": class_name,
                    "probability": round(probability, 2),
                }
            )
        return entries

    def _predict_multiclass_probabilities(self, buffer: deque[TrackObservation]) -> dict[str, float]:
        if not buffer:
            equal = 100.0 / len(MULTICLASS_LABELS)
            return {label: equal for label in MULTICLASS_LABELS}

        active_model = self._get_active_model()
        if active_model.model_type == "joblib" and active_model.predictor is not None:
            prediction = self._predict_with_joblib_model(active_model.predictor, buffer)
            if prediction is not None:
                return prediction

        return self._predict_with_heuristic(buffer)

    def _predict_with_joblib_model(
        self,
        predictor: Any,
        buffer: deque[TrackObservation],
    ) -> dict[str, float] | None:
        feature_vector = self._build_feature_vector(buffer)

        try:
            if hasattr(predictor, "predict_proba"):
                raw_probabilities = predictor.predict_proba([feature_vector])[0]
                raw_classes = list(getattr(predictor, "classes_", []))
                mapped = self._map_model_output(raw_classes, raw_probabilities)
                if mapped:
                    return self._normalize_probability_map(mapped)

            if hasattr(predictor, "predict"):
                prediction = predictor.predict([feature_vector])[0]
                mapped_label = self._normalize_class_label(prediction)
                if mapped_label:
                    one_hot = {label: (100.0 if label == mapped_label else 0.0) for label in MULTICLASS_LABELS}
                    return one_hot
        except Exception:
            return None

        return None

    def _map_model_output(self, raw_classes: list[Any], raw_probabilities: Any) -> dict[str, float]:
        mapped: dict[str, float] = {label: 0.0 for label in MULTICLASS_LABELS}
        probabilities = list(raw_probabilities)

        if not raw_classes:
            # Legacy binary fallback: assume [non_uav, uav].
            if len(probabilities) == 2:
                mapped["UAV"] = max(0.0, min(100.0, float(probabilities[1]) * 100.0))
                mapped["CIVIL_AIR"] = max(0.0, min(100.0, float(probabilities[0]) * 100.0))
                return mapped
            return {}

        for class_name, probability in zip(raw_classes, probabilities):
            normalized = self._normalize_class_label(class_name)
            if not normalized:
                continue
            mapped[normalized] += max(0.0, float(probability) * 100.0)

        if sum(mapped.values()) <= 0.0 and len(probabilities) == 2:
            # Binary model with unknown labels (e.g. [0, 1]) fallback.
            mapped["UAV"] = max(0.0, min(100.0, float(probabilities[1]) * 100.0))
            mapped["CIVIL_AIR"] = max(0.0, min(100.0, float(probabilities[0]) * 100.0))
            return mapped

        if sum(mapped.values()) <= 0.0:
            return {}
        return mapped

    def _predict_with_heuristic(self, buffer: deque[TrackObservation]) -> dict[str, float]:
        latest = buffer[-1]
        speeds = [sample.speed for sample in buffer]
        avg_speed = mean(speeds)
        speed_variation = max(speeds) - min(speeds) if len(speeds) > 1 else 0.0

        scores: dict[str, float] = {label: 1.0 for label in MULTICLASS_LABELS}

        normalized_hint = self._normalize_class_label(latest.object_class)
        if normalized_hint:
            scores[normalized_hint] += 7.0

        if avg_speed < 8:
            scores["BIRD"] += 6.0
            scores["BIRD_FLOCK"] += 4.0
        elif avg_speed < 35:
            scores["UAV"] += 5.0
            scores["HELICOPTER"] += 4.0
            scores["BIRD"] += 2.0
        elif avg_speed < 90:
            scores["UAV"] += 3.0
            scores["HELICOPTER"] += 3.0
            scores["CIVIL_AIR"] += 2.0
        elif avg_speed < 180:
            scores["CIVIL_AIR"] += 5.0
            scores["FIGHTER"] += 3.0
            scores["HIGHSPEED"] += 2.0
        else:
            scores["HIGHSPEED"] += 6.0
            scores["FIGHTER"] += 5.0

        if latest.distance <= 30:
            scores["UAV"] += 2.0
            scores["BIRD"] += 2.0
            scores["HELICOPTER"] += 1.0
        if latest.distance >= 120:
            scores["CIVIL_AIR"] += 2.5
            scores["FIGHTER"] += 2.0
            scores["HIGHSPEED"] += 1.0

        if latest.z <= 200:
            scores["UAV"] += 2.0
            scores["HELICOPTER"] += 1.5
            scores["BIRD"] += 2.0
        if latest.z >= 1500:
            scores["CIVIL_AIR"] += 3.0
            scores["FIGHTER"] += 3.0
            scores["HIGHSPEED"] += 2.0

        if speed_variation < 15:
            scores["HELICOPTER"] += 2.0
            scores["CIVIL_AIR"] += 1.5
            scores["BIRD_FLOCK"] += 1.0
        elif speed_variation > 60:
            scores["HIGHSPEED"] += 2.5
            scores["FIGHTER"] += 2.0

        if latest.confidence >= 80 and normalized_hint:
            scores[normalized_hint] += 2.0

        return self._normalize_probability_map(scores)

    def _normalize_probability_map(self, raw_scores: dict[str, float]) -> dict[str, float]:
        clamped: dict[str, float] = {}
        for label in MULTICLASS_LABELS:
            clamped[label] = max(0.0, float(raw_scores.get(label, 0.0)))

        total = sum(clamped.values())
        if total <= 0.0:
            equal = 100.0 / len(MULTICLASS_LABELS)
            return {label: equal for label in MULTICLASS_LABELS}

        return {label: (score / total) * 100.0 for label, score in clamped.items()}

    def _normalize_class_label(self, raw_label: Any) -> str | None:
        normalized = str(raw_label).strip().replace("-", "_").replace(" ", "_").upper()
        return CLASS_ALIASES.get(normalized)

    def _build_feature_vector(self, buffer: deque[TrackObservation]) -> list[float]:
        # Keep feature order/length stable for compatibility with existing joblib models.
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


# Backward-compatible alias
UavBinaryInferencer = ArgusBrainInferencer

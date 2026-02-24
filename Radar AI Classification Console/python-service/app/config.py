from __future__ import annotations

import os
from dataclasses import dataclass


def _to_int(value: str | None, fallback: int) -> int:
    if value is None:
        return fallback
    try:
        parsed = int(value)
    except ValueError:
        return fallback
    return parsed


def _to_float(value: str | None, fallback: float) -> float:
    if value is None:
        return fallback
    try:
        parsed = float(value)
    except ValueError:
        return fallback
    return parsed


@dataclass
class ServiceConfig:
    host: str = "127.0.0.1"
    port: int = 8787
    argus_source_url: str = "http://127.0.0.1:8080/api/v1/radar/frame"
    argus_auth_token: str = ""
    poll_interval_ms: int = 100
    request_timeout_ms: int = 1000
    uav_threshold: float = 35.0
    feature_window_ms: int = 2000
    model_path: str = ""
    active_model_id: str = "heuristic-default"

    @classmethod
    def from_env(cls) -> "ServiceConfig":
        return cls(
            host=os.getenv("RADAR_INFER_HOST", "127.0.0.1"),
            port=_to_int(os.getenv("RADAR_INFER_PORT"), 8787),
            argus_source_url=os.getenv(
                "RADAR_ARGUS_SOURCE_URL", "http://127.0.0.1:8080/api/v1/radar/frame"
            ),
            argus_auth_token=os.getenv("RADAR_ARGUS_AUTH_TOKEN", ""),
            poll_interval_ms=_to_int(os.getenv("RADAR_POLL_INTERVAL_MS"), 100),
            request_timeout_ms=_to_int(os.getenv("RADAR_REQUEST_TIMEOUT_MS"), 1000),
            uav_threshold=_to_float(os.getenv("RADAR_UAV_THRESHOLD"), 35.0),
            feature_window_ms=_to_int(os.getenv("RADAR_FEATURE_WINDOW_MS"), 2000),
            model_path=os.getenv("RADAR_MODEL_PATH", ""),
            active_model_id=os.getenv("RADAR_ACTIVE_MODEL_ID", "heuristic-default"),
        )

    def to_dict(self) -> dict:
        return {
            "host": self.host,
            "port": self.port,
            "argusSourceUrl": self.argus_source_url,
            "argusAuthToken": "***" if self.argus_auth_token else "",
            "pollIntervalMs": self.poll_interval_ms,
            "requestTimeoutMs": self.request_timeout_ms,
            "uavThreshold": self.uav_threshold,
            "featureWindowMs": self.feature_window_ms,
            "modelPath": self.model_path,
            "activeModelId": self.active_model_id,
        }

    def apply_patch(self, patch: dict) -> None:
        if "argusSourceUrl" in patch:
            self.argus_source_url = str(patch["argusSourceUrl"])
        if "argusAuthToken" in patch:
            self.argus_auth_token = str(patch["argusAuthToken"] or "")
        if "pollIntervalMs" in patch:
            self.poll_interval_ms = max(20, int(patch["pollIntervalMs"]))
        if "requestTimeoutMs" in patch:
            self.request_timeout_ms = max(100, int(patch["requestTimeoutMs"]))
        if "uavThreshold" in patch:
            self.uav_threshold = max(1.0, min(99.0, float(patch["uavThreshold"])))
        if "featureWindowMs" in patch:
            self.feature_window_ms = max(200, int(patch["featureWindowMs"]))
        if "modelPath" in patch:
            self.model_path = str(patch["modelPath"] or "")
        if "activeModelId" in patch:
            self.active_model_id = str(patch["activeModelId"] or "heuristic-default")

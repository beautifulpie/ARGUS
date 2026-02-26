from __future__ import annotations

import asyncio
import math
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Keep script executable directly: python3 ARGUS-Brain/app/main.py
import sys

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.append(str(CURRENT_DIR))

from config import ServiceConfig  # noqa: E402
from inference import ArgusBrainInferencer, TrackObservation  # noqa: E402


def _to_record(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    if math.isnan(parsed) or math.isinf(parsed):
        return fallback
    return parsed


def _to_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _to_text(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    return str(value).strip() or fallback


def _extract_objects(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if isinstance(payload.get("objects"), list):
        return payload["objects"]
    if isinstance(payload.get("tracks"), list):
        return payload["tracks"]
    if isinstance(payload.get("targets"), list):
        return payload["targets"]
    data = _to_record(payload.get("data"))
    if isinstance(data.get("objects"), list):
        return data["objects"]
    if isinstance(data.get("tracks"), list):
        return data["tracks"]
    return []


def _extract_events(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if isinstance(payload.get("events"), list):
        return payload["events"]
    if isinstance(payload.get("alerts"), list):
        return payload["alerts"]
    data = _to_record(payload.get("data"))
    if isinstance(data.get("events"), list):
        return data["events"]
    if isinstance(data.get("alerts"), list):
        return data["alerts"]
    return []


def _extract_status(payload: dict[str, Any]) -> dict[str, Any]:
    if isinstance(payload.get("systemStatus"), dict):
        return payload["systemStatus"]
    if isinstance(payload.get("status"), dict):
        return payload["status"]
    data = _to_record(payload.get("data"))
    if isinstance(data.get("systemStatus"), dict):
        return data["systemStatus"]
    if isinstance(data.get("status"), dict):
        return data["status"]
    return {}


class ConfigPatch(BaseModel):
    argusSourceUrl: str | None = None
    argusAuthToken: str | None = None
    pollIntervalMs: int | None = None
    requestTimeoutMs: int | None = None
    uavThreshold: float | None = None
    featureWindowMs: int | None = None
    modelPath: str | None = None
    activeModelId: str | None = None


class ModelRegisterRequest(BaseModel):
    modelId: str
    modelPath: str
    activate: bool = True


class ModelActivateRequest(BaseModel):
    modelId: str


class ServiceState:
    def __init__(self, config: ServiceConfig):
        self.config = config
        self.inferencer = ArgusBrainInferencer(
            threshold=config.uav_threshold,
            feature_window_ms=config.feature_window_ms,
            model_path=config.model_path,
            active_model_id=config.active_model_id,
        )
        self.frame_timestamp_history: deque[float] = deque(maxlen=240)
        self.inference_ms_history: deque[float] = deque(maxlen=300)
        self.model_latency_frame_history: deque[float] = deque(maxlen=300)
        self.pipeline_ms_history: deque[float] = deque(maxlen=300)
        self.last_frame: dict[str, Any] = {
            "objects": [],
            "events": [],
            "systemStatus": self._build_status({}, [], connected=False),
        }
        self.last_error = ""
        self.source_connected = False
        self.loop_task: asyncio.Task | None = None
        self.stop_event = asyncio.Event()
        self.start_ts = time.time()
        self.lock = asyncio.Lock()
        self.last_uav_decision: dict[str, str] = {}
        self.last_polled_at = 0.0
        self._sync_model_config()

    def _sync_model_config(self) -> None:
        active_model_id = self.inferencer.active_model_id
        self.config.active_model_id = active_model_id
        self.config.model_path = ""
        for model in self.inferencer.list_models():
            if model["modelId"] == active_model_id:
                self.config.model_path = model["modelPath"] or ""
                break

    def _build_status(
        self,
        source_status: dict[str, Any],
        objects: list[dict[str, Any]],
        connected: bool,
    ) -> dict[str, Any]:
        inference_p50, inference_p95 = self._percentiles(self.inference_ms_history)
        model_p50, model_p95 = self._percentiles(self.model_latency_frame_history)
        _, pipeline_p95 = self._percentiles(self.pipeline_ms_history)
        measured_fps = self._calculate_measured_fps()

        active_count = sum(
            1
            for obj in objects
            if _to_text(obj.get("status"), "").upper() in {"TRACKING", "STABLE"}
        )
        model_name = _to_text(source_status.get("modelName"), "ARGUS-Brain-Multiclass")
        model_version = _to_text(source_status.get("modelVersion"), self.inferencer.model_version)

        return {
            "connectionStatus": "LIVE" if connected else "DISCONNECTED",
            "modelName": model_name,
            "modelVersion": model_version,
            "device": _to_text(source_status.get("device"), "AESA-Array-X1"),
            "latency": model_p50 if model_p50 > 0 else _to_float(source_status.get("latency"), 0.0),
            "fps": measured_fps if measured_fps > 0 else _to_float(source_status.get("fps"), 0.0),
            "trackedObjects": len(objects),
            "activeTracksCount": active_count,
            "totalDetected": max(
                len(objects), _to_int(source_status.get("totalDetected"), len(objects))
            ),
            "sensorStatus": _to_text(source_status.get("sensorStatus"), "ONLINE"),
            "cpuUsage": _to_float(source_status.get("cpuUsage"), 0.0),
            "gpuUsage": _to_float(source_status.get("gpuUsage"), 0.0),
            "ramUsage": _to_float(source_status.get("ramUsage"), 0.0),
            "measuredFps": measured_fps,
            "modelLatencyP50": model_p50,
            "modelLatencyP95": model_p95,
            "inferenceLatencyP50": inference_p50,
            "inferenceLatencyP95": inference_p95,
            "pipelineLatencyP95": pipeline_p95,
        }

    @staticmethod
    def _percentiles(values: deque[float]) -> tuple[float, float]:
        if not values:
            return (0.0, 0.0)
        ordered = sorted(values)
        p50_idx = int(0.5 * (len(ordered) - 1))
        p95_idx = int(0.95 * (len(ordered) - 1))
        return (round(ordered[p50_idx], 3), round(ordered[p95_idx], 3))

    def _calculate_measured_fps(self) -> float:
        if len(self.frame_timestamp_history) < 2:
            return 0.0
        elapsed = self.frame_timestamp_history[-1] - self.frame_timestamp_history[0]
        if elapsed <= 0:
            return 0.0
        fps = (len(self.frame_timestamp_history) - 1) / elapsed
        return round(fps, 3)

    async def poll_once(self) -> None:
        poll_start = time.perf_counter()
        headers: dict[str, str] = {"Accept": "application/json"}
        if self.config.argus_auth_token:
            headers["Authorization"] = f"Bearer {self.config.argus_auth_token}"

        timeout_sec = self.config.request_timeout_ms / 1000.0
        async with httpx.AsyncClient(timeout=timeout_sec) as client:
            response = await client.get(self.config.argus_source_url, headers=headers)
            response.raise_for_status()
            payload = response.json()

        objects = _extract_objects(payload)
        events = _extract_events(payload)
        source_status = _extract_status(payload)
        now_ms = int(time.time() * 1000)

        normalized_objects: list[dict[str, Any]] = []
        normalized_events: list[dict[str, Any]] = []
        frame_model_latency_total_ms = 0.0

        for raw in objects:
            obj = _to_record(raw)
            object_id = _to_text(
                obj.get("id") or obj.get("trackId") or obj.get("objectId"),
                f"TRK-{uuid.uuid4().hex[:6].upper()}",
            )
            position = _to_record(obj.get("position"))
            velocity = _to_record(obj.get("velocity"))

            x = _to_float(position.get("x"), _to_float(obj.get("x"), 0.0))
            y = _to_float(position.get("y"), _to_float(obj.get("y"), 0.0))
            z = _to_float(position.get("z"), _to_float(obj.get("z"), _to_float(obj.get("altitude"), 0.0)))

            vx = _to_float(velocity.get("x"), _to_float(obj.get("vx"), 0.0))
            vy = _to_float(velocity.get("y"), _to_float(obj.get("vy"), 0.0))
            vz = _to_float(velocity.get("z"), _to_float(obj.get("vz"), 0.0))
            speed = _to_float(obj.get("speed"), math.sqrt(vx * vx + vy * vy + vz * vz))
            distance = _to_float(obj.get("distance"), math.sqrt(x * x + y * y))
            confidence = _to_float(obj.get("confidence"), 60.0)
            object_class = _to_text(obj.get("class") or obj.get("className"), "UNKNOWN")

            inference_start = time.perf_counter()
            inference = self.inferencer.observe(
                object_id,
                TrackObservation(
                    timestamp_ms=now_ms,
                    x=x,
                    y=y,
                    z=z,
                    speed=speed,
                    distance=distance,
                    object_class=object_class,
                    confidence=confidence,
                ),
            )
            inference_ms = (time.perf_counter() - inference_start) * 1000.0
            frame_model_latency_total_ms += inference_ms
            self.inference_ms_history.append(inference_ms)

            prev_decision = self.last_uav_decision.get(object_id, "UNKNOWN")
            current_decision = inference["uavDecision"]
            self.last_uav_decision[object_id] = current_decision
            if prev_decision != "UAV" and current_decision == "UAV":
                normalized_events.append(
                    {
                        "id": f"evt-{uuid.uuid4().hex[:10]}",
                        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "type": "ALERT",
                        "message": f"{object_id} UAV 의심 객체 감지 ({inference['uavProbability']:.1f}%)",
                        "objectId": object_id,
                        "objectClass": inference.get("class", object_class),
                    }
                )

            normalized_objects.append(
                {
                    **obj,
                    "id": object_id,
                    "class": object_class,
                    "position": {"x": x, "y": y, "z": z},
                    "velocity": {"x": vx, "y": vy, "z": vz},
                    "speed": speed,
                    "distance": distance,
                    "confidence": confidence,
                    "inferenceLatencyMs": round(inference_ms, 3),
                    **inference,
                }
            )

        for event in events:
            evt = _to_record(event)
            normalized_events.append(
                {
                    "id": _to_text(evt.get("id"), f"evt-{uuid.uuid4().hex[:10]}"),
                    "timestamp": _to_text(
                        evt.get("timestamp"), time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    ),
                    "type": _to_text(evt.get("type"), "INFO"),
                    "message": _to_text(evt.get("message"), "이벤트"),
                    "objectId": _to_text(evt.get("objectId"), ""),
                    "objectClass": _to_text(
                        evt.get("objectClass") or evt.get("class") or evt.get("className"),
                        "UNKNOWN",
                    ),
                }
            )

        pipeline_ms = (time.perf_counter() - poll_start) * 1000.0
        self.pipeline_ms_history.append(pipeline_ms)
        frame_model_latency_avg = (
            frame_model_latency_total_ms / len(normalized_objects) if normalized_objects else 0.0
        )
        self.model_latency_frame_history.append(frame_model_latency_avg)
        self.frame_timestamp_history.append(time.perf_counter())

        async with self.lock:
            self.source_connected = True
            self.last_error = ""
            self.last_polled_at = time.time()
            self.last_frame = {
                "objects": normalized_objects,
                "events": normalized_events,
                "systemStatus": self._build_status(source_status, normalized_objects, connected=True),
            }

    async def poll_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                await self.poll_once()
            except Exception as error:
                async with self.lock:
                    self.source_connected = False
                    self.last_error = str(error)
                    self.last_frame["systemStatus"] = self._build_status(
                        self.last_frame.get("systemStatus", {}),
                        self.last_frame.get("objects", []),
                        connected=False,
                    )
            await asyncio.sleep(max(0.02, self.config.poll_interval_ms / 1000.0))

    async def start(self) -> None:
        self.stop_event.clear()
        self.loop_task = asyncio.create_task(self.poll_loop())

    async def stop(self) -> None:
        self.stop_event.set()
        if self.loop_task:
            await self.loop_task
            self.loop_task = None

    async def snapshot(self) -> dict[str, Any]:
        async with self.lock:
            return {
                "objects": self.last_frame.get("objects", []),
                "events": self.last_frame.get("events", []),
                "systemStatus": self.last_frame.get("systemStatus", {}),
            }

    async def health(self) -> dict[str, Any]:
        async with self.lock:
            return {
                "status": "ok" if self.source_connected else "degraded",
                "sourceConnected": self.source_connected,
                "activeModelId": self.inferencer.active_model_id,
                "modelVersion": self.inferencer.model_version,
                "uptimeSec": int(time.time() - self.start_ts),
                "lastPolledAt": self.last_polled_at,
                "lastError": self.last_error,
                "models": self.inferencer.list_models(),
                "config": self.config.to_dict(),
                "queueDepth": 0,
            }

    async def list_models(self) -> dict[str, Any]:
        async with self.lock:
            return {
                "activeModelId": self.inferencer.active_model_id,
                "models": self.inferencer.list_models(),
            }

    async def register_model(self, model_id: str, model_path: str, activate: bool) -> dict[str, Any]:
        async with self.lock:
            descriptor = self.inferencer.register_joblib_model(model_id, model_path, activate=activate)
            self._sync_model_config()
            return {
                "registered": descriptor,
                "activeModelId": self.inferencer.active_model_id,
                "models": self.inferencer.list_models(),
            }

    async def activate_model(self, model_id: str) -> dict[str, Any]:
        async with self.lock:
            self.inferencer.activate_model(model_id)
            self._sync_model_config()
            return {
                "activeModelId": self.inferencer.active_model_id,
                "models": self.inferencer.list_models(),
            }

    async def unregister_model(self, model_id: str) -> dict[str, Any]:
        async with self.lock:
            self.inferencer.unregister_model(model_id)
            self._sync_model_config()
            return {
                "activeModelId": self.inferencer.active_model_id,
                "models": self.inferencer.list_models(),
            }

    async def reload(self, patch: dict[str, Any]) -> dict[str, Any]:
        async with self.lock:
            self.config.apply_patch(patch)
            self.inferencer.update_threshold(self.config.uav_threshold)
            self.inferencer.update_feature_window(self.config.feature_window_ms)

            if "modelPath" in patch:
                model_path = str(patch["modelPath"] or "").strip()
                if model_path:
                    self.inferencer.load_legacy_model_path(model_path, activate=True)

            if "activeModelId" in patch:
                active_model_id = str(patch["activeModelId"] or "").strip()
                if active_model_id:
                    self.inferencer.activate_model(active_model_id)

            self._sync_model_config()
            return self.config.to_dict()


config = ServiceConfig.from_env()
state = ServiceState(config=config)
app = FastAPI(title="Radar UAV Inference Service", version="0.1.0")


@app.on_event("startup")
async def on_startup() -> None:
    await state.start()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await state.stop()


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return await state.health()


@app.get("/api/v1/radar/frame")
async def radar_frame() -> dict[str, Any]:
    return await state.snapshot()


@app.post("/api/v1/config/reload")
async def reload_config(patch: ConfigPatch) -> dict[str, Any]:
    try:
        applied = await state.reload(patch.model_dump(exclude_none=True))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"ok": True, "config": applied}


@app.get("/api/v1/models")
async def list_models() -> dict[str, Any]:
    return await state.list_models()


@app.post("/api/v1/models/register")
async def register_model(payload: ModelRegisterRequest) -> dict[str, Any]:
    try:
        result = await state.register_model(
            model_id=payload.modelId,
            model_path=payload.modelPath,
            activate=payload.activate,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"ok": True, **result}


@app.post("/api/v1/models/activate")
async def activate_model(payload: ModelActivateRequest) -> dict[str, Any]:
    try:
        result = await state.activate_model(payload.modelId)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"ok": True, **result}


@app.delete("/api/v1/models/{model_id}")
async def unregister_model(model_id: str) -> dict[str, Any]:
    try:
        result = await state.unregister_model(model_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"ok": True, **result}


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=config.host,
        port=config.port,
        reload=False,
        log_level="info",
    )

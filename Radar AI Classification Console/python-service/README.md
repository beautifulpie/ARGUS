# Python UAV Inference Service

## Run locally

```bash
cd python-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app/main.py
```

## Environment variables

- `RADAR_INFER_HOST` (default: `127.0.0.1`)
- `RADAR_INFER_PORT` (default: `8787`)
- `RADAR_ARGUS_SOURCE_URL` (default: `http://127.0.0.1:8080/api/v1/radar/frame`)
- `RADAR_ARGUS_AUTH_TOKEN` (default: empty)
- `RADAR_POLL_INTERVAL_MS` (default: `100`)
- `RADAR_REQUEST_TIMEOUT_MS` (default: `1000`)
- `RADAR_UAV_THRESHOLD` (default: `35`)
- `RADAR_FEATURE_WINDOW_MS` (default: `2000`)
- `RADAR_MODEL_PATH` (optional; startup joblib model path)
- `RADAR_ACTIVE_MODEL_ID` (default: `heuristic-default`)

## API

- `GET /healthz`
- `GET /api/v1/radar/frame`
- `POST /api/v1/config/reload`
- `GET /api/v1/models`
- `POST /api/v1/models/register`
- `POST /api/v1/models/activate`
- `DELETE /api/v1/models/{model_id}`

## Model hot-swap flow

1. Register a model file:

```bash
curl -X POST http://127.0.0.1:8787/api/v1/models/register \
  -H "Content-Type: application/json" \
  -d '{"modelId":"rf-v2","modelPath":"/abs/path/uav_rf_v2.joblib","activate":true}'
```

2. Switch active model:

```bash
curl -X POST http://127.0.0.1:8787/api/v1/models/activate \
  -H "Content-Type: application/json" \
  -d '{"modelId":"heuristic-default"}'
```

3. List current registry:

```bash
curl http://127.0.0.1:8787/api/v1/models
```

4. Remove model (except `heuristic-default`):

```bash
curl -X DELETE http://127.0.0.1:8787/api/v1/models/rf-v2
```

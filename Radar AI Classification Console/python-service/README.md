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
- `RADAR_MODEL_PATH` (optional; joblib model path)

## API

- `GET /healthz`
- `GET /api/v1/radar/frame`
- `POST /api/v1/config/reload`

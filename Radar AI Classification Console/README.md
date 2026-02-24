
  # Radar AI Classification Console

  This is a code bundle for Radar AI Classification Console. The original project is available at https://www.figma.com/design/awT2Vcm0KbGxGuBI232ss6/Radar-AI-Classification-Console.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

  ## Python UAV inference service

  The repository includes a local Python service at `python-service/` that performs UAV binary classification.

  ```bash
  cd python-service
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
  python app/main.py
  ```

  Default service URL: `http://127.0.0.1:8787`

  Model hot-swap is supported in the Python service:
  - register/list/activate/remove models with `/api/v1/models*` endpoints
  - keep `heuristic-default` as safe fallback
  - optional startup envs: `RADAR_MODEL_PATH`, `RADAR_ACTIVE_MODEL_ID`

  ## Electron app mode

  Electron runs the web console and starts the Python service as a child process.

  - Dev mode: `npm run electron:dev`
  - Direct launch (after web build): `npm run electron:start`
  - Windows package build: `npm run electron:dist`

  In Electron mode, renderer is automatically configured with:
  - `argusBaseUrl=http://127.0.0.1:<RADAR_INFER_PORT>`
  - polling period target for near-real-time updates (default 200ms)

  ## ARGUS Integration

  This console now supports live polling from ARGUS.

  1. Create `.env.local` in project root.
  2. Add at least `VITE_ARGUS_BASE_URL`.
  3. Start the app with `npm run dev`.

  Example:

  ```bash
  VITE_ARGUS_BASE_URL=http://localhost:8080
  VITE_ARGUS_FRAME_PATH=/api/v1/radar/frame
  VITE_ARGUS_AUTH_TOKEN=
  VITE_ARGUS_POLL_INTERVAL_MS=200
  VITE_ARGUS_TIMEOUT_MS=1000
  VITE_ARGUS_FALLBACK_TO_MOCK=true
  ```

  - `VITE_ARGUS_BASE_URL` is empty: app runs in existing mock mode.
  - `VITE_ARGUS_BASE_URL` is set: app switches to ARGUS bridge mode.
  - `VITE_ARGUS_FALLBACK_TO_MOCK=true`: on ARGUS fetch failure, mock simulation continues.

  Expected ARGUS frame response (flexible keys are also supported):

  ```json
  {
    "objects": [
      {
        "id": "TRK-0001",
        "class": "UAV",
        "confidence": 92.5,
        "position": { "x": 12.5, "y": -3.1, "z": 350.0 },
        "velocity": { "x": 1.2, "y": -0.4, "z": 0.0 },
        "status": "TRACKING",
        "riskLevel": "HIGH"
      }
    ],
    "events": [
      {
        "id": "evt-1",
        "type": "WARNING",
        "message": "High-speed approach detected",
        "objectId": "TRK-0001",
        "timestamp": "2026-02-24T12:00:00Z"
      }
    ],
    "systemStatus": {
      "modelName": "ARGUS",
      "modelVersion": "v1.0.0",
      "latency": 8.2,
      "fps": 30.0
    }
  }
  ```
  

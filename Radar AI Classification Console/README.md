# ARGUS

**Aerial Radar-based Guard for UAV Surveillance**

ARGUS는 레이더 기반 항적을 실시간으로 감시하고 UAV 위협을 분류하는 통합 플랫폼입니다.  
프로젝트 이름은 100개의 눈을 가진 그리스 로마신화의 거인 **Argus**에서 가져왔고, "놓치지 않는 감시"라는 철학을 담고 있습니다.

## Repository Structure

현재 레포는 아래 3개 영역으로 정리되어 있습니다.

- **ARGUS (Main Frame)**: 웹 콘솔 + Electron 런타임 (레포 루트)
- **ARGUS-Brain**: UAV 분류 AI 모델 서비스 (`/ARGUS-Brain`)
- **ARGUS-Eye**: 신호 처리/특징 추출 모델 (`/ARGUS-Eye`)

## ARGUS (Main Frame)

레이더 객체, 이벤트, 시스템 상태를 시각화하고 Electron에서 모델 서비스를 함께 실행합니다.

```bash
npm i
npm run dev
```

Electron 실행:

- Dev: `npm run electron:dev`
- Start (build 후): `npm run electron:start`
- Windows 배포: `npm run electron:dist`

## ARGUS-Brain

항적 기반 UAV/Non-UAV 이진 분류 서비스입니다.

```bash
cd ARGUS-Brain
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app/main.py
```

기본 URL: `http://127.0.0.1:8787`

주요 API:

- `GET /healthz`
- `GET /api/v1/radar/frame`
- `POST /api/v1/config/reload`
- `GET /api/v1/models`
- `POST /api/v1/models/register`
- `POST /api/v1/models/activate`
- `DELETE /api/v1/models/{model_id}`

## ARGUS-Eye

신호 처리 전용 모듈입니다. 현재는 특징 추출 파이프라인의 기본 스켈레톤을 제공합니다.

```bash
cd ARGUS-Eye
python3 -c "from app.pipeline import ArgusEyeProcessor; print('ARGUS-Eye ready')"
```

## Integration Environment

`.env.local` 예시:

```bash
VITE_ARGUS_BASE_URL=http://localhost:8080
VITE_ARGUS_FRAME_PATH=/api/v1/radar/frame
VITE_ARGUS_AUTH_TOKEN=
VITE_ARGUS_POLL_INTERVAL_MS=200
VITE_ARGUS_TIMEOUT_MS=1000
VITE_ARGUS_FALLBACK_TO_MOCK=true
```

- `VITE_ARGUS_BASE_URL` 미설정: mock 모드
- `VITE_ARGUS_BASE_URL` 설정: ARGUS 브리지 모드
- `VITE_ARGUS_FALLBACK_TO_MOCK=true`: 연동 실패 시 mock 폴백

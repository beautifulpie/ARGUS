# ARGUS-Eye

Signal processing module for ARGUS.

## Purpose

- Raw radar signal / track stream preprocessing
- Denoising and normalization
- Feature extraction for downstream classifiers (ARGUS-Brain)

## Current Scope

- `app/pipeline.py`: lightweight feature extractor skeleton
- `contracts/track-frame.schema.json`: track frame contract draft

## Quick test

```bash
cd ARGUS-Eye
python3 -c "from app.pipeline import ArgusEyeProcessor; p=ArgusEyeProcessor(); print(p.extract_track_features([1,2,3,4], 10.0))"
```

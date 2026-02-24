# Official Map Data Drop Folder

Place official GeoJSON files in this folder to enable authoritative overlays in ARGUS.

Supported file names (first match is loaded):

- Boundary:
  - `korea_boundary.geojson`
  - `national_boundary.geojson`
  - `admin_boundary.geojson`
- Territorial sea:
  - `territorial_sea.geojson`
  - `maritime_boundary.geojson`
  - `eez_boundary.geojson`
- Airspace:
  - `airspace_boundary.geojson`
  - `airspace.geojson`
  - `fir.geojson`
- Eup/Myeon/Dong labels:
  - `emd_labels.geojson`
  - `emd.geojson`
  - `eupmyeondong.geojson`

The loader accepts `FeatureCollection`/`Feature` with:

- Geometry:
  - `LineString`, `MultiLineString`
  - `Polygon`, `MultiPolygon`
  - `Point`, `MultiPoint` (for labels)
- Name fields (one of):
  - `name`, `kor_nm`, `adm_nm`, `emd_nm`, `emd_kor_nm`, `EMD_KOR_NM`, `ctp_kor_nm`, `sgg_kor_nm`

Notes:

- Place only official datasets from your authorized source (e.g., national geospatial portals).
- If label data is polygon-based, ARGUS will compute a simple centroid for label placement.
- Current bundled sample:
  - `emd_labels.geojson` generated from [`raqoon886/Local_HangJeongDong`](https://github.com/raqoon886/Local_HangJeongDong).

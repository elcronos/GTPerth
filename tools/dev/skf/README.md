# Height cross-check against the Sketchfab "Perth, WA, Australia" GIS model

Model: Jack M Simmons, https://sketchfab.com/3d-models/perth-wa-australia-41a51bca67424ac58b19c1c3b8d09e44 (CC BY 4.0).
It is an older OpenStreetMap extrusion (ArcGIS Pro, Web Mercator): heights are OSM `height`, or `levels × 3.0 m`, or a
20 m default when OSM had neither. Used as a reference only; no geometry from it ships in the game.

1. `skf_extract.mjs <glb> clusters.json` (run from a folder with @gltf-transform installed): per-building clusters.
2. `align.mjs`: fixed Web-Mercator scale (cos lat), translation from unique tower heights, then ICP on all centroids
   (residual < 1 m).
3. `skf_raster.mjs`: 1 m roof-height raster of the model in game coordinates.
4. `compare.mjs`: game roof raster (towers.js osmBuildings) vs model; regions that disagree by > 12 m over > 150 m².
5. `diffimg.py` → docs/look/height_compare_sketchfab.png.

Findings (Nov 2026): the model predates Elizabeth Quay's towers (Ritz-Carlton, The Towers, Chevron, Nine, EQ West),
Central Park's tower, ECU City and the South Perth towers. It exposed real gaps in our pipeline: outlines dropped in
favour of parts that cover only a sliver (David Malcolm Justice Centre 149 m, Mia Yellagonga T1 body, Central Law
Courts, Enex and Equus podiums → tools/osm/restore_outlines.py) and the untagged Equus tower (110.5 m, OSM_FIX).

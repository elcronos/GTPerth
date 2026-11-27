# OSM pipeline (map data © OpenStreetMap contributors, ODbL)
Standard-style tiles (tile.openstreetmap.org, a few hundred, fetched once) → georeferenced 1 m world raster →
shorelines (osm_land.js), ground cover mask (assets/osm_mask.js), Kings Park terrain (assets/osm_height.js),
road centrelines + building footprints (osm_data.js). Run in order:
tiles.py 16; tiles.py 17 <bbox> cbd17; tiles.py 17 <bbox> sp17; tiles.py 18 <bbox> eq18; build_osm.py; extract.py;
emit_land.py; landuse.py; heights.py; roads.py; buildings.py; emit_data.py

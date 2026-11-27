#!/bin/bash
# usage: tools/dev/shots.sh <outdir> [w h]
OUT=$1; W=${2:-1280}; H=${3:-720}
cd /home/claude/perth
P=$(node -e "import('./src/contracts.js').then(m=>console.log([m.POSES[0],m.POSES[1],m.POSES[2],m.POSES[3],m.POSES[5],...m.YAWS].map(p=>p.join(',')).join(';')))")
P5=$(node -e "import('./src/contracts.js').then(m=>console.log(m.POSES[4].join(',')))")
ANGLE=swiftshader xvfb-run -a -s "-screen 0 1920x1200x24" node tools/capture.mjs --url dist/index.html --out $OUT --poses "$P" --names pose-1,pose-2,pose-3,pose-4,pose-6,yaw-1,yaw-2 --critic --w $W --h $H --ready 900000 --wait 7000 --reuse 1 2>&1 | grep -E "errors|pageerror" 
cp $OUT/meta.json $OUT/meta-a.json
ANGLE=swiftshader xvfb-run -a -s "-screen 0 1920x1200x24" node tools/capture.mjs --url dist/index.html --out $OUT --poses "$P5" --names pose-5 --critic --w $W --h $H --ready 900000 --wait 7000 --query "shot=1&show=chase" 2>&1 | grep -E "errors|pageerror"

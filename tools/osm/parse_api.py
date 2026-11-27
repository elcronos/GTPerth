import glob, json, math, re, xml.etree.ElementTree as ET
LAT0, LON0 = -31.95922, 115.85587
W = lambda lat, lon: [round((lon - LON0) * 94430, 2), round((LAT0 - lat) * 110950, 2)]
nodes, ways, rels = {}, {}, {}
for f in sorted(glob.glob('api/t_*.osm')):
    r = ET.parse(f).getroot()
    for n in r.iter('node'): nodes[n.get('id')] = (float(n.get('lat')), float(n.get('lon')))
    for w in r.iter('way'):
        ways[w.get('id')] = ([nd.get('ref') for nd in w.iter('nd')], {t.get('k'): t.get('v') for t in w.iter('tag')})
    for rl in r.iter('relation'):
        rels[rl.get('id')] = ([(m.get('type'), m.get('ref'), m.get('role')) for m in rl.iter('member')], {t.get('k'): t.get('v') for t in rl.iter('tag')})
print('nodes', len(nodes), 'ways', len(ways), 'rels', len(rels))
json.dump({'nodes': nodes, 'ways': ways, 'rels': rels}, open('api_all.json', 'w'))

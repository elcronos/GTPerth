import json, math, sys
LAT0, LON0 = -31.95922, 115.85587
def conv(tag, px, py, scale=1):
    m = json.load(open(f'mosaic{tag}.json')); n = 2 ** m['z'] * 256
    X = px * scale + m['X0'] * 256; Y = py * scale + m['Y0'] * 256
    lon = X / n * 360 - 180; lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * Y / n))))
    return (round((lon - LON0) * 94430, 1), round((LAT0 - lat) * 110950, 1))
def inv(tag, x, z, scale=1):
    m = json.load(open(f'mosaic{tag}.json')); n = 2 ** m['z'] * 256
    lon = LON0 + x / 94430; lat = LAT0 - z / 110950
    X = (lon + 180) / 360 * n; Y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return (round((X - m['X0'] * 256) / scale, 1), round((Y - m['Y0'] * 256) / scale, 1))
if __name__ == '__main__':
    tag, sc = sys.argv[1], float(sys.argv[2])
    for a in sys.argv[3:]:
        k, xy = a.split('=') if '=' in a else ('', a); x, y = map(float, xy.split(','))
        print(k, conv(tag, x, y, sc))

"""Download the CC0 Poly Haven assets the intro cut scene uses into blender/assets/ (gitignored).

  python3 blender/fetch_assets.py

Street Lamp 01 (model, 1k), Asphalt Snow and Snow 02 (textures, 2k). All CC0 from https://polyhaven.com.
"""
import json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'assets')


def get(url):  # curl, because some Python installs on macOS ship without SSL certificates
    return subprocess.run(['curl', '-sfL', '--max-time', '120', '-A', 'chudail-busters-asset-fetch', url], check=True, capture_output=True).stdout


def save(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(get(url))
    print('  got', os.path.relpath(path, HERE))


def model(name, res='1k'):
    info = json.loads(get(f'https://api.polyhaven.com/files/{name}'))['gltf'][res]['gltf']
    base = os.path.join(OUT, name)
    save(info['url'], os.path.join(base, os.path.basename(info['url'])))
    for rel, v in info.get('include', {}).items():
        save(v['url'], os.path.join(base, rel))


def texture(name, res='2k'):
    info = json.loads(get(f'https://api.polyhaven.com/files/{name}'))
    for key, short in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('Rough', 'rough')):
        if key in info and res in info[key]:
            f = info[key][res].get('jpg') or info[key][res].get('png')
            save(f['url'], os.path.join(OUT, name, f'{short}{os.path.splitext(f["url"])[1]}'))


if __name__ == '__main__':
    print('Poly Haven (CC0) assets ->', OUT)
    model('street_lamp_01')
    texture('asphalt_snow')
    texture('snow_02')
    print('done')

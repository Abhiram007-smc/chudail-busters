"""Encode the rendered intro frames (PNG sequence) into an H.264 MP4 for the browser, using Blender's own FFmpeg.

  Blender -b --factory-startup --python blender/encode_intro.py -- <frames_dir> public/video/intro.mp4
"""
import bpy, glob, os, sys

argv = sys.argv[sys.argv.index('--') + 1:]
frames_dir, out = argv[0], os.path.abspath(argv[1])
files = sorted(glob.glob(os.path.join(frames_dir, '*.png')))
assert files, 'no frames in ' + frames_dir
os.makedirs(os.path.dirname(out), exist_ok=True)

sc = bpy.context.scene
sc.sequence_editor_create()
strips = sc.sequence_editor.strips if hasattr(sc.sequence_editor, 'strips') else sc.sequence_editor.sequences
st = strips.new_image(name='frames', filepath=files[0], channel=1, frame_start=1)
for f in files[1:]:
    st.elements.append(os.path.basename(f))
img = bpy.data.images.load(files[0])
sc.render.resolution_x, sc.render.resolution_y = img.size
sc.render.resolution_percentage = 100
sc.render.fps = 24
sc.frame_start, sc.frame_end = 1, len(files)
sc.view_settings.view_transform = 'Standard'  # frames are already tone-mapped
ims = sc.render.image_settings
if 'media_type' in ims.bl_rna.properties:
    ims.media_type = 'VIDEO'
ims.file_format = 'FFMPEG'
ff = sc.render.ffmpeg
ff.format = 'MPEG4'
ff.codec = 'H264'
ff.constant_rate_factor = 'MEDIUM'
ff.ffmpeg_preset = 'GOOD'
ff.gopsize = 24
ff.audio_codec = 'NONE'
sc.render.filepath = out
sc.render.use_file_extension = False
bpy.ops.render.render(animation=True)
print('ENCODED', out, round(os.path.getsize(out) / 1e6, 2), 'MB,', len(files), 'frames')

# preparar_aserradero.py — Genera public/assets/models/aserradero.glb a partir del paquete
# "Low Poly Lumber Mill Pack" de reodesuxz (recursos-originales/, fuera del repositorio).
#
# Uso (Blender 4.x/5.x, sin interfaz):
#   Blender -b --factory-startup -P herramientas/preparar_aserradero.py -- <raíz del proyecto>
#
# Qué hace (licencia: se pueden modificar y usar en juegos, pero NO redistribuir los
# archivos como recursos sueltos; por eso no se copian los originales a public/):
# - Importa SOLO los modelos que usa el juego.
# - Cada modelo se convierte en UNA malla con el color de cada material "horneado" en los
#   colores de vértice (como la naturaleza del juego): todo el aserradero se dibuja con un
#   único material y se puede fusionar por etapas (pocas llamadas de dibujo).
# - Ajusta la paleta para que encaje con el aserradero actual del juego (maderas y tejado).
# - Separa el disco de la sierra circular en un objeto propio para poder girarlo.
# - Exporta todo en un solo GLB (cada modelo es un nodo con su nombre, en el origen).
import sys, bpy, bmesh

root = sys.argv[sys.argv.index('--') + 1]
PACK = f'{root}/recursos-originales/aserradero/LowPolyLumberMillPack_v1.0/GLB'
OUT = f'{root}/public/assets/models/aserradero.glb'

MODELS = [
    'mill_sign', 'sawhorse', 'firewood_stack', 'stump_chopping_block', 'log_cart',
    'log_cabin_office', 'plank_stack_big', 'lumber_bundle', 'drying_shed',
    'circular_saw_table', 'band_saw', 'sawdust_pile', 'log_conveyor', 'log_splitter',
    'sawmill_building', 'sawmill_boiler', 'sawdust_blower', 'forklift_log_loader', 'log_pile',
    'watchtower', 'fuel_barrel', 'single_log',
]

# Paleta (sRGB) — el resto de materiales conserva el color del paquete
RECOLOR = {'wood': 0xC08A52, 'wood2': 0x8A5A33, 'roof': 0xB3432F}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_linear(h):
    return tuple(srgb_to_linear(((h >> s) & 255) / 255) for s in (16, 8, 0))


def material_color(mat):
    """Color lineal del material (el importador ya lo pasa a lineal)."""
    base = mat.name.split('.')[0]
    if base in RECOLOR:
        return hex_linear(RECOLOR[base])
    if mat.use_nodes:
        for node in mat.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                return tuple(node.inputs['Base Color'].default_value[:3])
    return tuple(mat.diffuse_color[:3])


def bake_colors(obj):
    """Color de cada material → atributo de color por esquina (lineal)."""
    mesh = obj.data
    colors = [material_color(m) if m else (0.5, 0.5, 0.5) for m in mesh.materials]
    attr = mesh.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
    for poly in mesh.polygons:
        c = colors[poly.material_index] if colors else (0.5, 0.5, 0.5)
        for li in poly.loop_indices:
            attr.data[li].color = (*c, 1.0)
    mesh.color_attributes.active_color = attr
    mesh.materials.clear()  # Un único material en el juego


def import_model(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{PACK}/{name}.glb')
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    # Transformaciones aplicadas a la malla (el modelo queda en el origen)
    for o in new:
        o.select_set(False)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    for o in new:
        if o != obj and o.name in bpy.data.objects:
            bpy.data.objects.remove(o)
    obj.name = name
    obj.data.name = name
    bake_colors(obj)
    return obj


def split_saw_disc(table):
    """Separa las caras del disco (plano vertical fino, centro y = 1,25 m del juego)."""
    bm = bmesh.new()
    bm.from_mesh(table.data)
    disc = [f for f in bm.faces if all(abs(v.co.y) <= 0.025 and v.co.z >= 0.69 for v in f.verts)]
    if not disc:
        raise RuntimeError('no se encontró el disco de la sierra')
    for f in bm.faces:
        f.select_set(f in disc)
    bm.to_mesh(table.data)
    bm.free()
    bpy.ops.object.select_all(action='DESELECT')
    table.select_set(True)
    bpy.context.view_layer.objects.active = table
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    part = [o for o in bpy.context.selected_objects if o != table][0]
    part.name = 'saw_disc'
    part.data.name = 'saw_disc'
    # Origen en el eje del disco: en el juego gira sobre sí mismo
    bpy.context.scene.cursor.location = (0, 0, 1.25)
    bpy.ops.object.select_all(action='DESELECT')
    part.select_set(True)
    bpy.context.view_layer.objects.active = part
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    part.location = (0, 0, 0)  # El juego lo coloca respecto a la mesa
    print('disco separado:', len(disc), 'caras')


bpy.ops.wm.read_factory_settings(use_empty=True)
for name in MODELS:
    obj = import_model(name)
    if name == 'circular_saw_table':
        split_saw_disc(obj)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_materials='NONE',
    export_vertex_color='ACTIVE',
    export_normals=False,  # El juego calcula normales planas (flatShading)
    export_texcoords=False,
    export_animations=False,
    export_apply=True,
)
print('EXPORTADO', OUT, len(bpy.data.objects), 'objetos')

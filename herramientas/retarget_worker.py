# Retargeting de TreeChopping_Loop (UAL2, esqueleto "Armature") al Worker (esqueleto "CharacterArmature").
# Herramienta de preparación (NO forma parte del juego): genera public/assets/models/worker.glb.
# Uso desde la raíz del proyecto (macOS):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
#     --python herramientas/retarget_worker.py -- \
#     "recursos-originales/Individual Characters/glTF/Worker.gltf" \
#     "recursos-originales/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb" \
#     public/assets/models/worker.glb
# Probado con Blender 5.2.0 LTS. Un cuarto argumento opcional guarda además un .blend para revisarlo
# visualmente (guárdalo fuera de public/ para que no se publique con el juego).
#
# Método (sin complementos):
# - Ambos esqueletos están en pose T en reposo, pero sus huesos tienen ejes locales distintos.
#   Por eso NO se copian rotaciones locales: se copia el giro en ESPACIO MUNDIAL respecto al
#   reposo de cada hueso:  giro_destino = (pose_origen · reposo_origen⁻¹) · reposo_destino
# - Cadera: además de girar, se traslada lo mismo que la pelvis de origen (escalado por la altura).
# - Piernas: el Worker tiene los pies como controles de IK (Foot y PT cuelgan de Root).
#   Los pies se dejan fijos en el suelo y las piernas se resuelven con IK analítica de 2 huesos,
#   con la rodilla orientada hacia el control PT. Así los pies no se deslizan.
# - Se exporta un GLB con: Idle, Walk, Run (originales del Worker) + TreeChopping_Loop.
import sys
import bpy
from mathutils import Matrix, Vector

script_args = sys.argv[sys.argv.index('--') + 1:]
worker_path, ual_path, out_path = script_args[:3]
blend_path = script_args[3] if len(script_args) > 3 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
# Las animaciones de Quaternius están hechas a 30 fps (Run = 24 fotogramas, Walk = 40, tala = 29).
# Con los 24 fps por defecto de Blender caerían en fotogramas fraccionarios y el exportador,
# que muestrea fotogramas enteros, acortaría las animaciones y perdería precisión.
bpy.context.scene.render.fps = 30
bpy.context.scene.render.fps_base = 1.0

def import_armature(path):
    before = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    return arm, new, [a for a in bpy.data.actions if a not in before_actions]

W, w_objects, w_actions = import_armature(worker_path)
U, u_objects, u_actions = import_armature(ual_path)
assert W.matrix_world == Matrix.Identity(4) and U.matrix_world == Matrix.Identity(4), 'se esperaban objetos sin transformación'

# ---------- Tabla de correspondencia (origen UAL2 → destino Worker) ----------
MAP = {
    'pelvis': 'Hips', 'spine_01': 'Abdomen', 'spine_02': 'Torso', 'spine_03': 'Chest',
    'neck_01': 'Neck', 'Head': 'Head',
}
for s, t in (('l', 'L'), ('r', 'R')):
    MAP.update({
        f'clavicle_{s}': f'Shoulder.{t}', f'upperarm_{s}': f'UpperArm.{t}',
        f'lowerarm_{s}': f'LowerArm.{t}', f'hand_{s}': f'Wrist.{t}',
        # Falanges: index_01 (UAL) es la primera falange; Index1 (Worker) es el metacarpo
        f'index_01_{s}': f'Index2.{t}', f'index_02_{s}': f'Index3.{t}', f'index_03_{s}': f'Index4.{t}',
        f'middle_01_{s}': f'Middle2.{t}', f'middle_02_{s}': f'Middle3.{t}', f'middle_03_{s}': f'Middle4.{t}',
        f'ring_01_{s}': f'Ring2.{t}', f'ring_02_{s}': f'Ring3.{t}', f'ring_03_{s}': f'Ring4.{t}',
        f'pinky_01_{s}': f'Pinky2.{t}', f'pinky_02_{s}': f'Pinky3.{t}', f'pinky_03_{s}': f'Pinky4.{t}',
        f'thumb_01_{s}': f'Thumb1.{t}', f'thumb_02_{s}': f'Thumb2.{t}', f'thumb_03_{s}': f'Thumb3.{t}',
    })
TARGET_TO_SOURCE = {t: s for s, t in MAP.items()}
LEGS = {'L': ('UpperLeg.L', 'LowerLeg.L', 'Foot.L', 'PT.L'), 'R': ('UpperLeg.R', 'LowerLeg.R', 'Foot.R', 'PT.R')}
LEG_BONES = {b for leg in LEGS.values() for b in leg[:2]}
for t in TARGET_TO_SOURCE:
    assert t in W.data.bones, f'falta {t} en el Worker'
for s in MAP:
    assert s in U.data.bones, f'falta {s} en UAL2'

rest_w = {b.name: b.matrix_local.copy() for b in W.data.bones}
rest_u = {b.name: b.matrix_local.copy() for b in U.data.bones}
height_ratio = rest_w['Hips'].translation.z / rest_u['pelvis'].translation.z

# Orden padres → hijos
order = []
def visit(b):
    order.append(b.name)
    for c in b.children:
        visit(c)
for b in W.data.bones:
    if b.parent is None:
        visit(b)

def two_bone_ik(hip, ankle, l1, l2, pole):
    """Posición de la rodilla para llegar de la cadera al tobillo, doblando hacia el polo."""
    axis = ankle - hip
    c = min(axis.length, l1 + l2 - 1e-5)
    u = axis.normalized()
    cos_a = max(-1.0, min(1.0, (l1 * l1 + c * c - l2 * l2) / (2 * l1 * c)))
    w = (pole - hip) - u * (pole - hip).dot(u)
    w.normalize()
    sin_a = (1 - cos_a * cos_a) ** 0.5
    return hip + (u * cos_a + w * sin_a) * l1

def aim(rest_matrix, rest_vec, new_vec, head):
    """Gira la orientación de reposo lo mínimo para que rest_vec pase a apuntar a new_vec."""
    rot = rest_vec.rotation_difference(new_vec) @ rest_matrix.to_quaternion()
    return Matrix.LocRotScale(head, rot, Vector((1, 1, 1)))

# ---------- Acción nueva en el Worker ----------
src_action = next(a for a in u_actions if a.name == 'TreeChopping_Loop')
U.animation_data.action = src_action
W.animation_data_create()
W.animation_data.action = None
dst_action = bpy.data.actions.new('TreeChopping_Loop')
W.animation_data.action = dst_action
for pb in W.pose.bones:
    pb.rotation_mode = 'QUATERNION'

scene = bpy.context.scene
start, end = src_action.frame_range
frames = [float(f) for f in range(int(start), int(end) + 1)]
if frames[-1] < end:
    frames.append(end)

src_pelvis_rest = rest_u['pelvis'].translation
for frame in frames:
    scene.frame_set(int(frame), subframe=frame - int(frame))
    pose_u = {pb.name: pb.matrix.copy() for pb in U.pose.bones}
    pose = {}  # Matrices de pose del Worker en espacio de la armadura

    for name in order:
        bone = W.data.bones[name]
        parent = bone.parent
        rest_rel = (rest_w[parent.name].inverted() @ rest_w[name]) if parent else rest_w[name]
        # Por defecto el hueso sigue a su padre manteniendo su relación de reposo
        default = (pose[parent.name] @ rest_rel) if parent else rest_w[name].copy()
        head = default.translation.copy()

        if name in TARGET_TO_SOURCE:
            s = TARGET_TO_SOURCE[name]
            delta = pose_u[s].to_quaternion() @ rest_u[s].to_quaternion().inverted()
            rot = delta @ rest_w[name].to_quaternion()
            if name == 'Hips':
                head = rest_w[name].translation + (pose_u[s].translation - src_pelvis_rest) * height_ratio
            pose[name] = Matrix.LocRotScale(head, rot, Vector((1, 1, 1)))
        elif name in LEG_BONES:
            side = name[-1]
            up_name, low_name, foot_name, pole_name = LEGS[side]
            if name == up_name:
                hip = head
                knee_rest = rest_w[low_name].translation
                ankle = rest_w[foot_name].translation  # El pie se queda plantado en su sitio de reposo
                l1 = (knee_rest - rest_w[up_name].translation).length
                l2 = (rest_w[foot_name].translation - knee_rest).length
                knee = two_bone_ik(hip, ankle, l1, l2, rest_w[pole_name].translation)
                pose[name] = aim(rest_w[name], knee_rest - rest_w[up_name].translation, knee - hip, hip)
                pose['_knee_' + side] = Matrix.Translation(knee)
                pose['_ankle_' + side] = Matrix.Translation(ankle)
            else:
                knee = pose['_knee_' + side].translation
                ankle = pose['_ankle_' + side].translation
                pose[name] = aim(rest_w[name], rest_w[foot_name].translation - rest_w[low_name].translation, ankle - knee, knee)
        else:
            pose[name] = default

        # Matriz de pose → transformación local (matrix_basis) y fotograma clave
        parent_pose = pose[parent.name] if parent else Matrix.Identity(4)
        basis = rest_rel.inverted() @ parent_pose.inverted() @ pose[name] if parent else rest_w[name].inverted() @ pose[name]
        pb = W.pose.bones[name]
        loc, rot, _ = basis.decompose()
        pb.rotation_quaternion = rot
        pb.location = loc
        pb.keyframe_insert('rotation_quaternion', frame=frame, group=name)
        pb.keyframe_insert('location', frame=frame, group=name)

# Bucle perfecto: el último fotograma igual al primero (la animación de origen ya es un bucle)
print(f'RETARGET fotogramas {frames[0]}-{frames[-1]} · huesos con correspondencia {len(TARGET_TO_SOURCE)} · piernas IK · ratio de altura {height_ratio:.3f}')

# ---------- Limpieza y exportación ----------
KEEP = {'Idle', 'Walk', 'Run', 'TreeChopping_Loop'}
for obj in list(u_objects) + [o for o in w_objects if o.type == 'MESH' and o.parent is None]:
    bpy.data.objects.remove(obj, do_unlink=True)
for action in list(bpy.data.actions):
    if action is dst_action:
        continue
    if action.name not in KEEP or action in u_actions:
        bpy.data.actions.remove(action)
# Al crearla existía la acción de origen con el mismo nombre: ahora ya se puede renombrar
dst_action.name = 'TreeChopping_Loop'
for action in bpy.data.actions:
    action.use_fake_user = True
W.animation_data.action = None
print('ACCIONES EXPORTADAS', sorted(a.name for a in bpy.data.actions))
print('OBJETOS', sorted(o.name for o in bpy.data.objects))

bpy.ops.object.select_all(action='DESELECT')
W.select_set(True)
for child in W.children:
    child.select_set(True)
bpy.context.view_layer.objects.active = W
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
    export_yup=True,
)
if blend_path:
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print('EXPORTADO', out_path)

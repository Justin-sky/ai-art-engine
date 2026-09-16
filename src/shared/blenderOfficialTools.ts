/**
 * 官方 Blender Lab「MCP Server」扩展的协议适配层。
 *
 * 官方架构是「LLM 客户端 ⇄ blmcp(Python MCP server) ⇄ TCP ⇄ Blender 扩展」，中间还要
 * Python 环境；本应用不引入任何子进程，直接扮演 blmcp 的角色：对扩展的 9876 端口发
 * `{"type":"execute","code":"...","strict_json":true}` + `\0` 帧，由扩展在 Blender 主线程
 * 执行代码并回 `{"status":"ok","result":{...}}` + `\0`。
 *
 * 因此本模块的职责：把工具表的每个工具（命令 + 白名单参数）编成一段自包含的 Python，
 * 约定 `_p` 为参数字典、代码必须给 `result` 赋 dict（与官方扩展的执行约定一致）。
 * 工具契约（名称 / 入参 schema / 输出结构）与社区 addon.py 后端保持同构，模型侧无感。
 */
import {
  blenderToolSpec,
  buildBlenderCommand,
  type BlenderAddonType,
  type BlenderToolSpec
} from './blenderMcp'

export type { BlenderAddonType }

// --- 帧编解码（官方扩展用 \0 作帧边界，JSON 本体会转义 \0，不会出现歧义） --------

/** 官方扩展 execute 帧编码（含帧尾 \0） */
export function encodeOfficialExecute(code: string): string {
  return JSON.stringify({ type: 'execute', code, strict_json: true }) + '\0'
}

/** 从缓冲区切出一个以 \0 结尾的帧；没有完整帧时返回 null */
export function takeNullFrame(buffer: string): { frame: string; rest: string } | null {
  const idx = buffer.indexOf('\0')
  if (idx < 0) return null
  return { frame: buffer.slice(0, idx), rest: buffer.slice(idx + 1) }
}

/**
 * 官方扩展会把被执代码的 stdout 一并带回（响应体的 `stdout` 字段）。
 * execute_code 的「print 原样返回」契约靠它补齐；其余工具用不到。
 */
export function officialExecuteStdout(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { status?: unknown; stdout?: unknown }
    if (parsed?.status === 'ok' && typeof parsed.stdout === 'string') return parsed.stdout
  } catch {
    // 非法 JSON：主流程的 parseBlenderReply 会给出更合适的错误
  }
  return null
}

// --- Python 字面量 ------------------------------------------------------------

/** JS 值 → Python 字面量（字符串用 JSON 序列化，转义规则与 Python 字符串字面量兼容） */
function pythonLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'number':
      return Number.isFinite(value) ? String(value) : 'None'
    case 'boolean':
      return value ? 'True' : 'False'
    default:
      break
  }
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(', ')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)}: ${pythonLiteral(item)}`
    )
    return `{${entries.join(', ')}}`
  }
  return 'None'
}

function paramsDict(params: Record<string, unknown>): string {
  return pythonLiteral(params)
}

// --- 各工具的 Python 实现 -------------------------------------------------------
//
// 约定：`_p` 是参数字典；软失败返回 {"error": "..."}（parseBlenderReply 会归一成命令
// 失败），硬失败直接抛异常（扩展会回 status=error + traceback，与社区后端的报错
// 口径一致）。所有字符串保持 ASCII，避免任何编码层歧义。

const GET_SCENE_INFO = `import bpy


def _aiae_main():
    scene = bpy.context.scene
    objects = [obj for obj in scene.objects if obj.parent is None]
    return {
        "name": scene.name,
        "object_count": len(scene.objects),
        "material_count": len(bpy.data.materials),
        "top_level_objects": [
            {
                "name": obj.name,
                "type": obj.type,
                "location": [round(c, 4) for c in obj.matrix_world.to_translation()],
            }
            for obj in objects[:20]
        ],
    }


result = _aiae_main()
`

const GET_WORLD_STATE_SNAPSHOT = `import bpy


def _aiae_main():
    ctx = bpy.context
    scene = ctx.scene
    objects = list(scene.objects)
    vertices = edges = faces = 0
    for obj in objects:
        if obj.type == "MESH":
            vertices += len(obj.data.vertices)
            edges += len(obj.data.edges)
            faces += len(obj.data.polygons)
    animated = 0
    for obj in objects:
        data = getattr(obj, "animation_data", None)
        if data is not None and data.action is not None:
            animated += 1
    active = ctx.view_layer.objects.active if ctx.view_layer is not None else None
    return {
        "scene_name": scene.name,
        "frame_current": scene.frame_current,
        "frame_start": scene.frame_start,
        "frame_end": scene.frame_end,
        "fps": round(scene.render.fps / scene.render.fps_base, 4),
        "object_count": len(objects),
        "material_count": len(bpy.data.materials),
        "geometry": {"vertices": vertices, "edges": edges, "faces": faces},
        "relations": {"parented_objects": sum(1 for o in objects if o.parent is not None)},
        "animation": {"actions": len(bpy.data.actions), "animated_objects": animated},
        "selected": [obj.name for obj in objects if obj.select_get()],
        "active_camera": scene.camera.name if scene.camera is not None else None,
        "active_light": active.name if active is not None and active.type == "LIGHT" else None,
    }


result = _aiae_main()
`

const GET_OBJECT_INFO = `import bpy
from mathutils import Vector


def _aiae_main():
    name = _p["name"]
    obj = bpy.data.objects.get(name)
    if obj is None:
        return {
            "error": "Object not found: " + name,
            "available_objects": sorted(bpy.data.objects.keys())[:50],
        }
    info = {
        "name": obj.name,
        "type": obj.type,
        "location": [round(c, 4) for c in obj.matrix_world.to_translation()],
        "rotation": [round(c, 4) for c in obj.rotation_euler],
        "scale": [round(c, 4) for c in obj.scale],
        "visible": not obj.hide_get() and obj.visible_get(),
        "materials": [
            slot.material.name if slot.material is not None else None
            for slot in obj.material_slots
        ],
    }
    if obj.type == "MESH":
        info["mesh"] = {
            "vertices": len(obj.data.vertices),
            "edges": len(obj.data.edges),
            "faces": len(obj.data.polygons),
        }
        info["world_bbox"] = [
            [round(c, 4) for c in obj.matrix_world @ Vector(corner)]
            for corner in obj.bound_box
        ]
    return info


result = _aiae_main()
`

const GET_VIEWPORT_SCREENSHOT = `import os
import tempfile

import bpy
import imbuf


def _aiae_main():
    if bpy.app.background:
        return {"error": "Blender is running in background mode, no UI to screenshot"}
    window = bpy.context.window
    if window is None:
        windows = list(bpy.context.window_manager.windows)
        if not windows:
            return {"error": "No Blender window available"}
        window = windows[0]
    target = None
    for area in window.screen.areas:
        if area.type == "VIEW_3D":
            if target is None or area.width * area.height > target.width * target.height:
                target = area
    if target is None:
        return {"error": "No 3D viewport area found in the active window"}
    max_size = _p.get("max_size") or 800
    if not isinstance(max_size, (int, float)) or max_size < 64:
        max_size = 800
    with tempfile.TemporaryDirectory(prefix="aiae_shot_") as tmpdir:
        raw = os.path.join(tmpdir, "viewport.png")
        try:
            with bpy.context.temp_override(window=window, area=target):
                bpy.ops.screen.screenshot_area(filepath=raw)
        except RuntimeError as err:
            return {"error": "screenshot_area failed: " + str(err)}
        image = imbuf.load(raw)
        try:
            width, height = image.size
            if max(width, height) > 0:
                scale = min(1.0, float(max_size) / max(width, height))
                if scale < 1.0:
                    image.resize(
                        (max(1, int(width * scale)), max(1, int(height * scale))),
                        method="BILINEAR",
                    )
            imbuf.write(image, filepath=_p["filepath"])
            width, height = image.size
        finally:
            image.free()
        return {"width": width, "height": height}


result = _aiae_main()
`

const EXPORT_SCENE = `import os

import bpy


def _aiae_main():
    filepath = _p["filepath"]
    fmt = str(_p.get("format") or "glb").lower()
    names = _p.get("object_names")
    if names is not None:
        names = [str(n) for n in names]
    selection_only = bool(_p.get("selection_only"))
    apply_modifiers = _p.get("apply_modifiers")
    if apply_modifiers is None:
        apply_modifiers = True
    use_selection = bool(names) or selection_only
    restored = []
    try:
        if names:
            for obj in bpy.context.scene.objects:
                restored.append((obj, obj.select_get()))
            bpy.ops.object.select_all(action="DESELECT")
            missing = []
            for name in names:
                obj = bpy.data.objects.get(name)
                if obj is None:
                    missing.append(name)
                else:
                    obj.select_set(True)
            if missing:
                return {"error": "Objects not found: " + ", ".join(missing)}
        if fmt in ("glb", "gltf"):
            bpy.ops.export_scene.gltf(
                filepath=filepath,
                export_format="GLB" if fmt == "glb" else "GLTF",
                use_selection=use_selection,
                export_apply=bool(apply_modifiers),
            )
        elif fmt == "fbx":
            bpy.ops.export_scene.fbx(filepath=filepath, use_selection=use_selection)
        elif fmt == "obj":
            bpy.ops.export_scene.obj(
                filepath=filepath,
                use_selection=use_selection,
                apply_modifiers=bool(apply_modifiers),
            )
        elif fmt == "usd":
            bpy.ops.wm.usd_export(filepath=filepath, selected_objects_only=use_selection)
        elif fmt == "stl":
            bpy.ops.export_mesh.stl(
                filepath=filepath,
                use_selection=use_selection,
                apply_modifiers=bool(apply_modifiers),
            )
        else:
            return {"error": "Unsupported export format: " + fmt}
    finally:
        if restored:
            for obj, selected in restored:
                try:
                    obj.select_set(selected)
                except ReferenceError:
                    pass
    return {
        "filepath": filepath,
        "bytes": os.path.getsize(filepath) if os.path.exists(filepath) else 0,
        "format": fmt,
    }


result = _aiae_main()
`

const DESCRIBE_NODE_TYPE = `import bpy

_TREE_TYPES = (
    ("ShaderNode", "ShaderNodeTree"),
    ("GeometryNode", "GeometryNodeTree"),
    ("CompositorNode", "CompositorNodeTree"),
    ("TextureNode", "TextureNodeTree"),
)


def _aiae_main():
    bl_idname = _p["bl_idname"]
    cls = getattr(bpy.types, bl_idname, None)
    if cls is None or not hasattr(cls, "bl_rna"):
        return {"error": "Unknown node type: " + bl_idname}
    tree_type = None
    for prefix, candidate in _TREE_TYPES:
        if bl_idname.startswith(prefix):
            tree_type = candidate
            break
    if tree_type is None:
        return {"error": "Cannot infer node tree type for " + bl_idname}
    overrides = _p.get("property_overrides") or {}
    skip = {
        "rna_type",
        "type",
        "name",
        "location",
        "width",
        "height",
        "select",
        "parent",
    }
    properties = []
    for prop in cls.bl_rna.properties:
        if prop.identifier in skip:
            continue
        try:
            properties.append(
                {"name": prop.name, "identifier": prop.identifier, "type": prop.type}
            )
        except Exception:
            continue
    tree = bpy.data.node_groups.new("aiae_describe_tmp", tree_type)
    node = None
    try:
        node = tree.nodes.new(bl_idname)
        for key, value in overrides.items():
            try:
                setattr(node, key, value)
            except Exception:
                pass
        return {
            "bl_idname": bl_idname,
            "name": getattr(node, "name", bl_idname),
            "inputs": [
                {"name": s.name, "identifier": s.identifier, "type": s.type}
                for s in node.inputs
            ],
            "outputs": [
                {"name": s.name, "identifier": s.identifier, "type": s.type}
                for s in node.outputs
            ],
            "properties": properties,
        }
    finally:
        if node is not None:
            tree.nodes.remove(node)
        bpy.data.node_groups.remove(tree)


result = _aiae_main()
`

const BPY_API_LOOKUP = `import bpy


def _aiae_main():
    query = str(_p["query"]).strip()
    parts = [part for part in query.split(".") if part]
    obj = bpy
    walked = ["bpy"]
    for part in parts:
        try:
            obj = getattr(obj, part)
        except AttributeError:
            return {
                "error": "Cannot resolve " + ".".join(walked + [part]),
                "query": query,
            }
        walked.append(part)
    info = {"query": query, "resolved": ".".join(walked)}
    rna = getattr(obj, "bl_rna", None)
    if hasattr(obj, "get_rna_type"):
        try:
            rna = obj.get_rna_type()
        except Exception:
            pass
    if rna is not None:
        info["type"] = getattr(rna, "name", "") or rna.__class__.__name__
        info["description"] = (getattr(rna, "description", "") or "").strip()[:400]
        properties = []
        for prop in rna.properties:
            if prop.identifier == "rna_type":
                continue
            entry = {"name": prop.name, "identifier": prop.identifier, "type": prop.type}
            try:
                default = getattr(prop, "default", None)
            except Exception:
                default = None
            if default is not None:
                entry["default"] = str(default)
            properties.append(entry)
        info["properties"] = properties[:64]
    else:
        info["repr"] = repr(obj)[:200]
        info["callable"] = callable(obj)
    return info


result = _aiae_main()
`

const GET_ADDON_INFO = `import bpy


def _aiae_main():
    return {
        "blender_version": bpy.app.version_string,
        "addon_version": "Blender Lab MCP Server (execute protocol)",
        "protocol_version": "execute-1",
    }


result = _aiae_main()
`

/** 工具命令 → 官方后端 Python 模板 */
const TOOL_SNIPPETS: Record<string, (params: Record<string, unknown>) => string> = {
  get_scene_info: () => GET_SCENE_INFO,
  get_world_state_snapshot: () => GET_WORLD_STATE_SNAPSHOT,
  get_object_info: () => GET_OBJECT_INFO,
  get_viewport_screenshot: () => GET_VIEWPORT_SCREENSHOT,
  export_scene: () => EXPORT_SCENE,
  describe_node_type: () => DESCRIBE_NODE_TYPE,
  bpy_api_lookup: () => BPY_API_LOOKUP,
  get_addon_info: () => GET_ADDON_INFO
}

/**
 * 把一条工具调用编成官方扩展可执行的 Python：
 * 参数先走社区后端同一套白名单校验（buildBlenderCommand），再注入 `_p`。
 * execute_code 是特例：用户代码原样内联（护栏已在调用方执行），尾部补 result 兜底。
 */
export function buildOfficialToolCode(
  spec: BlenderToolSpec,
  args: Record<string, unknown>,
  ctx: { screenshotFilepath: string }
): string {
  const { params } = buildBlenderCommand(spec, args, ctx)
  if (spec.command === 'execute_code') {
    return `${String(params.code ?? '')}\nif not (isinstance(result, dict) and result):\n    result = {"executed": True}\n`
  }
  const snippet = TOOL_SNIPPETS[spec.command]
  if (!snippet) {
    throw new Error(`Blender tool not supported by official backend: ${spec.command}`)
  }
  return `_p = ${paramsDict(params)}\n\n${snippet(params)}`
}

/** 探活帧：get_addon_status 工具（命令 get_addon_info），回带 Blender / addon / 协议版本 */
export function buildOfficialProbeCode(): string {
  const spec = blenderToolSpec('get_addon_status')
  if (!spec) throw new Error('Blender probe tool spec missing')
  return buildOfficialToolCode(spec, {}, { screenshotFilepath: '' })
}

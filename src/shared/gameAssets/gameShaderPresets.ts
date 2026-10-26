/**
 * 跨引擎核心游戏 Shader 与运行时 GPU 粒子发射器预设纯函数层。
 *
 * 覆盖独立游戏最高频的 8 类实时 Shader 表现（支持 Godot 4 `.gdshader`、Unity `.shader`、WebGL GLSL）：
 * 1. `hit_flash`：角色受击闪白 / 受击染色
 * 2. `dissolve_burn`：怪物死亡 / 卡牌销毁余烬溶解（带灼烧亮边）
 * 3. `pixel_outline`：2D 精灵交互高亮 / 稀有度流光外描边
 * 4. `water_2d`：2D 水面正弦折射波纹与顶边泡沫
 * 5. `crt_retro`：复古街机 CRT 扫描线、暗角与色差滤镜
 * 6. `hologram_glitch`：赛博朋克全息扫描线与水平故障抖动
 * 7. `wind_foliage`：草丛/树木/旗帜随风摇曳顶点摆动
 * 8. `rarity_sheen`：SSR 卡牌 / 传奇装备斜向流光扫光
 *
 * 同时提供 8 类运行时 GPU 粒子发射器参数预设（`fire_arks`, `rain_storm`, `snow_fall`, `heal_aura`, `coin_burst`, `blood_hit`, `magic_trail`, `level_up_burst`）。
 */

export type GameShaderPresetId =
  | 'hit_flash'
  | 'dissolve_burn'
  | 'pixel_outline'
  | 'water_2d'
  | 'crt_retro'
  | 'hologram_glitch'
  | 'wind_foliage'
  | 'rarity_sheen'

export type GameParticlePresetId =
  | 'fire_sparks'
  | 'rain_storm'
  | 'snow_fall'
  | 'heal_aura'
  | 'coin_burst'
  | 'blood_hit'
  | 'magic_trail'
  | 'level_up_burst'

export interface GeneratedShaderPreset {
  presetId: GameShaderPresetId
  title: string
  description: string
  uniforms: Record<string, { type: string; default: number | string | number[]; desc: string }>
  godotGdShader: string
  unityShaderLab: string
  webglGlslFrag: string
}

export interface GeneratedParticlePreset {
  presetId: GameParticlePresetId
  title: string
  emissionShape: 'point' | 'sphere' | 'box' | 'ring'
  oneShot: boolean
  amount: number
  lifetimeSec: number
  explosiveness: number
  initialVelocityMin: number
  initialVelocityMax: number
  gravity: { x: number; y: number }
  scaleStart: number
  scaleEnd: number
  colorStartHex: string
  colorEndHex: string
  godotTresSnippet: string
  phaserEmitterConfig: Record<string, unknown>
}

export interface GameShaderParticleBundle {
  schemaVersion: 1
  shaders: GeneratedShaderPreset[]
  particles: GeneratedParticlePreset[]
}

const SHADER_CATALOG: Record<GameShaderPresetId, Omit<GeneratedShaderPreset, 'presetId'>> = {
  hit_flash: {
    title: 'Hit Flash & Damage Tint',
    description:
      'Preserves sprite alpha and linearly interpolates RGB toward flash color on impact.',
    uniforms: {
      flash_amount: { type: 'float', default: 0.0, desc: 'Flash intensity (0.0 ~ 1.0)' },
      flash_color: { type: 'vec4', default: [1.0, 1.0, 1.0, 1.0], desc: 'Target flash RGBA color' }
    },
    godotGdShader: `shader_type canvas_item;

uniform float flash_amount : hint_range(0.0, 1.0) = 0.0;
uniform vec4 flash_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);

void fragment() {
\tvec4 tex = texture(TEXTURE, UV);
\tvec3 blended = mix(tex.rgb, flash_color.rgb, flash_amount);
\tCOLOR = vec4(blended, tex.a);
}
`,
    unityShaderLab: `Shader "AIArtEngine/2D/HitFlash" {
  Properties {
    _MainTex ("Sprite Texture", 2D) = "white" {}
    _FlashColor ("Flash Color", Color) = (1,1,1,1)
    _FlashAmount ("Flash Amount", Range(0,1)) = 0.0
  }
  SubShader {
    Tags { "Queue"="Transparent" "RenderType"="Transparent" }
    Blend SrcAlpha OneMinusSrcAlpha
    Pass {
      CGPROGRAM
      #pragma vertex vert_img
      #pragma fragment frag
      #include "UnityCG.cginc"
      sampler2D _MainTex;
      fixed4 _FlashColor;
      float _FlashAmount;
      fixed4 frag(v2f_img i) : SV_Target {
        fixed4 c = tex2D(_MainTex, i.uv);
        c.rgb = lerp(c.rgb, _FlashColor.rgb, _FlashAmount);
        return c;
      }
      ENDCG
    }
  }
}`,
    webglGlslFrag: `precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uFlashAmount;
uniform vec3 uFlashColor;

void main() {
  vec4 tex = texture2D(uSampler, vTextureCoord);
  vec3 rgb = mix(tex.rgb, uFlashColor, clamp(uFlashAmount, 0.0, 1.0));
  gl_FragColor = vec4(rgb, tex.a);
}`
  },
  dissolve_burn: {
    title: 'Ember Dissolve Burn',
    description: 'Clips sprite alpha by noise threshold with an emissive burning rim.',
    uniforms: {
      dissolve_amount: { type: 'float', default: 0.0, desc: 'Dissolve progress (0.0 ~ 1.0)' },
      edge_width: { type: 'float', default: 0.06, desc: 'Glowing burn rim width' },
      burn_color: { type: 'vec4', default: [1.0, 0.42, 0.08, 1.0], desc: 'Ember rim color' }
    },
    godotGdShader: `shader_type canvas_item;

uniform sampler2D noise_tex : repeat_enable;
uniform float dissolve_amount : hint_range(0.0, 1.0) = 0.0;
uniform float edge_width : hint_range(0.0, 0.25) = 0.06;
uniform vec4 burn_color : source_color = vec4(1.0, 0.42, 0.08, 1.0);

void fragment() {
\tvec4 tex = texture(TEXTURE, UV);
\tfloat n = texture(noise_tex, UV).r;
\tif (n < dissolve_amount) {
\t\tdiscard;
\t}
\tfloat edge = smoothstep(dissolve_amount, dissolve_amount + edge_width, n);
\tvec3 rgb = mix(burn_color.rgb, tex.rgb, edge);
\tCOLOR = vec4(rgb, tex.a);
}
`,
    unityShaderLab: `Shader "AIArtEngine/2D/DissolveBurn" {
  Properties {
    _MainTex ("Sprite Texture", 2D) = "white" {}
    _NoiseTex ("Noise Texture", 2D) = "gray" {}
    _Dissolve ("Dissolve Amount", Range(0,1)) = 0.0
    _EdgeWidth ("Burn Edge Width", Range(0,0.25)) = 0.06
    _BurnColor ("Burn Color", Color) = (1,0.42,0.08,1)
  }
  SubShader {
    Tags { "Queue"="Transparent" "RenderType"="Transparent" }
    Blend SrcAlpha OneMinusSrcAlpha
    Pass {
      CGPROGRAM
      #pragma vertex vert_img
      #pragma fragment frag
      #include "UnityCG.cginc"
      sampler2D _MainTex;
      sampler2D _NoiseTex;
      float _Dissolve;
      float _EdgeWidth;
      fixed4 _BurnColor;
      fixed4 frag(v2f_img i) : SV_Target {
        fixed4 c = tex2D(_MainTex, i.uv);
        float n = tex2D(_NoiseTex, i.uv).r;
        clip(n - _Dissolve);
        float edge = smoothstep(_Dissolve, _Dissolve + _EdgeWidth, n);
        c.rgb = lerp(_BurnColor.rgb, c.rgb, edge);
        return c;
      }
      ENDCG
    }
  }
}`,
    webglGlslFrag: `precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D uNoiseSampler;
uniform float uDissolve;
uniform float uEdgeWidth;
uniform vec3 uBurnColor;

void main() {
  vec4 tex = texture2D(uSampler, vTextureCoord);
  float n = texture2D(uNoiseSampler, vTextureCoord).r;
  if (n < uDissolve) discard;
  float edge = smoothstep(uDissolve, uDissolve + uEdgeWidth, n);
  gl_FragColor = vec4(mix(uBurnColor, tex.rgb, edge), tex.a);
}`
  },
  pixel_outline: {
    title: '2D Sprite Pixel Outline',
    description: 'Samples 4-neighbor alpha channel to draw a uniform outer highlight stroke.',
    uniforms: {
      outline_width: { type: 'float', default: 1.5, desc: 'Outline pixel width' },
      outline_color: { type: 'vec4', default: [0.2, 0.95, 1.0, 1.0], desc: 'Outline RGBA color' }
    },
    godotGdShader: `shader_type canvas_item;

uniform float outline_width : hint_range(0.0, 8.0) = 1.5;
uniform vec4 outline_color : source_color = vec4(0.2, 0.95, 1.0, 1.0);

void fragment() {
\tvec4 col = texture(TEXTURE, UV);
\tvec2 ps = TEXTURE_PIXEL_SIZE * outline_width;
\tfloat a = texture(TEXTURE, UV + vec2(ps.x, 0.0)).a
\t        + texture(TEXTURE, UV - vec2(ps.x, 0.0)).a
\t        + texture(TEXTURE, UV + vec2(0.0, ps.y)).a
\t        + texture(TEXTURE, UV - vec2(0.0, ps.y)).a;
\tfloat edge = clamp(a, 0.0, 1.0) * (1.0 - col.a);
\tCOLOR = mix(col, outline_color, edge);
}
`,
    unityShaderLab: `Shader "AIArtEngine/2D/PixelOutline" {
  Properties {
    _MainTex ("Sprite Texture", 2D) = "white" {}
    _OutlineColor ("Outline Color", Color) = (0.2,0.95,1,1)
    _OutlineWidth ("Outline Width", Range(0,8)) = 1.5
  }
  SubShader {
    Tags { "Queue"="Transparent" "RenderType"="Transparent" }
    Blend SrcAlpha OneMinusSrcAlpha
    Pass {
      CGPROGRAM
      #pragma vertex vert_img
      #pragma fragment frag
      #include "UnityCG.cginc"
      sampler2D _MainTex;
      float4 _MainTex_TexelSize;
      fixed4 _OutlineColor;
      float _OutlineWidth;
      fixed4 frag(v2f_img i) : SV_Target {
        fixed4 c = tex2D(_MainTex, i.uv);
        float2 ps = _MainTex_TexelSize.xy * _OutlineWidth;
        float a = tex2D(_MainTex, i.uv + float2(ps.x, 0)).a
                + tex2D(_MainTex, i.uv - float2(ps.x, 0)).a
                + tex2D(_MainTex, i.uv + float2(0, ps.y)).a
                + tex2D(_MainTex, i.uv - float2(0, ps.y)).a;
        float edge = saturate(a) * (1.0 - c.a);
        return lerp(c, _OutlineColor, edge);
      }
      ENDCG
    }
  }
}`,
    webglGlslFrag: `precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec2 uTexelSize;
uniform float uOutlineWidth;
uniform vec4 uOutlineColor;

void main() {
  vec4 col = texture2D(uSampler, vTextureCoord);
  vec2 ps = uTexelSize * uOutlineWidth;
  float a = texture2D(uSampler, vTextureCoord + vec2(ps.x, 0.0)).a
          + texture2D(uSampler, vTextureCoord - vec2(ps.x, 0.0)).a
          + texture2D(uSampler, vTextureCoord + vec2(0.0, ps.y)).a
          + texture2D(uSampler, vTextureCoord - vec2(0.0, ps.y)).a;
  float edge = clamp(a, 0.0, 1.0) * (1.0 - col.a);
  gl_FragColor = mix(col, uOutlineColor, edge);
}`
  },
  water_2d: {
    title: '2D Water Ripple & Surface Foam',
    description: 'Sine-wave UV refraction distortion with a animated top surface foam band.',
    uniforms: {
      wave_speed: { type: 'float', default: 2.4, desc: 'Wave scroll speed' },
      wave_amp: { type: 'float', default: 0.012, desc: 'UV refraction amplitude' },
      foam_thickness: { type: 'float', default: 0.04, desc: 'Top foam band thickness' }
    },
    godotGdShader: `shader_type canvas_item;

uniform float wave_speed = 2.4;
uniform float wave_amp = 0.012;
uniform float foam_thickness = 0.04;
uniform vec4 water_tint : source_color = vec4(0.15, 0.58, 0.88, 0.85);

void fragment() {
\tvec2 warped = UV + vec2(sin(UV.y * 24.0 + TIME * wave_speed) * wave_amp, 0.0);
\tvec4 tex = texture(TEXTURE, clamp(warped, vec2(0.0), vec2(1.0)));
\tfloat surface = sin(UV.x * 18.0 + TIME * wave_speed) * 0.01 + foam_thickness;
\tfloat foam = step(UV.y, surface);
\tvec3 rgb = mix(tex.rgb * water_tint.rgb, vec3(0.92, 0.98, 1.0), foam);
\tCOLOR = vec4(rgb, tex.a * water_tint.a);
}
`,
    unityShaderLab: `Shader "AIArtEngine/2D/Water2D" {
  Properties {
    _MainTex ("Water Texture", 2D) = "white" {}
    _WaveSpeed ("Wave Speed", Float) = 2.4
    _WaveAmp ("Wave Amplitude", Float) = 0.012
  }
  SubShader {
    Tags { "Queue"="Transparent" "RenderType"="Transparent" }
    Blend SrcAlpha OneMinusSrcAlpha
    Pass {
      CGPROGRAM
      #pragma vertex vert_img
      #pragma fragment frag
      #include "UnityCG.cginc"
      sampler2D _MainTex;
      float _WaveSpeed;
      float _WaveAmp;
      fixed4 frag(v2f_img i) : SV_Target {
        float2 uv = i.uv + float2(sin(i.uv.y * 24.0 + _Time.y * _WaveSpeed) * _WaveAmp, 0);
        return tex2D(_MainTex, saturate(uv));
      }
      ENDCG
    }
  }
}`,
    webglGlslFrag: `precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime;

void main() {
  vec2 uv = vTextureCoord + vec2(sin(vTextureCoord.y * 24.0 + uTime * 2.4) * 0.012, 0.0);
  gl_FragColor = texture2D(uSampler, clamp(uv, 0.0, 1.0));
}`
  },
  crt_retro: {
    title: 'Retro CRT Scanline & Chromatic Aberration',
    description: 'Simulates retro arcade CRT scanline darkening and subtle RGB channel offset.',
    uniforms: {
      scanline_count: { type: 'float', default: 240.0, desc: 'Scanline row count' },
      scanline_opacity: { type: 'float', default: 0.18, desc: 'Scanline opacity' },
      chromatic_offset: { type: 'float', default: 0.0015, desc: 'RGB aberration offset' }
    },
    godotGdShader: `shader_type canvas_item;

uniform float scanline_count = 240.0;
uniform float scanline_opacity : hint_range(0.0, 0.6) = 0.18;
uniform float chromatic_offset : hint_range(0.0, 0.01) = 0.0015;

void fragment() {
\tfloat r = texture(TEXTURE, UV + vec2(chromatic_offset, 0.0)).r;
\tfloat g = texture(TEXTURE, UV).g;
\tfloat b = texture(TEXTURE, UV - vec2(chromatic_offset, 0.0)).b;
\tfloat a = texture(TEXTURE, UV).a;
\tfloat scan = sin(UV.y * scanline_count * 3.14159) * 0.5 + 0.5;
\tvec3 rgb = vec3(r, g, b) * mix(1.0, scan, scanline_opacity);
\tCOLOR = vec4(rgb, a);
}
`,
    unityShaderLab: `Shader "AIArtEngine/PostProcess/CRTRetro" {
  Properties {
    _MainTex ("Screen Texture", 2D) = "white" {}
    _ScanlineCount ("Scanline Count", Float) = 240.0
    _ScanlineOpacity ("Scanline Opacity", Range(0,0.6)) = 0.18
  }
  SubShader {
    Pass {
      CGPROGRAM
      #pragma vertex vert_img
      #pragma fragment frag
      #include "UnityCG.cginc"
      sampler2D _MainTex;
      float _ScanlineCount;
      float _ScanlineOpacity;
      fixed4 frag(v2f_img i) : SV_Target {
        fixed4 c = tex2D(_MainTex, i.uv);
        float scan = sin(i.uv.y * _ScanlineCount * 3.14159) * 0.5 + 0.5;
        c.rgb *= lerp(1.0, scan, _ScanlineOpacity);
        return c;
      }
      ENDCG
    }
  }
}`,
    webglGlslFrag: `precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;

void main() {
  vec4 c = texture2D(uSampler, vTextureCoord);
  float scan = sin(vTextureCoord.y * 240.0 * 3.14159) * 0.5 + 0.5;
  gl_FragColor = vec4(c.rgb * mix(1.0, scan, 0.18), c.a);
}`
  },
  hologram_glitch: {
    title: 'Cyberpunk Hologram & Glitch',
    description: 'Cyan holographic scanlines with periodic horizontal glitch displacement.',
    uniforms: {
      glitch_strength: { type: 'float', default: 0.015, desc: 'Horizontal glitch offset' },
      holo_color: { type: 'vec4', default: [0.1, 0.88, 1.0, 0.85], desc: 'Hologram tint RGBA' }
    },
    godotGdShader: `shader_type canvas_item;

uniform float glitch_strength : hint_range(0.0, 0.08) = 0.015;
uniform vec4 holo_color : source_color = vec4(0.1, 0.88, 1.0, 0.85);

void fragment() {
\tfloat wave = step(0.92, sin(UV.y * 16.0 - TIME * 6.0));
\tvec2 uv = UV + vec2(wave * glitch_strength, 0.0);
\tvec4 tex = texture(TEXTURE, uv);
\tfloat scan = sin(UV.y * 160.0 + TIME * 12.0) * 0.15 + 0.85;
\tCOLOR = vec4(tex.rgb * holo_color.rgb * scan, tex.a * holo_color.a);
}
`,
    unityShaderLab: `Shader "AIArtEngine/2D/HologramGlitch" {
  Properties {
    _MainTex ("Sprite Texture", 2D) = "white" {}
    _HoloColor ("Hologram Color", Color) = (0.1,0.88,1,0.85)
  }
  SubShader {
    Tags { "Queue"="Transparent" "RenderType"="Transparent" }
    Blend SrcAlpha OneMinusSrcAlpha
    Pass {
      CGPROGRAM
      #pragma vertex vert_img
      #pragma fragment frag
      #include "UnityCG.cginc"
      sampler2D _MainTex;
      fixed4 _HoloColor;
      fixed4 frag(v2f_img i) : SV_Target {
        fixed4 c = tex2D(_MainTex, i.uv);
        return c * _HoloColor;
      }
      ENDCG
    }
  }
}`,
    webglGlslFrag: `precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime;

void main() {
  vec4 c = texture2D(uSampler, vTextureCoord);
  float scan = sin(vTextureCoord.y * 160.0 + uTime * 10.0) * 0.15 + 0.85;
  gl_FragColor = vec4(c.rgb * vec3(0.1, 0.88, 1.0) * scan, c.a * 0.85);
}`
  },
  wind_foliage: {
    title: 'Wind Foliage Vertex Sway',
    description: 'Anchors bottom UV (UV.y=1) while swaying upper foliage vertices with sine wind.',
    uniforms: {
      wind_speed: { type: 'float', default: 2.0, desc: 'Wind sway frequency' },
      wind_strength: { type: 'float', default: 6.0, desc: 'Top sway pixel amplitude' }
    },
    godotGdShader: `shader_type canvas_item;

uniform float wind_speed = 2.0;
uniform float wind_strength = 6.0;

void vertex() {
\tfloat top_factor = 1.0 - UV.y;
\tVERTEX.x += sin(TIME * wind_speed + VERTEX.x * 0.05) * wind_strength * top_factor;
}
`,
    unityShaderLab: `Shader "AIArtEngine/2D/WindFoliage" {
  Properties {
    _MainTex ("Foliage Texture", 2D) = "white" {}
    _WindSpeed ("Wind Speed", Float) = 2.0
    _WindAmp ("Wind UV Amplitude", Float) = 0.03
  }
  SubShader {
    Tags { "Queue"="Transparent" "RenderType"="Transparent" }
    Blend SrcAlpha OneMinusSrcAlpha
    Pass {
      CGPROGRAM
      #pragma vertex vert_img
      #pragma fragment frag
      #include "UnityCG.cginc"
      sampler2D _MainTex;
      float _WindSpeed;
      float _WindAmp;
      fixed4 frag(v2f_img i) : SV_Target {
        float2 uv = i.uv;
        uv.x += sin(_Time.y * _WindSpeed + i.uv.y * 4.0) * _WindAmp * (1.0 - i.uv.y);
        return tex2D(_MainTex, uv);
      }
      ENDCG
    }
  }
}`,
    webglGlslFrag: `precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime;

void main() {
  vec2 uv = vTextureCoord;
  uv.x += sin(uTime * 2.0) * 0.025 * (1.0 - uv.y);
  gl_FragColor = texture2D(uSampler, clamp(uv, 0.0, 1.0));
}`
  },
  rarity_sheen: {
    title: 'SSR Card & Legendary Item Rarity Sheen',
    description: 'Sweeps a 45-degree specular highlight band periodically across cards or icons.',
    uniforms: {
      sheen_speed: { type: 'float', default: 1.4, desc: 'Sheen sweep speed' },
      sheen_width: { type: 'float', default: 0.14, desc: 'Highlight band width' },
      sheen_intensity: { type: 'float', default: 0.55, desc: 'Additive sheen brightness' }
    },
    godotGdShader: `shader_type canvas_item;

uniform float sheen_speed = 1.4;
uniform float sheen_width : hint_range(0.02, 0.4) = 0.14;
uniform float sheen_intensity : hint_range(0.0, 1.5) = 0.55;

void fragment() {
\tvec4 tex = texture(TEXTURE, UV);
\tfloat pos = mod(TIME * sheen_speed, 2.4) - 0.6;
\tfloat diag = (UV.x + UV.y) * 0.5;
\tfloat band = smoothstep(pos - sheen_width, pos, diag) - smoothstep(pos, pos + sheen_width, diag);
\tCOLOR = vec4(tex.rgb + vec3(band * sheen_intensity), tex.a);
}
`,
    unityShaderLab: `Shader "AIArtEngine/2D/RaritySheen" {
  Properties {
    _MainTex ("Card/Icon Texture", 2D) = "white" {}
    _SheenSpeed ("Sheen Speed", Float) = 1.4
    _SheenWidth ("Sheen Width", Range(0.02,0.4)) = 0.14
    _SheenIntensity ("Sheen Intensity", Range(0,1.5)) = 0.55
  }
  SubShader {
    Tags { "Queue"="Transparent" "RenderType"="Transparent" }
    Blend SrcAlpha OneMinusSrcAlpha
    Pass {
      CGPROGRAM
      #pragma vertex vert_img
      #pragma fragment frag
      #include "UnityCG.cginc"
      sampler2D _MainTex;
      float _SheenSpeed;
      float _SheenWidth;
      float _SheenIntensity;
      fixed4 frag(v2f_img i) : SV_Target {
        fixed4 c = tex2D(_MainTex, i.uv);
        float pos = fmod(_Time.y * _SheenSpeed, 2.4) - 0.6;
        float diag = (i.uv.x + i.uv.y) * 0.5;
        float band = smoothstep(pos - _SheenWidth, pos, diag) - smoothstep(pos, pos + _SheenWidth, diag);
        c.rgb += band * _SheenIntensity;
        return c;
      }
      ENDCG
    }
  }
}`,
    webglGlslFrag: `precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime;

void main() {
  vec4 tex = texture2D(uSampler, vTextureCoord);
  float pos = mod(uTime * 1.4, 2.4) - 0.6;
  float diag = (vTextureCoord.x + vTextureCoord.y) * 0.5;
  float band = smoothstep(pos - 0.14, pos, diag) - smoothstep(pos, pos + 0.14, diag);
  gl_FragColor = vec4(tex.rgb + vec3(band * 0.55), tex.a);
}`
  }
}

const PARTICLE_CATALOG: Record<
  GameParticlePresetId,
  Omit<GeneratedParticlePreset, 'presetId' | 'godotTresSnippet' | 'phaserEmitterConfig'>
> = {
  fire_sparks: {
    title: 'Fire & Torch Rising Sparks',
    emissionShape: 'sphere',
    oneShot: false,
    amount: 48,
    lifetimeSec: 1.2,
    explosiveness: 0.1,
    initialVelocityMin: 35,
    initialVelocityMax: 95,
    gravity: { x: 0, y: -120 },
    scaleStart: 1.0,
    scaleEnd: 0.15,
    colorStartHex: '#ffcc33',
    colorEndHex: '#ff3300'
  },
  rain_storm: {
    title: 'Heavy Rain Storm Curtain',
    emissionShape: 'box',
    oneShot: false,
    amount: 180,
    lifetimeSec: 0.85,
    explosiveness: 0.0,
    initialVelocityMin: 420,
    initialVelocityMax: 560,
    gravity: { x: -80, y: 680 },
    scaleStart: 0.8,
    scaleEnd: 0.8,
    colorStartHex: '#88ccff',
    colorEndHex: '#4488cc'
  },
  snow_fall: {
    title: 'Gentle Ambient Snowfall',
    emissionShape: 'box',
    oneShot: false,
    amount: 96,
    lifetimeSec: 3.6,
    explosiveness: 0.0,
    initialVelocityMin: 25,
    initialVelocityMax: 55,
    gravity: { x: 18, y: 45 },
    scaleStart: 0.9,
    scaleEnd: 0.4,
    colorStartHex: '#ffffff',
    colorEndHex: '#cfe8ff'
  },
  heal_aura: {
    title: 'Healing Aura Rising Glow',
    emissionShape: 'ring',
    oneShot: false,
    amount: 32,
    lifetimeSec: 1.4,
    explosiveness: 0.25,
    initialVelocityMin: 30,
    initialVelocityMax: 75,
    gravity: { x: 0, y: -85 },
    scaleStart: 0.6,
    scaleEnd: 1.2,
    colorStartHex: '#55ff99',
    colorEndHex: '#00cc66'
  },
  coin_burst: {
    title: 'Treasure Chest Coin Fountain Burst',
    emissionShape: 'point',
    oneShot: true,
    amount: 36,
    lifetimeSec: 0.9,
    explosiveness: 0.92,
    initialVelocityMin: 180,
    initialVelocityMax: 340,
    gravity: { x: 0, y: 520 },
    scaleStart: 1.0,
    scaleEnd: 0.7,
    colorStartHex: '#ffe047',
    colorEndHex: '#ff9900'
  },
  blood_hit: {
    title: 'Melee Combat Impact Splash',
    emissionShape: 'point',
    oneShot: true,
    amount: 24,
    lifetimeSec: 0.45,
    explosiveness: 0.95,
    initialVelocityMin: 140,
    initialVelocityMax: 280,
    gravity: { x: 0, y: 460 },
    scaleStart: 0.9,
    scaleEnd: 0.2,
    colorStartHex: '#ff3b5c',
    colorEndHex: '#7a091e'
  },
  magic_trail: {
    title: 'Spell Projectile Stardust Trail',
    emissionShape: 'point',
    oneShot: false,
    amount: 64,
    lifetimeSec: 0.55,
    explosiveness: 0.0,
    initialVelocityMin: 15,
    initialVelocityMax: 45,
    gravity: { x: 0, y: 0 },
    scaleStart: 1.0,
    scaleEnd: 0.05,
    colorStartHex: '#47f0ff',
    colorEndHex: '#6b38ff'
  },
  level_up_burst: {
    title: 'Character Level-Up Radial Burst',
    emissionShape: 'ring',
    oneShot: true,
    amount: 72,
    lifetimeSec: 1.1,
    explosiveness: 0.88,
    initialVelocityMin: 120,
    initialVelocityMax: 260,
    gravity: { x: 0, y: -140 },
    scaleStart: 1.2,
    scaleEnd: 0.1,
    colorStartHex: '#fff599',
    colorEndHex: '#33e6ff'
  }
}

export function buildGameShaderParticleBundle(options?: {
  shaderPresets?: GameShaderPresetId[]
  particlePresets?: GameParticlePresetId[]
}): GameShaderParticleBundle {
  const shaderIds: GameShaderPresetId[] =
    options?.shaderPresets && options.shaderPresets.length > 0
      ? options.shaderPresets
      : (Object.keys(SHADER_CATALOG) as GameShaderPresetId[])

  const particleIds: GameParticlePresetId[] =
    options?.particlePresets && options.particlePresets.length > 0
      ? options.particlePresets
      : (Object.keys(PARTICLE_CATALOG) as GameParticlePresetId[])

  const shaders: GeneratedShaderPreset[] = shaderIds
    .filter((id) => Boolean(SHADER_CATALOG[id]))
    .map((presetId) => ({
      presetId,
      ...SHADER_CATALOG[presetId]
    }))

  const particles: GeneratedParticlePreset[] = particleIds
    .filter((id) => Boolean(PARTICLE_CATALOG[id]))
    .map((presetId) => {
      const base = PARTICLE_CATALOG[presetId]
      const godotTresSnippet = `[gd_resource type="ParticleProcessMaterial" format=3]

[resource]
particle_flag_disable_z = true
gravity = Vector3(${base.gravity.x}, ${base.gravity.y}, 0)
initial_velocity_min = ${base.initialVelocityMin.toFixed(1)}
initial_velocity_max = ${base.initialVelocityMax.toFixed(1)}
scale_min = ${Math.min(base.scaleStart, base.scaleEnd).toFixed(2)}
scale_max = ${Math.max(base.scaleStart, base.scaleEnd).toFixed(2)}
`
      const phaserEmitterConfig = {
        lifespan: Math.round(base.lifetimeSec * 1000),
        speed: { min: base.initialVelocityMin, max: base.initialVelocityMax },
        scale: { start: base.scaleStart, end: base.scaleEnd },
        gravityX: base.gravity.x,
        gravityY: base.gravity.y,
        quantity: base.oneShot ? base.amount : 2,
        emitting: !base.oneShot,
        tint: [
          Number.parseInt(base.colorStartHex.replace('#', ''), 16),
          Number.parseInt(base.colorEndHex.replace('#', ''), 16)
        ]
      }
      return {
        presetId,
        ...base,
        godotTresSnippet,
        phaserEmitterConfig
      }
    })

  return {
    schemaVersion: 1,
    shaders,
    particles
  }
}

/** 中文界面文案 */
export default {
  common: {
    browse: '浏览',
    cancel: '取消',
    create: '创建',
    back: '返回',
    save: '保存',
    saving: '保存中…',
    delete: '删除',
    confirm: '确定',
    tip: '提示',
    gotIt: '知道了',
    search: '搜索…',
    all: '全部',
    none: '无',
    unnamed: '未命名',
    pleaseSelect: '请选择',
    second: '秒',
    open: '打开',
    close: '关闭'
  },
  characterRefs: {
    title: '角色绑定',
    importFromCatalog: '从世界目录导入',
    collapse: '收起',
    hint: '绑定世界人物目录的角色参考图，生成时注入参考图以保证跨分镜同人。',
    removeTitle: '移除',
    empty: '尚未绑定角色',
    loadingCatalog: '正在加载世界角色目录…',
    catalogEmpty: '世界人物目录中没有已生成图片的角色'
  },
  aiWorkflow: {
    title: '一键工作流',
    shortAction: '一键工作流',
    subtitle: '选模板预览拓扑，或 AI 定制后确认创建可复用宿主资产',
    presetsLabel: '预设模板',
    textModelLabel: '文本模型（AI 规划）',
    imageModelLabel: '图片默认模型',
    videoModelLabel: '视频默认模型',
    aspectRatioLabel: '宽高比',
    aspectRatioEmpty: '不设置（跟随默认）',
    modelLabel: '文本模型',
    modelEmpty: '未配置',
    promptLabel: '工作流描述',
    promptPlaceholder: '例如：帮我创建一个生成游戏买量视频的工作流，包含剧本、分镜图和视频生成…',
    hint: '将创建宿主资产（可拖入画布并编辑 I/O）。先预览再创建；选择模板会自动预览，AI 规划需文本模型。Ctrl/⌘ + Enter = AI 预览。',
    previewLabel: '预览',
    previewMeta: '{nodes} 节点 · {edges} 连线',
    previewAi: 'AI 生成预览',
    planning: '规划中…',
    create: '创建工作流',
    creating: '创建中…',
    saveTitle: '保存工作流',
    saveSubtitle: '选择保存目录并输入名称',
    defaultName: '一键工作流',
    generate: '生成工作流',
    generating: '生成中…',
    emptyPrompt: '请先填写工作流描述或选择预设',
    needProject: '请先打开工程',
    needModel: '请先选择可用的文本模型',
    needPresetForSeed: '请先选择带固化拓扑的预设模板',
    needPreview: '请先生成预览再创建',
    planFailed: '规划工作流失败',
    failed: '生成工作流失败',
    createdWithWarnings: '已创建（部分节点/连线已跳过）',
    planLog: {
      title: 'AI 生成预览',
      titlePreset: 'AI 生成预览 · {name}',
      start: '开始规划工作流',
      llmStart: '调用文本模型：{model}（第 {n} 次）',
      llmDone: '模型返回完成：{chars} 字符（{model}）',
      llmError: '模型调用失败：{error}',
      done: '规划完成：{nodes} 节点 · {edges} 连线',
      failed: '规划失败：{error}'
    },
    presets: {
      gameUaVideo: {
        title: '游戏买量',
        desc: '剧本 → 分镜图 → 视频',
        prompt:
          '帮我创建一个游戏买量短视频工作流：先用文本节点写卖点与旁白脚本，再生成关键角色/场景分镜图，最后用图生视频产出 15 秒左右竖屏广告片段。节点之间用合理连线串联，预留人工改稿口。'
      },
      characterSheet: {
        title: '角色设定',
        desc: '人设文案 + 多视角立绘',
        prompt:
          '创建一个角色设定工作流：文本节点输出角色人设与外观描述，再分别生成正面/侧面/三视图或表情变体立绘，并预留一张参考图上传节点以便锁定画风。'
      },
      storyboardVideo: {
        title: '分镜出片',
        desc: '分镜图串成视频',
        prompt:
          '创建一个分镜到成片的工作流：输入剧本或镜头列表，拆成若干分镜图生成节点，再对关键镜头做图生视频，最后用备注节点标明剪辑合成顺序。'
      },
      productAd: {
        title: '产品广告',
        desc: '卖点文案 + 产品图 + 短视频',
        prompt:
          '创建一个产品广告工作流：文本节点提炼卖点文案，图片节点生成产品主视觉与场景图，再生成一段带产品特写的短视频；预留产品参考图上传。'
      },
      gameUi: {
        title: '游戏UI界面',
        desc: '策划案 → UI拆分 → UI生成',
        prompt:
          '创建一个游戏 UI 工作流：先用策划案生成节点产出游戏系统策划案，再用 UI 界面拆分节点把策划案拆成各界面的详细生图提示词（不写具体配色与画风），最后由 UI 界面生成节点（可 dive 进入内图）逐屏生成界面图，并配合全局风格参考图统一界面风格。'
      },
      ecomAdDeep: {
        title: '电商带货',
        desc: '主视觉 → 变体矩阵 → 返工 → 质检',
        prompt:
          '创建一个电商带货工作流：文本节点提炼卖点文案，图片节点生成产品主视觉与使用场景图；广告变体矩阵节点接主视觉，批量生成多版本广告图；媒体返工节点按质检意见自动重试不达标图片，媒体质检节点输出最终审查结论；另接一个图层分离节点把主视觉拆成图层便于改详情页文字。'
      },
      game3dAsset: {
        title: '游戏3D资产',
        desc: '文生3D模型 → 导演台 → 站位图 → 展示视频',
        prompt:
          '创建一个游戏 3D 资产工作流：文本节点写资产设定，两个 3D 模型生成节点分别生成主角与配套道具 GLB 模型；导演台节点接入模型，dive 进入舞台自动实例化，用基础几何体或 AI 白模补景并摆机位；站位图（out-shots）经选择节点挑一张，图生视频生成资产展示视频。'
      },
      comicPublish: {
        title: '漫画出版',
        desc: '剧本 → 分镜图 ×3 → 漫画页排版导出',
        prompt:
          '创建一个漫画出版工作流：文本节点放按格编写的漫画剧本，三个图片节点分别生成统一画风的分镜图，全部接入漫画页节点；双击漫画页进入编辑器排版分格、加台词气泡、调背景色，并支持透明底导出。'
      },
      courseNarrate: {
        title: '知识口播',
        desc: '讲稿 → 配音 + 口播视频 → 口型同步',
        prompt:
          '创建一个知识课程口播工作流：文本节点放课程讲稿，图片节点生成主讲人形象，声音节点按讲稿生成口播配音，视频节点基于主讲人形象生成口播视频；口型同步节点接入口播视频与配音，输出口型对齐的成片。'
      },
      directorPreviz: {
        title: '3D白模预演',
        desc: '全景参考 → AI 白模搭景 → 站位图锁构图',
        prompt:
          '创建一个 3D 白模预演工作流：图片节点生成 360 全景氛围参考并接入导演台的全景口，dive 进入舞台自动设为背景；在舞台用「生成3D白模」按参考图与一句话指令搭建白模场景，摆机位截取站位图；站位图经选择节点挑一张，图生视频按构图生成预演成片，文本节点作为成片提示词补充。'
      },
      shortDrama: {
        title: '短剧分镜',
        desc: '剧本→节拍→9宫格→4宫格→36动态视频（Agent 流水线）',
        prompt:
          '创建一个短剧分镜 Agent 流水线工作流：文本节点放单集剧本，分镜师角色节点依次生成节拍拆解表、9宫格分镜表、4宫格动态分镜表（9×4=36），动画师角色节点生成动态提示词表；9 个宫格选择节点各接一张锚点分镜图，36 个动态格选择节点各接一条图生视频（父宫格锚点图作首帧）；每个阶段后接导演审核节点（输出 PASS/FAIL，失败原因自动写入 agent-state.json 并在重跑时附加）。'
      },
      shortDrama9: {
        title: '短剧分镜·9格直出',
        desc: '剧本→节拍→9宫格→动画师9条动态提示词→9条视频',
        prompt:
          '创建一个短剧分镜 Agent 流水线工作流，但跳过 4宫格展开：文本节点放单集剧本，分镜师角色节点依次生成节拍拆解表、9宫格分镜表；一张 9宫格拼图提取出 9 张锚点图；动画师角色节点为 9 个宫格各拆解 1 条动态提示词，共 9 条，每条动态提示词与对应锚点图共同驱动一条图生视频；节拍拆解表和 9宫格分镜表后各接导演审核节点（输出 PASS/FAIL，失败原因自动写入 agent-state.json 并在重跑时附加）。'
      },
      custom: {
        title: '自定义',
        desc: '清空描述后自行填写',
        prompt: ''
      }
    }
  },
  app: {
    nav: {
      studio: '工作室',
      settings: '设置'
    },
    menu: {
      openAria: '工程菜单：新建、打开与最近工程',
      recentEmpty: '暂无最近工程',
      closeProject: '关闭工程'
    }
  },
  home: {
    tagline: 'AI 创作工具',
    createProject: '新建工程',
    openProject: '打开工程',
    recentProjects: '最近工程',
    removeRecent: '从最近列表移除',
    apiUnavailable:
      '应用接口未就绪：请关闭所有 Electron 窗口后重新运行 npm run dev（不要用浏览器直接打开 localhost）',
    dialog: {
      title: '新建工程',
      projectName: '工程名称',
      storageDir: '存储目录',
      selectDirPlaceholder: '选择目录…'
    }
  },
  settings: {
    title: '设置',
    hint: '模型与 API 密钥为全局设置，对所有工程生效；修改后会自动保存。',
    section: {
      general: '通用',
      models: '模型',
      objectStorage: '对象存储',
      mcp: 'MCP',
      skills: '自定义技能',
      plugins: '扩展'
    },
    theme: '主题',
    themeDark: '暗色',
    themeLight: '亮色',
    language: '语言',
    languageZh: '中文',
    languageEn: 'English',
    autoSave: {
      enabled: '启用自动保存',
      interval: '自动保存间隔'
    },
    about: {
      title: '关于与更新',
      version: '当前版本',
      checkUpdate: '检查更新',
      installUpdate: '重启并安装',
      checking: '正在检查更新…',
      available: '发现新版本 {version}，正在下载…',
      notAvailable: '已是最新版本',
      progress: '下载中 {percent}%',
      downloaded: '新版本 {version} 已下载完成，可重启安装',
      error: '更新失败：{message}',
      disabled: '开发模式不检查更新',
      idle: '可检查 GitHub Releases 上的新版本'
    },
    mcp: {
      title: 'MCP 接入',
      status: '状态',
      running: '运行中 · 端口 {port}',
      notRunning: 'MCP 工具服务未启动，可填写端口后启动',
      endpoint: '接入地址',
      token: 'Token',
      port: '监听端口',
      portHint: '端口修改后点右侧按钮重启生效；若进程启动时设置了 AIAE_MCP_PORT 环境变量，以环境变量为准。',
      start: '启动 MCP 服务',
      restart: '重启 MCP 服务',
      restarting: '重启中…',
      restarted: 'MCP 服务已重启',
      resetToken: '重置 Token',
      tokenReset: 'Token 已重置，旧 Token 立即失效，请更新已接入的客户端配置',
      editToken: '编辑',
      tokenPlaceholder: '输入新 Token（8–128 位，不含空格）',
      saveToken: '保存 Token',
      cancelEdit: '取消',
      tokenInvalid: 'Token 需为 8–128 位且不含空格',
      tokenSaved: 'Token 已更新，请同步更新已接入客户端的配置',
      show: '显示',
      hide: '隐藏',
      copy: '复制',
      copied: '已复制到剪贴板',
      command: 'Claude Code 接入命令',
      hint: 'Token 跨重启复用（可在上方重置）。Token 相当于本机 MCP 服务的全部权限，请勿泄露。'
    },
    skills: {
      hint: 'AI 对话的 agent 通过 dsh 技能机制感知技能：把符合 dsh SKILL.md 格式（frontmatter name / description + 正文）的 .md 文件放进下方目录，下次对话自动生效。应用内置技能由程序自动管理，请勿手动修改。',
      dirPath: '技能目录',
      builtinCount: '内置技能 {count} 个（程序自动管理）',
      kind: {
        builtin: '内置',
        custom: '自定义',
        template: '模板'
      },
      openDir: '打开目录',
      writeTemplate: '生成示例模板',
      templateWritten: '示例模板已生成：{file}',
      templateSkipped: '示例模板已存在（未覆盖）：{file}',
      empty: '目录为空。点击「生成示例模板」创建一份可用的模板。'
    },
    models: {
      addProvider: '添加模型提供商',
      add: '添加',
      collapseProvider: '收起提供商',
      expandProvider: '展开提供商',
      emptyProviders:
        '尚未添加提供商。可添加 OpenRouter、OpenAI、DeepSeek、智谱、Kimi（月之暗面）、xAI（Grok）、Google（Gemini）、vLLM、Ollama、LM Studio、火山方舟、可灵、MiniMax、通义千问、魔塔、ComfyUI 或 MagicRouter；本地服务无需密钥，云端服务填写密钥后在各模态下勾选模型。',
      unifiedHint:
        '同一提供商只需填写一次密钥 / Base URL；文本、图片、视频、声音分别拉取并勾选。火山方舟声音为手填已购 speaker_id；可灵 / MiniMax / 通义千问用 API Key；魔塔用访问令牌（文本/文生图）；OpenAI 官方仅支持文本与图片，需要可访问 api.openai.com 的网络环境与账号；DeepSeek 仅支持文本；智谱支持 GLM 文本与 CogView 图片；Kimi（月之暗面）仅支持文本；xAI（Grok）支持文本 / 图片 / 视频；Google（Gemini）仅支持文本；vLLM / Ollama / LM Studio 为本地 OpenAI 兼容服务，无需 API Key；ComfyUI 走 API 2（本机 8189 或云端 Base URL），图片 / 视频 / 声音，本机可空 Key；MagicRouter 为多供应商聚合（OpenAI 兼容），支持文本 / 图片 / 视频，需 mr- 开头 API Key。',
      enabled: '启用',
      remove: '移除',
      label: '显示名称',
      baseUrl: 'API Base URL',
      nativeBaseUrl: 'ComfyUI 本体地址',
      nativeBaseUrlPlaceholder: 'http://127.0.0.1:8188',
      nativeBaseUrlHint:
        '填正在运行的 ComfyUI，例如 http://127.0.0.1:8190。workflow 只从这里读，填了就不会再连 8188。上面的 Base URL 仍是 comfy-api-proxy（默认 8189）。视频任务也走 proxy，ComfyUI 改端口后请把 proxy 重开为 --comfyui 指向同一地址。留空才尝试 8188。',
      showApiKey: '显示 API Key',
      hideApiKey: '隐藏 API Key',
      credentialsHint: {
        openrouter: '获取 API Key：',
        openai: '获取 OpenAI API Key：',
        deepseek: '获取 DeepSeek API Key：',
        zhipu: '获取智谱 API Key：',
        moonshot: '获取 Kimi（月之暗面）API Key：',
        xai: '获取 xAI API Key：',
        google: '获取 Google AI Studio API Key：',
        vllm: '本地服务无需 API Key；vLLM 文档：',
        ollama: '本地服务无需 API Key；Ollama 官网：',
        lmstudio: '本地服务无需 API Key；LM Studio 官网：',
        'volcengine-ark': '获取方舟 API Key（文本 / 图片 / 视频）：',
        kling: '获取 API Key：',
        meshy: '获取 Meshy API Key：',
        minimax: '获取 API Key：',
        dashscope: '获取百炼 API Key：',
        modelscope: '获取访问令牌：',
        comfyui: '本机可空 Key；云端 API Key：',
        magicrouter: '获取 MagicRouter API Key（mr- 开头）：',
        tripo: '获取 Tripo API Key：',
        hyper3d: '获取 Rodin（Hyper3D）API Key：',
        luma: '获取 Luma AI API Key：',
        lux3d: '获取 Lux3D API Key：'
      },
      arkVoiceCredentialsHint:
        '声音设计走豆包语音 openspeech，请填语音控制台 API Key（可与方舟 Key 不同），并手填已购 speaker_id：',
      fetchModels: '拉取可用模型',
      preloadListModelsUnavailable:
        'window.studio.listModels 不可用：请完全退出并重新运行 npm run dev（preload 变更不会热更新）',
      capFirstFrame: '首帧',
      capLastFrame: '尾帧',
      testingConnection: '正在验证 API Key…',
      loading: '拉取中…',
      catalogCount: '共 {n} 个模型',
      selectAll: '全选当前列表',
      clearSelection: '清空选择',
      manualModelPlaceholder: '手动填写模型 / 接入点 / Resource ID',
      manualModelAdd: '添加并勾选',
      manualSpeakerPlaceholder: '手填已购买声音 speaker_id（如 S_xxx）',
      manualSpeakerAdd: '添加并勾选',
      emptyCatalog: '目录为空。可手动填写模型 ID，或检查提供商与 API Key。',
      emptyRemoteKeepPrevious: '远端返回空列表，已保留上次拉取结果。可稍后重试。',
      filterNoMatch: '没有匹配的模型，请清空筛选后再试。',
      clearFilter: '清空筛选',
      emptySpeakers: '尚未添加声音。请手填控制台购买的 speaker_id 并勾选。',
      filterSpeakerPlaceholder: '筛选 speaker_id',
      defaultSpeaker: '默认声音',
      selectedSpeakerCount: '已选择 {n} 个声音',
      defaultModel: '默认生成模型',
      selectedCount: '已选择 {n} 个模型',
      filterPlaceholder: '筛选模型 id / 名称',
      modality: {
        text: '文本',
        image: '图片',
        video: '视频',
        audio: '声音',
        model3d: '3D 模型'
      },
      modalityHint: {
        text: '用于剧本与对话生成，对应 OpenRouter /api/v1/models。',
        image: '用于文生图 / 图生图，对应 /api/v1/images/models。',
        video: '用于分镜视频生成，对应 /api/v1/videos/models。',
        audio: '用于 TTS 语音合成，对应 /api/v1/models?output_modalities=speech 与 /api/v1/audio/speech。',
        model3d: '用于 3D 模型生成，从文本和/或参考图生成 GLB 模型。'
      },
      arkModalityHint: {
        text: '火山方舟对话模型（豆包等），Base URL 默认 https://ark.cn-beijing.volces.com/api/v3，对应 /chat/completions。',
        image: 'Seedream 等图片模型，调用 /images/generations。列表按接入点名称启发式筛选。',
        video: 'Seedance 等视频模型，调用 /contents/generations/tasks。参考图/视频需可公网访问（可用对象存储 TOS）。',
        audio:
          '豆包语音 openspeech「声音设计」（X-Api-Key）。不拉取模型目录；请在上方使用语音控制台 API Key，并手填已购 speaker_id（如 S_xxx）。生成时用节点指令作为声音描述。'
      },
      klingModalityHint: {
        image:
          '可灵图片生成（文生图 / 图生图），调用 /v1/images/generations。需 API Key；目录为本地静态列表。',
        video:
          '可灵视频生成：无首帧走文生视频 /v1/videos/text2video，有首帧走图生视频 /v1/videos/image2video。默认 Base URL 为 api-beijing.klingai.com。'
      },
      minimaxModalityHint: {
        text: 'MiniMax 对话（OpenAI 兼容），请求 /v1/chat/completions。默认 Base URL 为 api.minimaxi.com（不要带 /v1；程序会自动拼接）。',
        image:
          'MiniMax 文生图 / 主体参考图生图，调用 /v1/image_generation（image-01 / image-01-live）。参考图走 subject_reference。',
        video:
          'MiniMax 视频：H3 走 V2（POST /v2/video_generation，多模态 content，2K，时长 4–15s）；Hailuo 2.3/02 仍走 V1。默认 Base URL 为 api.minimaxi.com；视频目录为本地静态列表。',
        audio:
          'MiniMax 音色设计：POST /v1/voice_design。节点指令作为音色描述，返回 voice_id 与试听音频；目录为本地「音色设计」项。'
      },
      dashscopeModalityHint: {
        text: '通义千问对话（OpenAI 兼容），默认 Base URL 为 dashscope.aliyuncs.com/compatible-mode/v1，对应 /chat/completions。',
        image:
          '万相文生图，异步调用 /api/v1/services/aigc/text2image/image-synthesis（由兼容 Base URL 自动推导原生地址）。',
        video:
          '万相文生/图生视频，异步调用 /api/v1/services/aigc/video-generation/video-synthesis；有首帧时传 img_url，请选用 i2v 模型。'
      },
      modelscopeModalityHint: {
        text: '魔塔（ModelScope）API-Inference 对话，默认 Base URL 为 api-inference.modelscope.cn/v1，填写访问令牌（ms-…）。',
        image: '魔塔文生图，调用 /v1/images/generations；模型 id 形如 org/model_name。'
      },
      openaiModalityHint: {
        text: 'OpenAI 官方对话模型（GPT 系列），默认 Base URL 为 api.openai.com/v1，对应 /chat/completions；文本目录由 GET /models 拉取。',
        image:
          'OpenAI 图片模型（gpt-image-1 / gpt-image-2）：文生图走 /images/generations，参考图编辑走 /images/edits（最多 1 张）；固定 size 为 1024x1024 / 1536x1024 / 1024x1536 / auto。'
      },
      deepseekModalityHint: {
        text: 'DeepSeek 对话模型（deepseek-chat / deepseek-reasoner），OpenAI 兼容，默认 Base URL 为 api.deepseek.com，对应 /chat/completions；文本目录由 GET /models 拉取。'
      },
      moonshotModalityHint: {
        text: 'Kimi 对话模型（kimi-k2 系列 / moonshot-v1 系列），OpenAI 兼容，默认 Base URL 为 api.moonshot.cn/v1，对应 /chat/completions；文本目录由 GET /models 拉取。'
      },
      xaiModalityHint: {
        text: 'xAI（Grok）对话模型（grok-* 系列），OpenAI 兼容，默认 Base URL 为 api.x.ai/v1，对应 /chat/completions；文本目录由 GET /models 拉取。',
        image:
          'Grok Imagine 文生图（grok-imagine-image / grok-imagine-image-pro），JSON body 调用 /images/generations，支持 aspect_ratio 与 response_format（返回 base64，落盘不受 URL 过期影响）。',
        video:
          'Grok Imagine Video（grok-imagine-video）：异步提交 /videos/generations 后轮询 GET /videos/{request_id}，status=done 后下载 video.url；支持 480p / 720p、5–15 秒与首帧图生视频（image 字段）。'
      },
      googleModalityHint: {
        text: 'Google Gemini 对话（gemini-* 系列），走官方 OpenAI 兼容层，默认 Base URL 为 generativelanguage.googleapis.com/v1beta/openai，对应 /chat/completions；文本目录由 GET /models 拉取。',
        image:
          'Nano Banana 系列文生图 / 图生图（gemini-2.5-flash-image、gemini-3-pro-image、gemini-3.1-flash-image 等），JSON body 调用 /images/generations，支持 aspect_ratio、resolution、n 与 response_format（返回 base64，落盘不受 URL 过期影响）；参考图走 image 字段（gemini-3-pro-image 最多 14 张）。',
        video:
          'Veo 3.1 视频生成（veo-3.1-generate / fast / lite）：异步提交 /videos 后轮询 GET /videos/{id}，OpenAI VideoJob 形态，status=completed 后取 video_url / output.url；支持 720p–4K、4–8 秒与首帧图生视频（image 字段）。'
      },
      zhipuModalityHint: {
        text: '智谱 GLM 对话（OpenAI 兼容），默认 Base URL 为 open.bigmodel.cn/api/paas/v4，对应 /chat/completions。',
        image:
          '智谱 CogView 文生图（glm-image / cogview-4 / cogview-3-flash），调用 /images/generations；仅支持文生图，不支持参考图。'
      },
      comfyuiModalityHint: {
        image:
          'ComfyUI API 2 出图：POST /api/v2/jobs。模型 id = userdata 里的 API 格式 workflow 名（如 txt2img）。本机默认 http://127.0.0.1:8189（需 comfy-api-proxy），云端填 https://cloud.comfy.org 并填 Key。',
        video:
          'ComfyUI API 2 视频：同一套 /api/v2/jobs 轮询。请使用 txt2vid / img2vid 等 API 格式 workflow；有首帧时写入 LoadImage。',
        audio:
          'ComfyUI API 2 声音：同一套 /api/v2/jobs，收取 type=audio 的输出。请使用 txt2audio 等 API 格式 workflow。'
      },
      magicrouterModalityHint: {
        text:
          'MagicRouter 多供应商聚合（OpenAI 兼容），默认 Base URL 为 api.magicrouter.ai/v1，对应 /chat/completions；目录由 /models/live 拉取。',
        image:
          'MagicRouter 文生图 / 图生编辑，调用 /images/generations（参考图走 image / images 字段）；目录由 /models/live 拉取。',
        video:
          'MagicRouter 视频（happyhorse / wan2.7）：异步 POST /videos/generations 后轮询 GET /videos/generations/{id}；支持 t2v / i2v / r2v / videoedit。'
      },
      localModalityHint: {
        text: '本地 OpenAI 兼容服务（vLLM / Ollama / LM Studio）：无需 API Key，文本对话走 /chat/completions，模型目录由 /models 拉取；多模态理解可在文本节点传入图片。',
        video:
          'vLLM-Omni 视频生成（Wan T2V / I2V 等扩散模型）：异步任务走 /v1/videos，完成后下载成片；支持首帧图生视频与参考视频/音频；Ollama / LM Studio 不支持视频。'
      }
    },
    objectStorage: {
      hint: '配置对象存储后可用于媒体上传与公网访问。支持火山引擎 TOS、阿里云 OSS、腾讯云 COS。',
      singleEnabledHint: '同时只能启用一个对象存储；切换启用会自动关闭其它项。',
      addProvider: '添加对象存储',
      add: '添加',
      collapseProvider: '收起提供商',
      expandProvider: '展开提供商',
      emptyProviders:
        '尚未添加对象存储。可添加火山引擎 TOS / 阿里云 OSS / 腾讯云 COS，再填写密钥与桶信息。',
      enabled: '启用',
      remove: '移除',
      label: '显示名称',
      showSecret: '显示密钥',
      hideSecret: '隐藏密钥',
      tos: {
        intro:
          '参数对应火山引擎 TOS 官方 SDK 初始化字段：AccessKey、SecretKey、Region、Endpoint；Bucket 用于默认读写桶。',
        region: '地域 Region',
        customRegion: '自定义地域',
        endpoint: 'Endpoint',
        getCredentialsHint: '获取 Access Key 等参数：',
        bucket: 'Bucket 名称',
        publicBaseUrl: '公网访问域名（可选）',
        publicBaseUrlPlaceholder: '如 https://cdn.example.com 或自定义域名'
      },
      oss: {
        intro:
          '参数对应阿里云 OSS：AccessKey、Region、Endpoint、Bucket。未填公网域名时将使用签名 URL（约 24 小时有效）。',
        region: '地域 Region',
        customRegion: '自定义地域',
        endpoint: 'Endpoint',
        getCredentialsHint: '获取 AccessKey：',
        bucket: 'Bucket 名称',
        publicBaseUrl: '公网访问域名（可选）',
        publicBaseUrlPlaceholder: '如 https://cdn.example.com 或绑定的自定义域名'
      },
      cos: {
        intro:
          '参数对应腾讯云 COS：SecretId、SecretKey、Region、Bucket（通常为 BucketName-APPID）。未填公网域名时将使用签名 URL。',
        region: '地域 Region',
        customRegion: '自定义地域',
        getCredentialsHint: '获取 API 密钥：',
        bucket: 'Bucket 名称',
        bucketPlaceholder: '如 example-1250000000',
        publicBaseUrl: '公网访问域名（可选）',
        publicBaseUrlPlaceholder: '如 https://cdn.example.com 或默认加速域名'
      }
    },
    plugins: {
      hint: '编辑器运行时为 Cordis。用户数据目录 plugins 下的受控声明式扩展只贡献工具栏等数据，不执行外部脚本。',
      declarative: '声明式',
      empty: '未发现扩展'
    },
    saved: '已自动保存',
    saving: '正在保存…'
  },
  studio: {
    noProject: '尚未打开工程',
    backHome: '返回首页',
    toolbar: {
      hint: '拖动标签可停靠 / 右键可浮动或分离 · 未保存 * · Ctrl+S 保存',
      undo: '撤销（Ctrl+Z）',
      redo: '重做（Ctrl+Shift+Z）',
      tasks: '任务列表',
      tasksAria: '打开任务列表',
      logs: '执行日志',
      logsAria: '打开节点执行日志'
    },
    layout: {
      select: '布局',
      menu: '布局',
      menuAria: '窗口布局',
      default: '默认布局',
      save: '保存布局',
      export: '导出',
      import: '导入',
      fromFile: '从文件加载…',
      toFile: '导出到文件…',
      delete: '删除布局',
      deleteConfirmTitle: '删除布局',
      deleteConfirm: '确定删除布局「{name}」？',
      saveTitle: '保存布局',
      saveHint: '输入名称保存当前窗口布局；同名将覆盖。',
      name: '布局名称',
      namePlaceholder: '例如：宽资产栏',
      newName: '我的布局',
      invalid: '当前布局无效，无法保存',
      invalidFile: '无法识别的布局文件'
    },
    panel: {
      workspace: '工作区',
      tools: '工具',
      assets: '资产',
      inspector: '参数',
      chat: 'AI 对话',
      collapse: '收起到右侧',
      expand: '展开'
    },
    inspector: {
      unsupported: '当前对象没有可用的检查器',
      emptyGlobals: '暂无全局参数',
      multiAssets: '已选择 {count} 个资产'
    },
    chat: {
      empty: '向 DeepSeek Harness 描述任务，它会通过 MCP 调用本应用的生成工具（图片 / 视频 / 语音 / 3D 等）。',
      placeholder: "输入任务，Enter 发送，Shift+Enter 换行；输入 {'@'} 引用工程资产",
      send: '发送',
      stop: '停止',
      ready: '就绪',
      checking: '检查中…',
      unavailable: '不可用',
      toolRunning: '执行中',
      toolDone: '完成',
      toolFailed: '失败',
      model: '模型',
      noModel: '未配置文本模型',
      thinking: '思考过程',
      copy: '复制',
      copied: '已复制',
      copyTitle: '复制全部内容',
      sessionSelect: '历史会话',
      newChat: '新会话',
      newSession: '新建',
      deleteSession: '删除',
      deleteConfirm: '删除该会话？历史消息将一并移除，且不可恢复。',
      // 注意：vue-i18n 会把消息开头（token 起始）的 @ 解析为 linked format，须用 {'@'} 转义
      mentionButton: "{'@'} 引用资产",
      mentionTitle: '引用资产',
      mentionSubtitle: '选择要作为模型参考的图片 / 视频 / 音频',
      mentionHint: '点击卡片选择，可多选',
      mentionPicked: '已选 {n} 个资产',
      mentionEmpty: '工程中暂无可用资产，先导入图片 / 视频 / 音频',
      mentionNoMatch: '没有匹配的资产',
      mentionTypeAll: '全部',
      mentionTypeImage: '图片',
      mentionTypeVideo: '视频',
      mentionTypeAudio: '音频',
      mentionTypeFile: '文件',
      removeMention: '移除引用'
    },
    editor: {
      asset: '资产编辑器',
      screenplay: '剧本',
      script: '分镜',
      canvas: '剧集',
      director: '导演台',
      world: '世界元素',
      beat: '场'
    },
    dive: {
      up: '上一级',
      root: '剧集',
      sep: '/',
      toolMissing: '工具不可用'
    },
    window: {
      detach: '弹出到独立窗口（也可把窗口拖出主窗口）',
      dock: '停靠回主窗口'
    },
    tabMenu: {
      float: '浮动窗口',
      detach: '分离到新窗口',
      close: '关闭',
      closeOthers: '关闭其他',
      closeLeft: '关闭左侧',
      closeRight: '关闭右侧',
      closeAll: '关闭全部',
      resetAll: '恢复默认布局',
      waitNodeRun: '请等待节点执行完成后再关闭'
    }
  },
  workspace: {
    empty: {
      title: '工作区',
      hint: '从这里快速开写作流；也可从左侧图标新建，或在资产列表中双击打开。',
      pipeline: '推荐流程：剧本 → 分镜 → 节点生成',
      createTitle: '快捷新建',
      recentTitle: '最近资产',
      recentEmpty: '暂无资产，先新建一个开始吧'
    }
  },
  dialog: {
    saveAsset: {
      title: '保存资产',
      subtitle: '选择保存目录并输入文件名（Ctrl+S）',
      fileName: '文件名',
      folder: '保存到'
    }
  },
  validation: {
    nameRequired: '名称不能为空'
  },
  project: {
    globals: {
      type: '工程',
      title: '全局参数',
      name: '工程名称',
      stylePreset: '画面风格',
      stylePresetPlaceholder: '画风、色调、材质、镜头气质…',
      styleImagesHint: '最多 4 张风格参考图（计入图片输入口数量），可从默认库选择或上传自定义图片',
      generateSeed: '全局随机种子',
      generateSeedPlaceholder: '留空随机',
      generateSeedRandom: '随机',
      generateSeedHint:
        '图片/视频生成节点默认使用此种子（节点可关闭跟随）；固定后同提示词与参考图可复现',
      cacheOutputDir: '生成缓存根目录',
      cacheOutputDirHint:
        '相对工程根；生成结果默认写入 Cache/Images、Cache/Videos、Cache/Texts、Cache/Voices，不自动登记进资产库',
      empty: '未打开工程'
    }
  },
  stylePicker: {
    label: '画面风格',
    hint: '最多 {max} 张风格参考图（计入图片输入口）',
    readonlyHint: '当前跟随工程全局风格，不可在此修改',
    useGlobal: '使用全局风格',
    useGlobalHint: '开启后与全局参数一致且只读；关闭后可单独配置本节点风格',
    add: '添加风格',
    remove: '移除',
    weight: '参考强度',
    fromLibrary: '从风格库选择',
    upload: '上传图片',
    libraryTitle: '默认风格库',
    librarySubtitle: '本次还可选择 {max} 张',
    libraryPicked: '已勾选 {n} / {max}',
    categoryCharacter: '角色',
    categoryScene: '场景',
    categoryProp: '道具',
    categoryWeapon: '武器',
    categoryUi: 'UI 风格',
    alreadySelected: '已选用',
    maxReached: '最多只能添加 {max} 张风格图',
    truncated: '已达上限，仅添加了 {n} 张（最多 {max} 张）',
    customName: '自定义风格',
    readFailed: '读取图片失败',
    onlyImage: '仅支持拖入图片'
  },
  asset: {
    type: {
      image: '图片',
      video: '视频',
      voice: '声音',
      imageRef: '引用图片',
      videoRef: '引用视频',
      voiceRef: '引用声音',
      screenplayRef: '引用剧本',
      motion: '导演台',
      model: '模型',
      modelAnimation: '动画片段',
      modelPose: '姿势',
      screenplay: '剧本',
      script: '分镜',
      canvas: '剧集',
      freeCanvas: '自由画布',
      world: '世界元素',
      beat: '场',
      subgraph: '宿主资产',
      model3d: '3D 模型'
    },
    create: {
      image: '新建图片',
      video: '新建视频',
      voice: '新建声音',
      motion: '新建导演台',
      model: '新建模型',
      screenplay: '新建剧本',
      script: '新建分镜',
      freeCanvas: '新建自由画布',
      world: '新建世界元素',
      beat: '新建场',
      subgraph: '新建宿主资产',
      model3d: '新建 3D 模型',
      default: '新建资产',
      freeCanvasNameTitle: '新建自由画布',
      freeCanvasNameMessage: '请输入画布名称。将创建空白节点画布，可自由添加节点与资产。',
      freeCanvasNamePlaceholder: '画布名称',
      nameMessage: '请输入资产名称。',
      namePlaceholder: '资产名称'
    },
    generic: '资产',
    deleted: '（已删除）',
    open: '打开资产',
    import: {
      extensionsLabel: '图片 · 视频 · 声音 · 模型',
      needProject: '请先打开工程',
      noneImported: '未能导入任何文件',
      partial: '已导入 {ok} 个文件，跳过 {skip} 个',
      dropPathFailed: '无法读取拖入的文件路径，请改用「导入」按钮。'
    },
    browser: {
      title: '资产',
      refreshHint: '可拖入文件导入 · 刷新同步磁盘',
      refresh: '刷新',
      refreshing: '刷新中…',
      refreshTitle: '重新扫描工程资产与文件夹',
      importHint: '拖入文件导入',
      screenplayMissingFile: '该剧本没有旁挂文本文件，无法用记事本打开',
      import: '导入',
      importFiles: '导入文件',
      exportPackage: '导出资产包',
      exportPackageTitle: '导出选中资产或当前文件夹为 .aipackage',
      importPackage: '导入资产包',
      importPackageTitle: '从 .aipackage 导入到当前文件夹',
      packageNeedSelection: '请先选中资产，或进入要导出的文件夹',
      packageSkipped: '另有 {count} 项已跳过（不支持的类型或草稿等）',
      packageExportDone:
        '已导出 {assets} 个资产、{folders} 个文件夹、{generated} 个生成产物\n{path}',
      packageImportDone:
        '已导入 {assets} 个资产（文件夹：新建 {folders}，复用 {folderReuse}）；条目复用 {reused}；重映射 {remapped}；还原生成产物 {generated}',
      reimportNone: '没有可重新导入的媒体资产',
      reimportPartial: '已重新导入 {ok} 项，跳过 {skip} 项',
      viewList: '列表',
      viewIcon: '图标',
      folder: '目录',
      assetsRoot: 'Assets',
      resizeFolderPane: '拖动调整目录宽度',
      viewSizeHint: '显示大小（最小仅名称）',
      dropHint: '将图片、视频、声音或 .aipackage 拖入此处导入',
      searchEmpty: '未找到匹配的资产或文件夹',
      clearSearch: '清空搜索',
      dropRelease: '松开以导入',
      context: {
        openEditor: '打开编辑器',
        showInFolder: '在文件夹中打开',
        copyOriginal: '复制原始文件',
        reimport: '重新导入',
        rename: '重命名',
        findReferences: '查找引用',
        delete: '删除',
        deleteSelected: '删除 {count} 项'
      },
      referencesTitle: '资产引用',
      referencesNone: '未找到引用。',
      referencesSummary: '以下内容引用了目标资产（共 {count} 处）：',
      referencesAsset: '资产「{name}」',
      referencesMore: '…另有 {count} 处',
      deleteConfirmTitle: '删除资产',
      deleteConfirm: '确定删除「{name}」？',
      deleteConfirmMany: '确定删除已选的 {count} 项资产？',
      deleteReferencedConfirm: '删除后这些引用将失效。仍要删除吗？',
      selectedCount: '已选 {count} 项',
      refMark: '引用'
    },
    package: {
      exportTitle: '导出资产包',
      exportSubtitle: '勾选要导出的目录与资产（类似 Unity Export Package）',
      importTitle: '导入资产包',
      importSubtitle: '勾选要导入的条目（类似 Unity Import Package）',
      selectAll: '全选',
      selectNone: '全不选',
      includeDependencies: '包含依赖',
      includeGeneratedOutputs: '包含生成产物',
      includeGeneratedOutputsHint:
        '把画布/脚本中引用的 Cache、Output 等生成缓存一并打进包（体积可能较大）',
      selectedCount: '已勾选 {count} 项',
      emptyTree: '没有可选项',
      exportConfirm: '导出',
      importConfirm: '导入',
      oneAtATime: '一次只能勾选导入一个资产包；另有 {count} 个请再次拖入。'
    },
    folder: {
      new: '新建目录',
      rename: '重命名目录',
      delete: '删除目录（内容上移）',
      deleteWithContents: '删除目录及内容',
      deleteWithContentsConfirm:
        '将永久删除目录「{name}」及其内 {count} 个资产。此操作不可撤销。',
      deleteWithContentsConfirmScripts:
        '将永久删除目录「{name}」及其内 {count} 个资产（含脚本及其分镜）。此操作不可撤销。',
      deleteFailed: '无法删除目录'
    },
    field: {
      name: '名称',
      type: '类型',
      prompt: '提示词',
      description: '描述',
      notes: '备注',
      notesPlaceholder: '可选备注',
      file: '文件'
    },
    editor: {
      noPreview: '暂无预览',
      loadingPreview: '正在加载预览…',
      noMedia: '尚未关联媒体文件',
      descPlaceholder: '描述该资产的用途、风格、约束…',
      draftHint: 'Ctrl+S 选择目录与文件名后保存',
      notFound: '资产不存在或已删除',
      graphHint: '右键添加节点 · 拖入资产 · 连线至输出',
      import: {
        fromFile: '从文件导入',
        replaceFile: '更换文件',
        importFile: '导入文件'
      }
    },
    fileFilter: {
      image: '图片',
      video: '视频/动作',
      voice: '声音',
      all: '全部'
    },
    inspector: {
      title: '资产参数',
      empty: '未选择资产',
      shotCountValue: '{n} 个',
      linked: '已关联',
      unlinked: '未关联',
      linkedPanorama: '关联背景图',
      stageObjects: '舞台物体',
      transformMode: '操作模式',
      suggestedDuration: '建议时长（秒）',
      voiceTags: '声音标签',
      voiceTagsPlaceholder: '例如：沉稳男声 / 少女音 / 音效',
      styleNotes: '风格备注',
      styleNotesPlaceholder: '画风、镜头、色调…',
      modelUsage: '模型用途',
      modelUsagePlaceholder: '角色 / 场景 / 道具…',
      modelPreview: '模型预览',
      modelPreviewLoading: '正在加载模型…',
      modelPreviewError: '模型预览加载失败',
      modelFormat: '文件格式',
      modelFormatUnknown: '未知',
      tabs: {
        preview: '预览',
        animation: '动画',
        skeleton: '骨骼'
      },
      animation: {
        clip: '动画片段',
        none: '无',
        play: '播放',
        pause: '暂停',
        speed: '速度',
        clipList: '片段列表',
        empty: '该模型无内嵌动画'
      },
      skeleton: {
        showHelper: '显示骨架辅助线',
        hint: '仅显示骨架。橙色点为骨骼节点，点击列表或预览中的节点可选中高亮',
        bones: '骨骼列表（{n}）',
        empty: '未检测到骨骼'
      },
      pose: {
        hint: '姿势资产使用规范化骨骼名，可在不同角色模型间套用',
        bones: '骨骼偏移（{n}）',
        empty: '该姿势没有骨骼数据'
      },
      transform: {
        position: '位置 (Position)',
        rotation: '旋转 (Rotation °)',
        scale: '缩放 (Scale)'
      },
      promptPlaceholder: {
        image: '主体、构图、光影、风格…',
        video: '镜头运动、节奏、氛围…',
        motion: '场次说明、调度备注…',
        voice: '声音、语气、用途、情绪…',
        model: '外观特征、材质、比例…'
      }
    },
    contentLabel: {
      image: '画面描述',
      video: '视频提示词',
      motion: '导演台备注',
      voice: '声音描述',
      model: '模型描述',
      default: '描述'
    },
    contentPlaceholder: {
      image: '描述该图片的画面…',
      video: '描述视频 / 动作…',
      motion: '导演台备注…',
      voice: '描述声音 / 台词…',
      model: '描述模型用途…',
      default: '可选描述…'
    }
  },
  script: {
    dialog: {
      timeline: '成片时间线',
      close: '关闭'
    },
    timeline: {
      sources: '素材库',
      refreshSources: '刷新输入',
      autoPlace: '自动上轨',
      sourceGridSize: '素材显示大小',
      sourceGroup: {
        input: '节点输入',
        imported: '导入素材',
        importedTag: '导入'
      },
      importedEmpty: '拖入视频/声音到轨道后会出现在这里；也可右键创建分组',
      createGroup: '新建分组',
      renameGroup: '重命名分组',
      deleteGroup: '删除分组',
      deleteGroupConfirm: '删除分组「{name}」？组内素材会回到未分组。',
      groupNamePrompt: '输入分组名称',
      groupNamePlaceholder: '分组名称',
      groupNameDefault: '分组 {n}',
      groupEmpty: '将素材拖到此处',
      ungrouped: '未分组',
      removeSource: '移除导入素材，并删除轨道上对应片段',
      sourcesEmpty: '暂无素材：可从资产库/系统文件拖入视频或声音，或先运行上游生成分镜视频',
      emptyPreview: '将视频拖入轨道后可在此预览',
      videoEmpty: '拖入视频到此处（资产库或系统文件），或先运行上游生成',
      overlayEmpty: '将视频拖到此处可叠加为画中画',
      voiceEmpty: '拖入声音到此处（资产库或音频文件）',
      musicEmpty: '拖入音乐/音频到此处（资产库或音频文件）',
      dropUnsupported: '仅支持拖入视频或声音文件',
      importFailed: '导入失败：{error}',
      none: '无',
      track: {
        video: '视频',
        overlay: '画中画',
        voice: '配音',
        subtitle: '字幕',
        music: '音乐'
      },
      inspector: '属性',
      inspectorEmpty: '选中一个时间线片段查看参数',
      startSec: '开始时间',
      durationSec: '片段时长',
      hideTrack: '隐藏轨道',
      showTrack: '显示轨道',
      lockTrack: '锁定轨道',
      unlockTrack: '解锁轨道',
      collapseTrack: '折叠轨道',
      expandTrack: '展开轨道',
      removeClip: '移除片段',
      splitClip: '在播放头分割选中片段',
      undo: '撤销',
      redo: '重做',
      copyClip: '复制选中片段',
      pasteClip: '在播放头粘贴片段',
      duration: '总时长',
      durationHint: '时间线总时长（秒），不得短于素材内容',
      rate: '速度',
      trackHeight: '轨道高度',
      trackHeightHint: '拖动调整时间线轨道高度',
      volume: '音量',
      fadeIn: '淡入',
      fadeOut: '淡出',
      transition: '转场',
      transitionIn: '入场转场',
      transitionOut: '出场转场',
      transitionEffect: '转场效果',
      transitionNone: '无',
      transitionDissolve: '叠化',
      transitionFade: '淡入淡出',
      transitionFadeOut: 'A 淡出',
      transitionFadeIn: 'B 淡入',
      transitionFlash: '闪白',
      transitionSlideLeft: '左移',
      transitionSlideRight: '右移',
      transitionSlideUp: '上移',
      transitionSlideDown: '下移',
      transitionWipeLeft: '左擦除',
      transitionWipeRight: '右擦除',
      transitionWipeUp: '上擦除',
      transitionWipeDown: '下擦除',
      transitionCircleOpen: '圆形打开',
      transitionCircleClose: '圆形关闭',
      transitionDragHint: '拖动两个视频片段之间的蓝色手柄来调整重叠/转场时长。',
      overlayTransform: '画中画变换',
      overlayX: '横向位置 %',
      overlayY: '纵向位置 %',
      overlayWidth: '宽度 %',
      overlayHeight: '高度 %',
      overlayOpacity: '不透明度',
      overlayVolume: '音量',
      overlayReset: '重置画中画',
      exportResolution: '分辨率',
      customResolution: '自定义',
      exportWidthField: '宽',
      exportHeightField: '高',
      exportFps: '帧率',
      exportBitrate: '码率',
      previewFrameRatio: '预览框比例',
      previewFrameRatioVideo: '原始视频',
      previewFrameRatioExport: '导出比例',
      subtitleFontSize: '字幕字号',
      subtitleYOffset: '字幕高度',
      subtitleColor: '字幕颜色',
      subtitleStyle: '字幕样式',
      subtitleResizeHint: '点击选中字幕；滚轮调整字幕字号',
      loop: '循环',
      toStart: '回到起点',
      play: '播放',
      pause: '暂停',
      playSelected: '播放选中片段',
      playTimeline: '播放整条时间线',
      zoomFit: '适应宽度',
      subtitleEmpty: '拖入素材或添加字幕',
      addSubtitle: '添加字幕',
      editSubtitle: '编辑字幕文案',
      subtitlePlaceholder: '字幕',
      export: '导出成片',
      exportHint: '优先 ffmpeg 合成 MP4；若未安装则回退为 WebM 录制',
      exportSettings: '导出设置',
      exporting: '导出中 {progress}%',
      exportDone: '成片已导出：\n{path}',
      exportDoneFallback:
        '未检测到 ffmpeg，已用预览录制导出 WebM：\n{path}\n\n安装 ffmpeg 并加入 PATH（或设置 FFMPEG_PATH）可导出更高质量 MP4。',
      exportFailed: '导出失败：{error}',
      exportEmpty: '时间线为空，无法导出',
      exportSrt: '导出字幕 SRT',
      exportSrtDone: '字幕已导出：\n{path}',
      exportSrtFailed: '字幕导出失败：{error}',
      resizeSourcesWidth: '拖动调整素材库宽度',
      resizeInspectorWidth: '拖动调整属性面板宽度',
      subtitleScaleHint: '缩放字幕',
      recordFallbackFailed: '录制回退也失败：{error}',
      recorderUnsupported: '当前环境不支持 MediaRecorder，且未检测到 ffmpeg',
      canvasUnavailable: '无法创建画布',
      recordEmpty: '录制结果为空',
      recordCanceled: '已取消',
      defaultVideoTitle: '视频 {index}',
      defaultVoiceTitle: '声音 {index}'
    },
    pane: {
      resizeSplit: '拖动调整上下画布高度'
    },
    timelineWindow: {
      loading: '正在打开成片时间线…',
      missingAsset: '缺少剧本资产',
      noProject: '主窗口未打开工程'
    }
  },
  director: {
    title: '导演台',
    toolbar: {
      graph: '节点',
      stage: '舞台窗口',
      split: '分屏'
    },
    panorama: '全景',
    noPanorama: '无',
    transform: {
      translate: '移动 (Q)',
      rotate: '旋转 (R)',
      scale: '缩放 (S)'
    },
    hint: {
      stage: '左键选物体 · 中键平移 · 右键环视 · Q/R/S 移动/旋转/缩放',
      graph: '双击导演台编辑 · 连线至导演台输出'
    },
    error: {
      panoramaLoad: '全景加载失败'
    },
    stageWindow: {
      loading: '正在打开舞台…',
      missingAsset: '缺少导演台资产',
      noProject: '主窗口未打开工程'
    },
    stageDialog: {
      title: '导演台编辑',
      close: '关闭'
    },
    stage: {
      scenePanel: '全景',
      searchPlaceholder: '请输入搜索内容',
      resizePanel: '拖动调整列表宽度',
      hierarchyEmpty: '暂无对象',
      collapse: '折叠',
      expand: '展开',
      sideTab: {
        scene: '场景',
        inspector: 'Inspector'
      },
      selectionType: {
        camera: '相机',
        object: '物体',
        panorama: '全景',
        scene: '场景',
        none: '未选择'
      },
      cameraItem: '机位1',
      createCamera: '创建相机',
      createEmpty: '创建空物体',
      createMenu: '创建物体',
      aiBlockoutGroupName: 'AI 白模',
      deleteObject: '删除',
      copy: '复制',
      paste: '粘贴',
      cannotDeleteModel: '节点导入的模型不可删除',
      cannotDeleteCamera: '至少保留一个机位',
      hideObject: '隐藏',
      showObject: '显示',
      hideObjectName: '隐藏名称',
      showObjectName: '显示名称',
      lockObject: '锁定',
      unlockObject: '解锁',
      lockedHint: '物体已锁定，无法变换',
      primitive: {
        cube: 'Cube',
        sphere: 'Sphere',
        capsule: 'Capsule',
        cylinder: 'Cylinder',
        cone: 'Cone',
        pyramid: 'Pyramid',
        hemisphere: 'Hemisphere',
        torus: 'Torus',
        arch: 'Arch',
        pointedArch: '尖拱',
        cross: '十字架',
        tube: 'Tube',
        prism: 'Prism',
        tetrahedron: 'Tetrahedron',
        octahedron: 'Octahedron',
        icosphere: 'Icosphere',
        wedge: 'Wedge',
        disc: 'Disc',
        ring: 'Ring',
        plane: 'Plane',
        quad: 'Quad'
      },
      tabProps: '属性',
      tabPose: '姿势',
      poseHint: '场景中已显示角色骨骼点线。可在下方列表或视口中选中关节并调整姿势。',
      poseBones: '骨骼 ({n})',
      poseBonesEmpty: '当前模型没有可编辑骨骼',
      poseViewportHint: '在视口中点击绿色关节点选中，拖动旋转轴调整姿势',
      poseModeFk: 'FK 旋转',
      poseModeIk: 'IK 拖拽',
      poseModeAi: 'AI 姿势',
      poseAiHint:
        '用自然语言描述姿势（如走路、跳跃、挥手），由文本模型生成骨骼旋转并应用到当前角色。若 OpenRouter 的 openai/* 报 Terms of Service，请到 openrouter.ai/settings/privacy 放行上游，或换非 OpenAI / 国内文本模型。',
      poseAiModel: '文本模型',
      poseAiModelPick: '选择模型…',
      poseAiModelEmpty: '请先在设置中启用并勾选文本模型',
      poseAiPresets: '常用姿势',
      poseAiPreset: {
        idle: '站立',
        walk: '走路',
        run: '跑步',
        jumpAir: '跳跃',
        jumpLand: '落地',
        wave: '挥手',
        handsOnHips: '叉腰',
        point: '指向',
        think: '思考',
        crouch: '蹲下',
        kneel: '单跪',
        bow: '鞠躬',
        fightGuard: '格斗',
        sit: '坐下'
      },
      poseAiInstruction: '姿势指令',
      poseAiInstructionPlaceholder: '例如：走路迈右腿、双手叉腰站立、跳跃腾空…或点上方预设',
      poseAiGenerate: 'AI 生成姿势',
      poseAiGenerating: '正在生成…',
      poseAiApplied: '已应用 {matched}/{total} 根骨骼',
      poseAiParseFailed: '模型返回无法解析为姿势 function call，请换模型或改写指令重试',
      poseAiNoMatch: '模型返回的骨骼名与当前角色不匹配',
      poseAiFailed: '生成失败：{error}',
      poseAiLog: {
        title: 'AI 姿势',
        titlePreset: 'AI 姿势 · {name}',
        start: '开始生成：对象「{object}」，可编辑骨骼 {bones} 根',
        reset: '已重置姿势（与重置按钮相同）',
        instruction: '姿势指令：{text}',
        llmStart: '调用文本模型：{model}',
        llmDone: '模型返回完成：{chars} 字符（{model}）',
        parsed: '已解析 function call：匹配 {matched}/{total}，mode={mode}',
        rawReply: '原始回复摘录：{text}'
      },
      poseIkChains: 'IK 目标 ({n})',
      poseIkChainsEmpty: '未识别到可用 IK 目标；可手动指定末端骨骼',
      poseIkHint: '选择 IK 目标后，拖动橙色目标点；松手后写入姿势',
      poseIkManualHint: '骨骼名不标准时，可在下方下拉框手动指定末端骨骼',
      poseIkManual: '手动',
      poseIkPickBone: '选择末端骨骼...',
      poseIkUseAuto: '自动：{name}',
      poseIkAssignFailed: '无法从该骨骼推出 IK 链（需要有可旋转的父骨）',
      poseIkSlot1: '目标 1',
      poseIkSlot2: '目标 2',
      poseIkSlot3: '目标 3',
      poseIkSlot4: '目标 4',
      posePresets: '姿势预设',
      posePresetsEmpty: '暂无预设，调整骨骼后可保存',
      posePresetSave: '保存预设',
      posePresetRemove: '删除预设',
      posePresetNamePlaceholder: '预设名称（可选）',
      posePresetDefault: '姿势',
      poseReset: '重置姿势',
      poseAxisReset: '重置为 0°',
      poseAssets: '姿势资产',
      poseAssetsEmpty: '暂无姿势资产，可保存或从资产库拖入',
      poseAssetSave: '保存为资产',
      poseAssetNamePlaceholder: '资产名称（可选）',
      poseAssetDefault: '姿势',
      poseAssetApplyHint: '已匹配 {matched}/{total} 根骨骼',
      poseAssetSaved: '已保存资产「{name}」',
      poseAssetSaveFailed: '保存姿势资产失败',
      tabShots: '站位和动作',
      tabShotsOnly: '站位',
      tabActionsOnly: '动作',
      position: '位置',
      rotationDeg: '旋转 (°)',
      scale: '缩放',
      uniformScale: '统一缩放',
      color: '颜色',
      textures: '贴图',
      textureSlotMap: '基础贴图',
      textureSlotNormal: '法线贴图',
      textureSlotEmpty: '拖入图片',
      textureSlotHidden: '已隐藏',
      textureRemove: '移除贴图',
      textureReset: '还原模型自带贴图',
      textureHide: '隐藏该贴图槽',
      textureShow: '恢复显示该贴图槽',
      textureHint:
        '从资产库拖入图片到贴图槽；⊘ 隐藏模型自带贴图，✕ 还原。仅对当前物体生效。',
      incomingModelName: '输入 3D 模型',
      selectHint: '在左侧或视口中选择对象',
      viewDirector: '导演视角',
      viewCamera: '机位视角',
      viewMenu: '视图',
      moveToView: '移动到视图',
      moveToViewShortcut: 'Ctrl+Alt+F',
      alignWithView: '与视图对齐',
      alignWithViewShortcut: 'Ctrl+Shift+F',
      alignViewToSelected: '视图对齐到选中项',
      resetView: '重置视角',
      viewOrientation: '视角方位',
      viewTop: '顶视图',
      viewBottom: '底视图',
      viewLeft: '左视图',
      viewRight: '右视图',
      viewFront: '前视图',
      selectionBounds: '选中包围盒',
      captureShot: '截屏',
      shadingMode: '着色模式',
      shading: {
        shaded: '着色',
        wireframe: '线框',
        shadedWireframe: '着色线框'
      },
      cameraPreview: '相机预览',
      cameraPreviewHint: '浮动显示所选相机的实时画面',
      cameraPreviewEmpty: '在左侧场景层级中选中一个或多个相机',
      cameraPreviewClose: '关闭相机预览',
      cameraPreviewPopout: '弹出到独立窗口（也可把面板拖出主窗口）',
      cameraPreviewDockBack: '停靠回主窗口',
      cameraPreviewResize: '拖动右下角调整大小',
      cameraPreset: {
        title: '机位预设',
        needObject: '请先选中一个物体',
        groupShotSize: '景别',
        groupAngle: '角度',
        groupCombination: '组合机位',
        comboNeedModels: '需要选中物体下有足够的模型子物体',
        comboReverse: '正反打（双过肩）',
        comboThree: '三镜头法则',
        comboAxis: '标准五机位（轴线法则）',
        comboInterview: '访谈双机位',
        comboEyeline: '视线匹配大特写',
        comboOrbit: '环绕三联',
        comboOrbitName: '环绕机位',
        comboThreeWay: '三人对话三角机位',
        comboStageTrio: '舞台三机位',
        comboStageQuint: '舞台五机位',
        comboMaster: '全景双人',
        comboMaster3: '全景三人',
        comboOtsAB: '过肩 A→B',
        comboOtsBA: '过肩 B→A',
        comboOtsBC: '过肩 B→C',
        comboOtsCA: '过肩 C→A',
        comboCloseA: 'A 特写',
        comboCloseB: 'B 特写',
        comboStageWide: '全景',
        comboStageLeft: '左特写',
        comboStageRight: '右特写',
        comboStageLow: '低机位',
        comboStageHigh: '俯拍',
        extremeWide: '大远景',
        long: '远景',
        full: '全景',
        medium: '中景',
        mediumClose: '中近景',
        close: '近景',
        closeUp: '特写',
        extremeCloseUp: '大特写',
        eyeLevel: '平视',
        low: '低机位仰拍',
        high: '高机位俯拍',
        bird: '鸟瞰',
        dutch: '荷兰角',
        overShoulder: '过肩',
        threeQuarter: '四分之三',
        profile: '侧面',
        back: '背面'
      },
      gizmos: {
        title: 'Gizmos',
        size: '大小',
        labels: '场景文字',
        cameras: '相机 Gizmos',
        grid: '网格',
        selectionBounds: '选中包围盒',
        captureLabels: '截屏/视频包含场景文字',
        captureCameraLabels: '截屏/视频包含相机名称'
      },
      aspectRatio: '比例',
      aspectAuto: 'Auto',
      shotsEmpty: '暂无截屏',
      actionsEmpty: '暂无录制动作',
      actionLoading: '加载中…',
      shotPreviewTitle: '图片预览',
      shotPreviewTitleVideo: '视频预览',
      shotPreviewTitleVoice: '音频预览',
      shotPreviewEmpty: '暂无图片',
      shotPreviewEmptyVideo: '暂无视频',
      shotPreviewEmptyVoice: '暂无音频',
      shotPreviewExport: '导出',
      shotPreviewExporting: '导出中…',
      shotPreviewExportFailed: '导出失败：{error}',
      shotPreviewExportFilterImage: '图片',
      shotPreviewExportFilterAll: '所有文件',
      editInStage: '详细变换请在导演台舞台中编辑',
      sceneGlobal: '3D全景',
      sceneScale: '全景缩放',
      sceneTranslation: '全景平移',
      sceneRotation: '全景旋转',
      ground: '地面',
      groundOpacity: '透明度',
      groundHeight: '高度',
      panoramaBackground: '全景背景',
      panoramaConnected: '已连接背景图',
      panoramaConnectHint: '拖入图片资产作为背景',
      panoramaDropHint: '拖入图片到此处',
      panoramaRemove: '移除背景图',
      hidePanorama: '隐藏全景背景',
      showPanorama: '显示全景背景',
      blockoutButton: '生成3D白模',
      blockoutTitle: '生成3D白模',
      blockoutNeedPanorama: '请先设置全景背景图',
      blockoutRefAdd: '添加场景参考图',
      blockoutRefRemove: '移除参考图',
      blockoutPickAsset: '从资产库选择',
      blockoutAddFromAsset: '添加',
      blockoutLibraryTitle: '选择场景参考图',
      blockoutLibrarySubtitle: '仅显示图片，还可选 {max} 张',
      blockoutLibraryEmpty: '资产库中暂无图片',
      blockoutLibraryNoMatch: '没有匹配的图片',
      blockoutLibraryAdded: '已添加',
      blockoutLibraryPicked: '已选 {n} / {max}',
      blockoutLayoutLabel: '参考图类型',
      blockoutLayoutPerspective: '透视照片',
      blockoutLayoutPanorama: '360 全景',
      blockoutModelLabel: '文本模型',
      blockoutNoModels: '暂无可用文本模型',
      blockoutSystemLabel: '系统提示词',
      blockoutInstructionLabel: '指令',
      blockoutDefaultInstruction:
        '分析参考图中的场景元素，用基础几何体还原整个场景布局。',
      blockoutDefaultInstructionPerspective:
        '尽量按参考图还原：圆拱用 arch（不要转 90°），圆锥塔尖用 cone（尖朝上，底面正圆），圆塔身用 cylinder 不要用 prism；拱门留空，用人物当 1.7m 比例尺。',
      blockoutDefaultInstructionPanorama:
        '这是 360° 等距柱状全景。按图中方位把物体围在观察者周围，不要当成透视照片堆在相机正前方。',
      blockoutRun: '创建场景',
      blockoutRunning: '正在生成场景…',
      blockoutHint: '透视或 360 全景都可。将最多 3 张参考图与指令发给文本模型，按返回的 function call 用基础几何体搭建白模',
      blockoutNoImage: '请先添加至少一张场景参考图',
      blockoutParseFailed: '模型未返回有效的场景数据',
      blockoutDone: '已创建 {count} 个白模物体',
      blockoutAutoFix: '自动修复了 {count} 个几何体类型',
      blockoutLogTitle: 'AI 场景白模',
      blockoutLogStart: '开始生成场景白模（模型：{model}）',
      skyColor: '天空颜色',
      panoramaSphere: '全景球',
      panoramaYaw: '水平旋转',
      panoramaRadius: '球形半径',
      modeScene: '全景模式',
      modeAnimation: '动画模式',
      anim: {
        play: '播放',
        pause: '暂停',
        stop: '停止',
        loop: '循环',
        addTrack: '新建轨迹',
        cameraCutTrack: '机位',
        cameraCutTag: '机位',
        cameraCutHint: '添加机位切换轨道：播放时按区间激活对应相机',
        cameraCutAddHint: '在当前时间添加当前机位区间',
        cameraCutRemoveHint: '删除选中的机位区间',
        cameraCutDropHint: '把相机拖到这里（或点 + 添加当前机位）',
        removeTrack: '删除轨迹',
        drawPath: '绘制轨迹',
        orientToPath: '朝向轨迹方向',
        pathForwardAxis: '模型前方轴',
        empty: '点击「新建轨迹」添加物体或相机',
        noTargets: '没有可添加的目标',
        cameraTag: '相机',
        objectTag: '物体',
        path: {
          circle: '圆环路径',
          line: '直线路径',
          rect: '矩形路径',
          pencil: '铅笔路径',
          pen: '钢笔路径'
        },
        drawHint: {
          circle: '点击确定圆心，再点击确定半径',
          line: '点击起点，再点击终点',
          rect: '点击对角两点确定矩形',
          pencil: '按住并拖拽绘制自由路径，松开完成',
          pen: '单击添加点，双击或回车完成'
        },
        zoom: '缩放时间轴',
        playbackRate: '播放速度',
        playbackRateShort: '速度',
        exportVideo: '录制动作',
        exporting: '正在录制…',
        collapse: '收起动画栏',
        expand: '展开动画栏',
        addKeyframe: '添加关键帧',
        addKeyframeHint: '在当前时间添加位置关键帧 (K)',
        removeKeyframe: '删除关键帧 (Delete)',
        editingKeyframe: '编辑关键帧 · {time}s',
        skeleton: '骨骼动画',
        skeletonClip: '动画片段',
        skeletonNone: '无',
        skeletonSpeed: '骨骼速度',
        skeletonLoop: '骨骼循环',
        skeletonEmpty: '该模型无内嵌动画 · 可拖入动画资产',
        skeletonDropHint: '拖入动画资产到轨道',
        skeletonClipCount: '{n} 段',
        skeletonAssetEmpty: '动画资产无可用片段',
        skeletonAssetClear: '清除动画资产',
        removeSkeletonClip: '删除片段',
        skeletonBadge: '骨骼'
      }
    }
  },
  divePipeline: {
    episode: {
      title: {
        default: '剧集分镜流水线'
      },
      header: {
        currentStep: '当前步骤：',
        busyTasks: '任务运行中…',
        viewTrace: '查看轨迹',
        traceOpen: '打开本次流水线轨迹',
        traceNone: '尚无本次轨迹',
        refresh: '刷新',
        refreshing: '刷新中…',
        failPrefix: 'FAIL：',
        failReasonTitle: '最近一次导演审核失败原因'
      },
      empty: {
        noGraph:
          '尚未找到工作流数据。请先运行一次「分镜师·节拍拆解表」节点，再点击顶部工具栏的「剧集流水线」打开本视图。',
        beatsUnparsed: '节拍拆解有内容，但未能解析为表格格式',
        beatsPending: '未生成（运行 breakdown 节点）',
        anchorsUnparsed: '9宫格有内容，但未能解析',
        anchorsPending: '未生成（运行 beatboard 节点）',
        cellsUnparsed: '4宫格有内容，但未能解析',
        cellsPending: '未生成（运行 sequence 节点）'
      },
      panel: {
        beats: '节拍拆解',
        boardDirect: '9宫格分镜表 · 直出视频'
      },
      action: {
        directorReview: '导演审核',
        generate: '生成',
        regenerate: '重新生成',
        generateMotion: '生成动态提示词',
        generateMotionDirect: '生成9宫格动态提示词',
        buildGrid4: '生成4宫格拼图',
        buildGrid9: '生成9宫格拼图'
      },
      stageBusyTitle: {
        breakdown: '节拍拆解生成中…',
        beatboard: '9宫格分镜表生成中…',
        sequence: '4宫格分镜表生成中…',
        motion: '动态提示词生成中…'
      },
      task: {
        stage: '分镜流水线·{stage}',
        buildGrid4Group: '生成4宫格拼图·组{g}',
        video: '动态视频·格{g}-{c}'
      },
      state: {
        generating: '生成中…',
        passedMark: '✓ 已通过',
        awaitReview: '待审核',
        generated: '已生成',
        ranOnce: '已运行',
        failed: '失败',
        notGenerated: '未生成',
        noImage: '未生成图',
        completed: '已完成'
      },
      stepLabel: {
        motionDirect: '9宫格动态提示词表'
      },
      stepHint: {
        default: '流水线当前推进到的阶段',
        breakdown: '节拍拆解表已生成，正在推进 9宫格分镜表',
        beatboardDirect: '9宫格分镜表已生成，正在推进 动画师·9宫格动态提示词表',
        beatboardCells: '9宫格分镜表已生成，正在推进 4宫格动态分镜表',
        readyDirect: '9宫格动态提示词表已生成，可逐格或一键生成 9 条直出视频',
        sequenceCells: '4宫格动态分镜表已生成，正在推进 动态提示词表',
        motionCells: '动态提示词表已生成，等待导演审核通过后完成',
        completed: '全部阶段已通过'
      },
      cell: {
        short: '格{n}',
        key: '格{g}-{c}',
        beatRef: '节拍{n}',
        beatRefTitle: '关联节拍'
      },
      anchor: {
        badge: '锚',
        badgeTitle: '关键锚点（9宫格对应前 9 个锚）'
      },
      breadcrumb: {
        direct: '场/节拍 #{beat} → 格{cell} → 9格直出视频',
        cells: '场/节拍 #{beat} → 格{cell} → 动态格 {key}'
      },
      detail: {
        grid4: '4宫格（{index}）',
        motionDirect: '9宫格动态提示词',
        motionCell: '动态提示词（{key}）',
        videoOutput: '视频产物',
        generateVideo: '生成这条视频',
        regenVideo: '重新生成这条视频',
        videoWaitRegen: '请等待重新生成完成后再生成视频',
        videoRunning: '这条视频正在生成…',
        videoNeedsPrompt: '请先生成动态提示词'
      },
      hint: {
        backFromToolbar: '顶部工具栏的「剧集流水线」按钮可随时回到本视图；图片/视频在节点图中运行。'
      }
    },
    agent: {
      title: 'Agent 流水线',
      summary: {
        pending: '待处理 {n}',
        pendingTitle: '待处理：质检 pending + 返工 running',
        fail: 'FAIL {n}',
        failTitle: '质检 FAIL 节点数',
        exhausted: '达上限 {n}',
        exhaustedTitle: '达上限仍未通过的返工节点数',
        error: '异常 {n}',
        errorTitle: '运行失败的节点',
        degraded: '降级 {n}',
        degradedTitle: '失败后降级继续的节点，产物可能非最优'
      },
      fail: {
        latestTitle: '最近一次 FAIL / 达上限原因',
        latestPrefix: '最近失败：'
      },
      empty: {
        noNodes:
          '当前画布尚未放置「质检（media.review）」或「返工（media.rework）」节点。运行生成节点后，在其下游接上质检节点即可自动质检；质检 FAIL 时由返工节点自动重试，直到 PASS 或达尝试上限。'
      },
      panel: {
        review: '质检节点（media.review）',
        rework: '返工节点（media.rework）',
        errors: '运行异常',
        noReview: '无质检节点',
        noRework: '无返工节点',
        noErrors: '暂无运行异常',
        locateHint: '点击定位到节点'
      },
      row: {
        attempt: '第 {attempt}/{maxAttempts} 次'
      },
      status: {
        review: {
          pending: '待审核'
        },
        rework: {
          running: '返工中',
          passed: '已通过',
          exhausted: '达上限'
        },
        error: '失败',
        degraded: '降级'
      }
    },
    uiSplit: {
      loading: '正在打开 UI 界面拆分内图…',
      error: {
        noScreens: '请先生成界面提示词，再双击进入内图。'
      }
    }
  },
  canvas: {
    toolbar: {
      grid: '网格',
      spacing: '间距',
      layers: '图层'
    },
    focus: '聚焦画板 (F)',
    deleteSelected: '删除选中',
    layersEmpty: '拖入图片或从资产库添加素材',
    asset: {
      hint: '空白节点画布 · 右键添加节点 · 拖入资产连线'
    },
    layer: {
      hide: '隐藏',
      show: '显示',
      lock: '锁定',
      unlock: '解锁',
      up: '上移',
      down: '下移',
      delete: '删除',
      image: '图片',
      named: '图层 {n}'
    },
    error: {
      notReady: '画布未就绪',
      dropFailed: '无法读取拖入的资产',
      imageOnly: '画布仅支持拖入图片资产',
      noFile: '该图片尚未关联文件'
    }
  },
  review: {
    unreviewed: '未审核',
    reviewed: '已审核'
  },
  beat: {
    asset: {
      hint: '双击拆解进入指令编辑 · 双击表格进入目录 · 双击输出进入文本细化；面包屑返回'
    },
    dialog: {
      close: '关闭',
      table: '场表格',
      gen: '场生成'
    },
    hint: {
      table: '场表格 · 批量编辑节拍结构与审核状态',
      gen: '上图画布细化单元 · 下栏点选 Inspector · 拖入生成参考节点'
    },
    pane: {
      resizeSplit: '拖动调整上下区域高度'
    },
    strip: {
      title: '场',
      switchHint: '点击切换 · 拖入画布添加参考',
      empty: '暂无场，请先拆解或在表格中新建',
      collapse: '收起场栏',
      expand: '展开场栏'
    },
    unit: {
      inspector: {
        type: '场 {n}',
        title: '场',
        empty: '未选择场',
        sourceExcerpt: '原文'
      }
    },
    table: {
      new: '新建',
      empty: '暂无条目，点击新建或先执行拆解',
      unit: '场',
      column: {
        order: '顺序',
        title: '标题',
        time: '时间',
        durationHint: '时长',
        location: '空间与地点',
        locations: '地点绑定',
        characters: '角色',
        action: '核心动作',
        conflict: '冲突与目标',
        atmosphere: '氛围与声音',
        props: '道具',
        weapons: '武器',
        sourceExcerpt: '原文',
        status: '状态'
      },
      bind: {
        title: '绑定世界元素',
        action: '绑定',
        add: '添加名称',
        empty: '请先执行场表格节点以同步世界元素实体'
      }
    }
  },
  world: {
    asset: {
      hint: '双击提取进入指令编辑 · 双击表格进入目录 · 双击生成进入世界编辑；面包屑返回'
    },
    dialog: {
      close: '关闭',
      elementTable: '世界元素表格',
      editor: '世界元素生成'
    },
    hint: {
      table: '世界元素表格 · 批量编辑角色 / 场景 / 道具 / 武器',
      editor: '四类元素画布 · 参数与运行使用右侧 Inspector'
    },
    pane: {
      resizeSplit: '拖动调整上下画布高度'
    },
    table: {
      new: '新建',
      empty: '暂无条目，点击新建或先执行提取',
      briefStyle: '画风设定',
      briefWorldview: '世界观设定',
      column: {
        name: '名称',
        prompt: '提示词',
        status: '状态'
      },
      placeholder: {
        prompt: '图片生成提示词',
        style: '从剧本提炼的画风/媒介/色板/光影/材质/避免项',
        worldview: '时代、文化、规则、势力、基调等可复用的非视觉设定'
      }
    },
    tab: {
      characters: '角色',
      scenes: '场景',
      props: '道具',
      weapons: '武器'
    },
    kind: {
      character: '角色',
      scene: '场景',
      prop: '道具',
      weapon: '武器'
    },
    tableWindow: {
      loading: '正在打开世界元素表格…',
      missingAsset: '缺少世界元素资产 id',
      noProject: '未打开工程'
    }
  },
  graph: {
    toolbar: {
      hint: '节点工作流 · 选中后按住 C 打开执行环',
      toolMode: '画布工具',
      selectTitle: '选择（左键点选/框选）',
      panTitle: '平移（左键拖动画布）',
      collapse: '收起工具栏',
      expand: '展开工具栏'
    },
    editor: {
      loadingSource: '正在加载图片…'
    },
    radial: {
      hint: 'C',
      runCurrent: '执行当前',
      rerunCurrent: '重跑当前',
      cookSubgraph: 'Cook 子图',
      runSkip: '跳过上游',
      runForce: '强制上游',
      enqueue: '加入任务',
      stop: '停止'
    },
    tasks: {
      mark: 'Tasks',
      title: '工作流任务',
      tabActive: '进行中',
      tabCompleted: '已完成',
      emptyActive: '暂无进行中的任务',
      emptyCompleted: '暂无已完成的任务',
      emptyWorkflowActive: '暂无进行中的工作流',
      emptyWorkflowCompleted: '暂无已完成的工作流',
      generationSection: '生成任务',
      videoSection: '视频生成',
      workflowSection: '工作流',
      videoKind: '视频',
      videoUntitled: '视频任务',
      model3dKind: '3D 模型',
      model3dUntitled: '3D 模型任务',
      videoStopConfirmMessage: '确定取消该视频生成？供应商侧任务可能仍会继续计费。',
      stop: '停止',
      remove: '移除',
      stopConfirmTitle: '停止任务',
      stopConfirmMessage: '确定停止该工作流？停止后将移至「已完成」页签。',
      duplicateTitle: '无法重复添加',
      duplicateMessage: '同一输出分支已在任务列表中执行，请等待完成或停止后再试。不同边界输出可同时加入并行执行。',
      enqueueFailedTitle: '无法加入任务',
      enqueueFailedNoTarget: '当前画布无法确定任务目标（缺少分镜或剧本上下文），请从剧本进入分镜视频后再试。',
      nodeRunBlockedTitle: '无法执行节点',
      nodeRunBlockedMessage: '该工作流正在任务列表中执行，完成或停止前不能单独执行节点或执行上游节点。',
      status: {
        pending: '排队中',
        running: '执行中',
        done: '已完成',
        error: '失败',
        stopped: '已停止'
      },
      videoStatus: {
        submitted: '已提交',
        running: '生成中',
        succeeded: '已完成',
        failed: '失败',
        cancelled: '已取消'
      },
      nodeStatus: {
        idle: '未开始',
        pending: '等待',
        running: '运行',
        done: '完成',
        error: '失败',
        degraded: '降级',
        skipped: '跳过'
      },
      mcpSection: 'MCP 生成',
      mcpDefaultModel: '默认模型',
      mcpStatus: {
        running: '生成中',
        done: '已完成',
        error: '失败'
      },
      mcpKind: {
        generate_image: '图片',
        generate_video: '视频',
        generate_speech: '语音',
        generate_model3d: '3D 模型'
      }
    },
    logs: {
      mark: 'Logs',
      title: '节点执行日志',
      defaultTitle: '节点工作流',
      viewLog: '查看日志',
      emptySessions: '暂无执行记录',
      emptyEvents: '选择一次运行以查看事件',
      emptyFiltered: '没有匹配的事件',
      searchPlaceholder: '搜索节点 / 消息…',
      filterLevel: '按级别过滤',
      copy: '复制',
      copied: '已复制',
      clearAll: '清空',
      clearConfirmTitle: '清空执行日志',
      clearConfirmMessage: '确定清空全部执行日志？此操作不可恢复。',
      startWorkflow: '开始整图执行',
      startToNode: '开始执行至节点 {name}',
      startNodeOnly: '开始执行节点 {name}',
      sessionStatus: {
        running: '执行中',
        done: '成功',
        error: '失败',
        stopped: '已停止'
      },
      mode: {
        workflow: '整图',
        toNode: '至节点',
        nodeOnly: '单节点',
        task: '任务',
        mcp: 'MCP'
      },
      kind: {
        run_start: '开始',
        run_end: '结束',
        node_status: '节点',
        run_message: '消息'
      },
      level: {
        all: '全部',
        info: '信息',
        warn: '警告',
        error: '错误'
      },
      detailTitle: '执行详情',
      detailHint: '在上方列表中选中一条日志查看详情',
      resizeSplit: '拖动调整列表与详情高度',
      detailTime: '时间',
      detailDuration: '耗时',
      detailType: '类型',
      detailError: '错误码',
      portInputs: '输入端口',
      portOutputs: '输出端口',
      apiCall: 'API 调用 #{n} · {kind}',
      apiRequest: '请求参数',
      apiResponse: '响应内容',
      apiResponseEmpty: '无响应内容',
      apiEmpty: '该节点本次未记录 API 请求（可能未调用模型，或为透传/本地执行）',
      apiEmptyPending: '请求进行中；完成后请点击「完成」或「失败」状态查看请求与响应',
      apiEmptyPickDone:
        '此为中间状态。请点击同节点的「完成」或「失败」查看详情；模型请求一般在上游图片/视频生成节点上。',
      apiEmptyPassthrough:
        '该节点为输出/汇总透传，本身不调用模型。请查看上游图片生成、视频生成等节点的「完成」记录。',
      apiEmptyNotNode: '当前日志条目无节点 API 详情'
    },
    play: {
      start: '执行工作流（有选中则跑选中节点及上游）',
      stop: '停止工作流',
      startAria: '执行',
      stopAria: '停止',
      confirmAllTitle: '执行工作流',
      confirmAllMessage: '是否执行工作流中的所有节点？',
      enqueue: '加入任务列表',
      runUpstreamSkip: '执行当前及上游（跳过已执行）',
      runUpstreamForce: '重新执行当前及上游'
    },
    nodeRun: {
      execute: '执行当前节点',
      rerun: '重新执行当前节点',
      stop: '停止执行'
    },
    link: {
      start: '连线',
      cancel: '取消连线'
    },
    edgeStyle: {
      curve: '曲线',
      orthogonal: '直接',
      hidden: '不显示',
      cycleTitle: '连线样式：{style}（点击切换）'
    },
    fitView: '适配视图',
    episodePipeline: {
      open: '剧集流水线',
      openTitle: '打开剧集流水线总览（当前画布全局控制）'
    },
    agentPipeline: {
      open: 'Agent 流水线',
      openTitle: '打开 Agent 流水线总览（质检 / 返工）'
    },
    minimap: {
      title: '节点小地图（点击或拖拽定位）',
      empty: '暂无节点'
    },
    layout: {
      dragHandle: '拖动布局工具条',
      expand: '展开布局工具',
      collapse: '收起布局工具',
      grid: '显示/隐藏背景网格',
      minimap: '显示/隐藏小地图',
      collapseAllNodes: '折叠全部节点',
      expandAllNodes: '展开全部节点',
      snap: '拖拽时吸附网格',
      snapShort: '吸附',
      alignLeft: '左对齐',
      alignRight: '右对齐',
      alignTop: '顶对齐',
      alignBottom: '底对齐',
      alignCenterX: '水平居中',
      alignCenterY: '垂直居中',
      distributeH: '水平分布',
      distributeV: '垂直分布',
      distributeHShort: '横距',
      distributeVShort: '纵距',
      auto: '自动布局',
      autoShort: '布局'
    },
    context: {
      addNode: '添加节点',
      addAndConnect: '选择节点并连接',
      noCompatibleNodes: '没有可连接的同类型节点',
      selection: '选中项',
      copy: '复制',
      paste: '粘贴',
      copyEmpty: '请先选中要复制的节点',
      copyNone: '选中项中没有可复制的节点（单例/规范输出不可复制）',
      pasteEmpty: '剪贴板中没有可粘贴的节点',
      pasteSkippedHost: '已跳过 {n} 个宿主节点（同资产宿主画布唯一）',
      groups: {
        imageRefine: '图片精修',
        imageEdit: '图片编辑',
        episode: '剧集',
        text: '文本',
        prompt: '提示词',
        game: '游戏',
        motionFx: '动效',
        model3d: '3D 模型',
        comic: '漫画',
        agent: 'Agent',
        ad: '广告'
      }
    },
    episodeAgent: {
      breakdown: '节拍拆解表',
      beatboard: '9宫格分镜表',
      sequence: '4宫格动态分镜表',
      motion: '动态提示词表',
      review: '导演审核',
      title: {
        beatBreakdown: '节拍拆解表',
        grid9Storyboard: '9宫格分镜表',
        grid4Motion: '4宫格动态分镜表',
        motionPrompt: '动态提示词表',
        directorReview: '导演审核'
      }
    },
    bundle: {
      title: '束',
      hint: '汇聚多条同类型连线，减少画布线条；下游指令窗展开为真实上游缩略图'
    },
    selectImage: {
      appMark: '选取图片',
      hint: '单击缩略图选择图片；双击缩略图打开预览。默认第一张。',
      previewHint: '双击预览',
      empty: '暂无上游图片，请先连接导演台等图片输出并执行'
    },
    selectVideo: {
      appMark: '选取视频',
      hint: '单击缩略图选择视频；双击缩略图打开预览。默认第一条。',
      previewHint: '双击预览',
      empty: '暂无上游视频，请先连接视频生成等节点并执行'
    },
    selectVoice: {
      appMark: '选取声音',
      hint: '单击卡片选择声音；双击打开预览。默认第一条。',
      previewHint: '双击预览',
      empty: '暂无上游声音，请先连接声音生成等节点并执行'
    },
    selectText: {
      appMark: '选择文本',
      hint: '单击卡片选择一条文本；双击打开记事本查看全文。默认第一条。',
      openHint: '双击打开记事本',
      empty: '暂无上游文本，请先连接文本生成等节点并执行'
    },
    selectBeat: {
      appMark: '选择场',
      hint: '双击从上游场目录中选出一个单元；默认第一项。',
      empty: '暂无上游场，请先连接场资产并执行'
    },
    textsPreview: {
      appMark: '文本预览',
      hint: '多段文本以网格预览；双击卡片打开记事本查看全文。',
      openHint: '双击打开记事本',
      empty: '暂无文本输出，请先连接上游文本并执行'
    },
    adVariants: {
      appMark: '广告变体',
      presetGroups: {
        general: '通用策略',
        industry: '行业场景',
        promotion: '促销直播'
      },
      presets: {
        basicAb: '基础 A/B',
        cameraAngle: '机位角度',
        sceneTone: '场景色调',
        audienceEmotion: '人群情绪',
        copyStyle: '文案风格',
        vertical: '竖屏信息流',
        beauty: '美妆护肤',
        electronics: '3C数码',
        food: '食品饮料',
        fashion: '服饰穿搭',
        baby: '母婴亲子',
        home: '家居',
        auto: '汽车',
        pet: '宠物',
        education: '教育',
        travel: '旅游',
        health: '医疗健康',
        realestate: '房产',
        finance: '金融',
        game: '游戏',
        fitness: '运动健身',
        daily: '家清日用',
        beverage: '酒水饮料',
        freshfood: '生鲜食材',
        hotel: '酒店民宿',
        livestream: '直播引流',
        holiday: '节日促销'
      },
      product: '产品描述',
      productPlaceholder: '例如：一瓶香水',
      aspectRatio: '画幅比例（可选，如 1:1 / 9:16）',
      aspectRatioPlaceholder: '留空使用默认',
      dimensions: '变体维度',
      addDimension: '新增维度',
      dimensionHint: '每个维度一个「标签 + 若干取值（每行一个）」，单元格 = 取值笛卡尔积。',
      dimensionEmpty: '暂无维度，点击「新增维度」开始',
      dimensionLabelPlaceholder: '维度名，如 机位角度',
      dimensionValuesPlaceholder: '每行一个取值',
      removeDimension: '删除维度',
      preview: '变体预览',
      cellCount: '{n} 格',
      previewEmpty: '先在上方添加维度并填写取值，会自动生成变体预览',
      compare: '生成对比',
      selectedCount: '{n} 入选',
      exporting: '导出中…',
      exportSelected: '导出入选',
      compareEmptyHint: '运行该节点生成变体后，这里可并排对比并标记入选 / 淘汰。',
      loading: '加载中…',
      select: '入选',
      reject: '淘汰',
      clear: '清除',
      clearAll: '清除全部结论',
      save: '保存',
      exportNoFiles: '没有可导出的文件',
      exportSkipped: '（跳过 {n} 个）',
      exportDone: '已导出 {copied} 个文件{skipped}到 {directory}',
      exportFailed: '导出失败'
    },
    multiAngle: {
      appMark: '多角度编辑器',
      hint: '双击编辑机位与模型；运行节点以生成结果',
      yaw: '水平环绕',
      pitch: '垂直俯仰',
      shotScale: '景别缩放',
      prompt: '拼接面板提示词',
      panelPrompt: '面板提示词',
      panelPromptPlaceholder: '主体/风格等基础描述（开启拼接后与机位句合并）',
      cameraPrompt: '机位提示词',
      outputPrompt: '最终输出',
      promptEmpty: '（根据当前机位生成）',
      promptOffHint: '关闭时仅输出机位提示词，不拼接面板内容',
      pitchUp: '俯仰升高',
      pitchDown: '俯仰降低',
      yawLeft: '向左环绕',
      yawRight: '向右环绕',
      resetParams: '重置参数',
      presets: {
        custom: '自定义',
        fisheye: '鱼眼视角',
        dutch: '倾斜视角',
        frontHigh: '正面俯拍',
        frontLow: '正面仰拍',
        panoramaHigh: '全景俯拍',
        back: '背面视角'
      }
    },
    lighting: {
      appMark: '打光效果',
      hint: '双击编辑打光与模型；运行节点以生成结果',
      perspective: '透视',
      frontal: '正面',
      global: '全局',
      smartMode: '智能模式',
      brightness: '亮度',
      color: '颜色',
      mainLight: '主光源',
      rimLight: '轮廓光',
      smartPromptPlaceholder: "例如：让画面光影变成'黄金时刻'",
      presetsTitle: '预设',
      outputPrompt: '最终提示词',
      promptEmpty: '（根据当前打光参数生成）',
      resetParams: '重置参数',
      directions: {
        left: '左侧',
        top: '顶部',
        right: '右侧',
        front: '前方',
        bottom: '底部',
        back: '后方'
      },
      presets: {
        custom: '自定义',
        overexposedFilm: '过曝胶片',
        blueBacklight: '蓝色逆光',
        rembrandt: '伦勃朗光',
        cyberpunk: '赛博朋克',
        sunsetPsychedelic: '落日迷幻',
        mysteriousLowKey: '神秘暗调',
        goldenHour: '黄金时刻',
        nolanColdGrey: '诺兰冷灰'
      }
    },
    portraitTexture: {
      appMark: '人像质感调节',
      hint: '双击调节质感与模型；运行节点以生成结果',
      previewEmpty: '接入图片输入后可在此预览',
      outputPrompt: '最终提示词',
      promptEmpty: '（根据当前质感选项生成）',
      resetParams: '重置参数',
      fields: {
        personScene: '人景融合',
        lightShadow: '光影融合',
        skin: '皮肤',
        texture: '纹理',
        sharpness: '锐度'
      },
      options: {
        personScene: {
          light: '轻度对齐',
          natural: '自然融合',
          deep: '深度融合'
        },
        lightShadow: {
          softFill: '柔和补光',
          natural: '自然匹配',
          atmosphere: '氛围强化'
        },
        skin: {
          clear: '清透修饰',
          natural: '自然肤质',
          real: '真实肌理'
        },
        texture: {
          soft: '柔和纹理',
          natural: '自然纹理',
          grain: '颗粒质感'
        },
        sharpness: {
          softFocus: '柔焦',
          standard: '标准清晰',
          hd: '高清锐化'
        }
      }
    },
    portraitQuality: {
      appMark: '人像质感调节',
      previewEmpty: '接入图片输入后可在此预览',
      previewLoadFailed: '预览图加载失败',
      compareLoadFailed: '图片加载失败',
      before: '原图',
      after: '效果',
      generated: '生成',
      reset: '重置参数',
      groups: {
        skin: '肤质',
        light: '光影',
        blend: '融合',
        color: '色彩',
        detail: '细节'
      },
      fields: {
        skinSmoothing: '磨皮',
        skinPore: '毛孔保留',
        skinEvenness: '肤色均匀',
        blemishRemoval: '瑕疵移除',
        lightRatio: '主光比',
        fillLight: '补光',
        rimLight: '轮廓光',
        catchlight: '眼神光',
        atmosphere: '氛围',
        personSceneBlend: '人景融合',
        edgeTransition: '边缘过渡',
        colorTemp: '色温',
        saturation: '饱和度',
        contrast: '对比度',
        skinTone: '肤色调',
        sharpness: '锐度',
        grain: '颗粒',
        softFocus: '柔焦',
        clarity: '清晰度',
        vignette: '暗角'
      },
      presets: {
        natural: '自然',
        magazine: '杂志人像',
        commercial: '商业修图',
        cinematic: '电影感',
        retro: '港风复古'
      }
    },
    emotion: {
      appMark: '情绪调节',
      hint: '双击调节情绪与模型；运行节点以生成结果',
      previewEmpty: '接入图片输入后可在此预览',
      locate: '情绪定位',
      outputPrompt: '最终提示词',
      promptEmpty: '（根据情绪坐标盘生成）',
      resetParams: '重置参数',
      axis: {
        excited: '激动',
        calm: '平静',
        close: '亲近',
        distant: '疏离'
      }
    },
    lipSync: {
      hint: '连接角色图或参考视频，再接声音后运行；需 Seedance 2.0 等支持参考音频的视频模型'
    },

    upscale: {
      systemPrompt: '系统提示词',
      mergedPrompt: '合并提示词',
      promptEmpty: '暂无合并提示词，请在节点指令框填写放大指令'
    },

    expand: {
      appMark: '扩图',
      hint: '双击在画布上放置原图；运行节点以扩边生成',
      noSource: '请先连接上游图片',
      aspect: '比例',
      resolution: '分辨率',
      count: '张数',
      countOption: '{n}张',
      resetParams: '重置参数',
      systemPrompt: '系统提示词',
      mergedPrompt: '合并提示词',
      promptEmpty: '暂无合并提示词，请在编辑窗口调整画布',
      aspects: {
        original: '原图比例',
        '1_1': '1:1',
        '4_3': '4:3',
        '3_4': '3:4',
        '16_9': '16:9',
        '9_16': '9:16'
      }
    },
    redraw: {
      appMark: '重绘',
      hint: '双击涂抹蒙版；运行节点以局部重绘',
      noSource: '请先连接上游图片',
      promptPlaceholder: '开始你的设计…',
      brushSize: '笔刷大小',
      undo: '撤销',
      redo: '重做',
      aspect: '比例',
      resolution: '分辨率',
      count: '张数',
      countOption: '{n}张',
      systemPrompt: '系统提示词',
      mergedPrompt: '合并提示词',
      promptEmpty: '暂无合并提示词，请在编辑窗口涂抹蒙版并填写描述',
      tools: {
        brush: '画笔',
        rect: '框选',
        eraser: '橡皮'
      },
      aspects: {
        original: '原图比例'
      }
    },
    erase: {
      appMark: '擦除',
      hint: '双击涂抹蒙版；运行节点以擦除蒙版区域',
      noSource: '请先连接上游图片',
      promptPlaceholder: '可选：要擦除的内容 / 如何填补…',
      brushSize: '笔刷大小',
      undo: '撤销',
      redo: '重做',
      aspect: '比例',
      resolution: '分辨率',
      count: '张数',
      countOption: '{n}张',
      systemPrompt: '系统提示词',
      mergedPrompt: '合并提示词',
      promptEmpty: '暂无合并提示词，请在编辑窗口涂抹蒙版',
      tools: {
        brush: '画笔',
        rect: '框选',
        eraser: '清除蒙版'
      },
      aspects: {
        original: '原图比例'
      }
    },
    matte: {
      appMark: '抠图',
      hint: '运行自动抠图；双击可涂保留蒙版再 refinement',
      noSource: '请先连接上游图片',
      promptPlaceholder: '可选：主体提示…',
      brushSize: '笔刷大小',
      undo: '撤销',
      redo: '重做',
      aspect: '比例',
      resolution: '分辨率',
      count: '张数',
      countOption: '{n}张',
      systemPrompt: '系统提示词',
      mergedPrompt: '合并提示词',
      promptEmpty: '暂无合并提示词。可直接运行自动抠图，或涂抹保留蒙版。',
      tools: {
        brush: '画笔',
        rect: '框选',
        eraser: '清除蒙版'
      },
      aspects: {
        original: '原图比例'
      }
    },
    crop: {
      appMark: '裁剪',
      hint: '双击调整裁剪框；运行节点以本地裁剪',
      noSource: '请先连接上游图片',
      aspect: '比例',
      frame: '裁剪框',
      aspects: {
        original: '原图比例',
        custom: '自定义'
      }
    },
    gridSplit: {
      appMark: '宫格切分',
      hint: '双击选择宫格；运行节点直接切分原图，不调用大模型',
      noSource: '请先连接上游图片',
      selectedCount: '已选 {n} 个宫格',
      sizeLabel: '{n}宫格 ({r}×{c})',
      clearSelection: '清空选择',
      customTitle: '自定义宫格',
      grid: '宫格',
      selected: '已选',
      allCells: '全部',
      cropPreview: '切分原图',
      cropPreviewHint: '按当前宫格从上游图片裁出的格子（运行前参考）',
      cropLoading: '正在切分预览…',
      cropEmpty: '暂无切分预览',
      cropFailed: '切分预览失败',
      presets: {
        p4: '4宫格 (2×2)',
        p9: '9宫格 (3×3)',
        p16: '16宫格 (4×4)',
        p25: '25宫格 (5×5)'
      }
    },
    layerSplit: {
      appMark: '图层分离',
      hint: '运行节点调用 Seedream 5.0 Pro 拆层；双击进入画布调整层级与位置',
      needRun: '请先连接上游图片并运行节点。模型会拆出底图和透明图层，之后可在此拖动、缩放与调整叠放顺序。',
      noSelection: '未选中图层',
      layers: '图层',
      emptyLayers: '尚未拆层。运行节点后会显示各图层。',
      layerCount: '{n} 层',
      prompt: '拆层提示词',
      promptPlaceholder: '可选：描述要拆出的元素。留空则自动识别主体、文字与装饰。',
      resolution: '分辨率',
      sendBack: '下移一层',
      bringForward: '上移一层',
      hideBase: '隐藏底图',
      showBase: '显示底图',
      hideLayer: '隐藏图层',
      showLayer: '显示图层',
      baseLayer: '底图',
      resetPos: '复位位置',
      resetAll: '全部复位',
      redecompose: '清空并重新拆层',
      splitSelected: '拆分选中层',
      splitting: '正在拆分选中层…',
      splitNeedLayer: '请先选中要继续拆分的图层',
      splitAlready: '该图层已经拆成分组',
      splitNeedImage: '选中层没有可用图片',
      group: '分组',
      splitGroupName: '{name} 拆分',
      splitLogTitle: '拆分选中层 · {name}',
      splitLogStart: '对图层「{layer}」继续拆层',
      splitLogDone: '已拆出 {n} 层并收入分组',
      collapseGroup: '折叠分组',
      expandGroup: '展开分组',
      hideGroup: '隐藏分组',
      showGroup: '显示分组',
      exportSelected: '导出选中图层',
      exportGroup: '导出选中分组',
      exportAll: '导出全部图层',
      exporting: '导出中…',
      exportSelectedDone: '已导出选中图层',
      exportGroupDone: '已导出分组内 {n} 个图层',
      exportAllDone: '已导出 {n} 个图层',
      exportFailed: '导出失败：{error}',
      exportNeedImage: '没有可导出的图层图片',
      exportFilterImage: '图片',
      exportPsd: '导出 PSD',
      exportPsdDone: '已导出 PSD',
      exportPsdFilter: 'Photoshop PSD'
    },
    anim2d: {
      inspectorHint: '接入上游帧动画序列图；运行本节点按行列切分为单帧，下方可逐帧播放预览',
      genInspectorHint: '双击节点打开指令面板选择预设与动作描述；此处设置行列数与系统提示词，运行后生成序列图',
      cardPlayHint: '双击播放 / 暂停序列帧',
      rows: '行',
      cols: '列',
      preset: '动画预设',
      systemPrompt: '系统提示词',
      systemPromptPlaceholder: '可选：自定义生图系统提示词（留空使用默认）',
      action: '动作描述',
      actionPlaceholder: '可选：自定义动作描述（留空使用预设）',
      preview: '动画预览',
      play: '播放',
      pause: '暂停',
      fps: '帧率',
      loop: '循环',
      loading: '正在切分预览…',
      emptyPreview: '暂无预览：请接入上游序列图并运行本节点',
      presets: {
        idle: '待机',
        walk: '行走',
        run: '奔跑',
        jump: '跳跃',
        attack: '攻击',
        hurt: '受击',
        skill: '技能'
      }
    },
    group: {
      action: '分组',
      ungroup: '取消分组',
      title: '节点分组',
      defaultName: '分组',
      renamePlaceholder: '分组名称'
    },
    resize: '拖动调整大小',
    defaultNode: '节点',
    note: {
      badge: '备注',
      title: '备注',
      placeholder: '双击编辑备注…',
      draftPlaceholder: '备注…'
    },
    scriptNode: {
      badge: '文本',
      title: '文本',
      placeholder: '双击编辑文本内容…'
    },
    inputInterface: {
      badge: '输入接口',
      title: '输入',
      hint: '外层宿主传入的输入槽，稳定序号，不可删除',
      placeholder: '等待外层传入…',
      badgeByType: {
        text: '文本输入',
        image: '图片输入',
        voice: '声音输入',
        video: '视频输入',
        model: '模型输入',
        worldEntities: '世界元素实体'
      },
      placeholderByType: {
        text: '等待外层文本…',
        image: '等待外层图片…',
        voice: '等待外层声音…',
        video: '等待外层视频…',
        model: '等待外层模型…',
        worldEntities: '等待外层世界元素实体…'
      }
    },
    boundaryInput: {
      badge: '边界输入',
      title: '输入'
    },
    boundaryOutput: {
      badge: '边界输出',
      title: '输出'
    },
    hostInterface: {
      encapsulate: '封装为宿主资产',
      encapsulateAction: '封装资产',
      encapsulateFailed: '封装失败，请重试。',
      defaultName: '宿主资产',
      nameTitle: '创建宿主资产',
      nameMessage: '请输入可复用宿主资产的名称。',
      saveMessage: '选择保存目录并输入宿主资产名称。',
      namePlaceholder: '宿主资产名称',
      inspectorHint: '编辑宿主输入/输出端口定义。保存后更新资产定义与当前实例快照。',
      assetInspectorHint:
        '在此编辑该宿主资产的输入/输出端口。点击「应用接口」后写入资产并同步已打开的画布实例。',
      inputs: '输入端口',
      outputs: '输出端口',
      addPort: '添加端口',
      emptyPorts: '暂无端口',
      collapsePorts: '收起端口',
      expandPorts: '展开端口',
      reorderHint: '拖动左侧手柄可调整端口顺序，节点上会同步变化。',
      reorderHandle: '拖动调整顺序',
      portId: '端口 ID',
      portType: '端口类型',
      portLabel: '显示名',
      dataType: '端口类型',
      multiple: '允许多连',
      apply: '应用接口',
      saving: '保存中…'
    },
    demo: {
      badge: '插件示例',
      title: '示例节点',
      placeholder: '双击编辑演示文本…',
      inspector: {
        hint: '内置图插件演示：展示自定义节点、Scope、卡片与检查器注册。'
      }
    },
    directorNode: {
      hint: '双击打开导演台编辑',
      live: '实时预览 · 双击打开导演台编辑'
    },
    timelineOutputNode: {
      hint: '双击进入成片时间线编辑'
    },
    worldTableNode: {
      hint: '双击打开世界元素审核'
    },
    worldGenNode: {
      hint: '双击打开世界元素生成画布'
    },
    beatTableNode: {
      hint: '双击打开场表格'
    },
    beatGenNode: {
      hint: '双击进入场文本细化'
    },
    node: {
      collapsePreview: '收起预览',
      expandPreview: '展开预览',
      expandImageGrid: '展开多图平铺',
      collapseImageGrid: '折叠为叠放预览',
      expandImageGridShort: '展开',
      collapseImageGridShort: '折叠',
      enableLock: '锁定：跳过执行，保留上次结果',
      disableLock: '解锁：下次运行将重新执行',
      directorReviewFail: '导演审核失败',
      directorReviewPass: '导演审核通过'
    },
    nodeRole: {
      ref: '引用',
      host: '宿主',
      subgraph: '子图',
      generate: '生成',
      output: '输出',
      lock: '锁定',
      missing: '不可用'
    },
    assetRef: {
      hint: '引用素材 · 在左侧资产库打开预览'
    },
    assetHost: {
      hint: '宿主资产 · 双击打开编辑'
    },
    subgraphDive: {
      hint: '内含子图 · 双击进入'
    },
    assetMissing: {
      hint: '关联资产已删除 · 节点不可用'
    },
    generateNode: {
      hint: '生成节点 · 右侧面板调整参数',
      instructionHint: '双击编辑生成指令'
    },
    error: {
      selfAssetDrop: '不能将当前资产拖入自身工作流，以免循环依赖',
      alreadyOnGraph: '该宿主资产已在画布上',
      unsupportedDrop: '当前画布不支持此类型资产',
      dropPathFailed: '无法读取拖入的文件路径，请先导入到资产库',
      importFailed: '导入失败：{detail}',
      noneImportable: '没有可导入到画布的文件'
    },
    port: {
      outTitle: '拖出连线至输出节点',
      outAllTitle: '拖出全部历史结果',
      outAllShort: '全部',
      inTitle: '接入参考',
      limitMax: '最多 {n}',
      limitMaxAfterStyle: '端口最多 {n}（风格参考已占 {style}）',
      limitUnknown: '未声明上限 (*)',
      outputDuration: '输出时长 {range}',
      firstFrame: '首帧',
      lastFrame: '尾帧',
      referenceImage: '参考图',
      types: {
        image: '图片',
        images: '图片组',
        voice: '声音',
        voices: '声音组',
        video: '视频',
        videos: '视频组',
        text: '文本',
        texts: '文本组',
        world: '世界元素',
        worldEntities: '世界元素实体',
        beat: '场',
        model: '模型'
      }
    },
    media: {
      restart: '回到开头',
      pause: '暂停',
      play: '播放'
    },
    runStatus: {
      pending: '等待',
      running: '执行',
      done: '完成',
      error: '失败',
      degraded: '降级'
    },
    preview: {
      audioError: '声音无法播放',
      videoError: '视频编码不受支持',
      imageTitle: '图片预览',
      videoTitle: '视频预览',
      audioTitle: '声音预览'
    },
    run: {
      stopped: '已停止',
      complete: '执行完成 · {visual} 视觉参考 · {audio} 声音参考',
      completeImages: '执行完成 · 已汇总 {images} 张图片到输出',
      completeText: '执行完成 · 已汇总 {text} 条文本到输出',
      completeOk: '执行完成',
      noRefs: '执行完成 · 输出节点暂无有效输入（无资产参考、图片或文本）',
      failed: '执行失败',
      cancelled: '工作流已取消',
      cycle: '工作流存在环路，无法执行',
      noOutput: '未找到输出节点',
      unboundAsset: '节点未绑定资产',
      missingAsset: '关联资产已删除',
      hostNoGraph: '宿主资产没有可执行的内图',
      hostEnqueueFailed: '宿主内图未能加入任务列表',
      noInput: '请填写生成指令，或连接上游输入',
      lipSyncNoVisual: '请先连接角色图片或参考视频',
      lipSyncNoAudio: '请先连接声音（语音）输入',
      noMask: '请先在重绘编辑器中涂抹蒙版',
      lockNoCache: '已锁定，但没有可复用的上次结果；请先成功生成一次，或解锁',
      hostNoCacheCook: '没有可复用的宿主输出；请用圆形菜单「Cook 子图」执行内图',
      comicPageEmpty: '请先在漫画页编辑器中添加分格，或连接上游图片后 Cook',
      comicPageCompose: '漫画页合成失败（需要在界面中运行）',
      dismissHint: '点击关闭提示'
    },
    types: {
      asset: {
        image: '图片生成',
        canvas: '画布编辑',
        video: '视频生成',
        voice: '声音生成',
        motion: '导演台编辑',
        model: '模型',
        screenplay: '剧本生成',
        gameSystem: '策划案生成',
        script: '分镜',
        subgraph: '宿主资产'
      },
      output: {
        video: '视频输出',
        image: '图片输出',
        voice: '声音输出',
        text: '剧本输出',
        director: '导演台输出',
        timeline: '成片时间线',
        beat: '场输出',
        beatUnit: '场输出',
        world: '世界元素实体输出'
      },
      note: {
        text: '备注'
      },
      media: {
        bundle: '束结',
        review: '媒体质检',
        rework: '媒体返工'
      },
      comic: {
        page: '漫画页'
      },
      play: {
        script: '文本'
      },
      image: {
        select: '选取图片',
        multiAngle: '多角度编辑',
        lighting: '打光效果',
        portraitTexture: '人像质感调节',
        emotion: '情绪调节',
        upscale: '高清放大',
        expand: '扩图',
        redraw: '重绘',
        erase: '擦除',
        matte: '抠图',
        crop: '裁剪',
        gridSplit: '宫格切分',
        layerSplit: '图层分离',
        toPrompt: '图片反推提示词',
        adVariants: '广告变体'
      },
      video: {
        select: '选取视频',
        lipSync: '对口型',
        framePull: '逐帧拉片',
        reshoot: '片段重拍'
      },
      voice: {
        select: '选取声音'
      },
      prompt: {
        optimize: '提示词优化'
      },
      text: {
        select: '选择文本'
      },
      beat: {
        select: '选择场',
        split: '场拆解',
        table: '场表格',
        gen: '场生成',
        unitGen: '场生成',
        unitRef: '场参考'
      },
      ui: {
        split: 'UI 界面拆分',
        gen: 'UI 界面生成'
      },
      anim: {
        '2d': '2D帧动画'
      },
      frame: {
        animGen: '生成帧动画序列图'
      },
      episode: {
        anchorSelect: '宫格选择',
        cellSelect: '动态格选择'
      },
      world: {
        extract: '世界元素提取',
        table: '世界元素审核',
        gen: '世界元素生成'
      },
      plugin: {
        example: {
          node: '图插件示例'
        }
      }
    },
    titles: {
      image: '图片',
      video: '视频',
      voice: '声音',
      motion: '导演台',
      model: '模型',
      canvas: '画布',
      world: '世界元素',
      beat: '场',
      subgraph: '宿主资产',
      screenplayOutput: '剧本输出',
      directorOutput: '导演台输出',
      timelineOutput: '成片时间线',
      beatOutput: '场输出',
      beatUnitOutput: '场输出',
      worldOutput: '世界元素实体输出',
      assetOutput: {
        image: '图片输出',
        video: '视频输出',
        voice: '声音输出',
        text: '文本输出'
      }
    },
    output: {
      voiceHint: '控制该声音工作流的最终输出。',
      videoHint: '控制该工作流的最终视频输出。',
      imageHint: '控制该工作流的最终图片输出。',
      textHint: '控制该工作流的最终文本输出。',
      connectHint: '将参考节点连接到此节点，形成最终输出。',
      resultText: '执行结果',
      resultPlaceholder: '执行节点后显示汇总剧本文本，可在此编辑修改',
      exportScreenplay: '导出剧本…',
      exportVideo: '导出视频…',
      exportImages: '批量导出…',
      exporting: '导出中…',
      exportSuccess: '剧本已保存',
      exportVideoSuccess: '视频已保存',
      exportImagesSuccess: '已导出 {n} 张图片',
      exportFailed: '导出失败：{error}',
      exportFilterText: '文本文件',
      exportFilterVideo: '视频文件',
      exportFilterAll: '所有文件',
      volume: '输出音量',
      muted: '输出静音',
      loop: '循环播放',
      duration: '输出时长（秒）',
      speed: '播放速度',
      beatPaths: '落地剧本',
      beatPathsHint: '运行「场生成」后，各单元文本会保存为独立剧本文件；双击预览全文',
      beatPathsEmpty: '尚未落地，请先细化各单元并运行本节点',
      beatPathPending: '（未落盘）'
    },
    notepad: {
      appMark: '记事本',
      copy: '复制',
      copied: '已复制到剪贴板',
      close: '关闭',
      saveHint: 'Ctrl+S 保存',
      placeholder: '在此编辑文本…',
      emptyReadonly: '暂无文本内容',
      readonly: '只读',
      unsaved: '未保存',
      saved: '已保存',
      stats: '{lines} 行 · {chars} 字符 · {tokens} tokens',
      fontSize: '{size}px',
      fontZoomHint: 'Ctrl + 滚轮缩放字体',
      openHint: '双击查看 / 编辑',
      imageBatch: '参考图片'
    },
    inspector: {
      node: {
        title: '节点参数',
        hint: '预览在节点上；此处编辑详细参数',
        empty: '未选择节点'
      },
      assetRef: '引用素材',
      assetHost: '宿主资产',
      unselected: '未选择',
      assetTaken: '（已被其他节点使用）',
      displayName: '显示名称',
      weight: '参考强度',
      label: '备注标签',
      labelPlaceholder: "用于 {'@'} 引用展开",
      volume: '音量',
      previewMuted: '预览静音',
      notes: '节点备注',
      outputPreview: '输出预览',
      outputDelete: '删除输出',
      outputGalleryHint: '单击设为当前输出（out），× 删除该条',
      outputPreviewCount: '{n} 项',
      outputPreviewLoading: '正在加载预览…',
      outputPreviewMissing: '无法加载预览',
      aggregateJson: '聚合 JSON',
      revealInAssets: '在资产窗口中定位',
      current: '当前：',
      noAssets: '资产库中暂无「{type}」类型资产，请先创建或导入。',
        note: {
        hint: '画布便签；双击节点可在记事本中查看与编辑',
        title: '标题',
        body: '备注内容',
        empty: '未选择备注节点'
      },
      inputInterface: {
        hint: '由外层宿主入边注入；此处只读预览，双击节点不会打开记事本',
        dataType: '数据类型',
        port: '外层端口',
        index: '槽位序号',
        preview: '输入预览',
        previewEmpty: '暂无外层传入值（父图连线或运行后会出现）',
        previewEmbedded: '（已嵌入预览数据）',
        empty: '未选择输入接口节点'
      },
      boundary: {
        hintInput: '宿主边界输入；按端口类型预览外层注入的当前值，不再编辑备注正文',
        hintOutput: '宿主边界输出；按端口类型预览传入本口的当前值，不再编辑备注正文',
        dataType: '数据类型',
        port: '端口',
        preview: '端口预览',
        previewEmpty: '暂无预览（连接上游并生成后显示）',
        empty: '未选择边界节点'
      },
      script: {
        hint: '文本节点；可在此编辑内容，或点击扩展在记事本中查看',
        body: '内容',
        empty: '未选择文本节点'
      },
      group: {
        hint: '点击分组标签可选中分组；双击标签可改名',
        name: '分组名称',
        memberCount: '成员数量',
        empty: '未选择分组'
      },
      select: {
        hint: '双击节点打开选取面板；运行后可在此预览输出端口当前选中项'
      },
      episode: {
        anchorHint: '从上游 9宫格分镜表选择要提取的宫格（1~9）；运行后输出该格提示词。',
        cellHint: '从上游动态提示词表选择动态格：组（1~9）× 格（1~4）；运行后输出该格动态指令。',
        anchorLabel: '宫格',
        groupLabel: '组',
        cellLabel: '格'
      },
      worldTable: {
        hint: '双击打开世界元素审核；运行节点导入目录 JSON，并在此预览输出端口'
      },
      worldGen: {
        hint: '四个图片组出口：角色 / 场景 / 道具 / 武器。执行当前只收集已有图片；圆形菜单「Cook 子图」才批跑元素子图',
        groupedPreview: '分组预览',
        groupedPreviewHint: '按图片组出口分类；双击缩略图可放大查看',
        groupCount: '{n} 张',
        groupEmpty: '暂无图片'
      },
      beatTable: {
        hint: '双击打开场表格；运行节点导入目录 JSON，并在此预览输出端口'
      },
      beatGen: {
        hint: '运行本节点收集各单元文本并落地到输出路径'
      },
      multiAngle: {
        hint: '双击节点编辑机位与模型；运行后输出结果图，此处可预览图库与提示词',
        spliceOn: '开',
        spliceOff: '关'
      },
      lighting: {
        hint: '双击节点编辑打光与模型；运行后输出结果图，此处可预览图库与提示词'
      },
      portraitTexture: {
        hint: '双击节点调节质感与模型；运行后输出结果图，此处可预览图库与提示词'
      },
      emotion: {
        hint: '双击节点调节情绪与模型；运行后输出结果图，此处可预览图库与提示词'
      },
      upscale: {
        hint: '双击节点打开指令框填写放大指令；此处预览系统提示词与最终放大提示词',
        previewHint: '双击缩略图进入媒体预览',
        previewEmpty: '暂无放大结果，请连接输入图并运行节点'
      },
      framePull: {
        hint: '双击节点打开拉片台：<、> 键步进，空格播放/暂停，可逐帧取图并批注',
        openHint: '双击打开拉片台',
        noSource: '请先连接上游视频（视频生成节点执行后，或视频资产）',
        capture: '取当前帧',
        clear: '清空取帧',
        captured: '已取 {n} 帧',
        keyframeStrip: '关键帧胶片条',
        frameStripFallback: '未检测到 ffprobe，已回退为逐帧胶片条',
        framesEmpty: '尚未取帧，在拉片台里点击「取当前帧」开始',
        prevFrame: '上一帧',
        nextFrame: '下一帧',
        frameLabel: '帧 {frame}/{total}',
        frameShort: '帧',
        remove: '移除该帧',
        note: '当前帧批注',
        notePlaceholder: '记录这一帧的镜头、构图、表演要点…'
      },
      reshoot: {
        hint: '连接源视频后双击节点打开重拍台：定位到要修改的起止时间，填写修改要求，运行后仅重拍该区间，其余片段保持不变。建议配合 Seedance 2.5（时间戳级视频编辑）使用',
        noSource: '请先连接上游视频（视频生成节点执行后，或视频资产）',
        segment: '重拍区间',
        markStart: '标记起点 {time}',
        markEnd: '标记终点 {time}',
        start: '起点（秒）',
        end: '终点（秒）',
        segmentHint: '在视频上定位后点「标记起点 / 标记终点」，或直接输入秒数；区间默认按 mm:ss 写入指令',
        instruction: '修改要求',
        instructionPlaceholder: '例如：将人物手中的黑色雨伞改成透明雨伞',
        model: '视频模型',
        range: '重拍区间 {range}',
        done: '完成'
      },
      lipSync: {
        hint: '连接角色图或参考视频 + 声音；有视频时优先对视频中角色对口型。在节点下方可填表演指令，并选 Seedance 2.0',
        modelHint: '请选择 Seedance 2.0 / 2.0 Fast 等支持参考音频的模型；模型与时长比例在节点指令面板中设置'
      },
      expand: {
        hint: '双击节点放置原图；此处预览系统提示词与合并提示词'
      },
      redraw: {
        hint: '双击节点涂抹蒙版；此处预览系统提示词与合并提示词'
      },
      erase: {
        hint: '双击节点涂抹蒙版；此处预览系统提示词与合并擦除提示词'
      },
      matte: {
        hint: '运行自动抠图；双击可 refinement。此处预览系统提示词与合并抠图提示词'
      },
      crop: {
        hint: '双击节点调整裁剪框；运行节点在本地裁剪'
      },
      gridSplit: {
        hint: '双击选择宫格大小与单元格；运行节点直接切分原图，不调用大模型'
      },
      layerSplit: {
        hint: '运行节点用 Seedream 5.0 Pro 拆层。双击进入画布：拖动移动、角点缩放、列表调整叠放顺序。选中一层可继续拆分，结果收进分组。提示词或分辨率变化后会重新拆层。'
      },
      camera: {
        hint: '修改参数会同步到导演台编辑预览；在预览中环视也会实时更新。',
        position: '位置',
        rotation: '旋转 (°)',
        scale: '缩放',
        target: '注视点',
        fov: '视场角',
        openStage: '导演台编辑',
        empty: '未选择导演台编辑节点',
        outImages: '输出 · 站位',
        outImagesCount: '{n} 张',
        outImagesHint: '双击缩略图进入媒体预览',
        outImagesEmpty: '暂无站位图。在导演台中截取机位后会显示在这里',
        outActions: '输出 · 动作',
        outActionsCount: '{n} 段',
        outActionsHint: '双击缩略图预览录制视频',
        outActionsEmpty: '暂无动作。在动画模式中录制后会显示在这里'
      },
      mediaReview: {
        hint: '连接上游图片（或视频，按首帧审核），用视觉模型做导演 PASS/FAIL 质检',
        instruction: '审核指令',
        instructionPlaceholder: '可选：补充审核要点（如“检查手指数量、是否糊脸”）；留空用内置质检包',
        status: '质检结论',
        pending: '待审核',
        pass: '通过',
        fail: '不通过',
        reason: 'FAIL 原因',
        reviewModel: '质检模型',
        reviewModelHint: '用于看懂画面的视觉模型，须选择支持图像输入的模型',
        reviewModelFallback: '未配置质检模型，当前回退到生成模型，结论可能不可信',
        referenceCount: '参考图张数',
        referenceCountHint: '前 N 张作为比对基准（不评分），其余为待审产物；留空自动判定',
        score: '质检评分',
        rounds: '轮次记录'
      },
      mediaRework: {
        hint: '生成 → 质检 → 未通过则注入原因重生成，直到通过或达上限',
        instruction: '生成指令',
        instructionPlaceholder: '描述要生成的内容；返工会自动注入上次 FAIL 原因',
        maxAttempts: '最大返工次数',
        status: '返工状态',
        running: '返工中',
        passed: '已通过',
        exhausted: '已达上限',
        final: '最终质检',
        lastReason: '最近原因',
        imageModel: '生图模型',
        reviewModel: '质检模型',
        reviewModelHint: '须选择支持图像输入的视觉模型；用生图模型做质检等于盲评',
        reviewModelFallback: '未配置质检模型，当前回退到生图模型，结论可能不可信',
        imageModelFallbacks: '备选生图模型',
        reviewModelFallbacks: '备选质检模型',
        modelFallbacksHint: '首选模型调用失败（限流 / 不可用 / 超时）时，按勾选顺序自动切换',
        strategy: '返工策略',
        strategyAuto: '自动升档（推荐）',
        strategyGuidance: '针对性修正',
        strategyReseed: '换构图重抽',
        strategyStronger: '强化约束重解',
        confirmFirst: '首轮出图后等人工确认',
        confirmFirstHint: '开启后先出第一张交给你确认，避免无人值守一路烧到次数上限',
        awaitingConfirm: '等待人工确认',
        awaitingConfirmHint: '已出图并暂停。可继续返工，也可直接采用当前结果',
        continueRework: '继续返工',
        acceptCurrent: '采用当前结果',
        rounds: '轮次记录',
        cost: '调用开销',
        score: '质检评分',
        best: '已选最优'
      },
      adVariants: {
        hint: '在此设置产品描述与画幅比例；双击节点打开变体编辑器配置维度、预览与对比。'
      },
      comicPage: {
        hint: '双击节点进入漫画页编辑器；Cook 会按分格顺序填入上游空格图片并合成 PNG',
        cardHint: '双击打开漫画页编辑器',
        json: '页面 JSON',
        invalidJson: 'JSON 解析失败（未写入节点，预览已回退为默认）',
        reset: '重置为默认',
        openEditor: '打开编辑器',
        pageTitle: '页标题',
        columns: '列',
        rows: '行',
        gutter: '间距',
        width: '宽',
        height: '高',
        addPanel: '添加分格',
        removePanel: '删除分格',
        addBubble: '添加气泡',
        removeBubble: '删除气泡',
        panelSection: '选中分格',
        bubbleSection: '选中气泡',
        globalSection: '全局属性',
        bgColor: '背景颜色',
        bgTransparent: '透明（无底色）',
        panelTitle: '分格标题',
        panelImage: '图片路径',
        panelFallback: '分镜格',
        pickImage: '导入图片',
        pickIncoming: '上游图片',
        clearImage: '清除图片',
        bubbleText: '台词',
        bubblePlaceholder: '台词',
        speaker: '说话人',
        tail: '尾巴朝向',
        exportPng: '导出 PNG',
        exporting: '导出中…',
        exportDone: '已导出 {count} 张',
        exportCancel: '已取消',
        emptyPanels: '尚未添加分镜格',
        gridHint: '点击分镜格/气泡查看其属性；点工具栏「全局属性」按钮、空格或其他空白处返回页面属性。拖动选中分格的边缘/角落手柄调整大小，拖动气泡角部圆点缩放；从资产库拖图到空格自动建格',
        done: '完成'
      },
      generate: {
        hint: '连接上游参考后，在此调整该类型的生成参数',
        lock: '锁定输出',
        lockHint: '开启后本节点不再调用模型，直接输出图库中当前选中的上次结果',
        mediaOutputDir: '输出路径',
        mediaOutputDirHint:
          '相对工程根；默认写入工程缓存根下的 Images / Videos / Texts / Voices（见全局参数），不自动进资产库',
        pathOutsideProject: '只能选择工程目录内的文件夹',
        screenplayBody: '剧本文本',
        model: '文本模型',
        imageModel: '图片模型',
        videoModel: '视频模型',
        voiceModel: '已购声音',
        model3dModel: '3D 模型',
        modelPreview: '模型预览',
        modelPreviewEmpty: '生成完成后在此预览 3D 模型',
        model3dStyle: '3D 风格',
        model3dStyleHint: 'Lux3D 文生 3D 风格（图生 3D 不生效）',
        model3dStyles: {
          photorealistic: '写实',
          cartoon: '卡通',
          anime: '动漫',
          handPainted: '手绘',
          cyberpunk: '赛博朋克',
          fantasy: '奇幻',
          glass: '玻璃'
        },
        noModels: '暂无可用模型',
        systemPrompt: '系统提示词',
        systemPromptPlaceholder: '定义模型角色与输出规范；留空则使用内置默认',
        instruction: '生成指令',
        instructionPlaceholder: "根据现有内容扩写/整理为完整故事脚本；可用 {'@'} 引用上方连线资源",
        imageInstructionPlaceholder: "描述图片生成意图；可用 {'@'} 引用上方连线资源",
        toPromptInstructionPlaceholder:
          '根据图片生成结构化中文提示词，包括主体描述、环境、光影、镜头语言、风格关键词。',
        videoInstructionPlaceholder: "描述视频生成意图；可用 {'@'} 引用上方连线资源",
        lipSyncInstructionPlaceholder:
          '可选：补充表演/镜头说明（图→图片1+音频1；视频→视频1+音频1）；推荐 Seedance 2.0',
        voiceInstructionPlaceholder: "描述声音（文本）；可接图片参考；可用 {'@'} 引用连线资源",
        model3dInstructionPlaceholder: "描述要生成的 3D 模型；可接参考图进行图生 3D；可用 {'@'} 引用连线资源",
        worldExtractInstructionPlaceholder:
          "从文本提取角色/场景/道具/武器；可用 {'@'} 引用上方连线资源",
        beatSplitInstructionPlaceholder:
          "将剧本拆解为场；可用 {'@'} 引用上方连线资源",
        uiSplitInstructionPlaceholder:
          "将策划案中的 UI 拆为独立界面详细提示词；可用 {'@'} 引用上方连线资源",
        beatUnitGenInstructionPlaceholder:
          "可选：补充本次细化焦点（规则已在 Inspector 系统提示词）；可用 {'@'} 引用上游",
        refsEmpty: "连接上游后可用 {'@'} 引用；也可只在指令框中输入文本",
        disconnectRef: '断开连接',
        reorderRef: '拖动可调整引用顺序',
        styleRefRole: '风格',
        styleRefTitle: "{'@'}{n} 风格 · {name} · 强度{weight}（不可调序）",
        mentionHint: "输入 {'@'} 引用已连接资源；点击缩略图也可插入 {'@'}编号",
        presets: {
          open: '预设提示词',
          title: '生成指令模板',
          visualChip: {
            genre: '题材',
            cast: '人物',
            hook: '钩子'
          },
          titleScreenplay: '生成剧本模板',
          titleOptimize: '提示词优化模板',
          titleWorldExtract: '世界元素提取模板',
          titleBeatSplit: '场拆解模板',
          titleImage: '图片生成模板',
          titleVideo: '视频生成模板',
          titleLipSync: '对口型模板',
          titleToPrompt: '图片反推模板',
          tabGeneral: '通用',
          tabGame: '游戏',
          tabFilm: '影视',
          tabCharacter: '角色',
          tabFx: '特效',
          frameAnimFx: {
            smoke: '烟雾',
            fire: '火焰',
            lightning: '闪电',
            explosion: '爆炸',
            water: '水波',
            magic: '魔法粒子',
            rain: '雨',
            snow: '雪',
            spark: '火花',
            wind: '风',
            dust: '尘土',
            shockwave: '冲击波',
            glow: '光效',
            embers: '火星',
            bubbles: '气泡',
            slash: '斩击',
            impact: '打击'
          },
          frameAnimWushu: {
            xianglong: '降龙十八掌',
            taiji: '太极拳',
            wuyingjiao: '佛山无影脚',
            zuiquan: '醉拳',
            cunquan: '咏春寸拳',
            shizihou: '狮子吼',
            lingbo: '凌波微步',
            saotangtui: '扫堂腿',
            tieshazhang: '铁砂掌',
            yiyangzhi: '一阳指',
            liumai: '六脉神剑',
            dugu: '独孤九剑',
            dianxue: '葵花点穴手',
            jinzhongzhao: '金钟罩',
            rulai: '如来神掌',
            tiyunzong: '梯云纵'
          },
          screenplay: {
            create: '短剧创作框架',
            twists: '增加爽点和反转',
            dialogue: '优化台词',
            hooks: '强化结尾钩子'
          },
          image: {
            styleTransfer: '风格迁移',
            multiAngle9: '多机位九宫格',
            story4: '剧情推演四宫格',
            faceTurnaround: '角色脸部三视图',
            characterSheet: '角色设定图',
            characterTurnaround: '角色三视图',
            propTurnaround: '道具三视图',
            weaponTurnaround: '武器三视图',
            sceneSheet: '场景设定图（Three.js 可读）',
            productSheet: '产品设定图',
            story25: '25宫格连贯分镜',
            cinematicLighting: '电影级光影校正',
            physics3sLater: '画面推演-3秒后',
            physics5sBefore: '画面推演-5秒前',
            panorama720: '720全景',
            shotEstablish: '分镜思维：建立镜头首帧',
            shotDetail: '分镜思维：插入特写首帧',
            shotConfrontation: '分镜思维：低机位对峙'
          },
          video: {
            firstLastFrame: '首尾帧万能',
            cameraDolly: '推拉镜头',
            cameraPanTilt: '摇移镜头',
            cameraOrbit: '环绕运镜',
            cameraCrane: '升降镜头',
            cameraFollow: '跟拍运镜',
            cameraCombo: '组合运镜',
            textToVideo: '文生视频',
            multimodalRef: '全能参考',
            shotEstablish: '分镜思维：建立镜头运动',
            shotDetail: '分镜思维：细节动作',
            heroEntrance: '英雄式出场',
            performanceRealism: '人物真实表演',
            poseStandingFront: '姿势：正面站立',
            poseThreeQuarter: '姿势：45度站立',
            poseProfile: '姿势：侧面',
            poseBack: '姿势：背面',
            poseWalk: '姿势：走路',
            poseSit: '姿势：坐姿',
            poseLookBack: '姿势：回眸',
            poseHandsOnHips: '姿势：双手叉腰',
            poseRun: '姿势：跑步',
            framePairContinuity: '首尾帧成对：动作连续性',
            framePairProduct: '首尾帧成对：产品揭示',
            framePairTransition: '首尾帧成对：匹配转场',
            transitionHard: '广告转场：硬切',
            transitionFlash: '广告转场：闪白/闪黑',
            transitionMotion: '广告转场：运动匹配',
            transitionDissolve: '慢转场：短叠化',
            transitionOcclusion: '转场：前景遮挡',
            transitionFocus: '慢转场：虚焦揭示'
          },
          lipSync: {
            talkingHead: '对镜头说话',
            performance: '表演式对口型',
            fromVideo: '视频角色对口型'
          },
          reshoot: {
            prop: '改道具',
            scene: '改场景',
            camera: '改运镜',
            performance: '改表演'
          },
          optimize: {
            character: '人物设定提示词优化',
            prop: '道具提示词优化',
            scene: '场景提示词优化（Three.js）',
            camera: '运镜提示词优化',
            expression: '人物表情提示词优化',
            vfx: '特效提示词优化',
            episodeBreakdown: '分镜师：节拍拆解表',
            episodeBeatBoard: '分镜师：9宫格分镜表',
            episodeSequenceBoard: '分镜师：4宫格动态分镜表',
            episodeMotionPrompt: '动画师：动态提示词表',
            episodeDirectorReview: '导演：PASS/FAIL 审核'
          },
          toPrompt: {
            structured: '结构化全量反推',
            subject: '主体特写反推',
            style: '风格媒介反推',
            light: '构图光影反推',
            gameCharacter: '角色设定图',
            gameScene: '场景概念图',
            gameUi: 'UI / 图标',
            gameProp: '道具 / 武器',
            gameUa: '买量静帧',
            gameVfx: '技能特效帧',
            filmEstablish: '建立镜头 / 空镜',
            filmCloseup: '人物特写表演',
            filmLight: '光影调色',
            filmStoryboard: '分镜画面',
            filmCostume: '服化道造型',
            filmCamera: '镜头语言'
          },
          worldExtract: {
            create: '提取世界元素',
            refine: '优化元素目录'
          },
          beatSplit: {
            create: '剧本拆解为场',
            refine: '优化场结构'
          }
        },
        instructionExpand: '打开生成指令编辑窗',
        instructionPreview: '预览最终提示词',
        instructionPreviewTitle: '最终提示词预览',
        previewStyleImage: '风格 · {name}',
        previewStyleImageFallback: '风格参考',
        previewStyleImageAt: "{'@'}{n} 风格 · {name} · 强度{weight}",
        textExpand: '打开文本编辑窗',
        instructionDialogMark: '指令',
        instructionDialogTitle: '生成指令',
        instructionDialogHint: "支持 {'@'} 引用连线资源与预设模板",
        instructionDialogDone: '完成',
        executeHint: '执行本节点（生成）会调用上方模型生成剧本；右侧「剧本输出」节点只透传结果，不调 API',
        configureModelsHint: '请先在设置中配置可用的文本模型（需 API Key 并勾选模型）',
        configureImageModelsHint: '请先在设置中配置可用的图片模型（需 API Key 并勾选模型）',
        configureAudioModelsHint: '请先在设置 → 方舟 → 声音中手填并勾选已购买的 speaker_id',
        configureVideoModelsHint: '请先在设置中配置可用的视频模型（需 API Key 并勾选模型）',
        imageParams: {
          title: '图片生成参数',
          placeholder: '生成参数',
          loading: '正在读取模型能力…',
          empty: '当前模型未声明可调参数',
          quality: '画质',
          qualityLow: '低画质',
          qualityMedium: '标准画质',
          qualityHigh: '高画质',
          qualityAuto: '自动',
          resolution: '清晰度',
          aspectRatio: '比例',
          count: '生成数量',
          countOption: '{n}张',
          seed: '随机种子',
          seedPlaceholder: '留空随机',
          seedRandom: '随机',
          seedSummary: 'seed {n}',
          seedUseGlobal: '使用全局种子',
        },
        videoParams: {
          title: '视频生成参数',
          placeholder: '生成参数',
          loading: '正在读取模型能力…',
          empty: '当前模型未声明可调参数',
          duration: '时长',
          durationOption: '{n}秒',
          resolution: '清晰度',
          aspectRatio: '比例',
          generateAudio: '生成音频',
          generateAudioOn: '开',
          generateAudioOff: '关',
          frameMode: '帧模式',
          frameMode_none: '无帧控制',
          frameMode_first: '仅首帧',
          frameMode_first_last: '首尾帧',
          seed: '随机种子',
          seedPlaceholder: '留空随机',
          seedRandom: '随机',
          seedSummary: 'seed {n}',
          seedUseGlobal: '使用全局种子'
        },
        generatedImages: '已生成图片',
        generatedImagesCount: '{n} 张',
        generatedImagesHint:
          '每次执行追加新图并自动选中最新；单击设为当前输出（out），双击预览，× 删除',
        generatedImagesEmpty: '暂无生成结果。执行本节点后会显示在这里',
        generatedImagesDelete: '删除此图',
        generatedVideos: '已生成视频',
        generatedVideosCount: '{n} 条',
        generatedVideosHint:
          '每次执行追加新视频并自动选中最新；单击设为当前输出（out），双击预览，× 删除',
        generatedVideosEmpty: '暂无生成结果。执行本节点后会显示在这里',
        generatedVideosDelete: '删除此视频',
        generatedTexts: '已生成剧本',
        generatedTextsCount: '{n} 份',
        generatedTextsHint:
          '每次执行追加新文本并自动选中最新；单击设为当前输出（out），双击打开，× 删除',
        generatedTextsEmpty: '暂无生成结果。执行本节点后会显示在这里',
        generatedTextsDelete: '删除此文本',
        generatedTextsOpen: '双击打开记事本',
        generatedVoices: '已生成声音',
        generatedVoicesCount: '{n} 条',
        generatedVoicesHint:
          '每次执行追加新音频并自动选中最新；单击设为当前输出（out），× 删除',
        generatedVoicesEmpty: '暂无生成结果。执行本节点后会显示在这里',
        generatedVoicesDelete: '删除此声音',
        setAsOutput: '设为当前输出',
        selectedAsOutput: '当前输出'
      }
    }
  },
  draft: {
    error: {
      notFound: '草稿不存在或已保存'
    }
  }
} as const

/** English UI messages */
export default {
  common: {
    browse: 'Browse',
    cancel: 'Cancel',
    create: 'Create',
    back: 'Back',
    save: 'Save',
    saving: 'Saving…',
    delete: 'Delete',
    confirm: 'Confirm',
    tip: 'Notice',
    gotIt: 'Got it',
    search: 'Search…',
    all: 'All',
    none: 'None',
    unnamed: 'Untitled',
    pleaseSelect: 'Select…',
    model: 'Model',
    second: 's',
    open: 'Open',
    close: 'Close',
    done: 'Done'
  },
  characterRefs: {
    title: 'Character refs',
    importFromCatalog: 'Import from world catalog',
    collapse: 'Collapse',
    hint: 'Bind character reference images from the world catalog; they are injected during generation to keep the same character consistent across shots.',
    removeTitle: 'Remove',
    empty: 'No characters bound yet',
    loadingCatalog: 'Loading world characters…',
    catalogEmpty: 'No characters with generated images in the world catalog'
  },
  aiWorkflow: {
    title: 'One-Click Workflow',
    shortAction: 'One-Click Workflow',
    subtitle: 'Preview a template topology, or let AI customize, then create a reusable host asset',
    presetsLabel: 'Presets',
    textModelLabel: 'Text model (AI plan)',
    imageModelLabel: 'Default image model',
    videoModelLabel: 'Default video model',
    aspectRatioLabel: 'Aspect ratio',
    aspectRatioEmpty: 'Default (auto)',
    modelLabel: 'Text model',
    modelEmpty: 'Not configured',
    promptLabel: 'Workflow description',
    promptPlaceholder:
      'e.g. Create a game UA video workflow with script, key art, and video generation…',
    hint: 'Creates a host asset (drop onto a canvas and edit I/O). Preview first; selecting a preset previews it automatically, AI planning needs a text model. Ctrl/⌘ + Enter = AI preview.',
    previewLabel: 'Preview',
    previewMeta: '{nodes} nodes · {edges} edges',
    previewAi: 'AI preview',
    planning: 'Planning…',
    create: 'Create workflow',
    creating: 'Creating…',
    saveTitle: 'Save workflow',
    saveSubtitle: 'Choose a folder and enter a name',
    defaultName: 'One-Click Workflow',
    generate: 'Generate workflow',
    generating: 'Generating…',
    emptyPrompt: 'Enter a description or pick a preset first',
    needProject: 'Open a project first',
    needModel: 'Select an available text model first',
    needPresetForSeed: 'Pick a preset that has a fixed topology',
    needPreview: 'Generate a preview before creating',
    planFailed: 'Failed to plan workflow',
    failed: 'Failed to generate workflow',
    createdWithWarnings: 'Created (some nodes/edges were skipped)',
    planLog: {
      title: 'AI workflow preview',
      titlePreset: 'AI workflow preview · {name}',
      start: 'Start planning workflow',
      llmStart: 'Calling text model: {model} (attempt {n})',
      llmDone: 'Model reply received: {chars} chars ({model})',
      llmError: 'Model call failed: {error}',
      done: 'Plan ready: {nodes} nodes · {edges} edges',
      failed: 'Planning failed: {error}'
    },
    presets: {
      gameUaVideo: {
        title: 'Game UA',
        desc: 'Script → keyframes → video',
        prompt:
          'Create a game UA short-video workflow: text nodes for pitch and VO script, image nodes for character/scene keyframes, then image-to-video for a ~15s vertical ad. Wire nodes in a sensible chain and leave room for human edits.'
      },
      characterSheet: {
        title: 'Character sheet',
        desc: 'Bio + multi-angle art',
        prompt:
          'Create a character-sheet workflow: text for bio and look description, then image nodes for front/side/turnaround or expression variants, plus an upload node for style reference.'
      },
      storyboardVideo: {
        title: 'Storyboard to film',
        desc: 'Shots to video',
        prompt:
          'Create a storyboard-to-film workflow: start from a script or shot list, generate several storyboard frames, image-to-video for key shots, and a note node for edit order.'
      },
      productAd: {
        title: 'Product ad',
        desc: 'Copy + hero art + short video',
        prompt:
          'Create a product-ad workflow: text for selling points, image nodes for hero/product scenes, then a short video with product close-ups; include a product reference upload.'
      },
      gameUi: {
        title: 'Game UI screens',
        desc: 'System design → UI split → UI gen',
        prompt:
          'Create a game UI workflow: a system-plan node produces the game system design, a UI split node breaks it into per-screen image prompts (without concrete colors or art style), and a UI generation node (dive into its inner graph) renders each screen, with global style reference images unifying the UI look.'
      },
      ecomAdDeep: {
        title: 'E-commerce ads',
        desc: 'Hero image → ad variants → rework → review',
        prompt:
          'Create an e-commerce ad workflow: text for selling points, image nodes for the product hero and usage scene; an ad-variants node on the hero image produces multiple ad versions in batch; a media-rework node auto-retries failing images per review feedback; a media-review node outputs the final verdict; plus a layer-split node to break the hero image into layers for editing detail-page text.'
      },
      game3dAsset: {
        title: 'Game 3D assets',
        desc: 'Text-to-3D → director deck → shots → showcase video',
        prompt:
          'Create a game 3D asset workflow: text holds the asset design; two 3D-model nodes generate the hero and prop GLB models; a director-deck node takes the model and dive auto-instances it on stage, where primitives or an AI blockout flesh out the scene and cameras are staged; shots (out-shots) go through a select node, and image-to-video renders the showcase clip.'
      },
      comicPublish: {
        title: 'Comic publishing',
        desc: 'Script → 3 panels → comic page layout & export',
        prompt:
          'Create a comic publishing workflow: text holds a per-panel comic script, three image nodes generate consistent-style panels that all feed a comic-page node; double-click the comic page to lay out panels, add speech bubbles, adjust the page background, and export with transparent background.'
      },
      courseNarrate: {
        title: 'Knowledge talking-head',
        desc: 'Lecture script → voice + talking video → lip sync',
        prompt:
          'Create a knowledge-course talking-head workflow: text holds the lecture script, an image node generates the presenter look, a voice node narrates the script, and a video node turns the presenter image into a talking video; a lip-sync node takes the talking video plus the narration and outputs a lip-aligned clip.'
      },
      directorPreviz: {
        title: '3D blockout previz',
        desc: 'Panorama reference → AI blockout → shots lock framing',
        prompt:
          'Create a 3D blockout previz workflow: an image node generates a 360 panorama mood reference wired into the director deck panorama port, dive sets it as stage background; use Generate 3D Blockout with reference images plus a one-line instruction to build the scene from primitives, stage cameras and capture shots; a select node picks a shot and image-to-video renders the previz clip, with the text node supplementing the video prompt.'
      },
      shortDrama: {
        title: 'Short drama',
        desc: 'Script → beats → 9-grid → 4-grid → 36 motion videos (agent pipeline)',
        prompt:
          'Create a short-drama agent-pipeline workflow: a text node holds the episode script; storyboard-artist nodes produce the beat breakdown, 9-grid beat board, and 4-grid dynamic storyboard (9×4=36); an animator node produces the motion prompt table; 9 anchor-select nodes each feed one key storyboard image, 36 dynamic-cell select nodes each feed one image-to-video clip (parent anchor image as first frame); after each stage a director-review node outputs PASS/FAIL, and failures are written to agent-state.json and appended on rerun.'
      },
      shortDrama9: {
        title: 'Short drama · 9 direct',
        desc: 'Script → beats → 9-grid → animator 9 motion prompts → 9 videos',
        prompt:
          'Create a short-drama agent-pipeline workflow that skips 4-grid expansion: a text node holds the episode script; storyboard-artist nodes produce the beat breakdown and 9-grid beat board; one 9-grid canvas is split into 9 anchor images; an animator node decomposes one motion prompt for each of the 9 cells, and each motion prompt drives one image-to-video clip together with its anchor image (9 clips total); director-review nodes after the beat breakdown and 9-grid board output PASS/FAIL, with failures written to agent-state.json and appended on rerun.'
      },
      custom: {
        title: 'Custom',
        desc: 'Clear and write your own',
        prompt: ''
      }
    }
  },
  app: {
    nav: {
      studio: 'Studio',
      settings: 'Settings'
    },
    menu: {
      openAria: 'Project menu: new, open, and recent projects',
      recentEmpty: 'No recent projects',
      closeProject: 'Close Project'
    }
  },
  home: {
    tagline: 'AI creation tool',
    createProject: 'New Project',
    openProject: 'Open Project',
    recentProjects: 'Recent Projects',
    removeRecent: 'Remove from recent list',
    apiUnavailable:
      'App API unavailable: quit all Electron windows and run npm run dev again (do not open localhost in a browser)',
    dialog: {
      title: 'New Project',
      projectName: 'Project name',
      storageDir: 'Storage folder',
      selectDirPlaceholder: 'Choose a folder…'
    }
  },
  settings: {
    title: 'Settings',
    hint: 'Models and API keys are global across all projects. Changes save automatically.',
    section: {
      general: 'General',
      models: 'Models',
      objectStorage: 'Object storage',
      mcp: 'MCP',
      skills: 'Custom skills',
      plugins: 'Extensions'
    },
    theme: 'Theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    language: 'Language',
    languageZh: '中文',
    languageEn: 'English',
    autoSave: {
      enabled: 'Enable autosave',
      interval: 'Autosave interval'
    },
    about: {
      title: 'About & updates',
      version: 'Current version',
      checkUpdate: 'Check for updates',
      installUpdate: 'Restart and install',
      checking: 'Checking for updates…',
      available: 'Update {version} available, downloading…',
      notAvailable: 'You are up to date',
      progress: 'Downloading {percent}%',
      downloaded: 'Update {version} ready — restart to install',
      error: 'Update failed: {message}',
      disabled: 'Updates are disabled in development',
      idle: 'Check GitHub Releases for a newer build'
    },
    mcp: {
      title: 'MCP access',
      status: 'Status',
      running: 'Running · port {port}',
      notRunning: 'MCP tool service is not running. Set a port and start it.',
      endpoint: 'Endpoint',
      token: 'Token',
      port: 'Listen port',
      portHint: 'Port changes take effect after restart. If AIAE_MCP_PORT was set at launch, it takes precedence.',
      start: 'Start MCP service',
      restart: 'Restart MCP service',
      restarting: 'Restarting…',
      restarted: 'MCP service restarted',
      resetToken: 'Reset token',
      tokenReset: 'Token reset — the old token is invalid immediately. Update your connected clients.',
      editToken: 'Edit',
      tokenPlaceholder: 'Enter a new token (8–128 chars, no spaces)',
      saveToken: 'Save token',
      cancelEdit: 'Cancel',
      tokenInvalid: 'Token must be 8–128 characters with no spaces',
      tokenSaved: 'Token updated — update the token in connected clients',
      show: 'Show',
      hide: 'Hide',
      copy: 'Copy',
      copied: 'Copied to clipboard',
      command: 'Claude Code command',
      hint: 'The token is reused across restarts (reset it above). Treat it as full access to the local MCP service — do not share it.'
    },
    skills: {
      hint: 'The AI chat agent discovers skills through dsh\'s skill system: drop a .md file in dsh SKILL.md format (frontmatter name / description + body) into the folder below and it takes effect on the next chat. Built-in skills are managed automatically — please don\'t edit them.',
      dirPath: 'Skills directory',
      builtinCount: '{count} built-in skills (managed automatically)',
      kind: {
        builtin: 'Built-in',
        custom: 'Custom',
        template: 'Template'
      },
      openDir: 'Open folder',
      writeTemplate: 'Create sample template',
      templateWritten: 'Sample template created: {file}',
      templateSkipped: 'Sample template already exists (not overwritten): {file}',
      empty: 'The folder is empty. Click "Create sample template" to get a ready-to-use template.',
      templateLibrary: 'Skill template library',
      templateEmpty: 'No templates available',
      exportTemplate: 'Export template',
      templateExported: 'Template exported: {file}',
      templateExportedSkipped: 'Template already exists (not overwritten): {file}',
      importToGraph: 'Import as app skills',
      imported: 'Imported {count} custom skill(s): {names}',
      importSkipped: 'Import failed: {names}',
      importEmpty: 'No custom skills in the skills folder to import'
    },
    models: {
      addProvider: 'Add model provider',
      providerCustom: 'Custom',
      add: 'Add',
      addedProvider: 'Added {label}. Fill in Base URL / API key, then click Fetch models.',
      collapseProvider: 'Collapse provider',
      expandProvider: 'Expand provider',
      emptyProviders:
        'No providers yet. Add OpenRouter, OpenAI, DeepSeek, Zhipu, Kimi (Moonshot), xAI (Grok), Google (Gemini), vLLM, Ollama, LM Studio, Volcengine Ark, Kling, MiniMax, Tongyi Qianwen, ModelScope, ComfyUI, MagicRouter, or a custom provider (pick an endpoint type, then enter Base URL / API key). Local servers need no API key; cloud providers need credentials, then select models per modality.',
      unifiedHint:
        'One credential set / Base URL per provider. Fetch text, image, video, and audio models. Ark Voice uses purchased speaker_ids; Kling, MiniMax, and Qianwen use an API Key; ModelScope uses an access token (text/image). OpenAI official supports text and image only and requires network access to api.openai.com. DeepSeek supports text only. Zhipu supports GLM text and CogView image. Kimi (Moonshot) supports text only. xAI (Grok) supports text, image, and video. Google (Gemini) supports text only. vLLM / Ollama / LM Studio are local OpenAI-compatible servers and need no API key. ComfyUI uses API v2 (local :8189 or a cloud Base URL) for image / video / audio; local can omit the key. MagicRouter is a multi-provider aggregator (OpenAI-compatible) for text / image / video, using an mr- API key.',
      enabled: 'Enabled',
      remove: 'Remove',
      label: 'Display name',
      baseUrl: 'API Base URL',
      customApiStyle: 'Endpoint type',
      customApiStyleOptions: {
        openai: 'OpenAI compatible',
        anthropic: 'Anthropic',
        gemini: 'Gemini'
      },
      customApiStyleHint:
        'Endpoint type: {style}. OpenAI compatible covers most relay services / one-api / vLLM; Gemini uses Google\'s official OpenAI-compatible layer and most Gemini gateways; Anthropic uses the Messages API (x-api-key auth).',
      customBaseUrlPlaceholder:
        'e.g. https://api.openai.com/v1, https://generativelanguage.googleapis.com/v1beta/openai, or https://api.anthropic.com',
      nativeBaseUrl: 'ComfyUI native URL',
      nativeBaseUrlPlaceholder: 'http://127.0.0.1:8188',
      nativeBaseUrlHint:
        'The running ComfyUI, e.g. http://127.0.0.1:8190. Workflows are read only from this URL; 8188 is not tried once this is set. Base URL above stays comfy-api-proxy (default 8189). Video jobs also go through the proxy — after changing the ComfyUI port, restart the proxy with --comfyui pointing at the same address. Leave empty to try 8188.',
      showApiKey: 'Show API key',
      hideApiKey: 'Hide API key',
      credentialsHint: {
        openrouter: 'Get API key:',
        openai: 'Get OpenAI API key:',
        deepseek: 'Get DeepSeek API key:',
        zhipu: 'Get Zhipu API key:',
        moonshot: 'Get Kimi (Moonshot) API key:',
        xai: 'Get xAI API key:',
        google: 'Get Google AI Studio API key:',
        vllm: 'Local server, no API key needed; vLLM docs:',
        ollama: 'Local server, no API key needed; Ollama site:',
        lmstudio: 'Local server, no API key needed; LM Studio site:',
        'volcengine-ark': 'Get Ark API key (text / image / video):',
        kling: 'Get API key:',
        meshy: 'Get Meshy API key:',
        minimax: 'Get API key:',
        dashscope: 'Get Bailian API key:',
        modelscope: 'Get access token:',
        comfyui: 'Local can omit the key; cloud API key:',
        magicrouter: 'Get MagicRouter API key (starts with mr-):',
        tripo: 'Get Tripo API key:',
        hyper3d: 'Get Rodin (Hyper3D) API key:',
        luma: 'Get Luma AI API key:',
        lux3d: 'Get Lux3D API key:',
        custom:
          'Custom provider: pick an endpoint type, then enter the endpoint Base URL and API key to fetch the model list; there is no single signup page.'
      },
      arkVoiceCredentialsHint:
        'Voice design uses Doubao openspeech — use the speech console API key (may differ from Ark) and enter a purchased speaker_id:',
      fetchModels: 'Fetch models',
      preloadListModelsUnavailable:
        'window.studio.listModels is unavailable: fully exit and re-run npm run dev (preload changes are not hot-reloaded)',
      capFirstFrame: 'First frame',
      capLastFrame: 'Last frame',
      testingConnection: 'Verifying API key…',
      loading: 'Loading…',
      catalogCount: '{n} models',
      selectAll: 'Select all visible',
      clearSelection: 'Clear selection',
      filterPlaceholder: 'Filter by id / name',
      defaultModel: 'Default model',
      selectedCount: '{n} models selected',
      manualModelPlaceholder: 'Enter model / endpoint / Resource ID manually',
      manualModelAdd: 'Add & select',
      manualSpeakerPlaceholder: 'Enter purchased speaker_id (e.g. S_xxx)',
      manualSpeakerAdd: 'Add & select',
      emptyCatalog: 'Catalog is empty. Enter a model ID manually, or check the provider and API key.',
      emptyRemoteKeepPrevious: 'Remote returned an empty list; kept the previous catalog. Try again later.',
      filterNoMatch: 'No models match this filter. Clear the filter and try again.',
      clearFilter: 'Clear filter',
      emptySpeakers: 'No speakers yet. Enter a purchased speaker_id and select it.',
      filterSpeakerPlaceholder: 'Filter speaker_id',
      defaultSpeaker: 'Default speaker',
      selectedSpeakerCount: '{n} speakers selected',
      modality: {
        text: 'Text',
        image: 'Image',
        video: 'Video',
        audio: 'Voice',
        model3d: '3D Model'
      },
      modalityHint: {
        text: 'Script and chat generation via OpenRouter /api/v1/models.',
        image: 'Image generation via /api/v1/images/models.',
        video: 'Shot video generation via /api/v1/videos/models.',
        audio: 'TTS via /api/v1/models?output_modalities=speech and /api/v1/audio/speech.',
        model3d: '3D model generation from text and/or reference images, producing GLB assets.'
      },
      arkModalityHint: {
        text: 'Volcengine Ark chat models (Doubao, etc.). Default Base URL https://ark.cn-beijing.volces.com/api/v3 via /chat/completions.',
        image: 'Seedream image models via /images/generations. Catalog filtered by endpoint name heuristics.',
        video: 'Seedance video models via /contents/generations/tasks. Reference media must be publicly reachable (TOS helps).',
        audio:
          'Doubao openspeech voice design (X-Api-Key). No model fetch — use the speech console API key above and enter a purchased speaker_id (e.g. S_xxx). Node instruction is used as the design prompt.'
      },
      klingModalityHint: {
        image:
          'Kling image generation via /v1/images/generations. Requires an API Key; catalog is a local static list.',
        video:
          'Kling video: text-to-video (/v1/videos/text2video) without a first frame, or image-to-video (/v1/videos/image2video) with one. Default Base URL is api-beijing.klingai.com.'
      },
      minimaxModalityHint: {
        text: 'MiniMax chat via OpenAI-compatible /v1/chat/completions. Default Base URL is api.minimaxi.com (omit /v1; the client appends it).',
        image:
          'MiniMax text-to-image / subject-reference image-to-image via /v1/image_generation (image-01 / image-01-live).',
        video:
          'MiniMax video: H3 uses V2 (POST /v2/video_generation, multimodal content, 2K, 4–15s); Hailuo 2.3/02 still use V1. Default Base URL is api.minimaxi.com; video catalog is a local static list.',
        audio:
          'MiniMax voice design via POST /v1/voice_design. Node instruction is the voice prompt; returns voice_id and preview audio. Catalog lists a local Voice Design entry.'
      },
      dashscopeModalityHint: {
        text: 'Qwen chat via OpenAI-compatible API. Default Base URL is dashscope.aliyuncs.com/compatible-mode/v1 (/chat/completions).',
        image:
          'Wanxiang text-to-image via async /api/v1/services/aigc/text2image/image-synthesis (native URL derived from the compatible Base URL).',
        video:
          'Wanxiang text/image-to-video via async /api/v1/services/aigc/video-generation/video-synthesis; with a first frame, img_url is sent — pick an i2v model.',
        audio:
          'Bailian Fun-Music generation via /api/v1/services/audio/music/generation (Beijing region only). fun-music-v1 / fun-music-preview are invite-only; request access in the Bailian Model Studio.'
      },
      modelscopeModalityHint: {
        text: 'ModelScope API-Inference chat. Default Base URL is api-inference.modelscope.cn/v1; use an access token (ms-…).',
        image: 'ModelScope text-to-image via /v1/images/generations; model ids look like org/model_name.'
      },
      openaiModalityHint: {
        text: 'OpenAI official chat models (GPT family). Default Base URL is api.openai.com/v1 via /chat/completions; the text catalog is fetched from GET /models.',
        image:
          'OpenAI image models (gpt-image-1 / gpt-image-2). Text-to-image via /images/generations; reference-image edits via /images/edits (max 1). Fixed sizes: 1024x1024 / 1536x1024 / 1024x1536 / auto.'
      },
      deepseekModalityHint: {
        text: 'DeepSeek chat models (deepseek-chat / deepseek-reasoner), OpenAI-compatible. Default Base URL is api.deepseek.com via /chat/completions; the text catalog is fetched from GET /models.'
      },
      moonshotModalityHint: {
        text: 'Kimi chat models (kimi-k2 family / moonshot-v1 family), OpenAI-compatible. Default Base URL is api.moonshot.cn/v1 via /chat/completions; the text catalog is fetched from GET /models.'
      },
      xaiModalityHint: {
        text: 'xAI (Grok) chat models (grok-* family), OpenAI-compatible. Default Base URL is api.x.ai/v1 via /chat/completions; the text catalog is fetched from GET /models.',
        image:
          'Grok Imagine text-to-image (grok-imagine-image / grok-imagine-image-pro) via JSON /images/generations with aspect_ratio and response_format (base64 is returned, so saved assets are not affected by URL expiry).',
        video:
          'Grok Imagine Video (grok-imagine-video): submit async to /videos/generations, poll GET /videos/{request_id}, download video.url when status=done; supports 480p / 720p, 5-15 seconds, and first-frame image-to-video via the image field.'
      },
      googleModalityHint: {
        text: 'Google Gemini chat (gemini-* family) via the official OpenAI-compatible layer. Default Base URL is generativelanguage.googleapis.com/v1beta/openai via /chat/completions; the text catalog is fetched from GET /models.',
        image:
          'Nano Banana family text-to-image / image editing (gemini-2.5-flash-image, gemini-3-pro-image, gemini-3.1-flash-image, etc.) via JSON /images/generations with aspect_ratio, resolution, n and response_format (base64 is returned, so saved assets are not affected by URL expiry). Reference images are passed in the image field (up to 14 on gemini-3-pro-image).',
        video:
          'Veo 3.1 video generation (veo-3.1-generate / fast / lite): submit asynchronously to /videos, poll GET /videos/{id} with OpenAI-style video jobs, then take video_url / output.url when status=completed; supports 720p-4K, 4-8 seconds, and first-frame image-to-video via the image field.'
      },
      zhipuModalityHint: {
        text: 'Zhipu GLM chat (OpenAI-compatible). Default Base URL is open.bigmodel.cn/api/paas/v4 via /chat/completions.',
        image:
          'Zhipu CogView text-to-image (glm-image / cogview-4 / cogview-3-flash) via /images/generations; text-to-image only, no reference images.'
      },
      comfyuiModalityHint: {
        image:
          'ComfyUI API v2 image jobs via POST /api/v2/jobs. Model id = API-format workflow name in userdata (e.g. txt2img). Local default is http://127.0.0.1:8189 (comfy-api-proxy); cloud is https://cloud.comfy.org plus an API key.',
        video:
          'ComfyUI API v2 video uses the same /api/v2/jobs poll. Use txt2vid / img2vid API-format workflows; a first frame is written into LoadImage.',
        audio:
          'ComfyUI API v2 audio uses the same /api/v2/jobs path and collects type=audio outputs. Use a txt2audio API-format workflow.'
      },
      magicrouterModalityHint: {
        text:
          'MagicRouter multi-provider aggregator (OpenAI-compatible). Default Base URL is api.magicrouter.ai/v1 via /chat/completions; the catalog is fetched from /models/live.',
        image:
          'MagicRouter text-to-image / image editing via /images/generations (reference images use the image / images fields); the catalog is fetched from /models/live.',
        video:
          'MagicRouter video (happyhorse / wan2.7): async POST /videos/generations, poll GET /videos/generations/{id}; supports t2v / i2v / r2v / videoedit.'
      },
      localModalityHint: {
        text: 'Local OpenAI-compatible servers (vLLM / Ollama / LM Studio): no API key needed. Chat via /chat/completions; the model catalog is fetched from /models. Multimodal understanding works by passing images into a text node.',
        video:
          'vLLM-Omni video generation (Wan T2V / I2V diffusion models): async jobs via /v1/videos, download the result when completed; supports first-frame image-to-video and reference video/audio. Ollama / LM Studio do not support video.'
      },
      customModalityHint: {
        text: 'Text chat goes through /chat/completions (OpenAI compatible / Gemini) or /v1/messages (Anthropic); multimodal understanding works by passing images into a text node. OpenAI-compatible / Gemini endpoints also support image generation — see the Image tab.',
        image:
          'Image generation uses the OpenAI-compatible /images/generations endpoint (e.g. gpt-image-1 / dall-e-3 / FLUX); reference images go through /images/edits. The catalog does not auto-detect image models — add the image model id below and select it.'
      }
    },
    objectStorage: {
      hint: 'Configure object storage for media upload and public access. Supports Volcengine TOS, Alibaba Cloud OSS, and Tencent Cloud COS.',
      singleEnabledHint: 'Only one object storage provider can be enabled at a time; enabling one turns the others off.',
      addProvider: 'Add object storage',
      add: 'Add',
      collapseProvider: 'Collapse provider',
      expandProvider: 'Expand provider',
      emptyProviders:
        'No providers yet. Add Volcengine TOS / Alibaba Cloud OSS / Tencent Cloud COS, then enter credentials and bucket details.',
      enabled: 'Enabled',
      remove: 'Remove',
      label: 'Display name',
      showSecret: 'Show secret',
      hideSecret: 'Hide secret',
      tos: {
        intro:
          'Fields match the official TOS SDK: AccessKey, SecretKey, Region, Endpoint; Bucket is the default read/write bucket.',
        region: 'Region',
        customRegion: 'Custom region',
        endpoint: 'Endpoint',
        getCredentialsHint: 'Get Access Key and credentials:',
        bucket: 'Bucket name',
        publicBaseUrl: 'Public base URL (optional)',
        publicBaseUrlPlaceholder: 'e.g. https://cdn.example.com or a custom domain'
      },
      oss: {
        intro:
          'Fields for Alibaba Cloud OSS: AccessKey, Region, Endpoint, Bucket. Without a public base URL, signed URLs (~24h) are used.',
        region: 'Region',
        customRegion: 'Custom region',
        endpoint: 'Endpoint',
        getCredentialsHint: 'Get AccessKey:',
        bucket: 'Bucket name',
        publicBaseUrl: 'Public base URL (optional)',
        publicBaseUrlPlaceholder: 'e.g. https://cdn.example.com or a bound custom domain'
      },
      cos: {
        intro:
          'Fields for Tencent Cloud COS: SecretId, SecretKey, Region, Bucket (usually BucketName-APPID). Without a public base URL, signed URLs are used.',
        region: 'Region',
        customRegion: 'Custom region',
        getCredentialsHint: 'Get API keys:',
        bucket: 'Bucket name',
        bucketPlaceholder: 'e.g. example-1250000000',
        publicBaseUrl: 'Public base URL (optional)',
        publicBaseUrlPlaceholder: 'e.g. https://cdn.example.com or the default CDN domain'
      }
    },
    plugins: {
      hint: 'The editor runtime is Cordis. Controlled declarative extensions in the user-data plugins folder contribute toolbar items only; external scripts are not executed.',
      declarative: 'Declarative',
      empty: 'No extensions found'
    },
    saved: 'Saved automatically',
    saving: 'Saving…'
  },
  studio: {
    noProject: 'No project open',
    backHome: 'Back to home',
    toolbar: {
      hint: 'Drag tabs to dock / right-click to float or detach · Unsaved * · Ctrl+S to save',
      undo: 'Undo (Ctrl+Z)',
      redo: 'Redo (Ctrl+Shift+Z)',
      tasks: 'Tasks',
      tasksAria: 'Open task list',
      logs: 'Run log',
      logsAria: 'Open node execution log'
    },
    layout: {
      select: 'Layout',
      menu: 'Layout',
      menuAria: 'Window layout',
      default: 'Default',
      save: 'Save Layout',
      export: 'Export',
      import: 'Import',
      fromFile: 'Load Layout from File…',
      toFile: 'Save Layout to File…',
      delete: 'Delete Layout',
      deleteConfirmTitle: 'Delete layout',
      deleteConfirm: 'Delete layout "{name}"?',
      saveTitle: 'Save layout',
      saveHint: 'Name the current window layout. Matching names will be overwritten.',
      name: 'Layout name',
      namePlaceholder: 'e.g. Wide assets',
      newName: 'My layout',
      invalid: 'Current layout is invalid and cannot be saved',
      invalidFile: 'Unrecognized layout file'
    },
    panel: {
      workspace: 'Workspace',
      tools: 'Tools',
      assets: 'Assets',
      inspector: 'Inspector',
      chat: 'AI Chat',
      collapse: 'Collapse to the right',
      expand: 'Expand'
    },
    inspector: {
      unsupported: 'No inspector is available for the selected object',
      emptyGlobals: 'No global parameters',
      multiAssets: '{count} assets selected'
    },
    chat: {
      empty: 'Describe a task to DeepSeek Harness; it can call this app\u2019s generation tools (image / video / voice / 3D) over MCP.',
      placeholder: "Type a task. Enter to send, Shift+Enter for a new line; {'@'} references assets, paste screenshots/images",
      send: 'Send',
      stop: 'Stop',
      ready: 'Ready',
      checking: 'Checking…',
      unavailable: 'Unavailable',
      toolRunning: 'Running',
      toolDone: 'Done',
      toolFailed: 'Failed',
      taskList: 'Tasks',
      model: 'Model',
      noModel: 'No text model configured',
      modeTitle: 'Agent mode: Craft (act) / Ask (chat) / Plan (plan first, then execute)',
      modeCraft: 'Craft',
      modeAsk: 'Ask',
      modePlan: 'Plan',
      skills: 'Skills',
      skillsTitle: 'Skills available in this session (built-in snapshot + custom); marked as loaded when the model calls the skill tool',
      skillsMeta: 'Loaded {loaded}/{total}',
      skillsEmpty: 'No skills available',
      promptContinue: 'Continue',
      promptCancel: 'Cancel',
      promptAnswered: 'Chosen: {answer}',
      thinking: 'Thinking',
      copy: 'Copy',
      copied: 'Copied',
      copyTitle: 'Copy full content',
      scrollToBottom: 'Scroll to bottom',
      sessionSelect: 'Chat sessions',
      newChat: 'New chat',
      newSession: 'New',
      deleteSession: 'Delete',
      deleteConfirm: 'Delete this session? Its history will be removed and cannot be restored.',
      // Note: vue-i18n parses a leading @ in a message as linked format; escape it with {'@'}
      // Button shows only @, full label lives in title (mentionTitle)
      mentionButton: "{'@'}",
      mentionTitle: 'Reference assets',
      mentionSubtitle: 'Pick images / videos / audio to reference for the model',
      mentionHint: 'Click cards to select (multiple allowed)',
      mentionPicked: '{n} assets selected',
      mentionEmpty: 'No referenceable assets in the project yet; import images / videos / audio first',
      mentionNoMatch: 'No matching assets',
      mentionTypeAll: 'All',
      mentionTypeImage: 'Image',
      mentionTypeVideo: 'Video',
      mentionTypeAudio: 'Audio',
      mentionTypeFile: 'File',
      removeMention: 'Remove reference',
      saveToLibrary: 'Save to asset library',
      saveToLibraryTitle: 'Save generated result to asset library',
      saveToLibrarySubtitle: 'Choose a target folder and file name',
      savedToLibrary: 'Saved',
      close: 'Close',
      cancel: 'Cancel',
      forwardTitle: 'Forward to another Agent',
      forwardTo: 'Target Agent',
      forwardLive: 'Auto-forward: send this Agent\u2019s final result to the target automatically after each task',
      forwardText: 'Content to forward',
      forwardInstruction: 'Extra instruction (optional): prepended to each forwarded result',
      forwardInstructionHint: 'e.g. Execute based on the plan below. Leave empty to forward the result as-is',
      forwardFile: 'Attach workspace file (optional)',
      forwardFilePlaceholder: 'Path relative to project root, e.g. Cache/Images/xxx.png',
      forwardSend: 'Forward & run on target',
      forwardSetup: 'Set up auto-forward',
      forwardBusy: 'This agent is already running a task'
    },
    agents: {
      running: 'Running',
      addTitle: 'New Agent',
      newTitle: 'New Agent',
      newName: 'Agent name',
      newNamePlaceholder: 'e.g. Storyboarder',
      newPrompt: 'Role description (optional)',
      newPromptPlaceholder: 'Describe what this agent does…',
      removeTitle: 'Delete this agent',
      removeMessage: 'Delete agent "{name}"? Its chat history will also be removed.',
      removeConfirm: 'Delete',
      pipes: 'Auto-forward pipelines',
      pipeCancelTitle: 'Cancel this pipeline'
    },
    orchestrator: {
      tab: 'Orchestrator',
      title: 'Multi-Agent Orchestrator',
      subtitle:
        'Split a goal into role + task nodes. Nodes whose dependencies are ready run in parallel (same agent queued); each one receives the goal and the outputs of earlier nodes, retrying once on failure.',
      newJob: 'New orchestration',
      jobTitle: 'Job title (optional)',
      jobTitlePlaceholder: 'e.g. Script → storyboard → per-shot art',
      goal: 'Goal',
      goalPlaceholder:
        'Describe in one sentence what this collaboration should deliver, e.g. write the storyboard for episode 1 of "City Night Run" and generate matching art for each shot…',
      nodesHint: 'Nodes whose dependencies are ready run in parallel (same agent queued); a failed node is retried once',
      addNode: '+ Add node',
      removeNode: 'Remove node',
      nodeId: 'Node id',
      nodeAgent: 'Agent',
      nodeInstruction: 'Instructions',
      nodeInstructionPlaceholder:
        'Tell this agent what to do and what to produce, e.g. expand the storyboard above into drawing prompts (keep character design and global params consistent)',
      nodeDeps: 'Depends on',
      nodeDepsHint: 'Check nodes that must finish first; leave empty to run early',
      run: 'Start',
      submitting: 'Submitting…',
      clear: 'Clear form',
      noGoal: 'Please enter a goal first',
      noAgent: 'No orchestration-ready agents (need at least one non-default role; create one in the tab bar above)',
      nodeLimit: 'At most {max} nodes',
      runError: 'Failed to start orchestration',
      runningBadge: '{n} orchestration running',
      jobs: 'Jobs',
      jobsEmpty: 'No orchestration jobs yet. Define a goal and nodes above, then press Start.',
      noTitle: '(untitled job)',
      abortJob: 'Abort this job',
      abortJobConfirm: 'Abort this orchestration job? Results already produced are kept.',
      copy: 'Copy',
      copied: 'Copied',
      copySummary: 'Copy summary',
      summary: 'Final summary',
      noSummary: '(no summary produced)',
      nodeOutput: 'Output',
      nodeError: 'Error',
      stateRunning: 'Running',
      stateDone: 'Done',
      stateFailed: 'Failed',
      stateAborted: 'Aborted',
      stateSkipped: 'Skipped',
      statePending: 'Queued',
      depOf: 'depends on',
      error: 'Error',
      time: 'Time',
      goalShort: 'Goal',
      autoPlan: 'Auto-plan',
      autoPlanHint: 'Let the planner agent split the goal into editable nodes',
      planning: 'Planner agent is decomposing…',
      planReplaceTitle: 'Replace existing nodes',
      planReplaceMessage: 'Replace the {n} manually added nodes with the AI plan?',
      planSuccess: 'Filled in {n} nodes from the plan; tweak and start',
      noGoalPlan: 'Enter a goal first to auto-plan',
      planFailed: 'Auto-plan failed',
      viewFlow: 'List',
      viewGraph: 'Graph',
      graphSelectHint: 'Click a node to inspect its instructions & output',
      graphEmpty: '(no nodes)'
    },
    editor: {
      asset: 'Asset Editor',
      screenplay: 'Screenplay',
      script: 'Shot',
      canvas: 'Series',
      world: 'World Elements',
      beat: 'Beat Units',
      director: 'Director Deck'
    },
    dive: {
      up: 'Up',
      root: 'Series',
      sep: '/',
      toolMissing: 'Tool unavailable'
    },
    window: {
      detach: 'Pop out to its own window (or drag it outside the main window)',
      dock: 'Dock back to main window'
    },
    tabMenu: {
      float: 'Float window',
      detach: 'Detach to new window',
      close: 'Close',
      closeOthers: 'Close others',
      closeLeft: 'Close to the left',
      closeRight: 'Close to the right',
      closeAll: 'Close all',
      resetAll: 'Restore default layout',
      waitNodeRun: 'Please wait until the node finishes running before closing'
    }
  },
  workspace: {
    empty: {
      title: 'Workspace',
      hint: 'Start a writing flow here, or use the left icons / double-click an asset to open.',
      pipeline: 'Suggested flow: Screenplay → Storyboard → Node generation',
      createTitle: 'Quick create',
      recentTitle: 'Recent assets',
      recentEmpty: 'No assets yet — create one to get started'
    }
  },
  dialog: {
    saveAsset: {
      title: 'Save Asset',
      subtitle: 'Choose a folder and file name (Ctrl+S)',
      fileName: 'File name',
      folder: 'Save to'
    }
  },
  validation: {
    nameRequired: 'Name cannot be empty'
  },
  project: {
    globals: {
      type: 'Project',
      title: 'Global parameters',
      name: 'Project name',
      stylePreset: 'Visual style',
      stylePresetPlaceholder: 'Art style, palette, materials, camera mood…',
      styleImagesHint:
        'Up to 4 style references (count toward image input slots) — library or upload',
      generateSeed: 'Global seed',
      generateSeedPlaceholder: 'Empty = random',
      generateSeedRandom: 'Random',
      generateSeedHint:
        'Image/video generation nodes use this seed by default (nodes can opt out); fixed seed reproduces same prompt + references',
      cacheOutputDir: 'Generation cache root',
      cacheOutputDirHint:
        'Relative to project root; outputs default to Cache/Images, Cache/Videos, Cache/Texts, Cache/Voices and are not auto-registered in the asset library',
      empty: 'No project open'
    }
  },
  stylePicker: {
    label: 'Visual style',
    hint: 'Up to {max} style refs (count toward image input slots)',
    readonlyHint: 'Following project global style — not editable here',
    useGlobal: 'Use global style',
    useGlobalHint: 'When on, matches project globals (read-only); when off, configure this node',
    add: 'Add style',
    remove: 'Remove',
    weight: 'Strength',
    fromLibrary: 'Pick from library',
    upload: 'Upload image',
    libraryTitle: 'Style library',
    librarySubtitle: 'You can still pick {max} more',
    libraryPicked: 'Selected {n} / {max}',
    categoryCharacter: 'Character',
    categoryScene: 'Scene',
    categoryProp: 'Props',
    categoryWeapon: 'Weapons',
    categoryUi: 'UI style',
    alreadySelected: 'In use',
    maxReached: 'You can add at most {max} style images',
    truncated: 'Limit reached — added {n} of the selected files (max {max})',
    customName: 'Custom style',
    readFailed: 'Failed to read image',
    onlyImage: 'Only image assets can be dropped'
  },
  asset: {
    type: {
      image: 'Image',
      video: 'Video',
      voice: 'Voice',
      imageRef: 'Image Reference',
      videoRef: 'Video Reference',
      voiceRef: 'Voice Reference',
      screenplayRef: 'Screenplay Reference',
      motion: 'Director Deck',
      model: 'Model',
      modelAnimation: 'Animation Clip',
      modelPose: 'Pose',
      screenplay: 'Screenplay',
      script: 'Shot',
      canvas: 'Series',
      freeCanvas: 'Free Canvas',
      world: 'World Elements',
      beat: 'Beat Units',
      subgraph: 'Host Asset',
      model3d: '3D Model'
    },
    create: {
      image: 'New Image',
      video: 'New Video',
      voice: 'New Voice',
      motion: 'New Director Deck',
      model: 'New Model',
      screenplay: 'New Screenplay',
      script: 'New Shot',
      freeCanvas: 'New Free Canvas',
      world: 'New World Elements',
      beat: 'New Beat Units',
      subgraph: 'New Host Asset',
      model3d: 'New 3D Model',
      default: 'New Asset',
      freeCanvasNameTitle: 'New Free Canvas',
      freeCanvasNameMessage:
        'Enter a canvas name. Creates a blank node graph where you can freely add nodes and assets.',
      freeCanvasNamePlaceholder: 'Canvas name',
      nameMessage: 'Enter a name for the new asset.',
      namePlaceholder: 'Asset name'
    },
    generic: 'Asset',
    deleted: '(deleted)',
    open: 'Open asset',
    import: {
      extensionsLabel: 'Images · Videos · Voice · Models',
      needProject: 'Open a project first',
      noneImported: 'No files were imported',
      partial: 'Imported {ok} file(s), skipped {skip}',
      dropPathFailed: 'Could not read dropped file paths. Try Import instead.'
    },
    browser: {
      title: 'Assets',
      refreshHint: 'Drop files to import · refresh to sync disk',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      refreshTitle: 'Rescan project assets and folders',
      importHint: 'Drop files to import',
      screenplayMissingFile: 'This screenplay has no text file and cannot open in Notepad',
      import: 'Import',
      importFiles: 'Import files',
      exportPackage: 'Export package',
      exportPackageTitle: 'Export selected assets or current folder as .aipackage',
      importPackage: 'Import package',
      importPackageTitle: 'Import a .aipackage into the current folder',
      packageNeedSelection: 'Select assets first, or open the folder to export',
      packageSkipped: '{count} item(s) skipped (unsupported type, draft, etc.)',
      packageExportDone:
        'Exported {assets} asset(s), {folders} folder(s), {generated} generated file(s)\n{path}',
      packageImportDone:
        'Imported {assets} asset(s) (folders: new {folders}, reused {folderReuse}); entry reuse {reused}; remapped {remapped}; restored generated {generated}',
      reimportNone: 'No media assets to reimport',
      reimportPartial: 'Reimported {ok} item(s), skipped {skip}',
      viewList: 'List',
      viewIcon: 'Icons',
      folder: 'Folder',
      assetsRoot: 'Assets',
      resizeFolderPane: 'Drag to resize folder pane',
      viewSizeHint: 'Display size (minimum shows names only)',
      dropHint: 'Drop images, videos, voice, or .aipackage files here to import',
      searchEmpty: 'No matching assets or folders',
      clearSearch: 'Clear search',
      dropRelease: 'Release to import',
      context: {
        openEditor: 'Open editor',
        showInFolder: 'Open in folder',
        copyOriginal: 'Copy original files',
        reimport: 'Reimport',
        rename: 'Rename',
        findReferences: 'Find references',
        delete: 'Delete',
        deleteSelected: 'Delete {count} items'
      },
      referencesTitle: 'Asset references',
      referencesNone: 'No references found.',
      referencesSummary: '{count} reference(s) to the target asset(s):',
      referencesAsset: 'Asset "{name}"',
      referencesMore: '…and {count} more',
      deleteConfirmTitle: 'Delete assets',
      deleteConfirm: 'Delete "{name}"?',
      deleteConfirmMany: 'Delete {count} selected assets?',
      deleteReferencedConfirm: 'Deleting will leave broken references. Delete anyway?',
      selectedCount: '{count} selected',
      refMark: 'Ref'
    },
    package: {
      exportTitle: 'Export package',
      exportSubtitle: 'Select folders and assets to export (Unity-style)',
      importTitle: 'Import package',
      importSubtitle: 'Select items to import (Unity-style)',
      selectAll: 'Select all',
      selectNone: 'Select none',
      includeDependencies: 'Include dependencies',
      includeGeneratedOutputs: 'Include generated outputs',
      includeGeneratedOutputsHint:
        'Also pack Cache/Output files referenced by canvases or scripts (may increase size)',
      selectedCount: '{count} selected',
      emptyTree: 'Nothing to show',
      exportConfirm: 'Export',
      importConfirm: 'Import',
      oneAtATime: 'Import one package at a time; drop the remaining {count} again.'
    },
    folder: {
      new: 'New folder',
      rename: 'Rename folder',
      delete: 'Delete folder (hoist contents)',
      deleteWithContents: 'Delete folder and contents',
      deleteWithContentsConfirm:
        'Permanently delete folder "{name}" and its {count} asset(s). This cannot be undone.',
      deleteWithContentsConfirmScripts:
        'Permanently delete folder "{name}" and its {count} asset(s), including scripts and their shots. This cannot be undone.',
      deleteFailed: 'Could not delete folder'
    },
    field: {
      name: 'Name',
      type: 'Type',
      prompt: 'Prompt',
      description: 'Description',
      notes: 'Notes',
      notesPlaceholder: 'Optional notes',
      file: 'File'
    },
    editor: {
      noPreview: 'No preview',
      loadingPreview: 'Loading preview…',
      noMedia: 'No media file linked yet',
      descPlaceholder: 'Describe purpose, style, constraints…',
      draftHint: 'Ctrl+S to choose folder and file name, then save',
      notFound: 'Asset missing or deleted',
      graphHint: 'Right-click to add nodes · Drop assets · Connect to Output',
      import: {
        fromFile: 'Import from file',
        replaceFile: 'Replace file',
        importFile: 'Import file'
      }
    },
    fileFilter: {
      image: 'Images',
      video: 'Videos / Motion',
      voice: 'Voice',
      all: 'All'
    },
    inspector: {
      title: 'Asset parameters',
      empty: 'No asset selected',
      shotCountValue: '{n}',
      linked: 'Linked',
      unlinked: 'Not linked',
      linkedPanorama: 'Linked background image',
      stageObjects: 'Stage objects',
      transformMode: 'Transform mode',
      suggestedDuration: 'Suggested duration (s)',
      voiceTags: 'Voice tags',
      voiceTagsPlaceholder: 'e.g. deep male voice / young voice / sound effect',
      styleNotes: 'Style notes',
      styleNotesPlaceholder: 'Art style, framing, color palette…',
      modelUsage: 'Model usage',
      modelUsagePlaceholder: 'Character / scene / prop…',
      modelPreview: 'Model preview',
      modelPreviewLoading: 'Loading model…',
      modelPreviewError: 'Failed to load model preview',
      modelFormat: 'File format',
      modelFormatUnknown: 'Unknown',
      tabs: {
        preview: 'Preview',
        animation: 'Animation',
        skeleton: 'Skeleton'
      },
      animation: {
        clip: 'Clip',
        none: 'None',
        play: 'Play',
        pause: 'Pause',
        speed: 'Speed',
        clipList: 'Clips',
        empty: 'No embedded animations'
      },
      skeleton: {
        showHelper: 'Show skeleton helper',
        hint: 'Skeleton only. Orange dots are bone joints. Click a name or a joint to highlight.',
        bones: 'Bones ({n})',
        empty: 'No bones detected'
      },
      pose: {
        hint: 'Pose assets use normalized bone names and can be applied across characters.',
        bones: 'Bone offsets ({n})',
        empty: 'This pose has no bone data'
      },
      transform: {
        position: 'Position',
        rotation: 'Rotation (°)',
        scale: 'Scale'
      },
      promptPlaceholder: {
        image: 'Subject, composition, lighting, style…',
        video: 'Camera movement, pacing, atmosphere…',
        motion: 'Scene directions, blocking notes…',
        voice: 'Voice, tone, purpose, emotion…',
        model: 'Appearance, material, proportions…'
      }
    },
    contentLabel: {
      image: 'Visual description',
      video: 'Video prompt',
      motion: 'Director notes',
      voice: 'Voice description',
      model: 'Model description',
      default: 'Description'
    },
    contentPlaceholder: {
      image: 'Describe the look of this image…',
      video: 'Describe the video / motion…',
      motion: 'Director deck notes…',
      voice: 'Describe the voice / line…',
      model: 'Describe model usage…',
      default: 'Optional description…'
    }
  },
  script: {
    dialog: {
      timeline: 'Timeline',
      close: 'Close'
    },
    timeline: {
      sources: 'Media library',
      refreshSources: 'Refresh inputs',
      autoPlace: 'Auto-place',
      generateBgm: 'Generate BGM',
      generateBgmHint: 'Describe the music (style / mood / scene); it will be placed on the music track',
      generateBgmPlaceholder: 'Upbeat bright electronic score for a Vlog background',
      generateBgmPrompt: 'Describe the BGM you want (style, mood, scene, optionally tempo/duration)',
      generateBgmDoneTitle: 'BGM generated',
      generateBgmDone: 'Generated "{name}" and placed it on the music track',
      generateBgmFailed: 'BGM generation failed: {error}',
      generateSfx: 'Generate SFX',
      generateSfxPrompt:
        'Describe the sound effect you want (e.g. rain / door / impact / birds); it will be placed on the SFX track',
      generateSfxPlaceholder: 'Rain tapping on a window pane, close-up',
      generateSfxDone: 'Generated "{name}" and placed it on the SFX track',
      generateSfxFailed: 'SFX generation failed: {error}',
      smartCut: 'Smart cut',
      smartCutTitle: 'AI rough cut',
      smartCutHint: 'The AI reordered the video track from titles and shot descriptions. Adjust duration and transitions below.',
      smartCutNoVideo: 'No video sources available. Collect sources from output nodes or drag in videos first.',
      smartCutNoModel: 'No text generation model configured. Choose a model on the screenplay node first.',
      smartCutParseFailed: 'The AI did not return a valid cut plan. Try again or switch model.',
      smartCutFailed: 'Smart cut failed: {error}',
      smartCutDuration: 'Duration (s)',
      smartCutApply: 'Apply cut',
      smartCutRegenerate: 'Regenerate plan',
      smartCutRegenerating: 'Generating…',
      smartCutGenerating: 'Generating the cut plan…',
      smartCutStart: 'Generate',
      smartCutNotStarted: 'Click "Generate" to have AI reorder clips and set durations automatically',
      sfxLibrary: 'SFX library',
      sfxLibraryAll: 'All',
      sfxLibraryGenerate: 'Generate & place',
      sfxLibraryImport: 'Import from asset library',
      sfxLibraryImportBtn: 'Import & place',
      sfxLibraryNoAssets: 'No usable audio assets yet (import sound / audio files into the asset library first)',
      sfxLibraryGenerated: 'Generated SFX and placed it on the SFX track: {name}',
      sfxLibraryImported: 'Imported SFX and placed it on the SFX track: {name}',
      sourceNode: 'Source node',
      locateNode: 'Locate in graph',
      locateNodeHint: 'Locate this clip\'s source node in the graph (back to its generation branch)',
      sourceGridSize: 'Media tile size',
      sourceGroup: {
        input: 'Node inputs',
        imported: 'Imported',
        importedTag: 'Import'
      },
      importedEmpty: 'Dropped videos/audio appear here; right-click to create a group',
      createGroup: 'New group',
      renameGroup: 'Rename group',
      deleteGroup: 'Delete group',
      deleteGroupConfirm: 'Delete group "{name}"? Items move back to Ungrouped.',
      groupNamePrompt: 'Enter a group name',
      groupNamePlaceholder: 'Group name',
      groupNameDefault: 'Group {n}',
      groupEmpty: 'Drop items here',
      ungrouped: 'Ungrouped',
      removeSource: 'Remove from list and matching clips on tracks',
      sourcesEmpty:
        'No media yet — drop videos or audio from the asset library / files, or run upstream shot video generation',
      emptyPreview: 'Drop videos on the track to preview here',
      videoEmpty: 'Drop videos here (asset library or files), or generate upstream first',
      overlayEmpty: 'Drop a video here to add it as a picture-in-picture layer',
      voiceEmpty: 'Drop voice audio here (asset library or audio files)',
      musicEmpty: 'Drop music/audio here (asset library or audio files)',
      sfxEmpty: 'Drop SFX/audio here (asset library or audio files)',
      dropUnsupported: 'Only video or audio files can be dropped',
      importFailed: 'Import failed: {error}',
      none: 'None',
      track: {
        video: 'Video',
        overlay: 'PiP',
        voice: 'VO',
        subtitle: 'Subs',
        sfx: 'SFX',
        music: 'Music'
      },
      inspector: 'Inspector',
      inspectorEmpty: 'Select a timeline clip to inspect',
      startSec: 'Start time',
      durationSec: 'Clip duration',
      hideTrack: 'Hide track',
      showTrack: 'Show track',
      muteTrack: 'Mute track',
      unmuteTrack: 'Unmute track',
      lockTrack: 'Lock track',
      unlockTrack: 'Unlock track',
      collapseTrack: 'Collapse track',
      expandTrack: 'Expand track',
      removeClip: 'Remove clip',
      reshoot: 'Reshoot',
      reshootClip: 'Reshoot this shot',
      reshootNodeTitle: 'Reshoot · {shot}',
      reshootSource: 'Source node: {node}',
      reshootHint:
        'Jump to the matching node-graph branch: reshoot nodes open the reshoot editor, other nodes are selected in the graph',
      reshootUnavailable:
        'No source node for this clip (imported asset or legacy data). Refresh inputs and re-place it to link a node',
      splitClip: 'Split selected clip at playhead',
      undo: 'Undo',
      redo: 'Redo',
      copyClip: 'Copy selected clips',
      pasteClip: 'Paste clips at playhead',
      duration: 'Duration',
      durationHint: 'Timeline length in seconds (cannot be shorter than content)',
      rate: 'Speed',
      trackHeight: 'Track height',
      trackHeightHint: 'Drag to adjust timeline track height',
      volume: 'Volume',
      fadeIn: 'Fade in',
      fadeOut: 'Fade out',
      transition: 'Transition',
      transitionIn: 'Transition in',
      transitionOut: 'Transition out',
      transitionEffect: 'Transition effect',
      transitionNone: 'None',
      transitionDissolve: 'Dissolve',
      transitionFade: 'Fade',
      transitionFadeOut: 'A fade out',
      transitionFadeIn: 'B fade in',
      transitionFlash: 'Flash white',
      transitionSlideLeft: 'Slide left',
      transitionSlideRight: 'Slide right',
      transitionSlideUp: 'Slide up',
      transitionSlideDown: 'Slide down',
      transitionWipeLeft: 'Wipe left',
      transitionWipeRight: 'Wipe right',
      transitionWipeUp: 'Wipe up',
      transitionWipeDown: 'Wipe down',
      transitionCircleOpen: 'Circle open',
      transitionCircleClose: 'Circle close',
      transitionDragHint: 'Drag the blue handle between two video clips to adjust overlap/duration.',
      overlayTransform: 'Picture-in-picture transform',
      overlayX: 'Position X %',
      overlayY: 'Position Y %',
      overlayWidth: 'Width %',
      overlayHeight: 'Height %',
      overlayOpacity: 'Opacity',
      overlayVolume: 'Volume',
      overlayReset: 'Reset PiP',
      exportResolution: 'Resolution',
      customResolution: 'Custom',
      exportWidthField: 'Width',
      exportHeightField: 'Height',
      exportFps: 'FPS',
      exportBitrate: 'Bitrate',
      previewFrameRatio: 'Preview frame ratio',
      previewFrameRatioVideo: 'Source video',
      previewFrameRatioExport: 'Export ratio',
      subtitleFontSize: 'Subtitle size',
      subtitleYOffset: 'Subtitle height',
      subtitleColor: 'Subtitle color',
      subtitleStyle: 'Subtitle style',
      subtitleResizeHint: 'Click to select subtitle; scroll to resize it',
      loop: 'Loop',
      toStart: 'Go to start',
      play: 'Play',
      pause: 'Pause',
      playSelected: 'Play selected clip',
      playTimeline: 'Play full timeline',
      zoomFit: 'Fit',
      subtitleEmpty: 'Drop media or add a caption',
      addSubtitle: 'Add caption',
      editSubtitle: 'Edit caption text',
      subtitlePlaceholder: 'Caption',
      export: 'Export cut',
      exportHint: 'Prefer ffmpeg MP4; falls back to WebM capture if missing',
      exportSettings: 'Export settings',
      exporting: 'Exporting {progress}%',
      exportDone: 'Exported:\n{path}',
      exportDoneFallback:
        'ffmpeg not found — exported WebM via preview capture:\n{path}\n\nInstall ffmpeg on PATH (or set FFMPEG_PATH) for higher-quality MP4.',
      exportFailed: 'Export failed: {error}',
      exportEmpty: 'Timeline is empty',
      mixer: 'Mixer',
      mixerHint: 'Track gain, master output, bass/treble and compression (rendered on export)',
      exportPlatform: 'Target platform',
      platform: {
        custom: 'General / Custom',
        douyin: 'Douyin',
        kuaishou: 'Kuaishou',
        shipinhao: 'Channels',
        tiktok: 'TikTok',
        youtube: 'YouTube',
        portrait: 'Portrait',
        landscape: 'Landscape',
        square: 'Square'
      },
      platformSpec: `{width} × {height} {'@'} {fps} fps, ~{bitrate} Mbps`,
      platformMaxDuration: 'Up to ~{maxSec} min',
      platformTooLong: 'Over limit: ~{curSec}s exceeds the {maxSec} min cap',
      safeAreaHint: 'Safe area: keep subtitles and key content inside the dashed frame',
      exportCheckResolution: 'Resolution mismatches the platform; {width} × {height} recommended',
      exportCheckFps: 'Frame rate mismatches the platform; {fps} fps recommended',
      exportCheckDuration: 'Duration exceeds the ~{maxSec} min platform cap',
      exportCheckSubtitleSafe: 'Subtitles fall outside the platform bottom safe area',
      exportCheckPass: 'All specs meet the platform requirements',
      watermark: 'Watermark',
      watermarkEnable: 'Enable brand watermark',
      watermarkImage: 'Watermark image',
      watermarkPick: 'Pick image…',
      watermarkOpacity: 'Opacity',
      watermarkScale: 'Size (relative to frame width)',
      watermarkPosition: 'Position',
      watermarkBr: 'Bottom right',
      watermarkBl: 'Bottom left',
      watermarkTr: 'Top right',
      watermarkTl: 'Top left',
      exportRetryHint: 'Last export failed — fix issues and retry:',
      mixerTrackGains: 'Track gains',
      mixerMaster: 'Master',
      mixerMasterGain: 'Master gain',
      mixerBass: 'Bass',
      mixerTreble: 'Treble',
      mixerCompression: 'Compression',
      exportSrt: 'Export subtitles as SRT',
      exportSrtDone: 'Subtitles exported:\n{path}',
      exportSrtFailed: 'Subtitle export failed: {error}',
      subtitleFromVoice: 'Voice to captions',
      subtitleFromVoiceHint:
        'Transcribe voice-track clips into captions aligned to the timeline (requires a provider with speech-to-text)',
      subtitleFromVoiceWorking: 'Transcribing…',
      subtitleFromVoiceNoVoice: 'The voice track has no clips with an audio file to transcribe',
      subtitleFromVoiceDone: 'Generated {count} captions from voice',
      subtitleFromVoicePartial: 'Generated {count} captions; some clips failed: {error}',
      subtitleFromVoiceFailed: 'Voice transcription failed: {error}',
      subtitleFromVoiceEmpty: 'Transcription returned no text, no captions added',
      separateAudio: 'Vocal/Instrumental split',
      separateAudioHint:
        'Split the selected clip audio into dialogue and instrumental, placed onto the voice and music tracks aligned to the clip (built-in center-channel extraction)',
      separateAudioWorking: 'Separating…',
      separateAudioDoneTitle: 'Separation complete',
      separateAudioDone:
        'Dialogue added to the voice track and instrumental to the music track (aligned to the original clip); adjust the ratio in the mixer before export',
      separateAudioCenterNote:
        'Used built-in center-channel separation (best for centered dialogue); set AUDIO_SEPARATION_API_URL to enable a third-party AI separation service.',
      separateAudioNoSource: 'The selected clip has no usable audio source',
      separateAudioFailed: 'Separation failed: {error}',
      separateVocal: 'Vocal',
      separateInstrumental: 'Instrumental',
      audio: 'Audio',
      resizeSourcesWidth: 'Drag to resize library width',
      resizeInspectorWidth: 'Drag to resize inspector width',
      subtitleScaleHint: 'Scale subtitle',
      recordFallbackFailed: 'Recorder fallback also failed: {error}',
      recorderUnsupported:
        'MediaRecorder is unavailable in this environment and ffmpeg was not detected',
      canvasUnavailable: 'Unable to create canvas',
      recordEmpty: 'Recording produced no data',
      recordCanceled: 'Canceled',
      defaultVideoTitle: 'Video {index}',
      defaultVoiceTitle: 'Voice {index}'
    },
    pane: {
      resizeSplit: 'Drag to resize the upper/lower canvases'
    },
    timelineWindow: {
      loading: 'Opening timeline…',
      missingAsset: 'Missing script asset',
      noProject: 'No project open in the main window'
    }
  },
  director: {
    title: 'Director Deck',
    toolbar: {
      graph: 'Graph',
      stage: 'Stage window',
      split: 'Split'
    },
    panorama: 'Panorama',
    noPanorama: 'None',
    transform: {
      translate: 'Move (Q)',
      rotate: 'Rotate (R)',
      scale: 'Scale (S)'
    },
    hint: {
      stage: 'LMB select · MMB pan · RMB orbit · Q/R/S move/rotate/scale',
      graph: 'Double-click director deck edit · connect to director output'
    },
    error: {
      panoramaLoad: 'Failed to load panorama'
    },
    stageWindow: {
      loading: 'Opening stage…',
      missingAsset: 'Missing director asset',
      noProject: 'No project is open in the main window'
    },
    stageDialog: {
      title: 'Director deck edit',
      close: 'Close'
    },
    stage: {
      scenePanel: 'Panorama',
      searchPlaceholder: 'Search…',
      resizePanel: 'Drag to resize panel',
      hierarchyEmpty: 'No objects',
      collapse: 'Collapse',
      expand: 'Expand',
      sideTab: {
        scene: 'Scene',
        inspector: 'Inspector'
      },
      selectionType: {
        camera: 'Camera',
        object: 'Object',
        panorama: 'Panorama',
        scene: 'Scene',
        none: 'None'
      },
      cameraItem: 'Camera 1',
      createCamera: 'Create Camera',
      createEmpty: 'Create Empty',
      createMenu: 'Create object',
      aiBlockoutGroupName: 'AI Blockout',
      deleteObject: 'Delete',
      copy: 'Copy',
      paste: 'Paste',
      cannotDeleteModel: 'Graph-imported models cannot be deleted',
      cannotDeleteCamera: 'At least one camera must remain',
      hideObject: 'Hide',
      showObject: 'Show',
      hideObjectName: 'Hide name',
      showObjectName: 'Show name',
      lockObject: 'Lock',
      unlockObject: 'Unlock',
      lockedHint: 'Object is locked and cannot be transformed',
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
        pointedArch: 'Pointed Arch',
        cross: 'Cross',
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
      tabProps: 'Properties',
      tabPose: 'Pose',
      poseHint: 'Skeleton joints and bones are shown in the viewport. Select a joint below or in the view to adjust the pose.',
      poseBones: 'Bones ({n})',
      poseBonesEmpty: 'This model has no editable bones',
      poseViewportHint: 'Click a green joint in the viewport, then drag the rotate gizmo to pose',
      poseModeFk: 'FK Rotate',
      poseModeIk: 'IK Drag',
      poseModeAi: 'AI Pose',
      poseAiHint:
        'Describe a pose in natural language (walk, jump, wave). A text model generates bone rotations for the selected character. If OpenRouter openai/* returns Terms of Service, allow the upstream provider at openrouter.ai/settings/privacy, or switch to a non-OpenAI / local-region text model.',
      poseAiModel: 'Text model',
      poseAiModelPick: 'Select a model…',
      poseAiModelEmpty: 'Enable and select a text model in Settings first',
      poseAiPresets: 'Common poses',
      poseAiPreset: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Run',
        jumpAir: 'Jump',
        jumpLand: 'Land',
        wave: 'Wave',
        handsOnHips: 'Hands on hips',
        point: 'Point',
        think: 'Think',
        crouch: 'Crouch',
        kneel: 'Kneel',
        bow: 'Bow',
        fightGuard: 'Fight guard',
        sit: 'Sit'
      },
      poseAiInstruction: 'Pose instruction',
      poseAiInstructionPlaceholder:
        'e.g. mid-step walk with right leg forward… or pick a preset above',
      poseAiGenerate: 'Generate AI pose',
      poseAiGenerating: 'Generating…',
      poseAiApplied: 'Applied {matched}/{total} bones',
      poseAiParseFailed: 'Could not parse the model reply as a pose function call. Try another model or rewrite the prompt.',
      poseAiNoMatch: 'Returned bone names do not match this character',
      poseAiFailed: 'Generation failed: {error}',
      poseAiLog: {
        title: 'AI Pose',
        titlePreset: 'AI Pose · {name}',
        start: 'Start: object “{object}”, {bones} editable bones',
        reset: 'Pose reset (same as Reset pose)',
        instruction: 'Instruction: {text}',
        llmStart: 'Calling text model: {model}',
        llmDone: 'Model reply received: {chars} chars ({model})',
        parsed: 'Parsed function call: matched {matched}/{total}, mode={mode}',
        rawReply: 'Raw reply excerpt: {text}'
      },
      poseIkChains: 'IK targets ({n})',
      poseIkChainsEmpty: 'No IK target found. You can manually pick an end bone.',
      poseIkHint: 'Select an IK target, then drag the orange target; release to save pose',
      poseIkManualHint: 'If bone names are non-standard, pick the end effector below',
      poseIkManual: 'Manual',
      poseIkPickBone: 'Pick end bone...',
      poseIkUseAuto: 'Auto: {name}',
      poseIkAssignFailed: 'Cannot build an IK chain from that bone (needs rotatable parents)',
      poseIkSlot1: 'Target 1',
      poseIkSlot2: 'Target 2',
      poseIkSlot3: 'Target 3',
      poseIkSlot4: 'Target 4',
      posePresets: 'Pose presets',
      posePresetsEmpty: 'No presets yet. Adjust bones, then save.',
      posePresetSave: 'Save preset',
      posePresetRemove: 'Remove preset',
      posePresetNamePlaceholder: 'Preset name (optional)',
      posePresetDefault: 'Pose',
      poseReset: 'Reset pose',
      poseAxisReset: 'Reset to 0°',
      poseAssets: 'Pose assets',
      poseAssetsEmpty: 'No pose assets yet. Save one or drop from the library.',
      poseAssetSave: 'Save as asset',
      poseAssetNamePlaceholder: 'Asset name (optional)',
      poseAssetDefault: 'Pose',
      poseAssetApplyHint: 'Matched {matched}/{total} bones',
      poseAssetSaved: 'Saved asset "{name}"',
      poseAssetSaveFailed: 'Failed to save pose asset',
      tabShots: 'Shots & Actions',
      tabShotsOnly: 'Shots',
      tabActionsOnly: 'Actions',
      position: 'Position',
      rotationDeg: 'Rotation (°)',
      scale: 'Scale',
      uniformScale: 'Uniform Scale',
      color: 'Color',
      textures: 'Textures',
      textureSlotMap: 'Base Map',
      textureSlotNormal: 'Normal Map',
      textureSlotEmpty: 'Drop image',
      textureSlotHidden: 'Hidden',
      textureRemove: 'Remove texture',
      textureReset: 'Restore built-in texture',
      textureHide: 'Hide this texture slot',
      textureShow: 'Show this texture slot',
      textureHint:
        'Drag an image from the asset library onto a slot; ⊘ hides the built-in texture, ✕ restores it. Applies to this object only.',
      incomingModelName: 'Input 3D Model',
      selectHint: 'Select an object in the hierarchy or viewport',
      viewDirector: 'Director view',
      viewCamera: 'Camera view',
      viewMenu: 'View',
      moveToView: 'Move To View',
      moveToViewShortcut: 'Ctrl+Alt+F',
      alignWithView: 'Align With View',
      alignWithViewShortcut: 'Ctrl+Shift+F',
      alignViewToSelected: 'Align View to Selected',
      resetView: 'Reset view',
      viewOrientation: 'View orientation',
      viewTop: 'Top view',
      viewBottom: 'Bottom view',
      viewLeft: 'Left view',
      viewRight: 'Right view',
      viewFront: 'Front view',
      selectionBounds: 'Selection bounds',
      captureShot: 'Capture',
      shadingMode: 'Shading Mode',
      shading: {
        shaded: 'Shaded',
        wireframe: 'Wireframe',
        shadedWireframe: 'Shaded Wireframe'
      },
      cameraPreview: 'Camera preview',
      cameraPreviewHint: 'Floating live preview of selected cameras',
      cameraPreviewEmpty: 'Select one or more cameras in the hierarchy',
      cameraPreviewClose: 'Close camera preview',
      cameraPreviewPopout: 'Pop out to a separate window (or drag the panel out)',
      cameraPreviewDockBack: 'Dock back to main window',
      cameraPreviewResize: 'Drag the bottom-right corner to resize',
      cameraPreset: {
        title: 'Camera Presets',
        needObject: 'Select an object first',
        groupShotSize: 'Shot size',
        groupAngle: 'Angle',
        groupCombination: 'Combo shots',
        comboNeedModels: 'Needs enough model children under the selected object',
        comboReverse: 'Reverse shot (2× OTS)',
        comboThree: 'Three-shot rule',
        comboAxis: 'Standard 5-shot (180° rule)',
        comboInterview: 'Interview pair',
        comboEyeline: 'Eyeline match close-ups',
        comboOrbit: 'Orbit trio',
        comboOrbitName: 'Orbit cam',
        comboThreeWay: 'Three-way triangle',
        comboStageTrio: 'Stage trio',
        comboStageQuint: 'Stage five-cam',
        comboMaster: 'Master two-shot',
        comboMaster3: 'Master three-shot',
        comboOtsAB: 'OTS A→B',
        comboOtsBA: 'OTS B→A',
        comboOtsBC: 'OTS B→C',
        comboOtsCA: 'OTS C→A',
        comboCloseA: 'Close-up A',
        comboCloseB: 'Close-up B',
        comboStageWide: 'Wide',
        comboStageLeft: 'Left close-up',
        comboStageRight: 'Right close-up',
        comboStageLow: 'Low angle',
        comboStageHigh: 'High angle',
        extremeWide: 'Extreme long',
        long: 'Long',
        full: 'Full',
        medium: 'Medium',
        mediumClose: 'Medium close',
        close: 'Close',
        closeUp: 'Close-up',
        extremeCloseUp: 'Extreme close-up',
        eyeLevel: 'Eye level',
        low: 'Low angle',
        high: 'High angle',
        bird: "Bird's-eye",
        dutch: 'Dutch angle',
        overShoulder: 'Over shoulder',
        threeQuarter: 'Three-quarter',
        profile: 'Profile',
        back: 'Back'
      },
      gizmos: {
        title: 'Gizmos',
        size: 'Size',
        labels: 'Scene labels',
        cameras: 'Camera gizmos',
        grid: 'Grid',
        selectionBounds: 'Selection bounds',
        captureLabels: 'Include scene labels in captures',
        captureCameraLabels: 'Include camera names in captures'
      },
      aspectRatio: 'Aspect ratio',
      aspectAuto: 'Auto',
      shotsEmpty: 'No shots yet',
      actionsEmpty: 'No recorded actions yet',
      actionLoading: 'Loading…',
      shotPreviewTitle: 'Image preview',
      shotPreviewTitleVideo: 'Video preview',
      shotPreviewTitleVoice: 'Audio preview',
      shotPreviewEmpty: 'No image',
      shotPreviewEmptyVideo: 'No video',
      shotPreviewEmptyVoice: 'No audio',
      shotPreviewExport: 'Export',
      shotPreviewExporting: 'Exporting…',
      shotPreviewExportFailed: 'Export failed: {error}',
      shotPreviewExportFilterImage: 'Image',
      shotPreviewExportFilterAll: 'All files',
      editInStage: 'Edit transforms in the director stage view',
      sceneGlobal: '3D Panorama',
      sceneScale: 'Panorama Scale',
      sceneTranslation: 'Panorama Translation',
      sceneRotation: 'Panorama Rotation',
      ground: 'Ground',
      groundOpacity: 'Opacity',
      groundHeight: 'Height',
      panoramaBackground: 'Panorama Background',
      panoramaConnected: 'Connected background image',
      panoramaConnectHint: 'Drop an image asset as background',
      panoramaDropHint: 'Drop an image here',
      panoramaRemove: 'Remove background',
      hidePanorama: 'Hide panorama background',
      showPanorama: 'Show panorama background',
      blockoutButton: 'Generate 3D Blockout',
      blockoutTitle: 'Generate 3D Blockout',
      blockoutNeedPanorama: 'Set a panorama background first',
      blockoutRefAdd: 'Add scene reference image',
      blockoutRefRemove: 'Remove reference',
      blockoutPickAsset: 'Choose from assets',
      blockoutAddFromAsset: 'Add',
      blockoutLibraryTitle: 'Choose scene references',
      blockoutLibrarySubtitle: 'Images only, {max} more can be added',
      blockoutLibraryEmpty: 'No image assets in the library',
      blockoutLibraryNoMatch: 'No matching images',
      blockoutLibraryAdded: 'Added',
      blockoutLibraryPicked: 'Selected {n} / {max}',
      blockoutLayoutLabel: 'Reference type',
      blockoutLayoutPerspective: 'Perspective',
      blockoutLayoutPanorama: '360 panorama',
      blockoutModelLabel: 'Text model',
      blockoutNoModels: 'No text models available',
      blockoutSystemLabel: 'System prompt',
      blockoutInstructionLabel: 'Instruction',
      blockoutDefaultInstruction:
        'Analyze the reference images and rebuild the scene with primitives.',
      blockoutDefaultInstructionPerspective:
        'Match the photo: round arches = arch (no extra 90° rotation); circular spires = cone (tip up, circular base); round towers = cylinder not prism; leave openings; use people as a 1.7m scale.',
      blockoutDefaultInstructionPanorama:
        'This is a 360° equirectangular panorama. Place objects around the viewer by image azimuth; do not treat it as one perspective photo stacked in front of the camera.',
      blockoutRun: 'Create Scene',
      blockoutRunning: 'Generating scene…',
      blockoutHint:
        'Perspective or 360 panorama. Sends up to 3 reference images plus the instruction to a text model and builds stage blockout from its function call',
      blockoutNoImage: 'Add at least one scene reference image',
      blockoutParseFailed: 'The model returned no valid scene data',
      blockoutDone: 'Created {count} blockout objects',
      blockoutAutoFix: 'Auto-fixed {count} primitive types',
      blockoutLogTitle: 'AI scene blockout',
      blockoutLogStart: 'Start scene blockout (model: {model})',
      skyColor: 'Sky Color',
      panoramaSphere: 'Panorama Sphere',
      panoramaYaw: 'Horizontal Rotation',
      panoramaRadius: 'Sphere Radius',
      modeScene: 'Panorama Mode',
      modeAnimation: 'Animation Mode',
      anim: {
        play: 'Play',
        pause: 'Pause',
        stop: 'Stop',
        loop: 'Loop',
        addTrack: 'New Track',
        cameraCutTrack: 'Camera Cut',
        cameraCutTag: 'CUT',
        cameraCutHint: 'Add a camera cut track: activates the camera whose segment covers the playhead',
        cameraCutAddHint: 'Add a segment for the active camera at the playhead',
        cameraCutRemoveHint: 'Remove the selected camera segment',
        cameraCutDropHint: 'Drag cameras here (or use + to add the active camera)',
        removeTrack: 'Remove Track',
        drawPath: 'Draw Path',
        orientToPath: 'Orient to path',
        pathForwardAxis: 'Model forward axis',
        empty: 'Click “New Track” to add an object or camera',
        noTargets: 'No available targets',
        cameraTag: 'Camera',
        objectTag: 'Object',
        path: {
          circle: 'Circle Path',
          line: 'Straight Path',
          rect: 'Rectangle Path',
          pencil: 'Pencil Path',
          pen: 'Pen Path'
        },
        drawHint: {
          circle: 'Click center, then click to set radius',
          line: 'Click start, then click end',
          rect: 'Click two opposite corners',
          pencil: 'Hold and drag to draw; release to finish',
          pen: 'Click to add points; double-click or Enter to finish'
        },
        zoom: 'Zoom timeline',
        playbackRate: 'Playback speed',
        playbackRateShort: 'Speed',
        exportVideo: 'Record action',
        exporting: 'Recording…',
        collapse: 'Collapse animation panel',
        expand: 'Expand animation panel',
        addKeyframe: 'Add keyframe',
        addKeyframeHint: 'Add position keyframe at playhead (K)',
        removeKeyframe: 'Delete keyframe (Delete)',
        editingKeyframe: 'Editing keyframe · {time}s',
        skeleton: 'Skeleton',
        skeletonClip: 'Clip',
        skeletonNone: 'None',
        skeletonSpeed: 'Skeleton speed',
        skeletonLoop: 'Skeleton loop',
        skeletonEmpty: 'No embedded animations · drop an animation asset here',
        skeletonDropHint: 'Drop animation assets onto the track',
        skeletonClipCount: '{n}',
        skeletonAssetEmpty: 'Animation asset has no clips',
        skeletonAssetClear: 'Clear animation asset',
        removeSkeletonClip: 'Remove clip',
        skeletonBadge: 'Skel'
      }
    }
  },
  divePipeline: {
    episode: {
      title: {
        default: 'Episode storyboard pipeline'
      },
      header: {
        currentStep: 'Current step: ',
        busyTasks: 'Tasks running…',
        viewTrace: 'View trace',
        traceOpen: 'Open this run trace',
        traceNone: 'No trace yet for this run',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        failPrefix: 'FAIL: ',
        failReasonTitle: 'Reason of the last failed director review'
      },
      empty: {
        noGraph:
          'No workflow data found yet. Run a "Storyboard · Beat Breakdown Table" node first, then open this view from the "Episode Pipeline" toolbar button.',
        beatsUnparsed: 'Beat breakdown has content but could not be parsed into a table',
        beatsPending: 'Not generated (run the breakdown node)',
        anchorsUnparsed: '9-grid has content but could not be parsed',
        anchorsPending: 'Not generated (run the beatboard node)',
        cellsUnparsed: '4-grid has content but could not be parsed',
        cellsPending: 'Not generated (run the sequence node)'
      },
      panel: {
        beats: 'Beat breakdown',
        boardDirect: '9-grid storyboard table · direct-to-video'
      },
      action: {
        directorReview: 'Director review',
        generate: 'Generate',
        regenerate: 'Regenerate',
        generateMotion: 'Generate motion prompts',
        generateMotionDirect: 'Generate 9-grid motion prompts',
        buildGrid4: 'Generate 4-grid collage',
        buildGrid9: 'Generate 9-grid collage'
      },
      stageBusyTitle: {
        breakdown: 'Generating beat breakdown…',
        beatboard: 'Generating 9-grid storyboard table…',
        sequence: 'Generating 4-grid storyboard table…',
        motion: 'Generating motion prompts…'
      },
      task: {
        stage: 'Storyboard pipeline · {stage}',
        buildGrid4Group: 'Generate 4-grid collage · Group {g}',
        video: 'Motion video · Cell {g}-{c}'
      },
      state: {
        generating: 'Generating…',
        passedMark: '✓ Passed',
        awaitReview: 'Awaiting review',
        generated: 'Generated',
        ranOnce: 'Ran once',
        failed: 'Failed',
        notGenerated: 'Not generated',
        noImage: 'No image yet',
        completed: 'Completed'
      },
      stepLabel: {
        motionDirect: '9-grid motion prompt table'
      },
      stepHint: {
        default: 'The stage the pipeline has advanced to',
        breakdown: 'Beat breakdown table generated; advancing to the 9-grid storyboard table',
        beatboardDirect:
          '9-grid storyboard table generated; advancing to the Animator · 9-grid motion prompt table',
        beatboardCells:
          '9-grid storyboard table generated; advancing to the 4-grid motion storyboard table',
        readyDirect:
          '9-grid motion prompt table generated; generate all 9 direct videos cell by cell or in one click',
        sequenceCells: '4-grid motion storyboard table generated; advancing to the motion prompt table',
        motionCells: 'Motion prompt table generated; completes once director review passes',
        completed: 'All stages approved'
      },
      cell: {
        short: 'Cell {n}',
        key: 'Cell {g}-{c}',
        beatRef: 'Beat {n}',
        beatRefTitle: 'Linked beat'
      },
      anchor: {
        badge: 'Anchor',
        badgeTitle: 'Key anchors (the first 9 anchors map to the 9-grid)'
      },
      breadcrumb: {
        direct: 'Scene/beat #{beat} → Cell {cell} → 9-cell direct video',
        cells: 'Scene/beat #{beat} → Cell {cell} → Motion cell {key}'
      },
      detail: {
        grid4: '4-grid ({index})',
        motionDirect: '9-grid motion prompts',
        motionCell: 'Motion prompts ({key})',
        videoOutput: 'Video output',
        generateVideo: 'Generate this video',
        regenVideo: 'Regenerate this video',
        videoWaitRegen: 'Wait for regeneration to finish before generating video',
        videoRunning: 'This video is being generated…',
        videoNeedsPrompt: 'Generate motion prompts first'
      },
      hint: {
        backFromToolbar:
          'Use the "Episode Pipeline" button on the top toolbar to return to this view anytime; images/videos run in the node graph.'
      }
    },
    agent: {
      title: 'Agent pipeline',
      summary: {
        pending: 'Pending {n}',
        pendingTitle: 'Pending: review pending + rework running',
        fail: 'FAIL {n}',
        failTitle: 'Quality-check FAIL node count',
        exhausted: 'Exhausted {n}',
        exhaustedTitle: 'Rework nodes exhausted without passing',
        error: 'Errors {n}',
        errorTitle: 'Nodes that failed to run',
        degraded: 'Degraded {n}',
        degradedTitle: 'Nodes continued with a degraded result; output may be suboptimal'
      },
      fail: {
        latestTitle: 'Reason of the last FAIL / exhaustion',
        latestPrefix: 'Last failure: '
      },
      empty: {
        noNodes:
          'This canvas has no "Quality check (media.review)" or "Rework (media.rework)" nodes yet. After running a generate node, connect a quality-check node downstream for automatic review; on FAIL the rework node retries automatically until PASS or the attempt limit.'
      },
      panel: {
        review: 'Quality check nodes (media.review)',
        rework: 'Rework nodes (media.rework)',
        errors: 'Run issues',
        noReview: 'No quality check nodes',
        noRework: 'No rework nodes',
        noErrors: 'No run issues',
        locateHint: 'Click to locate the node'
      },
      row: {
        attempt: 'Attempt {attempt}/{maxAttempts}'
      },
      status: {
        review: {
          pending: 'Awaiting review'
        },
        rework: {
          running: 'Reworking',
          passed: 'Passed',
          exhausted: 'Exhausted'
        },
        error: 'Failed',
        degraded: 'Degraded'
      }
    },
    uiSplit: {
      loading: 'Opening UI split inner canvas…',
      error: {
        noScreens: 'Generate UI screen prompts first, then double-click to enter the inner canvas.'
      }
    }
  },
  canvas: {
    toolbar: {
      grid: 'Grid',
      spacing: 'Spacing',
      layers: 'Layers'
    },
    focus: 'Focus board (F)',
    deleteSelected: 'Delete selection',
    layersEmpty: 'Drop images or add from the asset library',
    asset: {
      hint: 'Blank node canvas · right-click to add · drop assets to connect'
    },
    layer: {
      hide: 'Hide',
      show: 'Show',
      lock: 'Lock',
      unlock: 'Unlock',
      up: 'Move up',
      down: 'Move down',
      delete: 'Delete',
      image: 'Image',
      named: 'Layer {n}'
    },
    error: {
      notReady: 'Canvas not ready',
      dropFailed: 'Could not read dropped asset',
      imageOnly: 'Canvas only accepts image assets',
      noFile: 'This image has no linked file yet'
    }
  },
  review: {
    unreviewed: 'Unreviewed',
    reviewed: 'Reviewed'
  },
  beat: {
    asset: {
      hint: 'Double-click split for instructions · table for catalog · output opens unit refinement; use breadcrumbs to go back'
    },
    dialog: {
      close: 'Close',
      table: 'Beat unit table',
      gen: 'Beat unit gen'
    },
    hint: {
      table: 'Beat unit table · edit beats and review status',
      gen: 'Canvas above refines the unit · click strip for Inspector · drag to add refs'
    },
    pane: {
      resizeSplit: 'Drag to resize the split panes'
    },
    strip: {
      title: 'Beat units',
      switchHint: 'Click to switch · drag onto canvas for refs',
      empty: 'No beat units yet — run split or add rows in the table',
      collapse: 'Collapse beat unit strip',
      expand: 'Expand beat unit strip'
    },
    unit: {
      inspector: {
        type: 'Beat {n}',
        title: 'Beat',
        empty: 'No beat selected',
        sourceExcerpt: 'Source excerpt'
      }
    },
    table: {
      new: 'New',
      empty: 'No entries yet — add one or run split first',
      unit: 'Beat',
      column: {
        order: 'Order',
        title: 'Title',
        time: 'Time',
        durationHint: 'Duration',
        location: 'Space and location',
        locations: 'Location bindings',
        characters: 'Characters',
        action: 'Core action',
        conflict: 'Conflict and goal',
        atmosphere: 'Atmosphere and sound',
        props: 'Props',
        weapons: 'Weapons',
        sourceExcerpt: 'Source excerpt',
        status: 'Status'
      },
      bind: {
        title: 'Bind world entity',
        action: 'Bind',
        add: 'Add name',
        empty: 'Run the beat table node first to sync world entities'
      }
    }
  },
  world: {
    asset: {
      hint: 'Double-click extract for instructions · table for catalog · gen opens world editor; use breadcrumbs to go back'
    },
    dialog: {
      close: 'Close',
      elementTable: 'World element table',
      editor: 'World element gen'
    },
    hint: {
      table: 'World element table · edit characters / scenes / props / weapons',
      editor: 'Four element canvases · use the right Inspector for params and run'
    },
    pane: {
      resizeSplit: 'Drag to resize the split panes'
    },
    table: {
      new: 'New',
      empty: 'No entries yet — add one or run extract first',
      briefStyle: 'Style brief',
      briefWorldview: 'Worldview brief',
      column: {
        name: 'Name',
        prompt: 'Prompt',
        status: 'Status'
      },
      placeholder: {
        prompt: 'Image generation prompt',
        style: 'Distilled genre / medium / palette / lighting / texture / avoid list',
        worldview: 'Era, culture, rules, factions, tone and other reusable non-visual settings'
      }
    },
    tab: {
      characters: 'Characters',
      scenes: 'Scenes',
      props: 'Props',
      weapons: 'Weapons'
    },
    kind: {
      character: 'Character',
      scene: 'Scene',
      prop: 'Prop',
      weapon: 'Weapon'
    },
    tableWindow: {
      loading: 'Opening world element table…',
      missingAsset: 'Missing world asset id',
      noProject: 'No project open'
    }
  },
  graph: {
    toolbar: {
      hint: 'Node workflow · hold C for run ring',
      toolMode: 'Canvas tools',
      selectTitle: 'Select (click / marquee)',
      panTitle: 'Pan (drag with left button)',
      collapse: 'Collapse toolbar',
      expand: 'Expand toolbar'
    },
    editor: {
      loadingSource: 'Loading image…'
    },
    radial: {
      hint: 'C',
      runCurrent: 'Run',
      rerunCurrent: 'Re-run',
      cookSubgraph: 'Cook subgraph',
      runSkip: 'Skip done',
      runForce: 'Force upstream',
      enqueue: 'Queue',
      stop: 'Stop'
    },
    tasks: {
      mark: 'Tasks',
      title: 'Workflow tasks',
      tabActive: 'Active',
      tabCompleted: 'Completed',
      emptyActive: 'No active tasks',
      emptyCompleted: 'No completed tasks',
      emptyWorkflowActive: 'No active workflows',
      emptyWorkflowCompleted: 'No completed workflows',
      generationSection: 'Generation jobs',
      videoSection: 'Video generation',
      workflowSection: 'Workflows',
      videoKind: 'Video',
      videoUntitled: 'Video job',
      model3dKind: '3D model',
      model3dUntitled: '3D model job',
      videoStopConfirmMessage:
        'Cancel this video job? The provider may still continue and bill the request.',
      stop: 'Stop',
      remove: 'Remove',
      stopConfirmTitle: 'Stop task',
      stopConfirmMessage: 'Stop this workflow? It will be moved to the Completed tab.',
      duplicateTitle: 'Already in queue',
      duplicateMessage:
        'This output branch is already running in the task list. Wait for it to finish or stop it first. Different boundary outputs can run in parallel.',
      enqueueFailedTitle: 'Cannot enqueue',
      enqueueFailedNoTarget:
        'Cannot resolve a task target for this canvas (missing shot or script context). Open shot video from the script and try again.',
      nodeRunBlockedTitle: 'Cannot run node',
      nodeRunBlockedMessage: 'This workflow is running in the task list. Individual or upstream node runs are disabled until it finishes or is stopped.',
      status: {
        pending: 'Queued',
        running: 'Running',
        done: 'Done',
        error: 'Failed',
        stopped: 'Stopped'
      },
      videoStatus: {
        submitted: 'Submitted',
        running: 'Generating',
        succeeded: 'Done',
        failed: 'Failed',
        cancelled: 'Cancelled'
      },
      nodeStatus: {
        idle: 'Idle',
        pending: 'Pending',
        running: 'Running',
        done: 'Done',
        error: 'Error',
        degraded: 'Degraded',
        skipped: 'Skipped'
      },
      mcpSection: 'MCP generation',
      mcpDefaultModel: 'Default model',
      mcpStatus: {
        running: 'Generating',
        done: 'Done',
        error: 'Failed'
      },
      mcpKind: {
        generate_image: 'Image',
        generate_video: 'Video',
        generate_speech: 'Voice',
        generate_music: 'Music',
        generate_model3d: '3D model'
      }
    },
    logs: {
      mark: 'Logs',
      title: 'Node execution log',
      defaultTitle: 'Node workflow',
      viewLog: 'View log',
      emptySessions: 'No runs yet',
      emptyEvents: 'Select a run to inspect events',
      emptyFiltered: 'No matching events',
      searchPlaceholder: 'Search node / message…',
      filterLevel: 'Filter by level',
      copy: 'Copy',
      copied: 'Copied',
      clearAll: 'Clear',
      clearConfirmTitle: 'Clear execution logs',
      clearConfirmMessage: 'Clear all execution logs? This cannot be undone.',
      startWorkflow: 'Started full workflow',
      startToNode: 'Started run to node {name}',
      startNodeOnly: 'Started node {name}',
      sessionStatus: {
        running: 'Running',
        done: 'Succeeded',
        error: 'Failed',
        stopped: 'Stopped'
      },
      mode: {
        workflow: 'Full',
        toNode: 'To node',
        nodeOnly: 'Node only',
        task: 'Task',
        mcp: 'MCP'
      },
      kind: {
        run_start: 'Start',
        run_end: 'End',
        node_status: 'Node',
        run_message: 'Message'
      },
      level: {
        all: 'All',
        info: 'Info',
        warn: 'Warn',
        error: 'Error'
      },
      detailTitle: 'Execution detail',
      detailHint: 'Select a log row above to inspect details',
      resizeSplit: 'Drag to resize list and detail panes',
      detailTime: 'Time',
      detailDuration: 'Duration',
      detailType: 'Type',
      detailError: 'Error code',
      portInputs: 'Input ports',
      portOutputs: 'Output ports',
      apiCall: 'API call #{n} · {kind}',
      apiRequest: 'Request',
      apiResponse: 'Response',
      apiResponseEmpty: 'No response payload',
      apiEmpty:
        'No API call recorded for this node (no model call, or local/passthrough execution)',
      apiEmptyPending:
        'Call in progress; select the Done or Failed status row to view request and response',
      apiEmptyPickDone:
        'This is an intermediate status. Select the same node’s Done or Failed row for details; model calls are usually on the upstream image/video generate node.',
      apiEmptyPassthrough:
        'This is an output/passthrough node and does not call the model. Check the Done row on an upstream image or video generate node.',
      apiEmptyNotNode: 'This log entry has no node API details'
    },
    play: {
      start: 'Run workflow (selection runs that node and upstream)',
      stop: 'Stop workflow',
      startAria: 'Run',
      stopAria: 'Stop',
      confirmAllTitle: 'Run workflow',
      confirmAllMessage: 'Run all nodes in this workflow?',
      enqueue: 'Add to task list',
      runUpstreamSkip: 'Run node & upstream (skip done)',
      runUpstreamForce: 'Re-run node & upstream'
    },
    nodeRun: {
      execute: 'Run current node',
      rerun: 'Re-run current node',
      stop: 'Stop'
    },
    link: {
      start: 'Link',
      cancel: 'Cancel link'
    },
    edgeStyle: {
      curve: 'Curve',
      orthogonal: 'Orthogonal',
      hidden: 'Hidden',
      cycleTitle: 'Edge style: {style} (click to switch)'
    },
    fitView: 'Fit view',
    episodePipeline: {
      open: 'Episode pipeline',
      openTitle: 'Open the episode pipeline overview (global control for the current canvas)'
    },
    agentPipeline: {
      open: 'Agent pipeline',
      openTitle: 'Open the agent pipeline overview (review / rework)'
    },
    minimap: {
      title: 'Node minimap (click or drag to navigate)',
      empty: 'No nodes'
    },
    layout: {
      dragHandle: 'Drag layout toolbar',
      expand: 'Expand layout tools',
      collapse: 'Collapse layout tools',
      grid: 'Show/hide background grid',
      minimap: 'Show/hide minimap',
      collapseAllNodes: 'Collapse all nodes',
      expandAllNodes: 'Expand all nodes',
      snap: 'Snap to grid while dragging',
      snapShort: 'Snap',
      alignLeft: 'Align left',
      alignRight: 'Align right',
      alignTop: 'Align top',
      alignBottom: 'Align bottom',
      alignCenterX: 'Align center X',
      alignCenterY: 'Align center Y',
      distributeH: 'Distribute horizontally',
      distributeV: 'Distribute vertically',
      distributeHShort: 'Dist. H',
      distributeVShort: 'Dist. V',
      auto: 'Auto layout',
      autoShort: 'Layout'
    },
    context: {
      addNode: 'Add node',
      addAndConnect: 'Add node and connect',
      noCompatibleNodes: 'No compatible nodes for this port type',
      selection: 'Selection',
      copy: 'Copy',
      paste: 'Paste',
      copyEmpty: 'Select nodes to copy first',
      copyNone: 'No copyable nodes in the selection (singletons / canonical outputs are skipped)',
      pasteEmpty: 'Clipboard has no pasteable nodes',
      pasteSkippedHost: 'Skipped {n} host node(s) (host assets must be unique on the canvas)',
      groups: {
        imageRefine: 'Image refine',
        imageEdit: 'Image edit',
        episode: 'Episode',
        text: 'Text',
        prompt: 'Prompt',
        game: 'Game',
        motionFx: 'Motion FX',
        model3d: '3D Model',
        comic: 'Comic',
        agent: 'Agent',
        ad: 'Ads'
      }
    },
    episodeAgent: {
      breakdown: 'Beat breakdown',
      beatboard: '9-grid beat board',
      sequence: '4-grid storyboard',
      motion: 'Motion prompts',
      review: 'Director review',
      title: {
        beatBreakdown: 'Beat Breakdown Table',
        grid9Storyboard: '9-Grid Storyboard Table',
        grid4Motion: '4-Grid Motion Storyboard Table',
        motionPrompt: 'Motion Prompt Table',
        directorReview: 'Director Review'
      }
    },
    bundle: {
      title: 'Bundle',
      hint: 'Merge same-type wires to reduce canvas edges; the instruction panel expands real upstream thumbnails'
    },
    selectImage: {
      appMark: 'Select image',
      hint: 'Click a thumbnail to select; double-click a thumbnail to open preview. Defaults to the first image.',
      previewHint: 'Double-click to preview',
      empty: 'No upstream images yet. Connect an image output (e.g. director) and run it first.'
    },
    selectVideo: {
      appMark: 'Select video',
      hint: 'Click a thumbnail to select; double-click a thumbnail to open preview. Defaults to the first video.',
      previewHint: 'Double-click to preview',
      empty: 'No upstream videos yet. Connect a video generate node and run it first.'
    },
    selectVoice: {
      appMark: 'Select voice',
      hint: 'Click a card to select; double-click to open the preview. Defaults to the first voice.',
      previewHint: 'Double-click to preview',
      empty: 'No upstream voices yet. Connect a voice generate node and run it first.'
    },
    selectText: {
      appMark: 'Select text',
      hint: 'Click a card to select one text; double-click to open the notepad. Defaults to the first item.',
      openHint: 'Double-click to open notepad',
      empty: 'No upstream texts yet. Connect a text generate node and run it first.'
    },
    selectBeat: {
      appMark: 'Select beat unit',
      hint: 'Double-click to pick one unit from the upstream beat catalog. Defaults to the first item.',
      empty: 'No upstream beat units yet. Connect a beat asset and run it first.'
    },
    textsPreview: {
      appMark: 'Texts preview',
      hint: 'Preview multiple texts in a grid; double-click a card to open the notepad.',
      openHint: 'Double-click to open notepad',
      empty: 'No text output yet. Connect upstream text and run first.'
    },
    adVariants: {
      appMark: 'Ad variants',
      presetGroups: {
        general: 'General',
        industry: 'Industry',
        promotion: 'Promo & live'
      },
      presets: {
        basicAb: 'Basic A/B',
        cameraAngle: 'Camera angles',
        sceneTone: 'Scene & tone',
        audienceEmotion: 'Audience & emotion',
        copyStyle: 'Copy styles',
        vertical: 'Vertical feed',
        beauty: 'Beauty',
        electronics: 'Electronics',
        food: 'Food & drink',
        fashion: 'Fashion',
        baby: 'Baby & mom',
        home: 'Home',
        auto: 'Auto',
        pet: 'Pets',
        education: 'Education',
        travel: 'Travel',
        health: 'Health',
        realestate: 'Real estate',
        finance: 'Finance',
        game: 'Gaming',
        fitness: 'Fitness',
        daily: 'Household',
        beverage: 'Beverages',
        freshfood: 'Fresh food',
        hotel: 'Hotel & stay',
        livestream: 'Livestream',
        holiday: 'Holiday'
      },
      product: 'Product description',
      productPlaceholder: 'e.g. a bottle of perfume',
      aspectRatio: 'Aspect ratio (optional, e.g. 1:1 / 9:16)',
      aspectRatioPlaceholder: 'Leave blank for default',
      dimensions: 'Variant dimensions',
      addDimension: 'Add dimension',
      dimensionHint: 'Each dimension is a label plus values (one per line); cells are the Cartesian product of all values.',
      dimensionEmpty: 'No dimensions yet. Click "Add dimension" to start.',
      dimensionLabelPlaceholder: 'Dimension name, e.g. camera angle',
      dimensionValuesPlaceholder: 'One value per line',
      removeDimension: 'Remove dimension',
      preview: 'Variant preview',
      cellCount: '{n} cells',
      previewEmpty: 'Add dimensions and values above to generate the variant preview',
      compare: 'Generation comparison',
      selectedCount: '{n} selected',
      exporting: 'Exporting…',
      exportSelected: 'Export selected',
      compareEmptyHint: 'Run this node to generate variants, then compare and mark selected / rejected here.',
      loading: 'Loading…',
      select: 'Select',
      reject: 'Reject',
      clear: 'Clear',
      clearAll: 'Clear all verdicts',
      save: 'Save',
      exportNoFiles: 'No files to export',
      exportSkipped: ' (skipped {n})',
      exportDone: 'Exported {copied} files{skipped} to {directory}',
      exportFailed: 'Export failed'
    },
    multiAngle: {
      appMark: 'Multi-angle editor',
      hint: 'Double-click to edit camera and model; run the node to generate',
      yaw: 'Orbit',
      pitch: 'Pitch',
      shotScale: 'Shot scale',
      prompt: 'Splice panel prompt',
      panelPrompt: 'Panel prompt',
      panelPromptPlaceholder: 'Subject/style base text (merged with camera line when splice is on)',
      cameraPrompt: 'Camera prompt',
      outputPrompt: 'Final output',
      promptEmpty: '(Built from current camera params)',
      promptOffHint: 'When off, only the camera prompt is emitted (panel text is not spliced)',
      pitchUp: 'Pitch up',
      pitchDown: 'Pitch down',
      yawLeft: 'Orbit left',
      yawRight: 'Orbit right',
      resetParams: 'Reset parameters',
      presets: {
        custom: 'Custom',
        fisheye: 'Fisheye',
        dutch: 'Dutch angle',
        frontHigh: 'Front high',
        frontLow: 'Front low',
        panoramaHigh: 'Panorama high',
        back: 'Back view'
      }
    },
    lighting: {
      appMark: 'Lighting effects',
      hint: 'Double-click to edit lighting and model; run the node to generate',
      perspective: 'Perspective',
      frontal: 'Front',
      global: 'Global',
      smartMode: 'Smart mode',
      brightness: 'Brightness',
      color: 'Color',
      mainLight: 'Key light',
      rimLight: 'Rim light',
      smartPromptPlaceholder: "e.g. Make the lighting 'golden hour'",
      presetsTitle: 'Presets',
      outputPrompt: 'Final prompt',
      promptEmpty: '(Built from current lighting params)',
      resetParams: 'Reset parameters',
      directions: {
        left: 'Left',
        top: 'Top',
        right: 'Right',
        front: 'Front',
        bottom: 'Bottom',
        back: 'Back'
      },
      presets: {
        custom: 'Custom',
        overexposedFilm: 'Overexposed film',
        blueBacklight: 'Blue backlight',
        rembrandt: 'Rembrandt',
        cyberpunk: 'Cyberpunk',
        sunsetPsychedelic: 'Sunset psychedelic',
        mysteriousLowKey: 'Mysterious low-key',
        goldenHour: 'Golden hour',
        nolanColdGrey: 'Nolan cold grey'
      }
    },
    portraitTexture: {
      appMark: 'Portrait texture',
      hint: 'Double-click to adjust texture and model; run the node to generate',
      previewEmpty: 'Connect an image input to preview here',
      outputPrompt: 'Final prompt',
      promptEmpty: '(Built from current texture options)',
      resetParams: 'Reset parameters',
      fields: {
        personScene: 'Person-scene blend',
        lightShadow: 'Light-shadow blend',
        skin: 'Skin',
        texture: 'Texture',
        sharpness: 'Sharpness'
      },
      options: {
        personScene: {
          light: 'Light align',
          natural: 'Natural blend',
          deep: 'Deep blend'
        },
        lightShadow: {
          softFill: 'Soft fill',
          natural: 'Natural match',
          atmosphere: 'Atmosphere boost'
        },
        skin: {
          clear: 'Clear retouch',
          natural: 'Natural skin',
          real: 'Real texture'
        },
        texture: {
          soft: 'Soft texture',
          natural: 'Natural texture',
          grain: 'Grain texture'
        },
        sharpness: {
          softFocus: 'Soft focus',
          standard: 'Standard clear',
          hd: 'HD sharpen'
        }
      }
    },
    portraitQuality: {
      appMark: 'Portrait texture',
      previewEmpty: 'Connect an image input to preview here',
      previewLoadFailed: 'Failed to load preview image',
      compareLoadFailed: 'Failed to load image',
      before: 'Before',
      after: 'After',
      generated: 'Generated',
      reset: 'Reset',
      groups: {
        skin: 'Skin',
        light: 'Light',
        blend: 'Blend',
        color: 'Color',
        detail: 'Detail'
      },
      fields: {
        skinSmoothing: 'Skin smoothing',
        skinPore: 'Pore retention',
        skinEvenness: 'Even skin tone',
        blemishRemoval: 'Blemish removal',
        lightRatio: 'Light ratio',
        fillLight: 'Fill light',
        rimLight: 'Rim light',
        catchlight: 'Catchlight',
        atmosphere: 'Atmosphere',
        personSceneBlend: 'Person-scene blend',
        edgeTransition: 'Edge transition',
        colorTemp: 'Color temperature',
        saturation: 'Saturation',
        contrast: 'Contrast',
        skinTone: 'Skin tone',
        sharpness: 'Sharpness',
        grain: 'Grain',
        softFocus: 'Soft focus',
        clarity: 'Clarity',
        vignette: 'Vignette'
      },
      presets: {
        natural: 'Natural',
        magazine: 'Magazine',
        commercial: 'Commercial',
        cinematic: 'Cinematic',
        retro: 'Retro'
      }
    },
    emotion: {
      appMark: 'Emotion pad',
      hint: 'Double-click to adjust emotion and model; run the node to generate',
      previewEmpty: 'Connect an image input for preview',
      locate: 'Emotion locate',
      outputPrompt: 'Final prompt',
      promptEmpty: '(Built from emotion pad selection)',
      resetParams: 'Reset parameters',
      axis: {
        excited: 'Excited',
        calm: 'Calm',
        close: 'Close',
        distant: 'Distant'
      }
    },
    lipSync: {
      hint: 'Connect a character image or reference video plus voice, then run; needs Seedance 2.0 or another audio-reference video model'
    },

    upscale: {
      systemPrompt: 'System prompt',
      mergedPrompt: 'Merged prompt',
      promptEmpty: 'No merged prompt yet. Write the upscale instruction in the node instruction box.'
    },
    expand: {
      appMark: 'Image expand',
      hint: 'Double-click to place the source on the canvas; run the node to outpaint',
      noSource: 'Connect an upstream image first',
      aspect: 'Aspect ratio',
      resolution: 'Resolution',
      count: 'Count',
      countOption: '{n}',
      resetParams: 'Reset parameters',
      systemPrompt: 'System prompt',
      mergedPrompt: 'Merged prompt',
      promptEmpty: 'No merged prompt yet. Adjust the canvas in the editor dialog.',
      aspects: {
        original: 'Original ratio',
        '1_1': '1:1',
        '4_3': '4:3',
        '3_4': '3:4',
        '16_9': '16:9',
        '9_16': '9:16'
      }
    },
    redraw: {
      appMark: 'Redraw',
      hint: 'Double-click to paint a mask; run the node to inpaint',
      noSource: 'Connect an upstream image first',
      promptPlaceholder: 'Start your design…',
      brushSize: 'Brush size',
      undo: 'Undo',
      redo: 'Redo',
      aspect: 'Aspect ratio',
      resolution: 'Resolution',
      count: 'Count',
      countOption: '{n}',
      systemPrompt: 'System prompt',
      mergedPrompt: 'Merged prompt',
      promptEmpty: 'No merged prompt yet. Paint a mask and describe the change in the editor.',
      tools: {
        brush: 'Brush',
        rect: 'Rectangle',
        eraser: 'Eraser'
      },
      aspects: {
        original: 'Original ratio'
      }
    },
    erase: {
      appMark: 'Erase',
      hint: 'Double-click to paint a mask; run the node to erase masked content',
      noSource: 'Connect an upstream image first',
      promptPlaceholder: 'Optional: what to remove / how to fill…',
      brushSize: 'Brush size',
      undo: 'Undo',
      redo: 'Redo',
      aspect: 'Aspect ratio',
      resolution: 'Resolution',
      count: 'Count',
      countOption: '{n}',
      systemPrompt: 'System prompt',
      mergedPrompt: 'Merged prompt',
      promptEmpty: 'No merged prompt yet. Paint a mask in the editor to erase.',
      tools: {
        brush: 'Brush',
        rect: 'Rectangle',
        eraser: 'Clear mask'
      },
      aspects: {
        original: 'Original ratio'
      }
    },
    matte: {
      appMark: 'Matte',
      hint: 'Run to auto-cutout; double-click to refine the keep-mask',
      noSource: 'Connect an upstream image first',
      promptPlaceholder: 'Optional: subject hints…',
      brushSize: 'Brush size',
      undo: 'Undo',
      redo: 'Redo',
      aspect: 'Aspect ratio',
      resolution: 'Resolution',
      count: 'Count',
      countOption: '{n}',
      systemPrompt: 'System prompt',
      mergedPrompt: 'Merged prompt',
      promptEmpty: 'No merged prompt yet. Run for auto cutout, or paint a keep-mask.',
      tools: {
        brush: 'Brush',
        rect: 'Rectangle',
        eraser: 'Clear mask'
      },
      aspects: {
        original: 'Original ratio'
      }
    },
    crop: {
      appMark: 'Crop',
      hint: 'Double-click to adjust the crop frame; run the node to apply',
      noSource: 'Connect an upstream image first',
      aspect: 'Aspect ratio',
      frame: 'Frame',
      aspects: {
        original: 'Original ratio',
        custom: 'Custom'
      }
    },
    gridSplit: {
      appMark: 'Grid split',
      hint: 'Double-click to pick grid cells; run the node to split tiles locally without an AI model',
      noSource: 'Connect an upstream image first',
      selectedCount: 'Selected {n} cells',
      sizeLabel: '{n}-grid ({r}×{c})',
      clearSelection: 'Clear selection',
      customTitle: 'Custom grid',
      grid: 'Grid',
      selected: 'Selected',
      allCells: 'All cells',
      cropPreview: 'Cropped source',
      cropPreviewHint: 'Tiles cropped from the upstream image with the current grid',
      cropLoading: 'Building crop preview…',
      cropEmpty: 'No crop preview yet',
      cropFailed: 'Failed to build crop preview',
      presets: {
        p4: '4-grid (2×2)',
        p9: '9-grid (3×3)',
        p16: '16-grid (4×4)',
        p25: '25-grid (5×5)'
      }
    },
    layerSplit: {
      appMark: 'Layer split',
      hint: 'Run the node to decompose with Seedream 5.0 Pro; double-click to reorder and move layers',
      needRun: 'Connect an upstream image and run the node. The model returns a base image plus transparent layers you can drag, resize, and restack here.',
      noSelection: 'No layer selected',
      layers: 'Layers',
      emptyLayers: 'No layers yet. Run the node to decompose the image.',
      layerCount: '{n} layers',
      prompt: 'Decompose prompt',
      promptPlaceholder: 'Optional: name the elements to isolate. Leave empty to detect subjects, text, and decorations automatically.',
      resolution: 'Resolution',
      sendBack: 'Send backward',
      bringForward: 'Bring forward',
      hideBase: 'Hide base',
      showBase: 'Show base',
      hideLayer: 'Hide layer',
      showLayer: 'Show layer',
      baseLayer: 'Base',
      resetPos: 'Reset position',
      resetAll: 'Reset all',
      redecompose: 'Clear and decompose again',
      splitSelected: 'Split selected layer',
      splitting: 'Splitting selected layer…',
      splitNeedLayer: 'Select a layer to split further',
      splitAlready: 'This layer is already in a split group',
      splitNeedImage: 'The selected layer has no image',
      group: 'Group',
      splitGroupName: '{name} split',
      splitLogTitle: 'Split selected layer · {name}',
      splitLogStart: 'Decompose layer “{layer}” further',
      splitLogDone: 'Split into {n} layers and added a group',
      collapseGroup: 'Collapse group',
      expandGroup: 'Expand group',
      hideGroup: 'Hide group',
      showGroup: 'Show group',
      exportSelected: 'Export selected layer',
      exportGroup: 'Export selected group',
      exportAll: 'Export all layers',
      exporting: 'Exporting…',
      exportSelectedDone: 'Selected layer exported',
      exportGroupDone: 'Exported {n} layers from the group',
      exportAllDone: 'Exported {n} layers',
      exportFailed: 'Export failed: {error}',
      exportNeedImage: 'No layer image to export',
      exportFilterImage: 'Images',
      exportPsd: 'Export PSD',
      exportPsdDone: 'PSD exported',
      exportPsdFilter: 'Photoshop PSD'
    },
    anim2d: {
      inspectorHint: 'Feed in a frame-animation sheet from upstream; run this node to split frames and preview playback below',
      genInspectorHint: 'Double-click the node to open the instruction panel for presets and action; set rows/cols and system prompt here, then run to generate the sheet',
      cardPlayHint: 'Double-click to play / pause the frame sequence',
      rows: 'Rows',
      cols: 'Cols',
      preset: 'Preset',
      systemPrompt: 'System prompt',
      systemPromptPlaceholder: 'Optional: custom system prompt for generation (empty = default)',
      action: 'Action',
      actionPlaceholder: 'Optional: custom action description (empty = preset)',
      preview: 'Animation preview',
      play: 'Play',
      pause: 'Pause',
      fps: 'FPS',
      loop: 'Loop',
      loading: 'Building frame preview…',
      emptyPreview: 'No preview yet: connect an upstream sheet and run this node',
      presets: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Run',
        jump: 'Jump',
        attack: 'Attack',
        hurt: 'Hurt',
        skill: 'Skill'
      }
    },
    group: {
      action: 'Group',
      ungroup: 'Ungroup',
      title: 'Node group',
      defaultName: 'Group',
      renamePlaceholder: 'Group name'
    },
    resize: 'Drag to resize',
    defaultNode: 'Node',
    note: {
      badge: 'Note',
      title: 'Note',
      placeholder: 'Double-click to edit note…',
      draftPlaceholder: 'Note…'
    },
    scriptNode: {
      badge: 'Text',
      title: 'Text',
      placeholder: 'Double-click to edit text…'
    },
    inputInterface: {
      badge: 'Input',
      title: 'Input',
      hint: 'Stable host input slot from the outer graph; not deletable',
      placeholder: 'Waiting for outer input…',
      badgeByType: {
        text: 'Text in',
        image: 'Image in',
        voice: 'Audio in',
        video: 'Video in',
        model: 'Model in',
        worldEntities: 'World entities'
      },
      placeholderByType: {
        text: 'Waiting for outer text…',
        image: 'Waiting for outer image…',
        voice: 'Waiting for outer audio…',
        video: 'Waiting for outer video…',
        model: 'Waiting for outer model…',
        worldEntities: 'Waiting for outer world entities…'
      }
    },
    boundaryInput: {
      badge: 'Boundary in',
      title: 'Input'
    },
    boundaryOutput: {
      badge: 'Boundary out',
      title: 'Output'
    },
    hostInterface: {
      encapsulate: 'Encapsulate as host asset',
      encapsulateAction: 'Encapsulate asset',
      encapsulateFailed: 'Encapsulation failed. Please try again.',
      defaultName: 'Host Asset',
      nameTitle: 'Create host asset',
      nameMessage: 'Enter a name for the reusable host asset.',
      saveMessage: 'Choose a folder and enter a name for the host asset.',
      namePlaceholder: 'Host asset name',
      inspectorHint:
        'Edit host input/output port definitions. Saving updates the asset definition and this instance snapshot.',
      assetInspectorHint:
        'Edit this host asset’s input/output ports. Apply to write the asset and sync open canvas instances.',
      inputs: 'Inputs',
      outputs: 'Outputs',
      addPort: 'Add port',
      emptyPorts: 'No ports yet',
      collapsePorts: 'Collapse ports',
      expandPorts: 'Expand ports',
      reorderHint: 'Drag the handle to reorder ports; the node updates live.',
      reorderHandle: 'Drag to reorder',
      portId: 'Port ID',
      portType: 'Port type',
      portLabel: 'Label',
      dataType: 'Port type',
      multiple: 'Allow multiple',
      apply: 'Apply interface',
      saving: 'Saving…'
    },
    demo: {
      badge: 'Plugin demo',
      title: 'Example node',
      placeholder: 'Double-click to edit demo text…',
      inspector: {
        hint: 'Built-in graph plugin demo: custom node type, scope, card, and inspector registration.'
      }
    },
    directorNode: {
      hint: 'Double-click to open director deck edit',
      live: 'Live preview · double-click to open director deck edit'
    },
    timelineOutputNode: {
      hint: 'Double-click to enter the timeline editor'
    },
    worldTableNode: {
      hint: 'Double-click to open world element review'
    },
    worldGenNode: {
      hint: 'Double-click to open world element gen canvas'
    },
    beatTableNode: {
      hint: 'Double-click to open beat unit table'
    },
    beatGenNode: {
      hint: 'Double-click to enter beat unit text refinement'
    },
    node: {
      collapsePreview: 'Collapse preview',
      expandPreview: 'Expand preview',
      expandImageGrid: 'Expand to image grid',
      collapseImageGrid: 'Collapse to stacked preview',
      expandImageGridShort: 'Expand',
      collapseImageGridShort: 'Stack',
      enableLock: 'Lock: skip execution and keep the last result',
      disableLock: 'Unlock: the next run will re-execute',
      directorReviewFail: 'Director review failed',
      directorReviewPass: 'Director review passed'
    },
    nodeRole: {
      ref: 'Ref',
      host: 'Host',
      subgraph: 'Subgraph',
      generate: 'Generate',
      output: 'Output',
      lock: 'Locked',
      missing: 'Unavailable'
    },
    assetRef: {
      hint: 'Imported reference · preview from the asset library'
    },
    assetHost: {
      hint: 'Host asset · double-click to edit'
    },
    subgraphDive: {
      hint: 'Contains subgraph · double-click to enter'
    },
    assetMissing: {
      hint: 'Linked asset deleted · node unavailable'
    },
    generateNode: {
      hint: 'Generation node · adjust parameters in the right panel',
      instructionHint: 'Double-click to edit generation instruction'
    },
    error: {
      selfAssetDrop: 'Cannot drop this asset into its own workflow — that would create a circular dependency',
      alreadyOnGraph: 'This host asset is already on the canvas',
      unsupportedDrop: 'This canvas does not accept this asset type',
      dropPathFailed: 'Could not read dropped file paths. Import into the library first.',
      importFailed: 'Import failed: {detail}',
      noneImportable: 'No files could be imported onto the canvas'
    },
    port: {
      outTitle: 'Drag to connect to output',
      outAllTitle: 'Drag full history output',
      outAllShort: 'All',
      inTitle: 'Accept references',
      limitMax: 'Up to {n}',
      limitMaxAfterStyle: 'Port up to {n} ({style} reserved by style refs)',
      limitUnknown: 'Limit undeclared (*)',
      outputDuration: 'Output duration {range}',
      firstFrame: 'First',
      lastFrame: 'Last',
      referenceImage: 'Reference',
      types: {
        image: 'Image',
        images: 'Images',
        voice: 'Voice',
        voices: 'Voices',
        video: 'Video',
        videos: 'Videos',
        text: 'Text',
        texts: 'Texts',
        world: 'World element',
        worldEntities: 'World entities',
        beat: 'Beat',
        model: 'Model'
      }
    },
    media: {
      restart: 'Back to start',
      pause: 'Pause',
      play: 'Play'
    },
    runStatus: {
      pending: 'Pending',
      running: 'Running',
      done: 'Done',
      error: 'Failed',
      degraded: 'Degraded'
    },
    preview: {
      audioError: 'Cannot play audio',
      videoError: 'Video codec not supported',
      imageTitle: 'Image preview',
      videoTitle: 'Video preview',
      audioTitle: 'Audio preview'
    },
    run: {
      stopped: 'Stopped',
      complete: 'Done · {visual} visual refs · {audio} voice refs',
      completeImages: 'Done · {images} image(s) merged at output',
      completeText: 'Done · {text} text input(s) merged at output',
      completeOk: 'Done',
      noRefs: 'Done · output has no asset refs, images, or text inputs',
      failed: 'Run failed',
      cancelled: 'Workflow cancelled',
      cycle: 'Workflow has a cycle and cannot run',
      noOutput: 'Output node not found',
      unboundAsset: 'Node has no bound asset',
      missingAsset: 'Linked asset was deleted',
      hostNoGraph: 'Host asset has no runnable inner graph',
      hostEnqueueFailed: 'Failed to enqueue the host inner graph',
      noInput: 'Enter a generation instruction, or connect an upstream input',
      lipSyncNoVisual: 'Connect a character image or reference video first',
      lipSyncNoAudio: 'Connect a voice (speech) input first',
      noMask: 'Paint a mask in the redraw editor first',
      lockNoCache:
        'Node is locked, but there is no reusable last result; generate once successfully, or unlock',
      hostNoCacheCook:
        'No reusable host output; use the radial menu “Cook subgraph” to run the inner graph',
      comicPageEmpty: 'Add panels in the comic page editor, or connect upstream images and Cook',
      comicPageCompose: 'Comic page compose failed (must run in the app UI)',
      dismissHint: 'Click to dismiss'
    },
    types: {
      asset: {
        image: 'Image generation',
        canvas: 'Canvas edit',
        video: 'Video generation',
        voice: 'Voice generation',
        motion: 'Director deck edit',
        model: 'Model',
        screenplay: 'Screenplay generation',
        gameSystem: 'Plan generation',
        script: 'Shot',
        subgraph: 'Host asset'
      },
      output: {
        video: 'Video output',
        image: 'Image output',
        voice: 'Voice output',
        text: 'Screenplay output',
        director: 'Director deck output',
        timeline: 'Cut timeline',
        beat: 'Beat output',
        beatUnit: 'Beat output',
        world: 'World entities output'
      },
      note: {
        text: 'Note'
      },
      media: {
        bundle: 'Bundle',
        review: 'Media review',
        rework: 'Media rework'
      },
      comic: {
        page: 'Comic page'
      },
      play: {
        script: 'Text'
      },
      image: {
        select: 'Select image',
        multiAngle: 'Multi-angle edit',
        lighting: 'Lighting effects',
        portraitTexture: 'Portrait texture',
        emotion: 'Emotion pad',
        upscale: 'HD upscale',
        expand: 'Image expand',
        redraw: 'Redraw',
        erase: 'Erase',
        matte: 'Matte',
        crop: 'Crop',
        gridSplit: 'Grid split',
        layerSplit: 'Layer split',
        toPrompt: 'Image reverse prompt',
        adVariants: 'Ad variants'
      },
      video: {
        select: 'Select video',
        lipSync: 'Lip sync',
        framePull: 'Frame pull',
        reshoot: 'Segment reshoot'
      },
      voice: {
        select: 'Select voice'
      },
      prompt: {
        optimize: 'Prompt optimize'
      },
      text: {
        select: 'Select text'
      },
      beat: {
        select: 'Select beat unit',
        split: 'Beat split',
        table: 'Beat table',
        gen: 'Beat unit gen',
        unitGen: 'Beat gen',
        unitRef: 'Beat ref'
      },
      ui: {
        split: 'UI screen split',
        gen: 'UI screen gen'
      },
      anim: {
        '2d': '2D Frame Animation'
      },
      frame: {
        animGen: 'Generate Frame Animation Sheet'
      },
      episode: {
        anchorSelect: 'Anchor select',
        cellSelect: 'Dynamic cell select'
      },
      world: {
        extract: 'World extract',
        table: 'World element review',
        gen: 'World element gen'
      },
      plugin: {
        example: {
          node: 'Graph plugin demo'
        }
      }
    },
    titles: {
      image: 'Image',
      video: 'Video',
      voice: 'Voice',
      motion: 'Director Deck',
      model: 'Model',
      canvas: 'Canvas',
      world: 'World Elements',
      beat: 'Beat Units',
      subgraph: 'Host Asset',
      screenplayOutput: 'Screenplay output',
      directorOutput: 'Director deck output',
      timelineOutput: 'Cut timeline',
      beatOutput: 'Beat output',
      beatUnitOutput: 'Beat output',
      worldOutput: 'World entities output',
      assetOutput: {
        image: 'Image output',
        video: 'Video output',
        voice: 'Voice output',
        text: 'Text output'
      }
    },
    output: {
      voiceHint: 'Controls the final voice output of this workflow.',
      videoHint: 'Controls the final video output of this workflow.',
      imageHint: 'Controls the final image output of this workflow.',
      textHint: 'Controls the final text output of this workflow.',
      connectHint: 'Connect reference nodes here to form the final output.',
      resultText: 'Run result',
      resultPlaceholder: 'After you run the node, aggregated screenplay text appears here and can be edited',
      exportScreenplay: 'Export screenplay…',
      exportVideo: 'Export video…',
      exportImages: 'Batch export…',
      exporting: 'Exporting…',
      exportSuccess: 'Screenplay saved',
      exportVideoSuccess: 'Video saved',
      exportImagesSuccess: 'Exported {n} images',
      exportFailed: 'Export failed: {error}',
      exportFilterText: 'Text files',
      exportFilterVideo: 'Video files',
      exportFilterAll: 'All files',
      volume: 'Output volume',
      muted: 'Mute output',
      loop: 'Loop playback',
      duration: 'Duration (seconds)',
      speed: 'Playback speed',
      beatPaths: 'Saved screenplays',
      beatPathsHint:
        'Running Beat unit gen saves each unit as its own screenplay file; double-click to preview',
      beatPathsEmpty: 'Nothing saved yet — refine units and run this node',
      beatPathPending: '(not saved)'
    },
    notepad: {
      appMark: 'Notepad',
      copy: 'Copy',
      copied: 'Copied to clipboard',
      close: 'Close',
      saveHint: 'Ctrl+S to save',
      placeholder: 'Edit text here…',
      emptyReadonly: 'No text content yet',
      readonly: 'Read-only',
      unsaved: 'Unsaved',
      saved: 'Saved',
      stats: '{lines} lines · {chars} chars · {tokens} tokens',
      fontSize: '{size}px',
      fontZoomHint: 'Ctrl + scroll to zoom font',
      openHint: 'Double-click to view / edit',
      imageBatch: 'Reference images'
    },
    inspector: {
      node: {
        title: 'Node parameters',
        hint: 'Preview on the node; edit details here',
        empty: 'No node selected'
      },
      assetRef: 'Referenced media',
      assetHost: 'Host asset',
      unselected: 'Not selected',
      assetTaken: '(already used by another node)',
      displayName: 'Display name',
      weight: 'Reference strength',
      label: 'Note label',
      labelPlaceholder: "Used when expanding {'@'} mentions",
      volume: 'Volume',
      previewMuted: 'Mute preview',
      notes: 'Node notes',
      outputPreview: 'Output preview',
      outputDelete: 'Delete output',
      outputGalleryHint: 'Click to set as current output; × deletes that item',
      outputPreviewCount: '{n} items',
      outputPreviewLoading: 'Loading preview…',
      outputPreviewMissing: 'Preview unavailable',
      aggregateJson: 'Aggregate JSON',
      revealInAssets: 'Reveal in Assets',
      current: 'Current: ',
      noAssets: 'No “{type}” assets in the library. Create or import one first.',
      note: {
        hint: 'Canvas sticky note. Double-click the node to view and edit in Notepad.',
        title: 'Title',
        body: 'Note content',
        empty: 'No note node selected'
      },
      inputInterface: {
        hint: 'Injected from the outer host edges. Read-only preview here; double-click does not open Notepad.',
        dataType: 'Data type',
        port: 'Outer port',
        index: 'Slot index',
        preview: 'Input preview',
        previewEmpty: 'No outer value yet (appears after parent wires or runs)',
        previewEmbedded: '(Embedded preview data)',
        empty: 'No input interface node selected'
      },
      boundary: {
        hintInput:
          'Host boundary input. Preview the injected value by port type; notes body is not editable here.',
        hintOutput:
          'Host boundary output. Preview the value fed into this port by type; notes body is not editable here.',
        dataType: 'Data type',
        port: 'Port',
        preview: 'Port preview',
        previewEmpty: 'No preview yet (connect upstream and generate)',
        empty: 'No boundary node selected'
      },
      script: {
        hint: 'Text node. Edit content here, or expand to view in Notepad.',
        body: 'Content',
        empty: 'No text node selected'
      },
      group: {
        hint: 'Click a group label to select the group; double-click the label to rename.',
        name: 'Group name',
        memberCount: 'Members',
        empty: 'No group selected'
      },
      select: {
        hint: 'Double-click the node to open the picker. After running, preview the selected out port here.'
      },
      episode: {
        anchorHint:
          'Pick the anchor cell (1–9) from the upstream 9-grid beat board; the node outputs that cell’s prompt when run.',
        cellHint:
          'Pick a dynamic cell by group (1–9) × cell (1–4) from the upstream motion prompt table; the node outputs that cell’s instruction when run.',
        anchorLabel: 'Anchor',
        groupLabel: 'Group',
        cellLabel: 'Cell'
      },
      worldTable: {
        hint: 'Double-click to open the world element review. Run the node to import catalog JSON and preview the out port here.'
      },
      worldGen: {
        hint: 'Four image-group outs: Characters / Scenes / Props / Weapons. Run current collects existing images; use radial Cook subgraph to batch-run element graphs.',
        groupedPreview: 'Grouped preview',
        groupedPreviewHint: 'Organized by image-group out port; double-click a thumbnail to zoom',
        groupCount: '{n} images',
        groupEmpty: 'No images yet'
      },
      beatTable: {
        hint: 'Double-click to open the beat unit table. Run the node to import catalog JSON and preview the out port here.'
      },
      beatGen: {
        hint: 'Running this node collects unit texts and saves them to the output path.'
      },
      multiAngle: {
        hint: 'Double-click to edit camera and model. Run to generate an image; this panel shows the gallery and prompt.',
        spliceOn: 'On',
        spliceOff: 'Off'
      },
      lighting: {
        hint: 'Double-click to edit lighting and model. Run to generate an image; this panel shows the gallery and prompt.'
      },
      portraitTexture: {
        hint: 'Double-click to adjust texture and model. Run to generate an image; this panel shows the gallery and prompt.'
      },
      emotion: {
        hint: 'Double-click to adjust emotion and model. Run to generate an image; this panel shows the gallery and prompt.'
      },
      upscale: {
        hint: 'Double-click the node to open the instruction box. This panel shows the system prompt and the final upscale prompt.',
        previewHint: 'Double-click a thumbnail to enter media preview.',
        previewEmpty: 'No upscaled images yet. Connect an input and run the node.'
      },
      framePull: {
        hint: 'Double-click the node to open the frame puller: < and > step frames, Space toggles playback. Capture frames and add notes there.',
        openHint: 'Double-click to open the frame puller',
        noSource: 'Connect an upstream video (a video generation node after running, or a video asset)',
        capture: 'Capture frame',
        clear: 'Clear frames',
        captured: '{n} captured',
        keyframeStrip: 'Keyframe strip',
        frameStripFallback: 'ffprobe not found — fell back to a per-frame strip',
        framesEmpty: 'No frames captured yet. Use “Capture frame” in the frame puller.',
        prevFrame: 'Previous frame',
        nextFrame: 'Next frame',
        frameLabel: 'Frame {frame}/{total}',
        frameShort: 'F',
        remove: 'Remove frame',
        note: 'Frame note',
        notePlaceholder: 'Note shot, composition or performance observations for this frame…'
      },
      reshoot: {
        hint: 'Connect a source video and double-click the node to open the reshoot desk: locate the start and end times to edit, write the change, and run — only that segment is regenerated while the rest stays intact. Works best with Seedance 2.5 (timestamp-level video editing)',
        noSource: 'Connect an upstream video (a video generation node after running, or a video asset)',
        segment: 'Reshoot segment',
        markStart: 'Mark start {time}',
        markEnd: 'Mark end {time}',
        start: 'Start (s)',
        end: 'End (s)',
        segmentHint: 'Seek the video, then click "Mark start / Mark end", or type seconds directly; the range is written into the prompt as mm:ss',
        instruction: 'Change',
        instructionPlaceholder: 'e.g. change the black umbrella in the character’s hand to a transparent one',
        model: 'Video model',
        range: 'Reshoot range {range}',
        done: 'Done'
      },
      lipSync: {
        hint: 'Connect a character image or reference video plus voice. With a video, lip-sync targets the character in that clip. Optionally add performance notes; pick Seedance 2.0.',
        modelHint:
          'Prefer Seedance 2.0 / 2.0 Fast. Model, duration, and aspect ratio are set in the node instruction panel.'
      },
      expand: {
        hint: 'Double-click the node to place the source. This panel shows the system prompt and the merged expand prompt.'
      },
      redraw: {
        hint: 'Double-click the node to paint a mask. This panel shows the system prompt and the merged redraw prompt.'
      },
      erase: {
        hint: 'Double-click the node to paint a mask. This panel shows the system prompt and the merged erase prompt.'
      },
      matte: {
        hint: 'Run for auto cutout. Double-click to refine a keep-mask. This panel shows the system and merged prompts.'
      },
      crop: {
        hint: 'Double-click the node to set the crop frame. Run the node to crop locally.'
      },
      gridSplit: {
        hint: 'Double-click to choose grid size and cells. Run the node to split tiles locally without an AI model.'
      },
      layerSplit: {
        hint: 'Run the node to decompose with Seedream 5.0 Pro. Double-click to drag, resize, and restack layers. Select a layer to split it further into a group. Changing the prompt or resolution triggers a new decompose.'
      },
      camera: {
        hint: 'Edits sync to the director deck edit preview; orbiting in the preview updates it live.',
        position: 'Position',
        rotation: 'Rotation (°)',
        scale: 'Scale',
        target: 'Look-at target',
        fov: 'Field of view',
        openStage: 'Director deck edit',
        empty: 'No director deck edit node selected',
        outImages: 'Output · Shots',
        outImagesCount: '{n}',
        outImagesHint: 'Double-click a thumbnail to enter media preview',
        outImagesEmpty: 'No camera shots yet. Capture shots in the director stage to see them here',
        outActions: 'Output · Actions',
        outActionsCount: '{n}',
        outActionsHint: 'Double-click a thumbnail to preview the recording',
        outActionsEmpty: 'No actions yet. Record animation in the director stage to see them here'
      },
      mediaReview: {
        hint: 'Connect upstream images (or video, reviewed by first frame) and run director PASS/FAIL review via a vision model',
        instruction: 'Review instruction',
        instructionPlaceholder:
          'Optional review points (e.g. "check finger count / blurry face"); defaults to the built-in checklist',
        status: 'Review verdict',
        pending: 'Pending',
        pass: 'Pass',
        fail: 'Fail',
        reason: 'FAIL reason',
        reviewModel: 'Review model',
        reviewModelHint: 'A vision model that can read the image; pick one with image input support',
        reviewModelFallback: 'No review model set — falling back to the generate model; verdicts may be unreliable',
        referenceCount: 'Reference image count',
        referenceCountHint: 'The first N images are the comparison baseline (not scored); the rest are under review. Leave empty for auto',
        score: 'Review score',
        rounds: 'Rounds'
      },
      mediaRework: {
        hint: 'Generate → review → inject the FAIL reason and regenerate until passed or max attempts',
        instruction: 'Generation instruction',
        instructionPlaceholder: 'Describe what to generate; the last FAIL reason is injected on each retry',
        maxAttempts: 'Max rework attempts',
        status: 'Rework status',
        running: 'Running',
        passed: 'Passed',
        exhausted: 'Exhausted',
        final: 'Final verdict',
        lastReason: 'Last reason',
        imageModel: 'Image model',
        reviewModel: 'Review model',
        reviewModelHint: 'Must be a vision model with image input; reviewing with an image model is blind judging',
        reviewModelFallback: 'No review model set — falling back to the image model; verdicts may be unreliable',
        imageModelFallbacks: 'Fallback image models',
        reviewModelFallbacks: 'Fallback review models',
        modelFallbacksHint: 'Used in order when the primary model call fails (rate limit / unavailable / timeout)',
        strategy: 'Rework strategy',
        strategyAuto: 'Auto escalate (recommended)',
        strategyGuidance: 'Targeted fix',
        strategyReseed: 'Re-stage composition',
        strategyStronger: 'Reinforced constraints',
        confirmFirst: 'Wait for confirmation after the first image',
        confirmFirstHint: 'Shows you the first image before spending the remaining attempts unattended',
        awaitingConfirm: 'Awaiting confirmation',
        awaitingConfirmHint: 'Paused after the first image. Continue reworking, or accept the current result',
        continueRework: 'Continue rework',
        acceptCurrent: 'Accept current',
        rounds: 'Rounds',
        cost: 'Call cost',
        score: 'Review score',
        best: 'Best picked'
      },
      adVariants: {
        hint: 'Set product description and aspect ratio here; double-click the node to open the variant editor for dimensions, preview and comparison.'
      },
      comicPage: {
        hint: 'Double-click the node to open the comic page editor. Cook fills empty panels from upstream images and composites a PNG.',
        cardHint: 'Double-click to open the comic page editor',
        json: 'Page JSON',
        invalidJson: 'Invalid JSON (not saved; preview falls back to default)',
        reset: 'Reset to default',
        openEditor: 'Open editor',
        pageTitle: 'Page title',
        columns: 'Columns',
        rows: 'Rows',
        gutter: 'Gutter',
        width: 'Width',
        height: 'Height',
        addPanel: 'Add panel',
        removePanel: 'Remove panel',
        addBubble: 'Add bubble',
        removeBubble: 'Remove bubble',
        panelSection: 'Selected panel',
        bubbleSection: 'Selected bubble',
        globalSection: 'Global properties',
        bgColor: 'Background color',
        bgTransparent: 'Transparent (no fill)',
        panelTitle: 'Panel title',
        panelImage: 'Image path',
        panelFallback: 'Panel',
        pickImage: 'Import image',
        pickIncoming: 'Upstream images',
        clearImage: 'Clear image',
        bubbleText: 'Dialogue',
        bubblePlaceholder: 'Dialogue',
        speaker: 'Speaker',
        tail: 'Tail',
        exportPng: 'Export PNG',
        exporting: 'Exporting…',
        exportDone: 'Exported {count} file(s)',
        exportCancel: 'Cancelled',
        emptyPanels: 'No panels yet',
        gridHint: 'Click a panel/bubble for its properties; use the Global properties toolbar button or blank space for page properties. Drag the selected panel edge/corner handles to resize, drag the bubble corner dot to scale; drag images onto empty cells to create panels',
        done: 'Done'
      },
      generate: {
        hint: 'Connect upstream references, then adjust generation parameters for this type here.',
        lock: 'Lock output',
        lockHint:
          'When enabled, this node skips the model call and outputs the currently selected gallery item from the last run',
        mediaOutputDir: 'Output path',
        mediaOutputDirHint:
          'Relative to project root; defaults to Images / Videos / Texts / Voices under the project cache root (see Global parameters); not auto-registered in the asset library',
        pathOutsideProject: 'Please choose a folder inside the project directory',
        screenplayBody: 'Screenplay text',
        model: 'Text model',
        imageModel: 'Image model',
        videoModel: 'Video model',
        voiceModel: 'Purchased speaker',
        model3dModel: '3D model',
        voiceProfile: 'Character voice',
        voiceProfileNone: 'None (describe the voice)',
        voiceProfileManage: 'Manage voice profiles',
        voiceProfileDelete: 'Delete',
        voiceProfileEmpty: 'No character voice profiles yet; create one below (character + voice id or clone reference audio)',
        voiceProfileCharacter: 'Character name (required)',
        voiceProfileVoice: 'Voice id (MiniMax voice_id / Ark speaker_id)',
        voiceProfileReferenceAudio: 'Clone reference audio (in-project path or URL)',
        voiceProfileDescription: 'Voice description',
        voiceProfileSave: 'Save profile',
        modelPreview: 'Model preview',
        modelPreviewEmpty: 'The generated 3D model appears here',
        model3dStyle: '3D style',
        model3dStyleHint: 'Lux3D text-to-3D style (ignored for image-to-3D)',
        model3dStyles: {
          photorealistic: 'Photorealistic',
          cartoon: 'Cartoon',
          anime: 'Anime',
          handPainted: 'Hand-painted',
          cyberpunk: 'Cyberpunk',
          fantasy: 'Fantasy',
          glass: 'Glass'
        },
        noModels: 'No models available',
        systemPrompt: 'System prompt',
        systemPromptPlaceholder: 'Define the model role and output rules; leave empty to use the built-in default',
        instruction: 'Instruction',
        instructionPlaceholder: "Expand or rewrite into a full screenplay; use {'@'} to cite connected inputs",
        imageInstructionPlaceholder: "Describe the image generation intent; use {'@'} to cite connected inputs",
        toPromptInstructionPlaceholder:
          'Generate a structured Chinese prompt from the image, covering subject, environment, lighting, camera language, and style keywords.',
        videoInstructionPlaceholder: "Describe the video generation intent; use {'@'} to cite connected inputs",
        lipSyncInstructionPlaceholder:
          'Optional performance / camera notes (image→图片1+音频1; video→视频1+音频1); Seedance 2.0 recommended',
        voiceInstructionPlaceholder:
          "Describe the voice in text; connect an image for visual prompt; use {'@'} to cite inputs",
        model3dInstructionPlaceholder:
          "Describe the 3D model to generate; connect reference images for image-to-3D; use {'@'} to cite inputs",
        worldExtractInstructionPlaceholder:
          "Extract characters / scenes / props / weapons; use {'@'} to cite connected inputs",
        beatSplitInstructionPlaceholder:
          "Decompose the screenplay into beat units; use {'@'} to cite connected inputs",
        uiSplitInstructionPlaceholder:
          "Split UI screens from the design doc into detailed prompts; use {'@'} to cite connected inputs",
        beatUnitGenInstructionPlaceholder:
          "Optional focus for this refine (rules live in Inspector system prompt); use {'@'} to cite upstream",
        refsEmpty: "Connect upstream inputs to cite with {'@'}, or type the instruction alone",
        disconnectRef: 'Disconnect',
        reorderRef: 'Drag to reorder references',
        styleRefRole: 'Style',
        styleRefTitle: "{'@'}{n} style · {name} · strength {weight} (fixed order)",
        mentionHint: "Type {'@'} to cite connected inputs, or click a thumbnail to insert {'@'}n",
        presets: {
          open: 'Prompt presets',
          title: 'Instruction templates',
          visualChip: {
            genre: 'Genre',
            cast: 'Cast',
            hook: 'Hook'
          },
          titleScreenplay: 'Screenplay templates',
          titleOptimize: 'Prompt optimize templates',
          titleWorldExtract: 'World extract templates',
          titleBeatSplit: 'Beat split templates',
          titleImage: 'Image generation templates',
          titleVideo: 'Video generation templates',
          titleLipSync: 'Lip sync templates',
          titleToPrompt: 'Image reverse-prompt templates',
          tabGeneral: 'General',
          tabGame: 'Game',
          tabFilm: 'Film',
          tabCharacter: 'Character',
          tabFx: 'Effects',
          frameAnimFx: {
            smoke: 'Smoke',
            fire: 'Fire',
            lightning: 'Lightning',
            explosion: 'Explosion',
            water: 'Water ripples',
            magic: 'Magic particles',
            rain: 'Rain',
            snow: 'Snow',
            spark: 'Sparks',
            wind: 'Wind',
            dust: 'Dust',
            shockwave: 'Shockwave',
            glow: 'Glow',
            embers: 'Embers',
            bubbles: 'Bubbles',
            slash: 'Slash',
            impact: 'Impact'
          },
          frameAnimWushu: {
            xianglong: 'Dragon-Subduing Palms',
            taiji: 'Tai Chi',
            wuyingjiao: 'Shadowless Kick',
            zuiquan: 'Drunken Fist',
            cunquan: 'Wing Chun Inch Punch',
            shizihou: "Lion's Roar",
            lingbo: 'Light-Footed Steps',
            saotangtui: 'Leg Sweep',
            tieshazhang: 'Iron Sand Palm',
            yiyangzhi: 'One-Yang Finger',
            liumai: 'Six Meridian Sword',
            dugu: 'Lonely Nine Swords',
            dianxue: 'Acupoint Sealing',
            jinzhongzhao: 'Golden Bell Shield',
            rulai: "Buddha's Palm",
            tiyunzong: 'Cloud Ladder Leap'
          },
          screenplay: {
            create: 'Short-drama framework',
            twists: 'Add payoffs & twists',
            dialogue: 'Polish dialogue',
            hooks: 'Strengthen ending hooks'
          },
          image: {
            styleTransfer: 'Style transfer',
            multiAngle9: 'Multi-angle 9-grid',
            story4: 'Storyboard 4-grid',
            faceTurnaround: 'Character face turnaround',
            characterSheet: 'Character design sheet',
            characterTurnaround: 'Character turnaround',
            propTurnaround: 'Prop turnaround',
            weaponTurnaround: 'Weapon turnaround',
            sceneSheet: 'Scene design sheet (Three.js-ready)',
            productSheet: 'Product design sheet',
            story25: '25-grid storyboard',
            cinematicLighting: 'Cinematic lighting fix',
            physics3sLater: 'Predict +3s',
            physics5sBefore: 'Rewind −5s',
            panorama720: '720 panorama',
            shotEstablish: 'Storyboard thinking: establishing frame',
            shotDetail: 'Storyboard thinking: insert close-up',
            shotConfrontation: 'Storyboard thinking: low-angle standoff'
          },
          video: {
            firstLastFrame: 'First & last frame',
            cameraDolly: 'Dolly in / out',
            cameraPanTilt: 'Pan / tilt / truck',
            cameraOrbit: 'Orbit 360 / 180',
            cameraCrane: 'Crane up / down',
            cameraFollow: 'Follow / POV',
            cameraCombo: 'Combo moves',
            textToVideo: 'Text-to-video',
            multimodalRef: 'Multimodal reference',
            shotEstablish: 'Storyboard thinking: establishing motion',
            shotDetail: 'Storyboard thinking: detail action',
            heroEntrance: 'Hero entrance',
            performanceRealism: 'Realistic character performance',
            poseStandingFront: 'Pose: front standing',
            poseThreeQuarter: 'Pose: three-quarter stand',
            poseProfile: 'Pose: profile',
            poseBack: 'Pose: from behind',
            poseWalk: 'Pose: walking',
            poseSit: 'Pose: sitting',
            poseLookBack: 'Pose: look back',
            poseHandsOnHips: 'Pose: hands on hips',
            poseRun: 'Pose: running',
            framePairContinuity: 'Frame pair: motion continuity',
            framePairProduct: 'Frame pair: product reveal',
            framePairTransition: 'Frame pair: matched transition',
            transitionHard: 'Ad transition: hard cut',
            transitionFlash: 'Ad transition: flash',
            transitionMotion: 'Ad transition: motion match',
            transitionDissolve: 'Slow transition: short dissolve',
            transitionOcclusion: 'Transition: foreground occlusion',
            transitionFocus: 'Slow transition: focus reveal'
          },
          lipSync: {
            talkingHead: 'Talking to camera',
            performance: 'Performance lip sync',
            fromVideo: 'Lip sync from video'
          },
          reshoot: {
            prop: 'Swap prop',
            scene: 'Swap scene',
            camera: 'Change camera',
            performance: 'Change performance'
          },
          optimize: {
            character: 'Character design prompt',
            prop: 'Prop prompt',
            scene: 'Scene prompt (Three.js)',
            camera: 'Camera move prompt',
            expression: 'Expression reference prompt',
            vfx: 'VFX prompt',
            episodeBreakdown: 'Storyboard artist: beat breakdown',
            episodeBeatBoard: 'Storyboard artist: 9-grid beat board',
            episodeSequenceBoard: 'Storyboard artist: 4-grid storyboard',
            episodeMotionPrompt: 'Animator: motion prompt table',
            episodeDirectorReview: 'Director: PASS/FAIL review'
          },
          toPrompt: {
            structured: 'Full structured caption',
            subject: 'Subject-focused',
            style: 'Style & medium',
            light: 'Composition & lighting',
            gameCharacter: 'Character sheet',
            gameScene: 'Scene concept',
            gameUi: 'UI / icon',
            gameProp: 'Prop / weapon',
            gameUa: 'UA still',
            gameVfx: 'Skill VFX frame',
            filmEstablish: 'Establishing shot',
            filmCloseup: 'Performance close-up',
            filmLight: 'Lighting & grade',
            filmStoryboard: 'Storyboard frame',
            filmCostume: 'Costume / makeup',
            filmCamera: 'Camera language'
          },
          worldExtract: {
            create: 'Extract world elements',
            refine: 'Refine element catalog'
          },
          beatSplit: {
            create: 'Split into beat units',
            refine: 'Refine beat structure'
          }
        },
        instructionExpand: 'Open instruction editor',
        instructionPreview: 'Preview final prompt',
        instructionPreviewTitle: 'Final prompt preview',
        previewStyleImage: 'Style · {name}',
        previewStyleImageFallback: 'Style reference',
        previewStyleImageAt: "{'@'}{n} style · {name} · strength {weight}",
        textExpand: 'Open text editor',
        instructionDialogMark: 'Prompt',
        instructionDialogTitle: 'Generation instruction',
        instructionDialogHint: "Use {'@'} to cite connected inputs and apply presets",
        instructionDialogDone: 'Done',
        executeHint: 'Running this generation node calls the model above. The “Screenplay output” node only passes results through (no API).',
        configureModelsHint: 'Configure a text model in Settings (API key + at least one selected model)',
        configureImageModelsHint: 'Configure an image model in Settings (API key + at least one selected model)',
        configureAudioModelsHint:
          'Add a purchased speaker_id under Settings → Ark → Voice first',
        configureVideoModelsHint: 'Configure a video model in Settings (API key + at least one selected model)',
        imageParams: {
          title: 'Image generation params',
          placeholder: 'Params',
          loading: 'Loading model capabilities…',
          empty: 'This model declares no tunable params',
          quality: 'Quality',
          qualityLow: 'Low',
          qualityMedium: 'Standard',
          qualityHigh: 'High',
          qualityAuto: 'Auto',
          resolution: 'Resolution',
          aspectRatio: 'Aspect ratio',
          count: 'Count',
          countOption: '{n}',
          seed: 'Seed',
          seedPlaceholder: 'Empty = random',
          seedRandom: 'Random',
          seedSummary: 'seed {n}',
          seedUseGlobal: 'Use global seed',
        },
        videoParams: {
          title: 'Video generation params',
          placeholder: 'Params',
          loading: 'Loading model capabilities…',
          empty: 'This model declares no tunable params',
          duration: 'Duration',
          durationOption: '{n}s',
          resolution: 'Resolution',
          aspectRatio: 'Aspect ratio',
          generateAudio: 'Generate audio',
          generateAudioOn: 'On',
          generateAudioOff: 'Off',
          frameMode: 'Frame mode',
          frameMode_none: 'None',
          frameMode_first: 'First frame',
          frameMode_first_last: 'First & last',
          seed: 'Seed',
          seedPlaceholder: 'Empty = random',
          seedRandom: 'Random',
          seedSummary: 'seed {n}',
          seedUseGlobal: 'Use global seed'
        },
        generatedImages: 'Generated images',
        generatedImagesCount: '{n}',
        generatedImagesHint:
          'Each run appends images and selects the newest. Click to set as current out; double-click to preview; × to delete.',
        generatedImagesEmpty: 'No generations yet. Run this node to see results here.',
        generatedImagesDelete: 'Delete this image',
        generatedVideos: 'Generated videos',
        generatedVideosCount: '{n}',
        generatedVideosHint:
          'Each run appends videos and selects the newest. Click to set as current out; double-click to preview; × to delete.',
        generatedVideosEmpty: 'No generations yet. Run this node to see results here.',
        generatedVideosDelete: 'Delete this video',
        generatedTexts: 'Generated screenplays',
        generatedTextsCount: '{n}',
        generatedTextsHint:
          'Each run appends text and selects the newest. Click to set as current out; double-click to open; × to delete.',
        generatedTextsEmpty: 'No generations yet. Run this node to see results here.',
        generatedTextsDelete: 'Delete this text',
        generatedTextsOpen: 'Double-click to open notepad',
        generatedVoices: 'Generated voices',
        generatedVoicesCount: '{n}',
        generatedVoicesHint:
          'Each run appends audio and selects the newest. Click to set as current out; × to delete.',
        generatedVoicesEmpty: 'No generations yet. Run this node to see results here.',
        generatedVoicesDelete: 'Delete this voice',
        setAsOutput: 'Set as current output',
        selectedAsOutput: 'Current output'
      }
    }
  },
  draft: {
    error: {
      notFound: 'Draft missing or already saved'
    }
  }
} as const

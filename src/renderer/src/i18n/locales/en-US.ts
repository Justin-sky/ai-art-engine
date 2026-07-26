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
    second: 's',
    open: 'Open'
  },
  app: {
    nav: {
      studio: 'Studio',
      settings: 'Settings'
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
    models: {
      addProvider: 'Add model provider',
      add: 'Add',
      collapseProvider: 'Collapse provider',
      expandProvider: 'Expand provider',
      emptyProviders:
        'No providers yet. Add OpenRouter, Volcengine Ark, Kling, Hailuo (MiniMax), Tongyi Qianwen, or ModelScope (Mota), enter credentials, then select models per modality.',
      unifiedHint:
        'One credential set / Base URL per provider. Fetch text, image, video, and audio models. Ark Voice uses purchased speaker_ids; Kling, Hailuo, and Qianwen use an API Key; ModelScope uses an access token (text/image).',
      enabled: 'Enabled',
      remove: 'Remove',
      label: 'Display name',
      baseUrl: 'API Base URL',
      showApiKey: 'Show API key',
      hideApiKey: 'Hide API key',
      credentialsHint: {
        openrouter: 'Get API key:',
        'volcengine-ark': 'Get Ark API key (text / image / video):',
        kling: 'Get API key:',
        minimax: 'Get API key:',
        dashscope: 'Get Bailian API key:',
        modelscope: 'Get access token:'
      },
      arkVoiceCredentialsHint:
        'Voice design uses Doubao openspeech — use the speech console API key (may differ from Ark) and enter a purchased speaker_id:',
      fetchModels: 'Fetch models',
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
        audio: 'Voice'
      },
      modalityHint: {
        text: 'Script and chat generation via OpenRouter /api/v1/models.',
        image: 'Image generation via /api/v1/images/models.',
        video: 'Shot video generation via /api/v1/videos/models.',
        audio: 'TTS via /api/v1/models?output_modalities=speech and /api/v1/audio/speech.'
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
          'Hailuo (MiniMax) video: POST /v1/video_generation (text / image / first-last frame), then files/retrieve for the download URL. Default Base URL is api.minimaxi.com; video catalog is a local static list.',
        audio:
          'MiniMax voice design via POST /v1/voice_design. Node instruction is the voice prompt; returns voice_id and preview audio. Catalog lists a local Voice Design entry.'
      },
      dashscopeModalityHint: {
        text: 'Qwen chat via OpenAI-compatible API. Default Base URL is dashscope.aliyuncs.com/compatible-mode/v1 (/chat/completions).',
        image:
          'Wanxiang text-to-image via async /api/v1/services/aigc/text2image/image-synthesis (native URL derived from the compatible Base URL).',
        video:
          'Wanxiang text/image-to-video via async /api/v1/services/aigc/video-generation/video-synthesis; with a first frame, img_url is sent — pick an i2v model.'
      },
      modelscopeModalityHint: {
        text: 'ModelScope API-Inference chat. Default Base URL is api-inference.modelscope.cn/v1; use an access token (ms-…).',
        image: 'ModelScope text-to-image via /v1/images/generations; model ids look like org/model_name.'
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
      hint: 'Loads controlled declarative extensions from the user data plugins folder. External scripts are not executed.',
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
      default: 'Default',
      save: 'Save layout',
      export: 'Export',
      import: 'Import',
      delete: 'Delete',
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
      inspector: 'Inspector'
    },
    inspector: {
      unsupported: 'No inspector is available for the selected object',
      emptyGlobals: 'No global parameters',
      multiAssets: '{count} assets selected'
    },
    editor: {
      asset: 'Asset Editor',
      screenplay: 'Screenplay',
      script: 'Shot',
      canvas: 'Canvas',
      world: 'World Elements',
      narrative: 'Narrative Units',
      director: 'Director Deck'
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
    alreadySelected: 'In use',
    maxReached: 'You can add at most {max} style images',
    truncated: 'Limit reached — added {n} of the selected files (max {max})',
    customName: 'Custom style',
    readFailed: 'Failed to read image'
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
      canvas: 'Canvas',
      world: 'World Elements',
      narrative: 'Narrative Units'
    },
    create: {
      image: 'New Image',
      video: 'New Video',
      voice: 'New Voice',
      motion: 'New Director Deck',
      model: 'New Model',
      screenplay: 'New Screenplay',
      script: 'New Shot',
      canvas: 'New Canvas',
      world: 'New World Elements',
      narrative: 'New Narrative Units',
      default: 'New Asset'
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
      packageExportDone: 'Exported {assets} asset(s), {folders} folder(s)\n{path}',
      packageImportDone:
        'Imported {assets} asset(s) (folders: new {folders}, reused {folderReuse}); entry reuse {reused}; remapped {remapped}',
      reimportNone: 'No media assets to reimport',
      reimportPartial: 'Reimported {ok} item(s), skipped {skip}',
      viewList: 'List',
      viewIcon: 'Icons',
      folder: 'Folder',
      assetsRoot: 'Assets',
      resizeFolderPane: 'Drag to resize folder pane',
      viewSizeHint: 'Display size (minimum shows names only)',
      dropHint: 'Drop images, videos, voice, or .aipackage files here to import',
      dropRelease: 'Release to import',
      context: {
        openEditor: 'Open editor',
        showInFolder: 'Show in File Explorer',
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
      referencesShot: 'Shot "{title}"',
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
      shotCount: 'Shot count',
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
  shot: {
    defaultName: 'Shot',
    index: "Shot {'#'}{n}",
    duration: 'Duration',
    inspector: {
      title: 'Shot parameters',
      empty: 'No shot selected'
    },
    staging: {
      title: 'Shot staging',
      select: 'Choose a camera, performance, or lighting preset…',
      selectField: 'Choose a {field} preset…',
      apply: 'Apply',
      showPresets: 'Show presets',
      hidePresets: 'Hide presets',
      hint: 'Inserts at the active caret and appends other related fields without clearing existing text.',
      hintVisual: 'Click a card to apply. Glyphs are for recognition only; the written prompt text is unchanged.',
      group: {
        cameraLanguage: 'Camera language',
        bodyFacing: 'Body orientation',
        performance: 'Performance',
        lighting: 'Lighting',
        advertising: 'Ad camera and transitions'
      },
      preset: {
        heroEntrance: 'Hero entrance',
        mysteriousEntrance: 'Mysterious entrance',
        storyEntrance: 'Story-driven entrance',
        twoShot: 'Two-shot',
        overShoulder: 'Over-the-shoulder reverse',
        highEmotion: 'High-angle pressure',
        backEmotion: 'Back-view isolation',
        dutch: 'Dutch-angle imbalance',
        facingFront: 'Full front',
        facingThreeQuarter: 'Front three-quarter',
        facingProfile: 'Pure profile',
        facingBackThreeQuarter: 'Rear three-quarter',
        facingBack: 'Strict back view',
        performanceAnger: 'Anger: facial action',
        performanceDazed: 'Dazed: focus and body drop',
        performanceManic: 'Manic: blinking, twitch, head tilt',
        performanceRelief: 'Relief: breath and release',
        performanceAnxiety: 'Anxiety: scanning, fingers, weight',
        performanceGrief: 'Grief: held breath and lost strength',
        performanceConfidence: 'Confidence: steady gaze and posture',
        performanceSurprise: 'Surprise: freeze and recoil',
        lightingTop: 'Top light: eye-socket shadow',
        lightingSide: 'Side light: split face',
        lightingRembrandt: 'Rembrandt: cheek triangle',
        lightingVolumetric: 'Volumetric light beams',
        lightingBacklight: 'Backlight: rim separation',
        lightingPractical: 'Motivated practical light',
        adImpact: 'Impact hard cut',
        adFlash: 'Flash transition',
        adMotion: 'Motion-match transition',
        adDissolve: 'Short dissolve',
        adMatchCut: 'Shape / color match cut',
        adOcclusion: 'Foreground occlusion',
        adFocus: 'Defocus reveal',
        adJumpCut: 'Locked-camera jump cut',
        adProductReveal: 'Hero product reveal'
      }
    },
    field: {
      visual: 'Visual description',
      shotSize: 'Shot size',
      lighting: 'Lighting',
      dialogue: 'Dialogue / VO',
      soundFx: 'Sound FX',
      cameraMove: 'Camera move',
      finalPrompt: 'Final prompt'
    },
    placeholder: {
      visual: 'Describe the frame…',
      lighting: 'Lighting mood…',
      dialogue: 'Dialogue or voice-over…',
      soundFx: 'SFX…',
      cameraMove: 'Camera move…'
    },
    shotSize: {
      大特写: 'Extreme close-up',
      特写: 'Close-up',
      半身景: 'Medium close-up',
      中景: 'Medium shot',
      中远景: 'Medium long shot',
      全景: 'Full shot',
      远景: 'Long shot'
    },
    refRole: {
      background: 'Background',
      character: 'Character',
      firstFrame: 'First frame',
      style: 'Style',
      motion: 'Motion'
    },
    audioKind: {
      voice: 'Voice',
      dialogue_tts: 'Dialogue TTS',
      sfx: 'SFX',
      bgm: 'BGM'
    },
    status: {
      draft: 'Draft',
      generating: 'Generating',
      done: 'Done',
      failed: 'Failed'
    },
    generate: {
      button: 'Generate video',
      running: 'Generating {n}%'
    },
    history: {
      title: 'Generation history',
      noPrompt: '(no prompt)'
    },
    genHint: {
      refCount: '{n} refs',
      refs: 'Refs: {list}',
      promptOnly: 'Text prompt only'
    },
    error: {
      canvasExport: 'Canvas export failed',
      generateFailed: 'Generation failed',
      draftMissing: 'Cannot create shot: draft missing'
    },
    strip: {
      title: 'Shots',
      switchHint: 'Drag onto canvas to create shot params; click to focus a shot',
      new: '+ New',
      collapse: 'Collapse shot strip',
      expand: 'Expand shot strip'
    },
    table: {
      title: 'Shot table · {n} shots',
      new: '+ New',
      resizeCol: 'Drag to resize column',
      resizeRow: 'Drag to resize row',
      column: {
        name: 'Name',
        duration: 'Duration',
        visual: 'Visual',
        shotSize: 'Size',
        lighting: 'Lighting',
        dialogue: 'Dialogue / VO',
        soundFx: 'SFX',
        cameraMove: 'Camera',
        status: 'Status'
      },
      placeholder: {
        name: 'Shot name',
        visual: 'Visual description',
        lighting: 'Lighting',
        dialogue: 'Dialogue',
        soundFx: 'SFX',
        cameraMove: 'Camera move'
      }
    },
    refs: {
      title: 'References',
      hint: 'Writes to the shot video node; frames are not @ mentions',
      drop: 'Drop assets here',
      add: '+ Add reference',
      badge: 'Ref {n}',
      notes: 'Notes (optional)',
      weight: 'Reference strength',
      insertVisual: 'Insert into visual description',
      remove: 'Remove',
      help: 'Supports images, voice, and more as generation references.',
      firstFrame: 'First',
      lastFrame: 'Last',
      setFrame: 'Choose',
      changeFrame: 'Change',
      clearFrame: 'Clear',
      frameHint: 'First/last frames connect to dedicated video-node ports and do not use @ numbers.',
      error: {
        invalidType: 'Drop an image, voice, or video asset',
        noFile: 'This asset has no linked file yet',
        dropFailed: 'Could not read dropped asset'
      }
    },
    mention: {
      hint: "Type {'@'} to mention a reference, e.g. {'@'}1, {'@'}2",
      labelHint:
        "Type {'@'} to insert a readable reference label; configure generation-port mentions in the instruction editor"
    }
  },
  script: {
    hint: {
      imageGraph: 'Per-shot visual graph · use the right Inspector for params and run',
      videoGraph: 'Per-shot video graph · use the right Inspector for params and run',
      table: 'Shot table · bulk edit all shots',
      assetGraph:
        'Double-click shot split to edit instruction · double-click shot table to open the table · double-click shot image/video gen to expand the matching graph below'
    },
    dialog: {
      shotImageEditor: 'Shot images',
      shotVideoEditor: 'Shot videos',
      shotTable: 'Shot table',
      close: 'Close'
    },
    pane: {
      resizeSplit: 'Drag to resize the upper/lower canvases'
    },
    shotTableWindow: {
      loading: 'Opening shot table…',
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
      hierarchyEmpty: 'No objects',
      resizeHierarchySplit: 'Drag to resize hierarchy and assets',
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
      deleteObject: 'Delete',
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
      tabShots: 'Positions',
      position: 'Position',
      rotationDeg: 'Rotation (°)',
      scale: 'Scale',
      uniformScale: 'Uniform Scale',
      color: 'Color',
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
      captureShot: 'Capture',
      aspectRatio: 'Aspect ratio',
      aspectAuto: 'Auto',
      shotsEmpty: 'No shots yet',
      shotPreviewTitle: 'Image preview',
      shotPreviewEmpty: 'No image',
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
        exportVideo: 'Export video',
        exporting: 'Exporting…',
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
  canvas: {
    noShot: 'No shot selected',
    selectShot: 'Select a shot',
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
      needShot: 'Select a shot first',
      dropFailed: 'Could not read dropped asset',
      imageOnly: 'Canvas only accepts image assets',
      noFile: 'This image has no linked file yet'
    }
  },
  narrative: {
    asset: {
      hint: 'Double-click split for instructions · table for catalog · editor for full text'
    },
    dialog: {
      close: 'Close',
      table: 'Narrative unit table',
      editor: 'Narrative unit editor'
    },
    hint: {
      table: 'Narrative unit table · edit beats and review status',
      editor: 'Narrative unit editor · list on the left · full text on the right'
    },
    editor: {
      empty: 'No narrative units yet — run split or add rows in the table',
      selectHint: 'Select a narrative unit on the left',
      fullText: 'Full text',
      fullTextPlaceholder: 'Source excerpt from the screenplay'
    },
    table: {
      new: 'New',
      empty: 'No entries yet — add one or run split first',
      unit: 'Narrative unit',
      column: {
        order: 'Order',
        title: 'Title',
        summary: 'Summary',
        dramaticFunction: 'Dramatic function',
        characters: 'Characters',
        location: 'Location',
        status: 'Status'
      },
      placeholder: {
        summary: 'One-line summary of this unit'
      }
    }
  },
  world: {
    asset: {
      hint: 'Double-click extract for instructions · table for catalog · editor expands four canvases below'
    },
    dialog: {
      close: 'Close',
      elementTable: 'World element table',
      editor: 'World element editor'
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
      column: {
        name: 'Name',
        prompt: 'Prompt',
        status: 'Status'
      },
      placeholder: {
        prompt: 'Image generation prompt'
      }
    },
    tab: {
      characters: 'Characters',
      scenes: 'Scenes',
      props: 'Props',
      weapons: 'Weapons'
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
      videoSection: 'Video generation',
      workflowSection: 'Workflows',
      videoUntitled: 'Video job',
      videoStopConfirmMessage:
        'Cancel this video job? The provider may still continue and bill the request.',
      stop: 'Stop',
      remove: 'Remove',
      stopConfirmTitle: 'Stop task',
      stopConfirmMessage: 'Stop this workflow? It will be moved to the Completed tab.',
      duplicateTitle: 'Already in queue',
      duplicateMessage: 'This workflow is already running in the task list. Wait for it to finish or stop it first.',
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
        skipped: 'Skipped'
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
        task: 'Task'
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
    fitView: 'Fit view',
    layout: {
      dragHandle: 'Drag layout toolbar',
      expand: 'Expand layout tools',
      collapse: 'Collapse layout tools',
      grid: 'Show/hide background grid',
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
      groups: {
        imageEdit: 'Image edit'
      }
    },
    selectImage: {
      appMark: 'Select image',
      hint: 'Click a thumbnail to select; double-click to open the preview window. Defaults to the first image.',
      previewHint: 'Double-click to preview',
      empty: 'No upstream images yet. Connect an image output (e.g. director) and run it first.'
    },
    selectVideo: {
      appMark: 'Select video',
      hint: 'Click a thumbnail to select; double-click to open the preview window. Defaults to the first video.',
      previewHint: 'Double-click to preview',
      empty: 'No upstream videos yet. Connect a video generate node and run it first.'
    },
    selectText: {
      appMark: 'Select screenplay',
      hint: 'Click a card to select one screenplay; double-click to open the notepad. Defaults to the first item.',
      openHint: 'Double-click to open notepad',
      empty: 'No upstream screenplays yet. Connect a screenplay generate node and run it first.'
    },
    textsPreview: {
      appMark: 'Texts preview',
      hint: 'Preview multiple texts in a grid; double-click a card to open the notepad.',
      openHint: 'Double-click to open notepad',
      empty: 'No text output yet. Connect upstream text and run first.'
    },
    multiAngle: {
      appMark: 'Multi-angle editor',
      hint: 'Double-click to open the multi-angle editor',
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
      hint: 'Double-click to open the lighting editor',
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
      hint: 'Double-click to open portrait texture adjustment',
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
    emotion: {
      appMark: 'Emotion pad',
      hint: 'Double-click to open emotion adjustment',
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
      appMark: 'HD upscale',
      hint: 'Double-click to configure upscale; run the node to generate',
      hintRun: 'Save closes this dialog. Run the node to upscale via the image model.',
      engine: 'Engine',
      model: 'Model',
      scale: 'Scale',
      resetParams: 'Reset parameters',
      systemPrompt: 'System prompt',
      mergedPrompt: 'Merged prompt',
      promptEmpty: 'No merged prompt yet. Adjust scale in the editor dialog.',
      variants: {
        general: 'General',
        portrait: 'Portrait',
        landscape: 'Landscape'
      }
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
      hint: 'Double-click to pick grid cells; run the node to HD-enlarge selected tiles',
      noSource: 'Connect an upstream image first',
      selectedCount: 'Selected {n} cells',
      sizeLabel: '{n}-grid ({r}×{c})',
      scale: 'Scale',
      clearSelection: 'Clear selection',
      customTitle: 'Custom grid',
      grid: 'Grid',
      selected: 'Selected',
      allCells: 'All cells',
      systemPrompt: 'System prompt',
      presets: {
        p4: '4-grid (2×2)',
        p9: '9-grid (3×3)',
        p16: '16-grid (4×4)',
        p25: '25-grid (5×5)'
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
    scriptShotTableNode: {
      hint: 'Double-click to open shot table'
    },
    scriptShotImageGenNode: {
      hint: 'Double-click to expand the shot image graph below'
    },
    scriptShotVideoGenNode: {
      hint: 'Double-click to expand the shot video graph below'
    },
    scriptOutputNode: {
      hint: 'Final video output of the shot pipeline'
    },
    worldTableNode: {
      hint: 'Double-click to open world element table'
    },
    worldEditorNode: {
      hint: 'Double-click to open world elements editor'
    },
    narrativeTableNode: {
      hint: 'Double-click to open narrative unit table'
    },
    narrativeEditorNode: {
      hint: 'Double-click to open narrative editor'
    },
    node: {
      collapsePreview: 'Collapse preview',
      expandPreview: 'Expand preview'
    },
    nodeRole: {
      ref: 'Ref',
      generate: 'Generate'
    },
    assetRef: {
      hint: 'Asset reference · open from the asset library'
    },
    generateNode: {
      hint: 'Generation node · adjust parameters in the right panel',
      instructionHint: 'Double-click to edit generation instruction'
    },
    error: {
      selfAssetDrop: 'Cannot drop this asset into its own workflow — that would create a circular dependency',
      alreadyOnGraph: 'This asset is already on the canvas',
      unsupportedDrop: 'This canvas does not accept this asset type',
      dropPathFailed: 'Could not read dropped file paths. Import into the library first.',
      importFailed: 'Import failed: {detail}',
      noneImportable: 'No files could be imported onto the canvas'
    },
    port: {
      outTitle: 'Drag to connect to output',
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
        voice: 'Voice',
        video: 'Video',
        text: 'Text',
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
      error: 'Failed'
    },
    preview: {
      audioError: 'Cannot play audio',
      videoError: 'Video codec not supported'
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
      noInput: 'Enter a generation instruction, or connect an upstream input',
      lipSyncNoVisual: 'Connect a character image or reference video first',
      lipSyncNoAudio: 'Connect a voice (speech) input first',
      noMask: 'Paint a mask in the redraw editor first'
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
        script: 'Shot'
      },
      output: {
        video: 'Video output',
        image: 'Image output',
        voice: 'Voice output',
        text: 'Screenplay output',
        director: 'Director deck output',
        script: 'Shot output',
        narrative: 'Narrative generation'
      },
      note: {
        text: 'Note'
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
        toPrompt: 'Image reverse prompt'
      },
      video: {
        select: 'Select video',
        lipSync: 'Lip sync'
      },
      prompt: {
        optimize: 'Prompt optimize'
      },
      script: {
        shotSplit: 'Shot split',
        shotTable: 'Shot table',
        shotImageGen: 'Generate shot images',
        shotVideoGen: 'Generate shot videos',
        shotParams: 'Shot params'
      },
      screenplay: {
        select: 'Select screenplay'
      },
      narrative: {
        split: 'Narrative split',
        table: 'Narrative table',
        editor: 'Narrative edit'
      },
      world: {
        extract: 'World extract',
        table: 'World table',
        editor: 'World edit'
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
      script: 'Shot',
      canvas: 'Canvas',
      world: 'World Elements',
      narrative: 'Narrative Units',
      shotOutput: 'Shot video output',
      shotVisualOutput: 'Image output',
      screenplayOutput: 'Screenplay output',
      directorOutput: 'Director deck output',
      scriptOutput: 'Shot output',
      narrativeOutput: 'Narrative generation',
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
      narrativePaths: 'Saved screenplays',
      narrativePathsHint:
        'Each narrative unit is saved as its own screenplay file on run; double-click to preview',
      narrativePathsEmpty: 'Nothing saved yet — connect upstream and run this node',
      narrativePathPending: '(not saved)'
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
      openHint: 'Double-click to view / edit',
      imageBatch: 'Reference images'
    },
    inspector: {
      node: {
        title: 'Node parameters',
        hint: 'Preview on the node; edit details here',
        empty: 'No node selected'
      },
      assetRef: 'Referenced asset',
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
      shotParams: {
        hint: 'Drag shots from the strip to create params nodes; connect several to one video node text port.',
        boundShot: 'Bound shot',
        boundShotValue: '#{n} {title}',
        unbound: 'No shot bound'
      },
      shotTable: {
        hint: 'Double-click to open the shot table. Run the node to import shot JSON and preview the out port here.'
      },
      shotImageGen: {
        hint: 'Run the node to collect images from each shot’s visual output, and preview the out port here.'
      },
      shotVideoGen: {
        hint: 'Run the node to collect videos from each shot’s video output, and preview the out port here.'
      },
      worldTable: {
        hint: 'Double-click to open the world element table. Run the node to import catalog JSON and preview the out port here.'
      },
      narrativeTable: {
        hint: 'Double-click to open the narrative unit table. Run the node to import catalog JSON and preview the out port here.'
      },
      multiAngle: {
        hint: 'Double-click the node to edit camera angles. This panel previews the text output (no image on the node card).',
        spliceOn: 'On',
        spliceOff: 'Off'
      },
      lighting: {
        hint: 'Double-click the node to edit lighting. This panel previews the final lighting prompt.'
      },
      portraitTexture: {
        hint: 'Double-click the node to adjust portrait texture. This panel previews the final prompt.'
      },
      emotion: {
        hint: 'Double-click the node to adjust emotion. This panel previews the final prompt.'
      },
      upscale: {
        hint: 'Double-click the node to edit options. This panel shows the system prompt and the merged upscale prompt.',
        previewHint: 'Double-click a thumbnail to open the preview window.',
        previewEmpty: 'No upscaled images yet. Connect an input and run the node.'
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
        hint: 'Double-click to choose grid size and cells. Run the node to HD-enlarge selected tiles.'
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
        outImages: 'Output · Images',
        outImagesCount: '{n}',
        outImagesHint: 'Double-click a thumbnail to open the preview window',
        outImagesEmpty: 'No camera shots yet. Capture shots in the director stage to see them here'
      },
      generate: {
        hint: 'Connect upstream references, then adjust generation parameters for this type here.',
        mediaOutputDir: 'Output path',
        mediaOutputDirHint:
          "Relative to project root; defaults to '<assetName>/Images', '<assetName>/Videos', '<assetName>/Texts', or '<assetName>/Voices' under the node owner asset folder",
        pathOutsideProject: 'Please choose a folder inside the project directory',
        screenplayBody: 'Screenplay text',
        model: 'Text model',
        imageModel: 'Image model',
        videoModel: 'Video model',
        voiceModel: 'Purchased speaker',
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
        shotSplitInstructionPlaceholder:
          "Split the screenplay into a shot list; use {'@'} to cite connected inputs",
        worldExtractInstructionPlaceholder:
          "Extract characters / scenes / props / weapons; use {'@'} to cite connected inputs",
        narrativeSplitInstructionPlaceholder:
          "Decompose the screenplay into narrative units; use {'@'} to cite connected inputs",
        refsEmpty: 'Connect upstream inputs to cite with @, or type the instruction alone',
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
          titleShotSplit: 'Shot split templates',
          titleWorldExtract: 'World extract templates',
          titleNarrativeSplit: 'Narrative split templates',
          titleImage: 'Image generation templates',
          titleVideo: 'Video generation templates',
          titleLipSync: 'Lip sync templates',
          screenplay: {
            create: 'Short-drama framework',
            twists: 'Add payoffs & twists',
            dialogue: 'Polish dialogue',
            hooks: 'Strengthen ending hooks'
          },
          image: {
            multiAngle9: 'Multi-angle 9-grid',
            story4: 'Storyboard 4-grid',
            faceTurnaround: 'Character face turnaround',
            characterSheet: 'Character design sheet',
            characterTurnaround: 'Character turnaround',
            sceneSheet: 'Scene design sheet',
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
          optimize: {
            character: 'Character design prompt',
            prop: 'Prop prompt',
            scene: 'Scene prompt',
            camera: 'Camera move prompt',
            expression: 'Expression reference prompt',
            vfx: 'VFX prompt'
          },
          shotSplit: {
            create: 'Split screenplay into shots',
            refine: 'Refine shot pacing'
          },
          worldExtract: {
            create: 'Extract world elements',
            refine: 'Refine element catalog'
          },
          narrativeSplit: {
            create: 'Split into narrative units',
            refine: 'Refine narrative structure'
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
          frameMode_first_last: 'First & last'
        },
        generatedImages: 'Generated images',
        generatedImagesCount: '{n}',
        generatedImagesHint: 'Each run appends new images. Double-click to preview; × to delete.',
        generatedImagesEmpty: 'No generations yet. Run this node to see results here.',
        generatedImagesDelete: 'Delete this image',
        generatedVideos: 'Generated videos',
        generatedVideosCount: '{n}',
        generatedVideosHint:
          'Each run appends new videos. Preview shows full history; delete from Inspector with ×.',
        generatedVideosEmpty: 'No generations yet. Run this node to see results here.',
        generatedVideosDelete: 'Delete this video',
        generatedTexts: 'Generated screenplays',
        generatedTextsCount: '{n}',
        generatedTextsHint:
          'Each run appends text and saves it to the output path. Double-click to open; × to delete.',
        generatedTextsEmpty: 'No generations yet. Run this node to see results here.',
        generatedTextsDelete: 'Delete this text',
        generatedTextsOpen: 'Double-click to open notepad',
        generatedVoices: 'Generated voices',
        generatedVoicesCount: '{n}',
        generatedVoicesHint:
          'Each run appends new audio saved to the output path. Use × to delete.',
        generatedVoicesEmpty: 'No generations yet. Run this node to see results here.',
        generatedVoicesDelete: 'Delete this voice'
      }
    }
  },
  draft: {
    error: {
      notFound: 'Draft missing or already saved'
    }
  }
} as const

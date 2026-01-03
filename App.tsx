import React, { useState, useCallback, useEffect } from 'react';
import { AppState, GeneratedAssets, ScriptData } from './types';
import * as gemini from './services/geminiService';
import { StepIndicator } from './components/StepIndicator';
import { Player } from './components/Player';
import { Wand2, FileText, Image as ImageIcon, Video, Mic, AlertCircle, RefreshCcw, Info, Palette, Camera, Ghost, Sparkles, PenTool, Brush } from 'lucide-react';

const STORAGE_KEY = 'autoshorts_session_v1';

const VISUAL_STYLES = [
  { id: 'realistic', label: '실사 (Realistic)', icon: <Camera size={18} />, prompt: 'Cinematic, hyper-realistic, 8k resolution, professional photography' },
  { id: 'anime', label: '애니메이션 (Anime)', icon: <Sparkles size={18} />, prompt: 'Modern high-quality Japanese anime style, vibrant colors, clean lines' },
  { id: '3d_cartoon', label: '3D 툰 (Pixar)', icon: <Ghost size={18} />, prompt: 'High-end 3D animation style, Pixar/Disney inspired, soft lighting, expressive characters' },
  { id: 'cyberpunk', label: '사이버펑크 (Neon)', icon: <Wand2 size={18} />, prompt: 'Cyberpunk aesthetic, neon lights, futuristic, rainy city streets, high contrast' },
  { id: 'oil_painting', label: '유화 (Oil Paint)', icon: <Brush size={18} />, prompt: 'Classical oil painting, thick brushstrokes, rich textures, fine art' },
  { id: 'sketch', label: '스케치 (Sketch)', icon: <PenTool size={18} />, prompt: 'Hand-drawn pencil sketch, artistic cross-hatching, charcoal details' },
];

export default function App() {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [topic, setTopic] = useState('');
  const [selectedStyle, setSelectedStyle] = useState(VISUAL_STYLES[0].id);
  const [assets, setAssets] = useState<GeneratedAssets>({
    script: null,
    videoUrls: [],
    audioBuffer: null
  });
  const [error, setError] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState<{current: number, total: number} | null>(null);
  const [isResuming, setIsResuming] = useState(false);

  // Persistence: Save state to localStorage
  useEffect(() => {
    if (state !== AppState.IDLE && state !== AppState.ERROR) {
      const sessionData = {
        state,
        topic,
        selectedStyle,
        assets: {
          ...assets,
          audioBuffer: null 
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
    }
  }, [state, topic, assets, selectedStyle]);

  // Persistence: Load state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const { state: savedState, topic: savedTopic, assets: savedAssets, selectedStyle: savedStyle } = JSON.parse(saved);
        if (savedState !== AppState.COMPLETED) {
          setTopic(savedTopic || '');
          if (savedStyle) setSelectedStyle(savedStyle);
          setAssets(savedAssets);
          setIsResuming(true);
          if (savedState !== AppState.IDLE) {
            handleGenerate(savedTopic, savedAssets, savedStyle);
          }
        }
      } catch (e) {
        console.error("Failed to restore session", e);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const checkVeoKey = async (): Promise<boolean> => {
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        try {
          await window.aistudio.openSelectKey();
          return true;
        } catch (e) {
          console.error("Key selection error", e);
          return false;
        }
      }
      return true;
    }
    return true; 
  };

  const handleGenerate = useCallback(async (forcedTopic?: string, resumeAssets?: GeneratedAssets, forcedStyle?: string) => {
    const currentTopic = forcedTopic || topic;
    const currentStyleId = forcedStyle || selectedStyle;
    const styleObj = VISUAL_STYLES.find(s => s.id === currentStyleId) || VISUAL_STYLES[0];

    if (!currentTopic.trim()) return;
    
    setError(null);
    setIsResuming(false);
    let lastError: any = null;

    try {
      // 1. Script (Storyboarding)
      let scriptData = resumeAssets?.script || assets.script;
      if (!scriptData) {
        setState(AppState.GENERATING_SCRIPT);
        scriptData = await gemini.generateScript(currentTopic, styleObj.prompt);
        setAssets(prev => ({ ...prev, script: scriptData }));
      }
      
      let pipelineScenes = scriptData.scenes.map((s, i) => ({ 
        ...s, 
        originalIndex: i,
        img: (resumeAssets?.videoUrls && resumeAssets.videoUrls[i]) ? 'EXISTS' : '', 
        videoUrl: resumeAssets?.videoUrls ? resumeAssets.videoUrls[i] || '' : '' 
      }));

      // 2. Image Generation
      setState(AppState.GENERATING_IMAGE);
      
      const imageResults = await Promise.all(
          pipelineScenes.map(async (scene) => {
              if (scene.videoUrl) return { originalIndex: scene.originalIndex, img: 'SKIPPED' };
              try {
                  const img = await gemini.generateSceneImage(scriptData!.globalStyle, scene.visualPrompt);
                  return { originalIndex: scene.originalIndex, img };
              } catch (e) {
                  console.error(`Image generation failed for scene ${scene.originalIndex + 1}`, e);
                  lastError = e;
                  return null;
              }
          })
      );

      const scenesWithImages = [];
      for (const res of imageResults) {
          if (res) {
              const sceneIndex = pipelineScenes.findIndex(s => s.originalIndex === res.originalIndex);
              if (sceneIndex !== -1) {
                scenesWithImages.push({
                    ...pipelineScenes[sceneIndex],
                    img: res.img
                });
              }
          }
      }

      if (scenesWithImages.length === 0) {
          throw lastError || new Error("이미지 생성에 실패했습니다.");
      }
      pipelineScenes = scenesWithImages;

      // 3. Video Generation
      await checkVeoKey(); 
      setState(AppState.GENERATING_VIDEO);
      
      const scenesWithVideo = [];
      setVideoProgress({ current: 0, total: pipelineScenes.length });

      for (let i = 0; i < pipelineScenes.length; i++) {
        setVideoProgress({ current: i + 1, total: pipelineScenes.length });
        const scene = pipelineScenes[i];
        
        if (scene.videoUrl) {
            scenesWithVideo.push(scene);
            continue;
        }

        try {
            const url = await gemini.generateVeoVideo(scene.img, scene.visualPrompt);
            scenesWithVideo.push({ ...scene, videoUrl: url });
            setAssets(prev => ({ ...prev, videoUrls: scenesWithVideo.map(s => s.videoUrl) }));
        } catch (e) {
            console.error(`Video generation failed for scene ${scene.originalIndex + 1}`, e);
            lastError = e;
        }
      }

      if (scenesWithVideo.length === 0) {
          throw lastError || new Error("비디오 생성에 실패했습니다.");
      }
      pipelineScenes = scenesWithVideo;
      
      setAssets(prev => ({ ...prev, videoUrls: pipelineScenes.map(s => s.videoUrl) }));
      setVideoProgress(null);

      // 4. Audio
      setState(AppState.GENERATING_AUDIO);
      const fullNarration = pipelineScenes.map(s => s.narration).join(' ');
      const audioBuffer = await gemini.generateNarrationAudio(fullNarration);
      
      const finalScript: ScriptData = {
          ...scriptData,
          scenes: pipelineScenes.map(s => ({ visualPrompt: s.visualPrompt, narration: s.narration }))
      };

      setAssets({ 
          script: finalScript, 
          videoUrls: pipelineScenes.map(s => s.videoUrl), 
          audioBuffer 
      });

      setState(AppState.COMPLETED);
      localStorage.removeItem(STORAGE_KEY);

    } catch (err: any) {
      console.error(err);
      let msg = err.message || "알 수 없는 오류가 발생했습니다.";
      if (typeof msg === 'string') {
        if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
            msg = "요청 한도를 초과했습니다. 비디오 생성은 계정당 제한이 엄격합니다. 잠시 후 다시 시도해주세요.";
        }
      }
      setError(msg);
      setState(AppState.ERROR);
    }
  }, [topic, assets, selectedStyle]);

  const resetApp = () => {
    localStorage.removeItem(STORAGE_KEY);
    setState(AppState.IDLE);
    setTopic('');
    setSelectedStyle(VISUAL_STYLES[0].id);
    setAssets({ script: null, videoUrls: [], audioBuffer: null });
    setError(null);
    setVideoProgress(null);
    setIsResuming(false);
  };

  const getStepStatus = () => {
    const steps = [
      { id: AppState.GENERATING_SCRIPT, label: '스토리 기획', icon: <FileText /> },
      { id: AppState.GENERATING_IMAGE, label: '이미지 생성', icon: <ImageIcon /> },
      { id: AppState.GENERATING_VIDEO, label: '비디오 생성', icon: <Video /> },
      { id: AppState.GENERATING_AUDIO, label: '나레이션 & 믹싱', icon: <Mic /> },
    ];
    
    let currentStepIndex = -1;
    if (state === AppState.GENERATING_SCRIPT) currentStepIndex = 0;
    else if (state === AppState.GENERATING_IMAGE) currentStepIndex = 1;
    else if (state === AppState.GENERATING_VIDEO) currentStepIndex = 2;
    else if (state === AppState.GENERATING_AUDIO) currentStepIndex = 3;
    else if (state === AppState.COMPLETED) currentStepIndex = 4;

    return steps.map((s, idx) => ({
      title: s.label,
      icon: s.icon,
      isActive: idx === currentStepIndex,
      isCompleted: idx < currentStepIndex || state === AppState.COMPLETED
    }));
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col items-center py-12 px-4 selection:bg-indigo-500/30 font-sans">
      
      {/* Header */}
      <div className="text-center mb-12 space-y-4">
        <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 mb-4">
          <Wand2 className="w-8 h-8 text-indigo-400" />
        </div>
        <h1 className="text-5xl md:text-6xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-zinc-500">
          AutoShorts AI
        </h1>
        <p className="text-zinc-400 text-lg max-w-lg mx-auto leading-relaxed word-keep-all">
          아이디어만 입력하세요. 기획부터 영상, 목소리까지 AI가 완성해드립니다.
        </p>
      </div>

      <div className="w-full max-w-5xl flex flex-col items-center">
        
        {state !== AppState.IDLE && state !== AppState.ERROR && (
           <StepIndicator steps={getStepStatus()} />
        )}

        {state === AppState.IDLE && (
          <div className="w-full max-w-2xl animate-fade-in-up space-y-8">
            {isResuming && (
              <div className="mb-6 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center gap-3 animate-fade-in">
                <Info className="text-indigo-400" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-indigo-200 font-medium">이전 작업이 발견되었습니다.</p>
                  <p className="text-xs text-indigo-300/60">마지막으로 진행하던 "{topic}" 작업을 복구하고 있습니다...</p>
                </div>
                <button onClick={resetApp} className="text-xs bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded text-zinc-400">취소</button>
              </div>
            )}

            {/* Topic Input */}
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg blur opacity-30 group-hover:opacity-75 transition duration-1000 group-hover:duration-200"></div>
              <div className="relative bg-zinc-900 rounded-lg p-1 flex items-center">
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="주제를 입력하세요 (예: 서울의 야경, 커피의 역사)"
                  className="flex-1 bg-transparent border-none text-white px-6 py-4 focus:ring-0 placeholder-zinc-500 text-lg outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                />
                <button
                  onClick={() => handleGenerate()}
                  disabled={!topic.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-md font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed m-1 whitespace-nowrap flex items-center gap-2"
                >
                  <Wand2 size={18} />
                  생성하기
                </button>
              </div>
            </div>

            {/* Style Selector */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-zinc-400 font-medium px-1">
                <Palette size={18} className="text-indigo-400" />
                <span>영상 스타일 선택</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {VISUAL_STYLES.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setSelectedStyle(style.id)}
                    className={`p-4 rounded-xl border transition-all duration-300 text-left space-y-2 group relative overflow-hidden ${
                      selectedStyle === style.id
                        ? 'bg-indigo-500/10 border-indigo-500 ring-1 ring-indigo-500 text-white'
                        : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    <div className={`p-2 rounded-lg inline-flex ${selectedStyle === style.id ? 'bg-indigo-500 text-white' : 'bg-zinc-800 text-zinc-500 group-hover:bg-zinc-700'}`}>
                      {style.icon}
                    </div>
                    <div className="font-semibold text-sm">{style.label}</div>
                    {selectedStyle === style.id && (
                      <div className="absolute -right-2 -bottom-2 opacity-10">
                         {React.cloneElement(style.icon as React.ReactElement, { size: 64 })}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {(state !== AppState.IDLE && state !== AppState.COMPLETED && state !== AppState.ERROR) && (
            <div className="mt-12 text-center space-y-4 animate-pulse">
                <div className="text-2xl font-light text-zinc-300">
                    {state === AppState.GENERATING_SCRIPT && "대본을 작성하고 있습니다..."}
                    {state === AppState.GENERATING_IMAGE && "장면별 이미지를 생성 중입니다..."}
                    {state === AppState.GENERATING_VIDEO && (
                      <span className="flex flex-col items-center">
                        <span>비디오 클립을 렌더링 중입니다...</span>
                        {videoProgress && (
                           <span className="text-indigo-400 font-bold mt-1 text-4xl">
                             {videoProgress.current} / {videoProgress.total}
                           </span>
                        )}
                        <span className="text-sm text-zinc-500 mt-4">비디오 생성은 최대 수 분이 소요될 수 있습니다. 브라우저를 닫지 마세요.</span>
                      </span>
                    )}
                    {state === AppState.GENERATING_AUDIO && "나레이션을 녹음 중입니다..."}
                </div>
            </div>
        )}

        {state === AppState.COMPLETED && (
            <Player 
                videoUrls={assets.videoUrls}
                audioBuffer={assets.audioBuffer}
                script={assets.script?.scenes.map(s => s.narration).join('\n\n') || ''}
                onReset={resetApp}
            />
        )}

        {state === AppState.ERROR && (
            <div className="mt-8 p-8 bg-red-500/10 border border-red-500/20 rounded-xl max-w-md w-full text-center animate-fade-in">
                <div className="flex justify-center mb-4">
                  <AlertCircle className="w-12 h-12 text-red-400" />
                </div>
                <h3 className="text-xl font-bold text-red-200 mb-2">오류가 발생했습니다</h3>
                <p className="text-zinc-400 mb-6 word-break-all text-sm">{error}</p>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => handleGenerate()} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2">
                    <RefreshCcw size={16} /> 이어하기
                  </button>
                  <button onClick={resetApp} className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg font-medium transition-colors">
                    새로 시작
                  </button>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}
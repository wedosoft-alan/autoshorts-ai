
import React, { useState, useCallback, useEffect } from 'react';
import { AppState, GeneratedAssets, ScriptData } from './types';
import * as gemini from './services/geminiService';
import { StepIndicator } from './components/StepIndicator';
import { Player } from './components/Player';
import { Wand2, FileText, Image as ImageIcon, Mic, AlertCircle, Camera, Sparkles, Waves, Video, Palette, Film, Moon, Box } from 'lucide-react';

const VISUAL_STYLES = [
  { id: 'realistic', label: '실사 시네마틱', icon: <Camera size={18} />, prompt: 'Hyper-realistic, 8k, cinematic film stock, sharp focus, professional photography, natural lighting.' },
  { id: 'anime', label: '애니메이션', icon: <Sparkles size={18} />, prompt: 'Breathtaking anime scenery, Makoto Shinkai style, emotional lighting, vibrant clouds, detailed backgrounds.' },
  { id: '3d_pixar', label: '3D 애니메이션', icon: <Box size={18} />, prompt: 'Pixar-style 3D animation, vibrant colors, expressive characters, smooth rendering, family-friendly aesthetic.' },
  { id: 'vintage', label: '빈티지 필름', icon: <Film size={18} />, prompt: 'Vintage film aesthetic, 35mm grain, warm tones, nostalgic mood, retro color grading, soft focus edges.' },
  { id: 'watercolor', label: '수채화 아트', icon: <Palette size={18} />, prompt: 'Watercolor painting style, soft brushstrokes, flowing colors, artistic interpretation, dreamy atmosphere.' },
  { id: 'dark_cinematic', label: '다크 시네마틱', icon: <Moon size={18} />, prompt: 'Dark cinematic mood, dramatic shadows, moody lighting, high contrast, mysterious atmosphere, film noir inspired.' },
];

export default function App() {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [topic, setTopic] = useState('');
  const [selectedStyle, setSelectedStyle] = useState(VISUAL_STYLES[0].id);
  const [assets, setAssets] = useState<GeneratedAssets>({ script: null, imageUrls: [], videoUrls: [], audioBuffer: null });
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{current: number, total: number} | null>(null);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) await window.aistudio.openSelectKey();
      }
    };
    checkKey();
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!topic.trim()) return;
    
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await window.aistudio.openSelectKey();
        return; 
      }
    }

    setError(null);
    const styleObj = VISUAL_STYLES.find(s => s.id === selectedStyle) || VISUAL_STYLES[0];
    
    try {
      // 1. Script
      setState(AppState.GENERATING_SCRIPT);
      const scriptData = await gemini.generateScript(topic, styleObj.prompt);
      setAssets(prev => ({ ...prev, script: scriptData }));
      
      const sceneCount = 5;
      const images: string[] = [];
      const videos: string[] = [];

      // 2. Images (Pre-generate all images for fallback)
      setState(AppState.GENERATING_IMAGE);
      setProgress({ current: 0, total: sceneCount });
      for (let i = 0; i < sceneCount; i++) {
        const base64Img = await gemini.generateSceneImage(scriptData.globalStyle, scriptData.scenes[i].visualPrompt);
        images.push(base64Img);
        setProgress({ current: i + 1, total: sceneCount });
      }
      setAssets(prev => ({ ...prev, imageUrls: images }));

      // 3. Videos (Veo) - Sequential with fallback for 429 errors
      setState(AppState.GENERATING_VIDEO);
      setProgress({ current: 0, total: sceneCount });
      for (let i = 0; i < sceneCount; i++) {
        try {
          // Add a small delay between requests to mitigate 429
          if (i > 0) await new Promise(r => setTimeout(r, 3000));
          
          const videoUrl = await gemini.generateSceneVideo(images[i], scriptData.scenes[i].visualPrompt);
          videos.push(videoUrl);
        } catch (err) {
          console.warn(`Video generation failed for scene ${i+1}. Falling back to image.`, err);
          // Fallback: Use the data URL of the image as the "video" source
          videos.push(`data:image/png;base64,${images[i]}`);
        }
        setProgress({ current: i + 1, total: sceneCount });
        setAssets(prev => ({ ...prev, videoUrls: [...videos] }));
      }

      // 4. Audio
      setState(AppState.GENERATING_AUDIO);
      const audioBuffer = await gemini.generateNarrationAudio(scriptData.scenes.map(s => s.narration).join(' '));
      
      setAssets(prev => ({ ...prev, audioBuffer }));
      setState(AppState.COMPLETED);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "생성 중 예상치 못한 오류가 발생했습니다.");
      setState(AppState.ERROR);
    }
  }, [topic, selectedStyle]);

  const resetApp = () => {
    setState(AppState.IDLE);
    setTopic('');
    setAssets({ script: null, imageUrls: [], videoUrls: [], audioBuffer: null });
    setError(null);
  };

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4 font-sans selection:bg-cyan-500/30">
      {state === AppState.IDLE && (
        <div className="text-center mb-16 space-y-6 animate-fade-in">
          <div className="inline-flex p-5 rounded-[2rem] bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-white/20 shadow-2xl backdrop-blur-xl mb-4">
            <Waves className="w-12 h-12 text-cyan-400 animate-pulse" />
          </div>
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-cyan-500 uppercase">
            AutoShorts AI
          </h1>
          <p className="text-cyan-100/60 text-lg md:text-2xl max-w-xl mx-auto leading-relaxed font-light">
            상상 속의 이야기를 <span className="text-cyan-400 font-bold">생동감 넘치는 비디오</span>로 만듭니다.
          </p>
        </div>
      )}

      <div className="w-full max-w-5xl flex flex-col items-center">
        {state !== AppState.IDLE && state !== AppState.COMPLETED && state !== AppState.ERROR && (
           <StepIndicator steps={[
             { title: 'Script', icon: <FileText size={18}/>, isActive: state === AppState.GENERATING_SCRIPT, isCompleted: state !== AppState.GENERATING_SCRIPT },
             { title: 'Imagery', icon: <ImageIcon size={18}/>, isActive: state === AppState.GENERATING_IMAGE, isCompleted: ![AppState.GENERATING_SCRIPT, AppState.GENERATING_IMAGE].includes(state) },
             { title: 'AI Video', icon: <Video size={18}/>, isActive: state === AppState.GENERATING_VIDEO, isCompleted: ![AppState.GENERATING_SCRIPT, AppState.GENERATING_IMAGE, AppState.GENERATING_VIDEO].includes(state) },
             { title: 'Narration', icon: <Mic size={18}/>, isActive: state === AppState.GENERATING_AUDIO, isCompleted: state === AppState.COMPLETED },
           ]} />
        )}

        {state === AppState.IDLE && (
          <div className="w-full max-w-2xl space-y-12 animate-fade-in-up">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-400 to-blue-600 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
              <div className="relative bg-black/40 border border-white/10 rounded-3xl p-2 flex items-center backdrop-blur-3xl">
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="무엇을 만들고 싶나요? (예: 사이버펑크 도시의 추격전)"
                  className="flex-1 bg-transparent border-none text-white px-6 py-5 focus:ring-0 placeholder-white/20 text-xl outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                />
                <button
                  onClick={handleGenerate}
                  disabled={!topic.trim()}
                  className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:scale-105 text-white px-10 py-5 rounded-2xl font-black transition-all disabled:opacity-30 shadow-lg uppercase tracking-wider"
                >
                  Create
                </button>
              </div>
            </div>
            
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {VISUAL_STYLES.map((style) => (
                              <button
                                key={style.id}
                                onClick={() => setSelectedStyle(style.id)}
                                className={`p-4 md:p-5 rounded-2xl border transition-all text-left space-y-3 backdrop-blur-xl group ${selectedStyle === style.id ? 'bg-cyan-500/20 border-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.3)]' : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'}`}
                              >
                                <div className={`p-3 rounded-xl inline-flex transition-colors ${selectedStyle === style.id ? 'bg-cyan-500 text-white shadow-lg' : 'bg-white/5 group-hover:text-white'}`}>{style.icon}</div>
                                <div className="font-bold text-xs uppercase tracking-wider">{style.label}</div>
                              </button>
                            ))}
                        </div>
          </div>
        )}

        {state !== AppState.IDLE && state !== AppState.COMPLETED && state !== AppState.ERROR && (
            <div className="mt-20 text-center space-y-10 animate-fade-in">
                <div className="relative inline-block">
                    <div className="w-32 h-32 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Waves className="text-cyan-400 animate-pulse" size={32} />
                    </div>
                </div>
                <div className="space-y-4">
                    <h3 className="text-4xl font-black text-white uppercase tracking-[0.3em]">
                        {state === AppState.GENERATING_SCRIPT ? 'Plotting' : 
                         state === AppState.GENERATING_IMAGE ? 'Dreaming' : 
                         state === AppState.GENERATING_VIDEO ? 'Rendering AI Video' : 'Synthesizing'}
                    </h3>
                    <p className="text-cyan-400/60 font-medium italic">
                      {state === AppState.GENERATING_VIDEO ? "Veo 모델이 장면을 렌더링 중입니다. (지연 시 이미지가 대신 사용됩니다)" : "잠시만 기다려주세요..."}
                    </p>
                    {progress && (
                      <div className="flex flex-col items-center gap-2">
                        <div className="text-7xl font-black text-cyan-400 tracking-tighter">{progress.current} <span className="text-2xl text-white/20">/ {progress.total}</span></div>
                        <div className="w-64 h-1 bg-white/5 rounded-full overflow-hidden">
                           <div 
                             className="h-full bg-cyan-500 transition-all duration-1000" 
                             style={{ width: `${(progress.current / progress.total) * 100}%` }}
                           ></div>
                        </div>
                      </div>
                    )}
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
            <div className="mt-8 p-12 bg-white/5 border border-red-500/30 rounded-[3rem] max-w-md w-full text-center shadow-2xl animate-fade-in backdrop-blur-3xl">
                <AlertCircle className="w-20 h-20 text-red-500 mx-auto mb-8 animate-bounce" />
                <h3 className="text-3xl font-black text-white mb-4 uppercase tracking-tighter">System Error</h3>
                <p className="text-red-200/60 mb-10 text-sm leading-relaxed">{error}</p>
                <button onClick={resetApp} className="w-full px-8 py-5 bg-white/10 hover:bg-white/20 text-white rounded-2xl font-bold transition-all border border-white/10 uppercase tracking-widest">Restart System</button>
            </div>
        )}
      </div>
    </div>
  );
}


import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, RefreshCw, Film, Volume2, Download, Shuffle } from 'lucide-react';

interface Props {
  videoUrls: string[];
  audioBuffer: AudioBuffer | null;
  script: string;
  onReset: () => void;
}

type TransitionType = 'fade' | 'slide' | 'zoom';

const TRANSITIONS: { id: TransitionType; label: string }[] = [
  { id: 'fade', label: '페이드' },
  { id: 'slide', label: '슬라이드' },
  { id: 'zoom', label: '줌' },
];

const BGM_URL = "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112778.mp3";

export const Player: React.FC<Props> = ({ videoUrls, audioBuffer, script, onReset }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState(-1);
  const [bgmVolume, setBgmVolume] = useState(0.15);
  const [narrationVolume, setNarrationVolume] = useState(1.0);
  const [transitionType, setTransitionType] = useState<TransitionType>('fade');
  const [isExporting, setIsExporting] = useState(false);
  
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const narrationSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bgmSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [bgmBuffer, setBgmBuffer] = useState<AudioBuffer | null>(null);

  useEffect(() => {
    const loadBgm = async () => {
      try {
        const response = await fetch(BGM_URL);
        const arrayBuffer = await response.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        setBgmBuffer(decoded);
        ctx.close();
      } catch (e) { console.error(e); }
    };
    loadBgm();
  }, []);

  const getTransitionClasses = (index: number): string => {
    const isActive = index === currentIndex;
    const isPrev = index === prevIndex;
    
    const baseClasses = 'absolute inset-0 w-full h-full object-cover';
    
    switch (transitionType) {
      case 'fade':
        return `${baseClasses} transition-opacity duration-700 ${isActive ? 'opacity-100' : 'opacity-0'}`;
      
      case 'slide':
        if (isActive) {
          return `${baseClasses} transition-transform duration-700 ease-out translate-x-0`;
        } else if (isPrev) {
          return `${baseClasses} transition-transform duration-700 ease-out -translate-x-full`;
        }
        return `${baseClasses} translate-x-full opacity-0`;
      
      case 'zoom':
        if (isActive) {
          return `${baseClasses} transition-all duration-700 ease-out scale-100 opacity-100`;
        } else if (isPrev) {
          return `${baseClasses} transition-all duration-700 ease-out scale-150 opacity-0`;
        }
        return `${baseClasses} scale-75 opacity-0`;
      
      default:
        return `${baseClasses} transition-opacity duration-700 ${isActive ? 'opacity-100' : 'opacity-0'}`;
    }
  };

  const playAll = async () => {
    if (!audioBuffer) return;
    
    stopAll();
    setIsPlaying(true);
    setCurrentIndex(0);
    setPrevIndex(-1);

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContextRef.current = ctx;

    // Narration
    const narrSource = ctx.createBufferSource();
    narrSource.buffer = audioBuffer;
    const narrGain = ctx.createGain();
    narrGain.gain.value = narrationVolume;
    narrSource.connect(narrGain).connect(ctx.destination);
    narrSource.start(0);
    narrationSourceRef.current = narrSource;

    // BGM
    if (bgmBuffer) {
      const bgmSource = ctx.createBufferSource();
      bgmSource.buffer = bgmBuffer;
      bgmSource.loop = true;
      const bgmGain = ctx.createGain();
      bgmGain.gain.value = bgmVolume;
      bgmSource.connect(bgmGain).connect(ctx.destination);
      bgmSource.start(0);
      bgmSourceRef.current = bgmSource;
    }

    // Video/Scene Sync Logic
    const sceneDuration = audioBuffer.duration / videoUrls.length;
    
    for (let i = 0; i < videoUrls.length; i++) {
      if (!audioContextRef.current) break;
      setPrevIndex(i > 0 ? i - 1 : -1);
      setCurrentIndex(i);
      const url = videoUrls[i];
      const isImage = url.startsWith('data:image');
      
      const v = videoRefs.current[i];
      if (v && !isImage) {
        v.currentTime = 0;
        v.play().catch(() => {});
      }
      
      await new Promise(r => setTimeout(r, sceneDuration * 1000));
      if (v && !isImage) v.pause();
    }
    
    setIsPlaying(false);
  };

  const stopAll = () => {
    narrationSourceRef.current?.stop();
    bgmSourceRef.current?.stop();
    audioContextRef.current?.close();
    audioContextRef.current = null;
    videoRefs.current.forEach(v => {
      if (v) {
        v.pause();
        v.currentTime = 0;
      }
    });
    setIsPlaying(false);
  };

  const exportToMp4 = async () => {
    if (!audioBuffer || videoUrls.length === 0) return;
    
    setIsExporting(true);
    
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext('2d')!;
      
      const sceneDuration = audioBuffer.duration / videoUrls.length;
      const fps = 30;
      const totalFrames = Math.ceil(audioBuffer.duration * fps);
      const framesPerScene = Math.ceil(sceneDuration * fps);
      
      // Create MediaRecorder with canvas stream
      const stream = canvas.captureStream(fps);
      
      // Create audio context for mixing
      const audioCtx = new AudioContext();
      const destination = audioCtx.createMediaStreamDestination();
      
      // Add narration
      const narrSource = audioCtx.createBufferSource();
      narrSource.buffer = audioBuffer;
      const narrGain = audioCtx.createGain();
      narrGain.gain.value = narrationVolume;
      narrSource.connect(narrGain).connect(destination);
      
      // Add BGM if available
      if (bgmBuffer) {
        const bgmSource = audioCtx.createBufferSource();
        bgmSource.buffer = bgmBuffer;
        bgmSource.loop = true;
        const bgmGain = audioCtx.createGain();
        bgmGain.gain.value = bgmVolume;
        bgmSource.connect(bgmGain).connect(destination);
        bgmSource.start(0);
      }
      
      // Combine video and audio streams
      const audioTrack = destination.stream.getAudioTracks()[0];
      if (audioTrack) {
        stream.addTrack(audioTrack);
      }
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 8000000,
      });
      
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      const recordingPromise = new Promise<Blob>((resolve) => {
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          resolve(blob);
        };
      });
      
      mediaRecorder.start();
      narrSource.start(0);
      
      // Load all images/videos first
      const mediaElements: (HTMLImageElement | HTMLVideoElement)[] = [];
      for (const url of videoUrls) {
        const isImage = url.startsWith('data:image');
        if (isImage) {
          const img = new Image();
          img.src = url;
          await new Promise(r => { img.onload = r; });
          mediaElements.push(img);
        } else {
          const video = document.createElement('video');
          video.src = url;
          video.muted = true;
          video.playsInline = true;
          video.crossOrigin = 'anonymous';
          await new Promise(r => { video.onloadeddata = r; });
          mediaElements.push(video);
        }
      }
      
      // Render frames
      const frameDelay = 1000 / fps;
      let currentScene = 0;
      
      for (let frame = 0; frame < totalFrames; frame++) {
        const newScene = Math.min(Math.floor(frame / framesPerScene), videoUrls.length - 1);
        
        if (newScene !== currentScene) {
          currentScene = newScene;
        }
        
        const media = mediaElements[currentScene];
        const isVideo = media instanceof HTMLVideoElement;
        
        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Calculate transition progress within scene
        const frameInScene = frame % framesPerScene;
        const transitionFrames = Math.min(fps * 0.7, framesPerScene / 2);
        const transitionProgress = Math.min(frameInScene / transitionFrames, 1);
        
        // Apply transition effect
        ctx.save();
        
        switch (transitionType) {
          case 'fade':
            ctx.globalAlpha = transitionProgress;
            break;
          case 'slide':
            const slideOffset = (1 - transitionProgress) * canvas.width;
            ctx.translate(slideOffset, 0);
            break;
          case 'zoom':
            const scale = 0.8 + (0.2 * transitionProgress);
            ctx.globalAlpha = transitionProgress;
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.scale(scale, scale);
            ctx.translate(-canvas.width / 2, -canvas.height / 2);
            break;
        }
        
        // Draw media to fill canvas (cover mode)
        if (isVideo) {
          const video = media as HTMLVideoElement;
          video.currentTime = (frameInScene / fps) % (video.duration || 1);
        }
        
        const mediaWidth = isVideo ? (media as HTMLVideoElement).videoWidth : (media as HTMLImageElement).naturalWidth;
        const mediaHeight = isVideo ? (media as HTMLVideoElement).videoHeight : (media as HTMLImageElement).naturalHeight;
        
        const scaleRatio = Math.max(canvas.width / mediaWidth, canvas.height / mediaHeight);
        const scaledWidth = mediaWidth * scaleRatio;
        const scaledHeight = mediaHeight * scaleRatio;
        const x = (canvas.width - scaledWidth) / 2;
        const y = (canvas.height - scaledHeight) / 2;
        
        ctx.drawImage(media, x, y, scaledWidth, scaledHeight);
        ctx.restore();
        
        await new Promise(r => setTimeout(r, frameDelay));
      }
      
      mediaRecorder.stop();
      audioCtx.close();
      
      const blob = await recordingPromise;
      
      // Download the file
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `autoshorts-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('Export failed:', error);
      alert('내보내기에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-12 w-full max-w-5xl p-6 bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[3rem] shadow-2xl animate-scale-in">
      
      {/* Viewport */}
      <div className="mx-auto md:mx-0 relative w-[320px] h-[570px] bg-black rounded-[3.5rem] border-[10px] border-white/10 shadow-2xl overflow-hidden shrink-0">
        {videoUrls.map((url, index) => {
          const isImage = url.startsWith('data:image');
          if (isImage) {
            return (
              <img 
                key={index}
                src={url}
                className={getTransitionClasses(index)}
                alt={`Scene ${index + 1}`}
              />
            );
          }
          return (
            <video 
              key={index}
              ref={el => videoRefs.current[index] = el}
              src={url}
              className={getTransitionClasses(index)}
              muted
              playsInline
            />
          );
        })}
        
        {!isPlaying && !isExporting && (
          <div onClick={playAll} className="absolute inset-0 bg-black/40 flex items-center justify-center cursor-pointer group z-40">
            <div className="w-20 h-20 rounded-full bg-cyan-500/80 flex items-center justify-center border border-white/30 group-hover:scale-110 transition-transform shadow-[0_0_30px_rgba(6,182,212,0.5)]">
                <Play fill="white" className="ml-1 text-white" size={32} />
            </div>
          </div>
        )}
        
        {isExporting && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-40">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-white font-bold">내보내는 중...</p>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex-1 flex flex-col justify-center space-y-6">
        <div>
          <h2 className="text-4xl font-black text-white mb-2 uppercase tracking-tighter">AI Cinematic</h2>
          <p className="text-cyan-400 font-bold uppercase tracking-widest text-sm mb-4">Hybrid Rendering</p>
          <p className="text-cyan-100/60 leading-relaxed italic text-sm">
            "비디오 렌더링 부하 시 이미지가 대신 사용될 수 있습니다. 고품질 스크립트와 나레이션은 그대로 유지됩니다."
          </p>
        </div>

        {/* Transition Selector */}
        <div className="flex items-center gap-3">
          <Shuffle size={16} className="text-cyan-400" />
          <span className="text-xs font-bold text-white/60 uppercase">전환 효과:</span>
          <div className="flex gap-2">
            {TRANSITIONS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTransitionType(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  transitionType === t.id 
                    ? 'bg-cyan-500 text-white' 
                    : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white/5 p-5 rounded-[2rem] border border-white/10 max-h-36 overflow-y-auto">
            <h3 className="text-cyan-400 font-bold mb-2 text-xs uppercase flex items-center gap-2">
              <Film size={14}/> Narration Script
            </h3>
            <p className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">{script}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={isPlaying ? stopAll : playAll}
              disabled={isExporting}
              className="py-4 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white font-black text-base shadow-xl hover:scale-[1.02] transition-transform flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPlaying ? <Pause size={20}/> : <Play size={20}/>}
              {isPlaying ? 'PAUSE' : 'PLAY'}
            </button>
            <button 
              onClick={onReset}
              disabled={isExporting}
              className="py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold hover:bg-white/10 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={20}/> NEW
            </button>
        </div>

        {/* Download Button */}
        <button 
          onClick={exportToMp4}
          disabled={isExporting || isPlaying}
          className="w-full py-4 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 text-white font-black text-base shadow-xl hover:scale-[1.02] transition-transform flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={20}/>
          {isExporting ? '내보내는 중...' : '비디오 다운로드'}
        </button>
        
        <div className="p-3 bg-white/5 rounded-2xl border border-white/10 space-y-3">
          <div className="flex items-center gap-3">
            <Volume2 size={16} className="text-cyan-400"/>
            <input 
              type="range" min="0" max="1" step="0.1" 
              value={bgmVolume} onChange={e => setBgmVolume(parseFloat(e.target.value))}
              className="flex-1 h-1 bg-white/10 rounded-lg appearance-none accent-cyan-500"
            />
            <span className="text-[10px] font-bold text-white/40 uppercase">BGM</span>
          </div>
        </div>
      </div>
    </div>
  );
};

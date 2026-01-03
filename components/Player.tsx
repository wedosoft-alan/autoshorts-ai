import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, RefreshCw, Volume2, Music, Film, Download, ChevronDown, Check, X, FileVideo, Loader2 } from 'lucide-react';

interface Props {
  videoUrls: string[];
  audioBuffer: AudioBuffer | null;
  script: string;
  onReset: () => void;
}

const BGM_URL = "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112778.mp3";

export const Player: React.FC<Props> = ({ videoUrls, audioBuffer, script, onReset }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  
  // Export State
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportFormat, setExportFormat] = useState<'webm' | 'mp4'>('webm');
  const [exportResolution, setExportResolution] = useState<'720p' | '1080p'>('720p');

  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Audio Context & Source Nodes
  const audioContextRef = useRef<AudioContext | null>(null);
  const narrationSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bgmSourceRef = useRef<AudioBufferSourceNode | null>(null);
  
  // BGM Data
  const [bgmBuffer, setBgmBuffer] = useState<AudioBuffer | null>(null);
  const [isBgmLoading, setIsBgmLoading] = useState(true);

  // Load and decode BGM
  useEffect(() => {
    const loadBgm = async () => {
      try {
        const response = await fetch(BGM_URL);
        const arrayBuffer = await response.arrayBuffer();
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        setBgmBuffer(decoded);
        ctx.close();
      } catch (e) {
        console.error("Failed to load background music", e);
      } finally {
        setIsBgmLoading(false);
      }
    };
    loadBgm();

    return () => {
      stopAudio();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Check MP4 support
  useEffect(() => {
    if (MediaRecorder.isTypeSupported('video/mp4')) {
        setExportFormat('mp4');
    } else {
        setExportFormat('webm');
    }
  }, []);

  // When video index changes, if playing, ensure video plays
  useEffect(() => {
    if (isPlaying && videoRef.current) {
        videoRef.current.play().catch(e => console.log("Auto-play blocked or waiting", e));
    }
  }, [currentVideoIndex, isPlaying]);

  const handleVideoEnded = () => {
    if (videoUrls.length > 1) {
        // Move to next video
        const nextIndex = (currentVideoIndex + 1) % videoUrls.length;
        setCurrentVideoIndex(nextIndex);
        // Note: The `useEffect` above will trigger play()
    } else {
        // Single video loop
        videoRef.current?.play();
    }
  };

  const playAudio = () => {
    if (!audioBuffer) return;

    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Narration
    const narrSource = ctx.createBufferSource();
    narrSource.buffer = audioBuffer;
    narrSource.connect(ctx.destination);
    
    // BGM
    if (bgmBuffer) {
      const bgmSource = ctx.createBufferSource();
      bgmSource.buffer = bgmBuffer;
      bgmSource.loop = true;
      const bgmGain = ctx.createGain();
      bgmGain.gain.value = 0.12;
      bgmSource.connect(bgmGain);
      bgmGain.connect(ctx.destination);
      bgmSource.start(0);
      bgmSourceRef.current = bgmSource;
    }

    // Cleanup on Narration End
    narrSource.onended = () => {
        setIsPlaying(false);
        if(videoRef.current) videoRef.current.pause();
        if (bgmSourceRef.current) {
            try { bgmSourceRef.current.stop(); } catch(e) {}
        }
        // Reset video to start
        setCurrentVideoIndex(0);
    };
    
    narrSource.start(0);
    narrationSourceRef.current = narrSource;
  };

  const stopAudio = () => {
    if (narrationSourceRef.current) {
      try { narrationSourceRef.current.stop(); } catch (e) {}
      narrationSourceRef.current = null;
    }
    if (bgmSourceRef.current) {
      try { bgmSourceRef.current.stop(); } catch (e) {}
      bgmSourceRef.current = null;
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      stopAudio();
      videoRef.current?.pause();
      setIsPlaying(false);
    } else {
      playAudio();
      // Ensure current video plays
      videoRef.current?.play().catch(e => console.error("Play fail", e));
      setIsPlaying(true);
    }
  };

  // --- Export Logic ---
  const handleExport = async () => {
    setIsExportMenuOpen(false);
    setIsExporting(true);
    setExportProgress(0);

    // Stop playback if running
    if (isPlaying) togglePlay();

    try {
        const width = exportResolution === '1080p' ? 1080 : 720;
        const height = exportResolution === '1080p' ? 1920 : 1280;
        const fps = 30;

        // 1. Setup Canvas (Visuals)
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if(!ctx) throw new Error("Canvas context failed");

        // 2. Setup Audio Recording
        const offlineCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const dest = offlineCtx.createMediaStreamDestination();
        
        // Connect Narration
        if (audioBuffer) {
            const source = offlineCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(dest);
            source.start(0);
        }
        // Connect BGM
        if (bgmBuffer) {
            const bgmSource = offlineCtx.createBufferSource();
            bgmSource.buffer = bgmBuffer;
            bgmSource.loop = true;
            const bgmGain = offlineCtx.createGain();
            bgmGain.gain.value = 0.12;
            bgmSource.connect(bgmGain);
            bgmGain.connect(dest);
            bgmSource.start(0);
        }

        // 3. Setup Recorder
        const canvasStream = canvas.captureStream(fps);
        const audioTrack = dest.stream.getAudioTracks()[0];
        if (audioTrack) canvasStream.addTrack(audioTrack);

        const mimeType = exportFormat === 'mp4' && MediaRecorder.isTypeSupported('video/mp4') 
            ? 'video/mp4' 
            : 'video/webm;codecs=vp9';
            
        const recorder = new MediaRecorder(canvasStream, {
            mimeType,
            videoBitsPerSecond: 5000000 // 5Mbps
        });

        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        const stopPromise = new Promise<Blob>((resolve) => {
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType });
                resolve(blob);
            };
        });

        recorder.start();

        // 4. Play and Draw Videos Sequentially
        const hiddenVideo = document.createElement('video');
        hiddenVideo.muted = true;
        hiddenVideo.playsInline = true;
        hiddenVideo.crossOrigin = "anonymous";
        // Force size on video element to match canvas for drawing
        hiddenVideo.width = width; 
        hiddenVideo.height = height;

        for (let i = 0; i < videoUrls.length; i++) {
            const url = videoUrls[i];
            
            await new Promise<void>((resolve, reject) => {
                hiddenVideo.src = url;
                hiddenVideo.onloadeddata = () => {
                    hiddenVideo.play();
                    
                    const drawFrame = () => {
                        if (hiddenVideo.paused || hiddenVideo.ended) return;
                        ctx.drawImage(hiddenVideo, 0, 0, width, height);
                        requestAnimationFrame(drawFrame);
                    };
                    drawFrame();
                };

                hiddenVideo.onended = () => {
                    resolve();
                };
                hiddenVideo.onerror = (e) => reject(e);
            });
            
            // Update progress
            setExportProgress(Math.round(((i + 1) / videoUrls.length) * 100));
        }

        recorder.stop();
        offlineCtx.close();
        
        const blob = await stopPromise;
        
        // 5. Trigger Download
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `autoshorts_${Date.now()}.${exportFormat}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);

    } catch (e) {
        console.error("Export failed", e);
        alert("영상 내보내기에 실패했습니다.");
    } finally {
        setIsExporting(false);
    }
  };


  // Safe access to current video URL
  const currentVideoUrl = videoUrls[currentVideoIndex] || null;

  return (
    <div className="flex flex-col md:flex-row gap-8 w-full max-w-5xl animate-fade-in">
      {/* Phone Mockup Frame */}
      <div className="mx-auto md:mx-0 relative w-[300px] h-[600px] bg-zinc-900 rounded-[3rem] border-8 border-zinc-800 shadow-2xl overflow-hidden shrink-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-zinc-800 rounded-b-2xl z-20"></div>
        
        {/* Export Overlay */}
        {isExporting && (
            <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-6 text-center backdrop-blur-sm">
                <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
                <h3 className="text-white font-bold text-lg mb-2">영상을 렌더링 중입니다...</h3>
                <p className="text-zinc-400 text-sm mb-4">브라우저를 닫지 마세요.</p>
                <div className="w-full bg-zinc-700 rounded-full h-2">
                    <div 
                        className="bg-indigo-500 h-2 rounded-full transition-all duration-300" 
                        style={{ width: `${exportProgress}%` }}
                    />
                </div>
                <span className="text-zinc-300 text-xs mt-2">{exportProgress}% 완료</span>
            </div>
        )}

        {currentVideoUrl ? (
          <video 
            key={currentVideoUrl} // Key change forces reload for new source
            ref={videoRef}
            src={currentVideoUrl}
            className="w-full h-full object-cover"
            muted // Muted to allow autoplay/sync logic without browser block
            playsInline
            onEnded={handleVideoEnded}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-950 text-zinc-700">
            영상 로딩 실패
          </div>
        )}

        {/* Overlay UI */}
        <div className="absolute bottom-0 left-0 w-full p-4 bg-gradient-to-t from-black/90 to-transparent pt-20 pointer-events-none">
          {/* We show full script or could slice it if we had timestamps. Showing full context is safer. */}
          <p className="text-white text-sm font-medium leading-relaxed drop-shadow-md line-clamp-4 word-keep-all">
            {script}
          </p>
          <div className="mt-4 flex items-center gap-2">
             <div className="flex items-center gap-1 bg-black/40 px-2 py-1 rounded-full backdrop-blur-sm">
                <Film size={12} className="text-indigo-400" />
                <span className="text-[10px] text-zinc-300 font-mono">SCENE {currentVideoIndex + 1}/{videoUrls.length}</span>
             </div>
          </div>
        </div>

        {/* Play Button Overlay if paused */}
        {!isPlaying && !isExporting && (
          <div 
            onClick={togglePlay}
            className="absolute inset-0 bg-black/30 flex items-center justify-center cursor-pointer hover:bg-black/20 transition-colors z-10"
          >
            <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30">
                <Play fill="white" className="ml-1 text-white" size={32} />
            </div>
          </div>
        )}
      </div>

      {/* Info & Controls Side */}
      <div className="flex-1 flex flex-col justify-center space-y-6">
        <div>
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 mb-2">
            나만의 쇼츠가 완성되었습니다!
          </h2>
          <p className="text-zinc-400 word-keep-all">
            총 {videoUrls.length}개의 장면으로 구성된 영상이 생성되었습니다. 재생 버튼을 눌러 확인해보세요.
          </p>
        </div>

        <div className="bg-zinc-900/50 p-6 rounded-xl border border-zinc-800/50 backdrop-blur-sm">
            <h3 className="text-zinc-300 font-semibold mb-3 flex items-center gap-2">
                <Volume2 size={18} className="text-indigo-400"/> 전체 대본
            </h3>
            <div className="text-zinc-400 text-sm leading-relaxed max-h-60 overflow-y-auto pr-2 word-keep-all whitespace-pre-wrap">
                {script}
            </div>
             <div className="mt-4 pt-4 border-t border-zinc-800 flex items-center gap-2 text-xs text-zinc-500">
                <Music size={14} /> 
                {isBgmLoading ? "배경음악 로딩 중..." : "배경음악: Calm Lo-Fi (믹싱됨)"}
            </div>
        </div>

        <div className="flex flex-col gap-3">
            <div className="flex gap-4">
            <button 
                onClick={togglePlay}
                disabled={isBgmLoading || isExporting}
                className="flex-1 py-3 px-6 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                {isPlaying ? '일시정지' : '전체 재생하기'}
            </button>
            
            <button 
                onClick={onReset}
                disabled={isExporting}
                className="px-6 py-3 rounded-lg border border-zinc-700 hover:bg-zinc-800 text-zinc-300 font-medium transition-all flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
            >
                <RefreshCw size={20} />
                새로 만들기
            </button>
            </div>
            
            {/* Export Dropdown */}
            <div className="relative z-20">
                <button
                    onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                    disabled={isExporting}
                    className="w-full py-3 px-6 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium transition-colors flex items-center justify-center gap-2 border border-zinc-700 disabled:opacity-50"
                >
                    <Download size={18} />
                    영상 저장 (Export)
                    <ChevronDown size={16} className={`transition-transform ${isExportMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {isExportMenuOpen && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl overflow-hidden animate-fade-in p-2">
                        <div className="text-xs text-zinc-500 px-3 py-2 font-semibold">설정</div>
                        
                        <div className="flex flex-col gap-1">
                            <div className="px-2 py-1">
                                <label className="text-zinc-400 text-xs mb-1 block">해상도</label>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => setExportResolution('720p')}
                                        className={`flex-1 text-xs py-1.5 rounded border ${exportResolution === '720p' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'}`}
                                    >
                                        720p (원본)
                                    </button>
                                    <button 
                                        onClick={() => setExportResolution('1080p')}
                                        className={`flex-1 text-xs py-1.5 rounded border ${exportResolution === '1080p' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'}`}
                                    >
                                        1080p (확대)
                                    </button>
                                </div>
                            </div>

                            <div className="px-2 py-1 mb-2">
                                <label className="text-zinc-400 text-xs mb-1 block">파일 형식</label>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => setExportFormat('webm')}
                                        className={`flex-1 text-xs py-1.5 rounded border ${exportFormat === 'webm' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'}`}
                                    >
                                        WebM
                                    </button>
                                    <button 
                                        onClick={() => setExportFormat('mp4')}
                                        disabled={!MediaRecorder.isTypeSupported('video/mp4')}
                                        className={`flex-1 text-xs py-1.5 rounded border ${exportFormat === 'mp4' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700 disabled:opacity-30'}`}
                                        title={!MediaRecorder.isTypeSupported('video/mp4') ? "이 브라우저에서는 지원되지 않습니다" : ""}
                                    >
                                        MP4
                                    </button>
                                </div>
                            </div>
                            
                            <button 
                                onClick={handleExport}
                                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg font-semibold flex items-center justify-center gap-2"
                            >
                                <Download size={14} /> 다운로드 시작
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};
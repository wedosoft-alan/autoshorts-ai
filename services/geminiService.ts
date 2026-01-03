
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ScriptData, Scene } from "../types";

const getAI = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

// 1. Generate Script
export const generateScript = async (topic: string, stylePreference: string): Promise<ScriptData> => {
  const ai = getAI();
  const prompt = `Create a high-quality 25-second YouTube Short storyboard about: "${topic}".
  CRITICAL: Define a consistent character and setting. Every visualPrompt must repeat physical descriptions (ethnicity, age, outfit) and the setting to ensure consistency.
  STYLE: ${stylePreference}.
  Output exactly 5 scenes in JSON.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          globalStyle: { type: Type.STRING },
          scenes: {
            type: Type.ARRAY,
            minItems: 5,
            maxItems: 5,
            items: {
              type: Type.OBJECT,
              properties: {
                visualPrompt: { type: Type.STRING },
                narration: { type: Type.STRING },
              },
              required: ["visualPrompt", "narration"],
            },
          },
        },
        required: ["title", "globalStyle", "scenes"],
      },
    },
  });

  return JSON.parse(response.text) as ScriptData;
};

// 2. Generate Image (Base for Video)
export const generateSceneImage = async (stylePrompt: string, scenePrompt: string): Promise<string> => {
  const ai = getAI();
  const fullPrompt = `${stylePrompt}, ${scenePrompt}. 9:16 vertical aspect ratio. High quality.`;
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: { parts: [{ text: fullPrompt }] },
    config: { imageConfig: { aspectRatio: "9:16" } }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) return part.inlineData.data;
  }
  throw new Error("이미지 생성 실패");
};

// Helper function for exponential backoff retry
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 5000
): Promise<T> => {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error as Error;
      const errorMessage = (error as Error).message || String(error);
      
      // Check if it's a 429 rate limit error
      if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('rate limit')) {
        const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff: 5s, 10s, 20s
        console.warn(`Rate limit hit (attempt ${attempt + 1}/${maxRetries}). Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      } else {
        // For non-rate-limit errors, throw immediately
        throw error;
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
};

// 3. Generate Video using Veo (Image-to-Video) with retry logic
export const generateSceneVideo = async (base64Image: string, prompt: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  return retryWithBackoff(async () => {
    let operation = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: `Cinematic motion, ${prompt}`,
      image: {
        imageBytes: base64Image,
        mimeType: 'image/png',
      },
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: '9:16'
      }
    });

    while (!operation.done) {
      await sleep(5000);
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new Error("비디오 생성 실패");
    
    return `${downloadLink}&key=${process.env.API_KEY}`;
  }, 3, 5000); // 3 retries with 5s base delay
};

// 4. Generate Audio
export const generateNarrationAudio = async (text: string): Promise<AudioBuffer> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("오디오 생성 실패");
  
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  const dataInt16 = new Int16Array(bytes.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  buffer.getChannelData(0).set(Array.from(dataInt16).map(v => v / 32768.0));
  return buffer;
};

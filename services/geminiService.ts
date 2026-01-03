import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ScriptData, Scene } from "../types";

// Helper to get a fresh AI instance with the current key
const getAI = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

// 1. Generate Script (Storyboard with 5 scenes)
export const generateScript = async (topic: string, stylePreference: string): Promise<ScriptData> => {
  const ai = getAI();
  
  const prompt = `Create a 30-second YouTube Short storyboard about: "${topic}".
  The story must be consistent, featuring the same main character or setting across scenes.
  Divide the story into 5 distinct scenes (approx 5-6 seconds each).
  
  User Style Preference: ${stylePreference}
  
  Output JSON format:
  {
    "title": "Korean Title",
    "globalStyle": "Detailed description of the art style based on the user preference, main character features, and setting to ensure consistency across all images. Use English for this part.",
    "scenes": [
      { 
        "visualPrompt": "Description of the specific action in this scene, referencing the main character/setting (in English).",
        "narration": "Korean narration line for this scene (해요체)."
      }
    ]
  }
  `;

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

  const text = response.text;
  if (!text) throw new Error("No script generated");

  const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(cleanedText) as ScriptData;
  } catch (e) {
    console.error("JSON Parse Error", e);
    throw new Error("Failed to parse script format.");
  }
};

// 2. Generate Image for a Scene
export const generateSceneImage = async (stylePrompt: string, scenePrompt: string): Promise<string> => {
  const ai = getAI();
  const fullPrompt = `Cinematic, high quality, 9:16 vertical ratio. ${stylePrompt} . Scene action: ${scenePrompt}`;
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        { text: fullPrompt }
      ]
    },
    config: {
      imageConfig: {
        aspectRatio: "9:16",
      }
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return part.inlineData.data;
    }
  }
  throw new Error("No image generated");
};

// 3. Generate Video (Veo)
export const generateVeoVideo = async (imageBase64: string, prompt: string): Promise<string> => {
  const attemptGeneration = async (isRetry: boolean = false): Promise<string> => {
    try {
        if (window.aistudio) {
            if (isRetry || !(await window.aistudio.hasSelectedApiKey())) {
                await window.aistudio.openSelectKey();
            }
        }
    } catch (e) {
        console.warn("AI Studio key check failed", e);
    }

    const aiWithKey = new GoogleGenAI({ apiKey: process.env.API_KEY });

    try {
      let operation = await aiWithKey.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: `Cinematic movement, slow motion. ${prompt}`,
        image: {
          imageBytes: imageBase64,
          mimeType: 'image/png',
        },
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '9:16'
        }
      });

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await aiWithKey.operations.getVideosOperation({ operation: operation });
      }

      const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!videoUri) throw new Error("Video generation failed: No URI");

      const videoRes = await fetch(`${videoUri}&key=${process.env.API_KEY}`);
      if (!videoRes.ok) throw new Error("Failed to download video file");
      
      const blob = await videoRes.blob();
      return URL.createObjectURL(blob);

    } catch (error: any) {
      const errorMsg = error.message || JSON.stringify(error);
      const isNotFound = errorMsg.includes("Requested entity was not found") || error.status === 404 || error.code === 404;

      if (isNotFound && !isRetry && window.aistudio) {
          console.warn("Veo 404. Retrying with key selection...");
          await window.aistudio.openSelectKey();
          return attemptGeneration(true);
      }
      throw error;
    }
  };

  return attemptGeneration(false);
};

// Orchestrator for Mass Generation
export const generateStoryVideoAssets = async (script: ScriptData): Promise<string[]> => {
    const imagePromises = script.scenes.map(scene => 
        generateSceneImage(script.globalStyle, scene.visualPrompt)
            .catch(e => { console.error("Img Gen Fail", e); return null; })
    );
    const images = await Promise.all(imagePromises);

    const validScenes: {img: string, prompt: string}[] = [];
    images.forEach((img, idx) => {
        if (img) validScenes.push({ img, prompt: script.scenes[idx].visualPrompt });
    });

    if (validScenes.length === 0) throw new Error("Failed to generate any scene images");

    const videoPromises = validScenes.map(scene => 
        generateVeoVideo(scene.img, scene.prompt)
            .catch(e => { console.error("Video Gen Fail", e); return null; })
    );

    const videoUrls = await Promise.all(videoPromises);
    const validVideoUrls = videoUrls.filter(url => url !== null) as string[];

    if (validVideoUrls.length === 0) throw new Error("Failed to generate any video clips");

    return validVideoUrls;
}


// 4. Generate Narration (TTS) - Combined
export const generateNarrationAudio = async (text: string): Promise<AudioBuffer> => {
  const ai = getAI();
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' }, 
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("No audio generated");

  const binaryString = atob(base64Audio);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  return await decodePCM(bytes, audioContext);
};

async function decodePCM(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
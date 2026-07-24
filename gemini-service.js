// ─── Gemini 2.5 Flash Audio Transcription ────────────────────────────────
// Uses @google/genai SDK via CDN ESM import.

import { GoogleGenAI } from 'https://esm.run/@google/genai';

const API_KEY = 'AQ.Ab8RN6LgtdO' + 'EFA24eB31vrVHmQmY3uPnRs1iuWtySkSzTdppzA';
const MODEL  = 'gemini-3.5-flash';

const ai = new GoogleGenAI({ apiKey: API_KEY });

// ─── TRANSCRIBE AUDIO ────────────────────────────────────────────────────

/**
 * Transcribes an audio Blob using Gemini 2.5 Flash.
 * @param {Blob} audioBlob  - Audio blob (audio/webm)
 * @returns {Promise<string>} - Transcription text
 */
export async function transcribeAudio(audioBlob) {
  const base64 = await blobToBase64(audioBlob);

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: 'Transcribe the following audio recording accurately. Return only the raw transcription text — no labels, no timestamps, no formatting. If the audio is unclear or silent, return an empty string.',
          },
          {
            inlineData: {
              mimeType: audioBlob.type || 'audio/webm',
              data: base64,
            },
          },
        ],
      },
    ],
  });

  const text = response?.candidates?.[0]?.content?.parts?.[0]?.text
            || response?.text
            || '';
  return text.trim();
}

// ─── HELPERS ─────────────────────────────────────────────────────────────

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // Strip the data:audio/webm;base64, prefix
      const result = reader.result;
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

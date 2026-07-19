let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

async function toggleRecording(onRecordStop) {
  const micBtn = document.getElementById("mic-btn");
  if (!micBtn) return;

  if (!isRecording) {
    // Start Recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      
      let mimeType = '';
      if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
      else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      else if (MediaRecorder.isTypeSupported('audio/wav')) mimeType = 'audio/wav';

      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunks = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/wav' });
        
        // Release mic resources
        stream.getTracks().forEach(track => track.stop());

        micBtn.textContent = "TRANSCRIBING...";
        micBtn.classList.remove("recording");

        try {
          const text = await transcribeAudioBlob(audioBlob);
          onRecordStop(text);
        } catch(e) {
          console.error("Transcription failed:", e);
          const userFriendlyMsg = e.message.includes("429") 
            ? "Gemini rate limit exceeded (429). Please wait a few seconds before trying again."
            : e.message;
          onRecordStop(`[Transcription failed: ${userFriendlyMsg}]`);
        }

        micBtn.textContent = "REC AUDIO";
      };

      mediaRecorder.start();
      isRecording = true;
      micBtn.textContent = "STOP REC";
      micBtn.classList.add("recording");
    } catch(e) {
      console.error("Recording start failed:", e);
      window.showToast?.("Mic recording failed: " + e.message);
    }
  } else {
    // Stop Recording
    if (mediaRecorder) {
      mediaRecorder.stop();
    }
    isRecording = false;
  }
}

async function transcribeAudioBlob(blob) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const response = await window.fetchGemini({
    contents: [{
      parts: [
        {
          inlineData: {
            mimeType: blob.type || "audio/wav",
            data: base64
          }
        },
        {
          text: "Transcribe the audio exactly and completely. Output ONLY the transcription. Do not explain, summarize, or add markdown."
        }
      ]
    }]
  });

  if (!response.ok) throw new Error(`Gemini status ${response.status}`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
}

export { toggleRecording };

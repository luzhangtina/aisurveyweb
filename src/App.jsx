import { useEffect, useState, useCallback, useRef } from "react";
import { Mic, Speaker } from "lucide-react";
import { MediaRecorder, register } from "extendable-media-recorder";
import { connect } from "extendable-media-recorder-wav-encoder";
import ThinkingDots from "./ThinkingDots";

const SERVER_URL = "ws://localhost:5000/ws";

function App() {
  const [encoderInitialized, setEncoderInitialized] = useState(false);
  const [isConversionStarted, setIsConversionStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speakerSize, setSpeakerSize] = useState(120);
  const [micSize, setMicSize] = useState(120);
  const wsRef = useRef(null);
  const startRecordingRef = useRef(null);
  const animationFrameRef = useRef(null);
  const micAnimationFrameRef = useRef(null);

  const sendToServer = useCallback((init, audioBlob = null) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("⚠️ WebSocket not connected!");
      return;
    }

    const clientInfo = {
      client_id: "client1",
      name: "Tina",
    };

    if (init) {
      console.log("📤 Sending context to server:", clientInfo);
      wsRef.current.send(JSON.stringify(clientInfo));
    } else if (audioBlob) {
      // Create a new FileReader
      const reader = new FileReader();
      
      // Set up the onload handler before calling readAsArrayBuffer
      reader.onload = function() {
        try {
          const arrayBuffer = this.result;
          const uint8Array = new Uint8Array(arrayBuffer);
          
          // Convert to base64 in chunks to avoid call stack issues
          const chunkSize = 0x8000; // Process in 32KB chunks
          let base64Audio = '';
          
          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.slice(i, i + chunkSize);
            base64Audio += String.fromCharCode.apply(null, chunk);
          }
          
          base64Audio = btoa(base64Audio);

          const audioClientInfo = {
            ...clientInfo,
            audio_data: base64Audio,
          };

          console.log("📤 Sending Base64-encoded WAV data to server...");
          wsRef.current.send(JSON.stringify(audioClientInfo));
        } catch (error) {
          console.error("Error processing audio data:", error);
        }
      };

      // Read the blob as array buffer
      reader.readAsArrayBuffer(audioBlob);
    }
  }, []);

  const playAudio = useCallback(async (audioData) => {
    if (!audioData) return;
  
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    try {
      const arrayBuffer = await audioData.arrayBuffer(); // Convert Blob to ArrayBuffer
      const decodedData = await audioContext.decodeAudioData(arrayBuffer);
  
      const source = audioContext.createBufferSource();
      source.buffer = decodedData;
      source.connect(audioContext.destination);
  
      let direction = 1;
      const animate = () => {
        setSpeakerSize(prev => {
          const newSize = prev + direction;
          if (newSize >= 144) direction = -1;
          if (newSize <= 120) direction = 1;
          return newSize;
        });
        animationFrameRef.current = requestAnimationFrame(animate);
      };
  
      source.onended = () => {
        console.log("✅ AI speech ended. Starting user recording...");
      };
  
      setIsPlaying(true);
      animationFrameRef.current = requestAnimationFrame(animate);
      source.start(0);
  
    } catch (error) {
      console.error("❌ Error decoding or playing MP3:", error);
    }
  }, []);
  
  const startRecording = useCallback(async () => {    
    try {
      setIsRecording(true);

      let direction = 1;
      const animate = () => {
        setMicSize(prev => {
          const newSize = prev + direction;
          if (newSize >= 144) direction = -1;
          if (newSize <= 120) direction = 1;
          return newSize;
        });
        micAnimationFrameRef.current = requestAnimationFrame(animate);
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/wav" });
      const chunks = [];
    
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      source.connect(analyser);
      
      const bufferLength = analyser.fftSize;
      const dataArray = new Uint8Array(bufferLength);
      let silenceTimer = null;

      function detectSilence() {
        analyser.getByteFrequencyData(dataArray);
        const volume = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        
        if (volume < 10) {
          if (!silenceTimer) {
            silenceTimer = setTimeout(() => {
              console.log("🛑 Silence detected. Stopping recording...");
              if (micAnimationFrameRef.current) {
                cancelAnimationFrame(micAnimationFrameRef.current);
              }
              setIsRecording(false);
              recorder.stop();
              stream.getTracks().forEach(track => track.stop());
              audioContext.close();
            }, 3000);
          }
        } else {
          if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }
        }

        requestAnimationFrame(detectSilence);
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          console.log("Recording...");
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        console.log("Record finished.");
        const audioBlob = new Blob(chunks, { type: "audio/wav" });
        sendToServer(false, audioBlob);
      };

      recorder.start();
      console.log("🎤 Recording started");
      micAnimationFrameRef.current = requestAnimationFrame(animate);
      detectSilence();
    } catch (error) {
      console.error("❌ Error accessing microphone:", error);
      setIsRecording(false);
    }
  }, [sendToServer]);

  const startConversion = useCallback(() => {
    console.log("Start Conversion");
    sendToServer(true);
    setIsConversionStarted(true);
  }, [sendToServer]);

  // Store the startRecording function in the ref
  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  // Initialize socket connection using ref to persist across re-renders
  useEffect(() => {
    // Only create a new socket if one doesn't exist
    if (!wsRef.current) {
      wsRef.current = new WebSocket(SERVER_URL);

      wsRef.current.onopen = () => {
        console.log("✅ Connected to WebSocket server");
      };

      wsRef.current.onmessage = (event) => {
        try {
            console.log("🎵 AI response received");
            playAudio(event.data);
        } catch (error) {
          console.error("❌ Error processing WebSocket message:", error);
        }
      }

      wsRef.current.onclose = () => console.log("❌ WebSocket closed");

      return () => {
        if (wsRef.current && !document.querySelector('#root')) {
          console.log("Application is truly unmounting. Closing socket.");
          wsRef.current.close();
          wsRef.current = null;
        }

        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          cancelAnimationFrame(micAnimationFrameRef.current);
        }
      };
    }
  }); // Empty dependency array for single initialization

  // Initialize encoder once
  useEffect(() => {
    async function initializeEncoder() {
      try {
        if (!encoderInitialized) {
          await register(await connect());
          console.log("✅ WAV Encoder Registered");
          setEncoderInitialized(true);
        }
      } catch (error) {
        if (error.message.includes('already an encoder stored')) {
          // Encoder is already registered, just update our state
          console.log("Encoder was already registered");
          setEncoderInitialized(true);
        } else {
          console.error("Error initializing encoder:", error);
        }
      }
    }
    initializeEncoder();
  });

  return (
    <div className="flex min-h-screen w-full items-center justify-center">
      <div className="text-center space-y-6 flex flex-col items-center justify-center w-full">
        {!isConversionStarted && (
          <button
            onClick={startConversion}
            className="rounded-full bg-transparent px-24 py-20 text-6xl font-semibold text-blue-500 border-0 transition-all hover:bg-blue-100 hover:text-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:ring-offset-2"
          >
            Start Survey
          </button>               
        )}

        {isPlaying && (
          <div className="flex justify-center">
            <Speaker size={speakerSize} style={{ fill: 'black' }} className="animate-bounce" />
          </div>
        )}


        {isRecording && (
          <div className="relative">
          <Mic size={micSize} style={{ fill: 'black', stroke: 'black' }} className="animate-bounce" />
          </div>
        )}

        {isConversionStarted && !isPlaying && !isRecording && (
          <div className="flex justify-center">
            <ThinkingDots />
          </div>
        )}
      </div>
    </div>
  );  
}

export default App;

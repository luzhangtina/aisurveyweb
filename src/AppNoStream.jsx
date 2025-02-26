import { useEffect, useState, useCallback, useRef } from "react";
import { Mic, Speaker } from "lucide-react";
import { io } from "socket.io-client";
import { MediaRecorder, register } from "extendable-media-recorder";
import { connect } from "extendable-media-recorder-wav-encoder";
import ThinkingDots from "./ThinkingDots";

const SERVER_URL = "http://localhost:5000";

function AppNoStream() {
  const [encoderInitialized, setEncoderInitialized] = useState(false);
  const [isConversionStarted, setIsConversionStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speakerSize, setSpeakerSize] = useState(120);
  const [micSize, setMicSize] = useState(120);
  const socketRef = useRef(null);
  const startRecordingRef = useRef(null);
  const animationFrameRef = useRef(null);
  const micAnimationFrameRef = useRef(null);

  const sendToServer = useCallback((init, audioBlob = null) => {
    if (!socketRef.current?.connected) {
      console.warn("⚠️ Socket is not connected! Trying to reconnect...");
      return;
    }

    const clientInfo = {
      client_id: "client1",
      name: "Tina",
    };

    if (init) {
      console.log("📤 Sending context to server:", clientInfo);
      socketRef.current.emit("client_voice", clientInfo);
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
          socketRef.current.emit("client_voice", audioClientInfo);
        } catch (error) {
          console.error("Error processing audio data:", error);
        }
      };

      // Read the blob as array buffer
      reader.readAsArrayBuffer(audioBlob);
    }
  }, []);

  const playAudio = useCallback((audioData) => {
    const audioBlob = new Blob([audioData], { type: "audio/wav" });
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

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

    audio.oncanplaythrough = () => {
      console.log("🔊 AI speech ready to play.");
      setIsPlaying(true);
      animationFrameRef.current = requestAnimationFrame(animate);
      audio.play().catch((error) => console.error("❌ Error playing audio:", error));
    };

    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      setIsPlaying(false);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      console.log("✅ AI speech ended. Starting user recording...");
      startRecordingRef.current();
    };

    audio.onerror = () => console.error("❌ Error playing AI response audio.");
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
    if (!socketRef.current) {
      const newSocket = io(SERVER_URL, {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        transports: ["websocket"]
      });
      
      socketRef.current = newSocket;

      newSocket.on("connect", () => {
        console.log("Connected to server:", newSocket.id);
      });

      newSocket.on("disconnect", () => {
        console.log("Disconnected from server");
      });

      newSocket.on("connect_error", (error) => {
        if (newSocket.active) {
          console.log("Temporary disconnect. Will retry: ", error.message);
        } else {
          console.log(error.message);
        }
      });

      newSocket.on("ai_speech", (audioData) => {
        console.log("AI response received:", audioData);
        playAudio(audioData);
      });
    }

    // Cleanup function
    return () => {
      // Only close the socket if component is truly being unmounted
      if (socketRef.current && !document.querySelector('#root')) {
        console.log("Application is truly unmounting. Closing socket.");
        socketRef.current.close();
        socketRef.current = null;
      }

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
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

export default AppNoStream;

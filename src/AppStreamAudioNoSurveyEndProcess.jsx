import { useEffect, useState, useCallback, useRef } from "react";
import { Mic, Speaker } from "lucide-react";
import { MediaRecorder, register } from "extendable-media-recorder";
import { connect } from "extendable-media-recorder-wav-encoder";
import ThinkingDots from "./ThinkingDots";

const SERVER_URL = "ws://localhost:5000/ws";

// Playing server audio with stream. The audio is in binary mp3 format
function App() {
  const [encoderInitialized, setEncoderInitialized] = useState(false);
  const [isConversionStarted, setIsConversionStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speakerSize, setSpeakerSize] = useState(120);
  const [micSize, setMicSize] = useState(120);
  const [audioQueue, setAudioQueue] = useState([]); // Queue of audio chunks
  const [isFinal, setIsFinal] = useState(false); // Flag for final message
  const audioContextRef = useRef(null); // Audio context reference
  const audioSourceNodeRef = useRef(null); // Current source node reference
  const wsRef = useRef(null);
  const startRecordingRef = useRef(null);
  const animationFrameRef = useRef(null);
  const micAnimationFrameRef = useRef(null);
  const currentQueueRef = useRef([]);
  const isFinalRef = useRef(isFinal);

  const sendToServer = useCallback((init, audioBlob = null) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("⚠️ WebSocket not connected!");
      return;
    }

    const message = {
      type: "client_init",
      client_id: "client1",
      name: "Tina",
    }

    if (init) {
      console.log("📤 Sending context to server:", message);
      wsRef.current.send(JSON.stringify(message));
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

          const message = {
            type: "client_audio_response",
            client_id: "client1",
            name: "Tina",
            audio_data: base64Audio,
          }

          console.log("📤 Sending Base64-encoded WAV data to server...");
          wsRef.current.send(JSON.stringify(message));
        } catch (error) {
          console.error("Error processing audio data:", error);
        }
      };

      // Read the blob as array buffer
      reader.readAsArrayBuffer(audioBlob);
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

  const addToQueue = (audioChunk) => {
    setAudioQueue((prevQueue) => {
      const newQueue = [...prevQueue, audioChunk];
      console.log("Queue updated, new length:", newQueue.length);
      return newQueue;
    });
  };

  const cleanup = useCallback(() => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    
    setIsFinal(false);
  
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  
    setIsPlaying(false);
  
    // Small delay to ensure state updates before starting recording again
    setTimeout(() => {
      console.log("Starting recording after cleanup");
      startRecordingRef.current();
    }, 100);
  }, []);

  const handleWebSocketMessage = (message) => {
    const { type, isFinal: receivedIsFinal, audioBase64 } = message;

    if (type === 'server_audio_response') {
      if (audioBase64) {
        console.log("adding audio to queue")
        addToQueue(audioBase64);
      }

      if (receivedIsFinal) {
        console.log("set isFinal to true")
        setIsFinal(true);
      }

      console.log("isPlaying: ", isPlaying)
      console.log("audioQueue.length: ", audioQueue.length)
      if (!isPlaying && audioQueue.length > 0) {
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

        console.log("start playing audio")
        setIsPlaying(true);
        animate(); 
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;
      }
    }
  };

  const playNextAudio = useCallback(() => {
    const currentQueue = currentQueueRef.current;
  
    if (currentQueue.length > 0) {
      const nextAudio = currentQueue[0];

      const arrayBuffer = new Uint8Array(atob(nextAudio).split('').map(char => char.charCodeAt(0)));

      const audioContext = audioContextRef.current;
      const sourceNode = audioContext.createBufferSource();
      audioContext.decodeAudioData(arrayBuffer.buffer, (buffer) => {
        sourceNode.buffer = buffer;
        sourceNode.connect(audioContext.destination);

        console.log("playing a audio chunk")
        sourceNode.start();
        audioSourceNodeRef.current = sourceNode;

        sourceNode.onended = () => {
          setAudioQueue(prevQueue => prevQueue.slice(1));
          sourceNode.disconnect();
          
          // Use setTimeout to give React time to update state and ref
          setTimeout(() => {
            if (currentQueueRef.current.length === 0 && isFinalRef.current) {
              console.log("nothing to playing, can finish now");
              cleanup();
            } else if (currentQueueRef.current.length > 0) {
              console.log("playing next chunk");
              playNextAudio();
            } else {
              // Not final but queue empty, wait and check again
              console.log("Not final but queue empty, wait and check again");
              const checkInterval = setInterval(() => {
                if (currentQueueRef.current.length > 0) {
                  clearInterval(checkInterval);
                  playNextAudio();
                }
              }, 100);
              
              // Clear interval after a reasonable timeout
              setTimeout(() => clearInterval(checkInterval), 5000);
            }
          }, 10);
        };
      });
    }
  }, [cleanup]);

  const startConversion = useCallback(() => {
    const hasPermission = requestMicrophonePermission()
    if (!hasPermission) {
        alert("No permission")
        return;
    }
    
    console.log("Start Conversion");
    sendToServer(true);
    setIsConversionStarted(true);
  }, [sendToServer]);

  useEffect(() => {
    isFinalRef.current = isFinal;
  }, [isFinal]);

  // Store the startRecording function in the ref
  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  // Update the ref whenever audioQueue changes
  useEffect(() => {
    currentQueueRef.current = audioQueue;
  }, [audioQueue]);

  useEffect(() => {
    console.log("audioQueue changed, length:", audioQueue.length);
    
    if (!isPlaying && audioQueue.length > 0) {
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
      
      console.log("start playing audio");
      setIsPlaying(true);
      animate();
      
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;
      playNextAudio();
    }
  }, [audioQueue, isPlaying, playNextAudio]); 

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
          const message = JSON.parse(event.data);
          console.log("✅ Received message: ", message);
          handleWebSocketMessage(message);
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

  async function requestMicrophonePermission() {
      try {
          await navigator.mediaDevices.getUserMedia({audio: true})
          return true
      } catch {
          console.error('Microphone permission denied')
          return false
      }
  }

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

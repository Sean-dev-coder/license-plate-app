// src/composables/useVoiceAssistant.js
import { ref, onUnmounted } from 'vue';
import { correctTranscript, extractBatchPlates } from '../utils/textUtils';

export function useVoiceAssistant() {
  const isVoiceListening = ref(false); // 總開關
  const isListening = ref(false);      // 實際麥克風狀態
  const isSystemSpeaking = ref(false); // 系統正在說話
  const message = ref('');             // 語音相關訊息
  
  // 內部變數
  let recognition = null;
  let voiceBuffer = "";
  let bufferTimer = null;
  let wakeLock = null;
  const audioPlayer = new Audio();
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  // ==========================================
  // 【新增】強制喚醒藍牙麥克風的函式
  // ==========================================
  // ==========================================
  // 【加強版】精準鎖定藍牙裝置並喚醒
  // ==========================================
  const wakeUpBluetooth = async () => {
    try {
      message.value = "正在搜尋藍牙耳機...";
      
      // 1. 第一次請求：為了拿權限 (不然 enumerateDevices 標籤會是空的)
      // 這一點點時間順便讓 Android 知道我們要用麥克風
      let stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // 用完馬上關，準備下一步

      // 2. 列出所有裝置，找出那是「第幾個」
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      // --- 策略 A：智慧搜尋 (推薦) ---
      // 找名字裡面有 "Bluetooth", "Headset", "JLab" (您的耳機牌子) 的
      let targetDevice = audioInputs.find(d => 
      // d.label.toLowerCase().includes('headset') ||
        d.label.toLowerCase().includes('jlab') ||
        d.label.toLowerCase().includes('bluetooth')
      );
      // --- 策略 B：如果您很確定它是「最後一個」(通常藍牙是最後加入的) ---
      // 如果策略 A 沒找到，就預設抓清單裡最後一個
      if (!targetDevice && audioInputs.length > 1) {
        targetDevice = audioInputs[audioInputs.length - 1];
      }
      if (targetDevice) {
        message.value = `鎖定裝置: ${targetDevice.label || '外接/藍牙裝置'}`;
        console.log("鎖定目標 ID:", targetDevice.deviceId);

        // 3. 【關鍵步驟】指定 deviceId 強制開啟
        const bluetoothStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: targetDevice.deviceId } // <--- 這裡就是在指定「第4個」
          }
        });

        // 4. 成功連線後，等待一秒讓系統切換路由
        // 這時候您的藍牙耳機應該會聽到背景底噪改變
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 5. 任務完成，釋放它，讓 SpeechRecognition 接手
        bluetoothStream.getTracks().forEach(track => track.stop());
        console.log("🎤 藍牙鎖定喚醒完成");
        
      } else {
        message.value = "未偵測到藍牙特徵，使用系統預設";
        // 沒找到特定裝置，就用通用喚醒法 (雖然不完美但堪用)
        const defaultStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        defaultStream.getTracks().forEach(track => track.stop());
      }

    } catch (err) {
      console.error("藍牙鎖定失敗:", err);
      message.value = "藍牙連接異常，切換回預設";
    }
  };
  // 自定義問候語
  const greetings = ["大哥辛苦了，請說車牌", "吃飽了嗎，系統準備好了", "現在可以開始查詢車牌"];

  // 外部注入的處理函式 (當分析出車牌時呼叫)
  let onPlatesDetected = null; 

  // --- 1. 螢幕鎖定 ---
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('💡 螢幕喚醒鎖定已啟用');
      }
    } catch (err) { console.error('螢幕鎖定失敗', err); }
  };

  // --- 2. 說話功能 (Speak) ---
  const speak = async (text, isResult = false) => {
    if (!text || text.trim() === "") return;
    isSystemSpeaking.value = true;

    // 暫停識別以防回音
    if (recognition && isVoiceListening.value) {
      try { recognition.stop(); } catch (e) {}
    }

    const resumeListening = () => {
      setTimeout(() => {
        isSystemSpeaking.value = false;
        if (isVoiceListening.value && document.visibilityState === 'visible') {
          try { recognition.start(); } catch (e) {}
        }
      }, 500);
    };

    return new Promise((resolve) => {
      let textToSpeak = text;
      if (isResult) {
        textToSpeak = text.replace(/([a-zA-Z0-9])/g, '$1 ').replace(/-/g, ' ');
      }
      const utter = new SpeechSynthesisUtterance(textToSpeak);
      utter.lang = 'zh-TW';
      utter.rate = 0.9;
      utter.volume = 1;
      utter.onend = () => { resumeListening(); resolve(); };
      utter.onerror = () => { resumeListening(); resolve(); };
      
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    });
  };

  // --- 3. 核心監聽邏輯 ---
  const handleVoiceResult = (event) => {
    if (isSystemSpeaking.value) return;

    let currentSegment = "";
    let isFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) isFinal = true;
      currentSegment += event.results[i][0].transcript;
    }

    if (isFinal) {
      const correctedSegment = correctTranscript(currentSegment);
      voiceBuffer += correctedSegment;
      message.value = `聽取中: ${voiceBuffer}`;

      if (voiceBuffer.includes('查詢')) {
        const platesFound = extractBatchPlates(voiceBuffer);
        if (platesFound.length > 0) {
          const simulationInput = platesFound.join(' ');
          const totalLength = simulationInput.replace(/[-\s]/g, '').length;
          
          // 快速通關邏輯
          if (totalLength >= 6) {
             triggerSearch(simulationInput, true);
             return;
          }

          // 緩衝邏輯
          if (bufferTimer) clearTimeout(bufferTimer);
          bufferTimer = setTimeout(() => {
             triggerSearch(simulationInput, false);
          }, 1200);
        }
      }
    }
  };
  
  const triggerSearch = (input, immediate) => {
      if (bufferTimer) clearTimeout(bufferTimer);
      console.log(`語音識別結果: ${input}`);
      
      // 呼叫外部注入的處理函式
      if (onPlatesDetected) onPlatesDetected(input);

      voiceBuffer = "";
  };

  // --- 4. 啟動/關閉開關 ---
  const toggleVoiceSearch = async (callback) => {
    // 註冊 callback
    if (callback) onPlatesDetected = callback;

    if (!Recognition) return alert("您的瀏覽器不支援語音功能");

    // 音訊預熱
    audioPlayer.src = "data:audio/wav;base64,UklGRiQAAABXQVZFRm10IBAAAAABAAEAgD8AAIA/AAABAAgAZGF0YQAAAAA=";
    audioPlayer.play().catch(() => {});

    await requestWakeLock();

    // 關閉邏輯
    if (isVoiceListening.value) {
      isVoiceListening.value = false;
      isSystemSpeaking.value = false;
      if (recognition) recognition.stop();
      if (bufferTimer) clearTimeout(bufferTimer);
      voiceBuffer = "";
      message.value = "語音監聽已關閉";
      return;
    }

    // 啟動邏輯
    isVoiceListening.value = true;
    const welcome = greetings[Math.floor(Math.random() * greetings.length)];
    message.value = `系統啟動：${welcome}`;
    await speak(welcome);

    if (!recognition) {
      recognition = new Recognition();
      recognition.lang = 'zh-TW';
      recognition.continuous = true;
      recognition.interimResults = true;
      
      recognition.onstart = () => { isListening.value = true; message.value = "🎤 監聽中..."; };
      recognition.onend = () => {
         isListening.value = false;
         // 自動重啟機制
         if (document.visibilityState === 'visible' && isVoiceListening.value && !isSystemSpeaking.value) {
             try { recognition.start(); } catch(e) {}
         }
      };
      recognition.onerror = (e) => {
          console.error("語音錯誤", e.error);
          if (e.error === 'not-allowed') {
             isVoiceListening.value = false;
             isListening.value = false;
          }
      };
      recognition.onresult = handleVoiceResult;
    }

    try { recognition.start(); } catch(e) {}
  };

  // --- 5. 頁面可見性處理 (核彈級重連) ---
  const handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible') {
      await requestWakeLock();
      if (isVoiceListening.value) {
        message.value = "系統喚醒中...";
        if (recognition) recognition.abort();
        setTimeout(() => {
           if (recognition && isVoiceListening.value) recognition.start().catch(()=>{});
        }, 500);
      }
    }
  };

  // 生命週期清理
  onUnmounted(() => {
     if (wakeLock) wakeLock.release();
     if (recognition) recognition.abort();
     document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  // 註冊全域監聽
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return {
    isVoiceListening,
    isListening,
    message, // 讓外層可以顯示語音狀態
    toggleVoiceSearch,
    speak // 匯出 speak 讓搜尋功能可以用
  };
}
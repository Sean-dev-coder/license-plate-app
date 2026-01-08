<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import { auth, db, storage, functions } from '../firebase.js';
import imageCompression from 'browser-image-compression';// 這是用來壓縮圖片的套件

// --- 新增：住戶名單功能相關的狀態變數 ---
const residentListImageUrl = ref('') // 預設是空的，我們會從 Firebase 讀取
const residentListFile = ref(null)
const isResidentListUploading = ref(false)
const isListening = ref(false);
const props = defineProps({
  collection: { type: String, required: true }
})

// --- 狀態變數 ---
const searchPlate = ref('')
const isLoading = ref(false)
const message = ref('')
const isSuccess = ref(false)
const searchInput = ref(null)
const searchResults = ref([])
const selectedItem = ref(null)
const showCreateForm = ref(false)
const plateToCreate = ref('')
const selectedFile = ref(null)
const isUploading = ref(false)
const isNumericMode = ref(true)
const searchMode = ref('plate')
const editSectionRef = ref(null)
const notesTextarea = ref(null)
const featuresTextarea = ref(null)
const isEditing = ref(false)
const itemBeforeEdit = ref(null)
const isNewHouseholdModalOpen = ref(false)
const householdToCreate = ref({ id: '', name: '', features: '' })
const pendingCount = ref(0); // 待查的數量
// --- 新增：語音功能相關狀態 ---
const isVoiceListening = ref(false);
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
const isSystemSpeaking = ref(false); // [新功能] 防止系統報讀時自己聽自己
const audioPlayer = new Audio();
// --- 核心：語音辨識 (STT) ---
// --- 新增：自定義問候語清單 ---
const greetings = [
  "大哥辛苦了，請說車牌",
  "吃飽了嗎，系統準備好了",
  "現在可以開始查詢車牌"
];
// --- 1. 強制原生語音版 speak 函式 (捨棄雲端，確保藍牙切換最穩) ---
const speak = async (text, isResult = false) => {
  if (!text || text.trim() === "") return;

  isSystemSpeaking.value = true; // 標記系統正在說話，防止麥克風收到回音

  // 【關鍵步驟 1】: 報讀前，強制停止麥克風
  // 讓 Pixel 8a 的藍牙從「通話模式」切換回「媒體模式」，聲音才會清楚
  if (recognition && isVoiceListening.value) {
    try {
      recognition.stop();
      console.log("🔊 準備報讀，暫時釋放麥克風...");
    } catch (e) {
      console.error("停止麥克風失敗", e);
    }
  }

  // 定義重啟麥克風的邏輯 (共用)
  const resumeListening = () => {
    // 延遲 0.5 秒，給藍牙耳機一點時間切換回「通話收音模式」
    setTimeout(() => {
      isSystemSpeaking.value = false;
      // 只有在原本就是開啟監聽的狀態下，才自動重啟
      if (isVoiceListening.value) {
        console.log("👂 報讀完畢，重啟監聽...");
        try {
          recognition.start();
        } catch (e) {
          console.log("麥克風已啟動或無需重啟");
        }
      }
    }, 500); 
  };

  // 【關鍵步驟 2】: 統一使用原生 SpeechSynthesis (離線/低延遲)
  return new Promise((resolve) => {
    // 如果是報讀車牌結果，我們稍微處理一下文字，讓它念得慢一點或清楚一點
    // 例如把 "ABC-1234" 變成 "A B C 1 2 3 4" (可選，看您喜好)
    let textToSpeak = text;
    if (isResult) {
        // 簡單優化：將英數字加空格，讓 Google 小姐念得更清楚
        textToSpeak = text.replace(/([a-zA-Z0-9])/g, '$1 ').replace(/-/g, ' ');
    }

    const utter = new SpeechSynthesisUtterance(textToSpeak);
    utter.lang = 'zh-TW'; 
    utter.rate = 0.9;  // 稍微調慢一點點 (0.8~1.0)，讓保全聽得更清楚
    utter.volume = 1;  // 最大音量

    // 監聽結束事件
    utter.onend = () => {
      resumeListening(); // 講完了 -> 重啟麥克風
      resolve();
    };

    utter.onerror = (err) => {
      console.error("語音播放錯誤", err);
      resumeListening(); // 就算出錯也要把麥克風還給使用者
      resolve();
    };

    // 播放前先取消之前的排程，避免卡住
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  });
};
// ==========================================
// 1. 全域變數與設定 (放在 startVoiceSearch 外面)
// ==========================================

// --- 語音校正字典 (包含數字、字母、常見指令諧音) ---
const typoMap = {
  // 指令
  '茶尋': '查詢', '茶行': '查詢', '查尋': '查詢', '搜尋': '查詢', '查': '查詢', '尋找': '查詢',
  
  // 數字 (含軍用/台式諧音)
  '一': '1', '妖': '1', '么': '1', '要': '1', '依': '1',
  '二': '2', '愛': '2', '餓': '2', '兩': '2',
  '三': '3', '山': '3', '散': '3',
  '四': '4', '是': '4', '世': '4',
  '五': '5', '舞': '5', '無': '5',
  '六': '6', '溜': '6', '路': '6',
  '七': '7', '去': '7', '起': '7', '氣': '7',
  '八': '8', '巴': '8', '發': '8', '爸': '8',
  '九': '9', '酒': '9', '久': '9',
  '洞': '0', '動': '0', '孔': '0', '懂': '0', '零': '0',

  // 字母
  'A': 'A', 'ㄟ': 'A',
  'B': 'B', '逼': 'B',
  'C': 'C', '西': 'C',
  'D': 'D', '豬': 'D',
  'E': 'E',
  'F': 'F', '艾夫': 'F',
  'G': 'G', '居': 'G', '雞': 'G',
  'H': 'H', '欸取': 'H',
  'I': 'I', '愛': 'I', 
  'J': 'J', '傑': 'J',
  'K': 'K', 'KAY': 'K',
  'L': 'L', '艾爾': 'L',
  'M': 'M', '艾姆': 'M',
  'N': 'N', '恩': 'N',
  'O': 'O', '歐': 'O',
  'P': 'P', '披': 'P',
  'Q': 'Q', 'CUTE': 'Q',
  'R': 'R', '阿': 'R',
  'S': 'S', '艾斯': 'S',
  'T': 'T', '踢': 'T',
  'U': 'U', '優': 'U',
  'V': 'V', 'VEE': 'V',
  'W': 'W', '大波憂': 'W',
  'X': 'X', '叉': 'X',
  'Y': 'Y', '歪': 'Y',
  'Z': 'Z', '力': 'Z',
  '還有': ' ', 
  '以及': ' ', 
  '再來': ' ', 
  '下一台': ' ', 
  '接著': ' ', 
  '和': ' ', 
  '跟': ' ',
  '空白': ' ',
  'SPACE': ' ',
  '個': ' ', 
  '、': ' ', 
  '，': ' '
};
// --- 校正輔助函式 (修正版：允許空白) ---
const correctTranscript = (text) => {
  let corrected = text;
  // 跑迴圈替換所有諧音字
  Object.keys(typoMap).forEach(key => {
    const regex = new RegExp(key, 'g');
    corrected = corrected.replace(regex, typoMap[key]);
  });
  
  // 【修正重點】
  // 原本是 /[^\w\u4e00-\u9fa5]/g -> 會把空格刪掉
  // 改成是 /[^\w\s\u4e00-\u9fa5]/g -> 多加了 \s (代表保留空白)
  // 這樣 "1234 5678" 才不會黏在一起變成 "12345678"
  return corrected.toUpperCase().replace(/[^\w\s\u4e00-\u9fa5]/g, '');
};

// --- 核心狀態變數 ---
let voiceBuffer = "";      // 用來黏接斷斷續續的語句
let bufferTimer = null;    // 防抖計時器

// A. 車牌整形 (1668ARY -> 1668-ARY)
const formatLicensePlate = (input) => {
  let clean = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^\d+$/.test(clean)) return clean; // 純數字不動
  if (/^\d+[A-Z]+$/.test(clean)) return clean.replace(/^(\d+)([A-Z]+)$/, '$1-$2'); // 數字在前
  if (/^[A-Z]+\d+$/.test(clean)) return clean.replace(/^([A-Z]+)(\d+)$/, '$1-$2'); // 英文在前
  return clean;
};
// B. 批次提取 (輸入: "1668ARY還有9527" -> 輸出: ["1668-ARY", "9527"])
const extractBatchPlates = (text) => {
  let content = text.split('查詢').pop() || "";
  // 依照非英數字切開 (空格、逗號都會被切開)
  let tokens = content.split(/[^A-Z0-9]/).filter(t => t.length > 0);
  
  let results = [];
  tokens.forEach(token => {
    if (token.length >= 2) { // 過濾雜訊
      results.push(formatLicensePlate(token));
    }
  });
  return results;
};
// --- [新增功能 1] 螢幕恆亮控制 ---
let wakeLock = null;

// 請求螢幕保持喚醒的函式
const requestWakeLock = async () => {
  try {
    // 檢查瀏覽器是否支援
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('💡 螢幕喚醒鎖定已啟用 (螢幕將保持常亮)');
      
      // 如果鎖定意外斷開 (例如切換 App)，做個紀錄
      wakeLock.addEventListener('release', () => {
        console.log('螢幕喚醒鎖定已釋放');
      });
    }
  } catch (err) {
    console.error(`螢幕鎖定失敗: ${err.name}, ${err.message}`);
  }
};
// ---【修正 3】終極版：畫面切換重連機制 ---
// --- 【修正】核彈級畫面重連機制 ---
const handleVisibilityChange = async () => {
  if (document.visibilityState === 'visible') {
    console.log("👀 回到畫面，執行核彈級重置...");

    // 1. 介面強制歸零：先不要騙使用者還在聽
    isListening.value = false;
    
    // 2. 螢幕鎖定
    await requestWakeLock();

    // 3. 只有在「原本就是開著」的狀態下才重連
    if (isVoiceListening.value) {
        message.value = "系統喚醒中..."; // 給個提示
        
        try {
            // 先強制殺掉舊的，避免狀態不一致
            if (recognition) recognition.abort(); 
            
            // 延遲 500ms (給手機喘口氣)，再重新啟動
            setTimeout(() => {
                if (recognition && isVoiceListening.value) {
                    console.log("🚀 執行重啟指令");
                    recognition.start().catch((err) => {
                        // 這是最壞的情況：瀏覽器完全不給自動開
                        console.warn("自動重啟被攔截:", err);
                        
                        // 誠實告訴使用者：斷線了
                        isVoiceListening.value = false; 
                        isListening.value = false;
                        message.value = "⚠️ 連線中斷";
                        // 可以考慮這裡不要 alert，不然切換畫面一直跳窗很煩
                        // 讓使用者自己看燈號決定要不要按
                    });
                }
            }, 500);

        } catch (e) {
            console.log("重連過程異常:", e);
            isListening.value = false;
        }
    }
  }
};
// ==========================================
// 2. 修正後的 startVoiceSearch
// ==========================================
// --- 核心：語音辨識啟動函式 (包含多車牌處理邏輯) ---
const startVoiceSearch = async () => { 
  if (!Recognition) return alert("您的瀏覽器不支援語音功能");

  // 1. 音訊預熱 (解決 iOS/Android 首次說話延遲)
  audioPlayer.src = "data:audio/wav;base64,UklGRiQAAABXQVZFRm10IBAAAAABAAEAgD8AAIA/AAABAAgAZGF0YQAAAAA=";
  audioPlayer.play().catch(() => {}); 
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));

  // 2. 請求螢幕恆亮
  try { if ('wakeLock' in navigator) navigator.wakeLock.request('screen'); } catch (e) { console.log('恆亮失敗', e); }
  
  // --- 如果已經在聽，就關閉 (Toggle Off) ---
  if (isVoiceListening.value) {
    isVoiceListening.value = false;
    isSystemSpeaking.value = false;
    
    if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    if (recognition) recognition.stop();
    
    // 關閉時計時器要清掉
    if (bufferTimer) clearTimeout(bufferTimer);
    voiceBuffer = "";
    
    message.value = "語音監聽已關閉";
    return; 
  }

  // --- 啟動語音監聽 (Toggle On) ---
  const welcomeMessage = greetings[Math.floor(Math.random() * greetings.length)];
  isVoiceListening.value = true; 
  message.value = `系統啟動：${welcomeMessage}`;
  await speak(welcomeMessage); 

  // 初始化 Recognition 物件
  if (!recognition) {
    recognition = new Recognition();
    recognition.lang = 'zh-TW';
    recognition.continuous = true; 
    recognition.interimResults = true;

    recognition.onstart = () => { 
        message.value = "🎤 監聽中..."; 
        isListening.value = true; // 確保這裡有同步狀態
    };

    // --- 【新增】錯誤監聽：防止狀態卡死 ---
    recognition.onerror = (event) => {
        console.error("語音辨識錯誤:", event.error);
        
        // 如果是這類嚴重錯誤，直接關閉功能，不要讓保全以為還在跑
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            isVoiceListening.value = false;
            isListening.value = false;
            alert("麥克風權限失效，請重新點擊麥克風按鈕");
        }
        
        // 如果是 'aborted' (被中斷)，也要把狀態修復
        if (event.error === 'aborted') {
            isListening.value = false;
        }
    };
    // --- 這裡就是您覺得困惑的 onresult區塊，我們已經改好了 ---
    recognition.onresult = (event) => {
      // 系統正在報號時，暫停接收，避免自己聽自己
      if (isSystemSpeaking.value) return;

      let currentSegment = "";
      let isFinal = false; 

      // 抓取目前的辨識結果
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) isFinal = true;
        currentSegment += event.results[i][0].transcript;
      }

      // 只有當這句話結束 (停頓) 時才處理
      if (isFinal) {
        // A. 進行文字校正 (把「洞洞七」變成「007」)
        const correctedSegment = correctTranscript(currentSegment);
        
        // B. 加入全域緩衝區
        voiceBuffer += correctedSegment;
        message.value = `聽取中: ${voiceBuffer}`; // 顯示在畫面上給你看

        // 檢查是否有「查詢」指令
        if (voiceBuffer.includes('查詢')) {
            
            // 1. 提取所有聽到的車牌 (回傳陣列)
            const platesFound = extractBatchPlates(voiceBuffer);

            // 2. 如果有抓到車牌
            if (platesFound.length > 0) {
                
                // 【核心邏輯】模擬手動輸入：用空格把所有車牌接起來
                // 例如 ["1668-ARY", "2900"] -> "1668-ARY 2900"
                const simulationInput = platesFound.join(' ');
                
                // 計算總長度 (用來判斷是否快速通關，去除空格和橫槓)
                const totalLength = simulationInput.replace(/[-\s]/g, '').length;

                // --- 狀況一：快速通關 (字數夠多，直接查) ---
                // 例如兩台車加起來通常超過 6 碼
                if (totalLength >= 6) {
                    console.log("🚀 多車牌語音輸入(快速):", simulationInput);
                    if (bufferTimer) clearTimeout(bufferTimer);
                    
                    searchPlate.value = simulationInput; // 填入
                    handleSearch(true); // 執行
                    
                    voiceBuffer = ""; // 清空
                    return; 
                }

                // --- 狀況二：緩衝倒數 (字數少，等 1.2 秒) ---
                if (bufferTimer) clearTimeout(bufferTimer);
                
                bufferTimer = setTimeout(() => {
                    console.log(`語音緩衝結束，送出:`, simulationInput);
                    
                    searchPlate.value = simulationInput;
                    handleSearch(true);
                    
                    voiceBuffer = ""; 
                }, 1200); // 等待 1.2 秒
            }
        }
      }
    };
    // -------------------------------------------------------

// --- 【修正】onend：更聰明的重啟邏輯 ---
    recognition.onend = () => {
      console.log("麥克風已停止 (onend triggered)");
      isListening.value = false; // 1. 介面狀態馬上歸零
      
      // 2. 只有在「畫面是亮著的」+「非系統說話」+「總開關是開的」才自動重啟
      // 關鍵修改：加上 document.visibilityState === 'visible'
      // 這樣背景執行時就會乖乖停止，不會跟系統打架
      if (document.visibilityState === 'visible' && isVoiceListening.value && !isSystemSpeaking.value) { 
          console.log("🔄 保持監聽，自動重啟...");
          try {
              recognition.start(); 
          } catch(e) {
              console.log("重啟過快或已在執行");
          }
      }
    };
  }
  
  // 初次啟動
  try {
      if(isVoiceListening.value && !isSystemSpeaking.value) recognition.start();
  } catch(e) {}
};
// --- 工具：圖片壓縮函式 ---
const compressImage = async (imageFile) => {
  // 設定壓縮選項
  const options = {
    maxSizeMB: 0.8,          // 目標盡量壓在 0.8MB 以下 (通常會壓到 200-500KB)
    maxWidthOrHeight: 1920,  // 限制最大寬或高 (1920px 對閱讀文件已經非常足夠)
    useWebWorker: true,      // 開啟多執行緒加速壓縮
    fileType: 'image/jpeg'   // 統一轉成 JPEG 格式
  };

  try {
    console.log(`原始大小: ${imageFile.size / 1024 / 1024} MB`);
    const compressedFile = await imageCompression(imageFile, options);
    console.log(`壓縮後大小: ${compressedFile.size / 1024 / 1024} MB`);
    return compressedFile;
  } catch (error) {
    console.error("圖片壓縮失敗，將使用原圖:", error);
    return imageFile; // 如果壓縮失敗，就回傳原圖，避免流程卡死
  }
}
// 【關鍵整合：資料選集邏輯】
const householdCollectionName = computed(() => {
  // 自動偵測車牌集合的後綴，並對應到戶號集合
  const suffix = props.collection.replace('licensePlates', '');
  return `households${suffix}`;
});

// 新增：動態對應社區的車位反查表名稱 (例如 parking_lookup_test)
const lookupCollectionName = computed(() => {
  const suffix = props.collection.replace('licensePlates', '');
  return `parking_lookup${suffix}`;
});
// --- 修改：載入住戶名單圖片的函式 ---
const loadResidentListImage = async () => {
  try {
    const suffix = props.collection.replace('licensePlates', '');
    const configDocName = suffix ? `residentList${suffix}` : 'residentList';
    
    const docRef = db.collection('config').doc(configDocName);
    const docSnap = await docRef.get();
    if (docSnap.exists && docSnap.data().imageUrl) {
      residentListImageUrl.value = docSnap.data().imageUrl;
    } else {
      console.log('尚未設定住戶名單圖片');
      residentListImageUrl.value = 'https://via.placeholder.com/800x600.png?text=請上傳住戶名單圖'; 
    }
  } catch (error) {
    console.error("讀取住戶名單圖片失敗:", error);
  }
}

// 1. 檢查有多少筆「待查」資料 (用來顯示按鈕上的數字)
const checkPendingCount = async () => {
  if (!props.collection) return;
  try {
    const snapshot = await db.collection(props.collection)
      .where('householdCode', '==', '-')
      .get();
    pendingCount.value = snapshot.size; // 根據真實資料更新數字
  } catch (e) {
    console.error("檢查待查數量失敗", e);
  }
};
// 只要你切換社區，這裡就會觸發，自動去算新社區的數量
watch(() => props.collection, async (newVal) => {
  if (newVal) {
    // 當社區改變時，如果您希望搜尋模式重置回「查車牌」，可以加這行：
    // changeSearchMode('plate'); 
    
    // 重新檢查該社區的待查數量
    await checkPendingCount();
  }
}, { immediate: true }); // immediate: true 代表畫面剛載入時也會跑一次

// 2. 點擊「待查」按鈕後的動作
const handlePendingClick = async () => {
  changeSearchMode('pending'); // 切換模式
  isLoading.value = true;
  searchResults.value = [];
  message.value = '正在載入待查清單...';

  try {
    const snapshot = await db.collection(props.collection)
      .where('householdCode', '==', '-')
      .get();

    if (!snapshot.empty) {
      searchResults.value = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      message.value = `查詢完成，共有 ${searchResults.value.length} 筆待查資料。`;
    } else {
      message.value = '目前沒有待查資料。';
      // 如果點了發現沒資料，順便更新一下計數
      pendingCount.value = 0;
    }
  } catch (error) {
    console.error("載入待查清單失敗:", error);
    message.value = '載入失敗';
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  loadResidentListImage(); // 頁面載入時，自動讀取圖片
  requestWakeLock(); // 一進來就先鎖住螢幕
  document.addEventListener('visibilitychange', handleVisibilityChange);
  nextTick(() => { if (searchInput.value) searchInput.value.focus() })
})
// 好的習慣：離開頁面時移除監聽
onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (wakeLock !== null) {
        wakeLock.release();
    }
});
// --- 修改：處理住戶名單圖片上傳的相關函式 ---
const handleResidentListFileSelect = (event) => {
  residentListFile.value = event.target.files[0];
  message.value = `已選擇檔案：${event.target.files[0].name}`;
  isSuccess.value = false;
}

const uploadResidentListImage = async () => {
  if (!residentListFile.value) {
    alert('請先選擇要上傳的圖片檔案！');
    return;
  }
  isResidentListUploading.value = true;
  message.value = '正在壓縮並上傳總表圖片...';
  isSuccess.value = false;

  try {
    const suffix = props.collection.replace('licensePlates', '');
    const configDocName = suffix ? `residentList${suffix}` : 'residentList';
    // --- 【新增】 1. 先進行壓縮 ---
    const compressedFile = await compressImage(residentListFile.value);
    // 1. 將圖片上傳到 Firebase Storage 的動態路徑
    // 2. 上傳 (注意這裡要改成上傳 compressedFile)
    const imagePath = `system/residentListImage${suffix}`;
    const imageRef = storage.ref().child(imagePath);
    const uploadTask = await imageRef.put(compressedFile);
    const downloadURL = await uploadTask.ref.getDownloadURL();

    // 2. 將新的圖片網址儲存到對應的 Config 文件
    const docRef = db.collection('config').doc(configDocName);
    await docRef.set({ imageUrl: downloadURL }, { merge: true });

    // 3. 更新畫面上的圖片
    residentListImageUrl.value = downloadURL;
    
    message.value = '總表圖片更新成功！';
    isSuccess.value = true;
    residentListFile.value = null; 
  } catch (error) {
    console.error("總表圖片上傳失敗:", error);
    message.value = '總表圖片上傳失敗';
    isSuccess.value = false;
  } finally {
    isResidentListUploading.value = false;
  }
}


const handleResidentListClick = () => {
  changeSearchMode('resident-list');
  if (residentListImageUrl.value) {
    window.open(residentListImageUrl.value, '_blank');
  } else {
    alert('圖片網址未設定！');
  }
}

const quickSearch = (term, mode = 'plate') => {
  if (!term) return
  searchPlate.value = term
  searchMode.value = mode
  handleSearch()
}

const adjustTextareaHeight = () => {
  nextTick(() => {
    const textarea = notesTextarea.value;
    const textareaF = featuresTextarea.value;

    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
    if (textareaF) {
      textareaF.style.height = 'auto';
      textareaF.style.height = `${textareaF.scrollHeight}px`;
    }
  });
}

watch(selectedItem, (newItem) => {
  if (newItem && isEditing.value) {
    adjustTextareaHeight()
  }
})

const enterEditMode = () => {
  itemBeforeEdit.value = JSON.parse(JSON.stringify(selectedItem.value))
  isEditing.value = true
  nextTick(() => {
    adjustTextareaHeight()
  })
}

const cancelEdit = () => {
  selectedItem.value = { ...itemBeforeEdit.value }
  isEditing.value = false
}

const handleHouseholdCreate = async () => {
  if (!householdToCreate.value.id) { alert('户号不能为空！'); return }
  isLoading.value = true
  try {
    const docRef = db.collection(householdCollectionName.value).doc(householdToCreate.value.id)
    const dataToCreate = {
      name: householdToCreate.value.name || '',
      features: householdToCreate.value.features || ''
    }
    await docRef.set(dataToCreate)
    message.value = `户号「${householdToCreate.value.id}」的住户资讯已成功建立！`
    isSuccess.value = true
    isNewHouseholdModalOpen.value = false
  } catch (error) {
    console.error("建立住户失败:", error)
    message.value = '建立住户失败'
    isSuccess.value = false
  } finally {
    isLoading.value = false
  }
}

const changeSearchMode = (mode) => {
  searchMode.value = mode
  message.value = ''; // 切換分頁時清除訊息
  if (mode === 'household' || mode === 'parking') { isNumericMode.value = false } 
  else { isNumericMode.value = true }
  if (mode !== 'residentList') {
    nextTick(() => { if (searchInput.value) searchInput.value.focus() })
  }
}

const toggleInputMode = () => {
  nextTick(() => { if (searchInput.value) searchInput.value.focus() })
}

const handleSearch = async (isVoice = false) => {
  // 確保 isVoice 是布林值 (防止 Event 物件干擾)
  const fromVoice = isVoice === true; 

  if (!searchPlate.value) { alert('請輸入查詢內容！'); return }
  const searchInputString = searchPlate.value.toUpperCase().trim()
  searchPlate.value = ''
  isLoading.value = true
  searchResults.value = []
  selectedItem.value = null
  message.value = ''
  showCreateForm.value = false

  try {
    let finalSearchId = searchInputString;
    let targetMode = searchMode.value;

    if (searchMode.value === 'parking') {
      const lookupDoc = await db.collection(lookupCollectionName.value).doc(searchInputString).get();
      if (lookupDoc.exists) {
        finalSearchId = lookupDoc.data().ownerId;
        searchMode.value = 'household';
        targetMode = 'household';
        const msg = `車位搜尋成功，正在導向戶號：${finalSearchId}`;
        message.value = msg;
        if (fromVoice) speak(msg); // 只有語音模式才報讀
      } else {
        const errorMsg = `查無車位「${searchInputString}」`;
        message.value = errorMsg;
        if (fromVoice) speak(errorMsg); // 只有語音模式才報讀
        isLoading.value = false; 
        return;
      }
    }

    let querySnapshot;
    if (targetMode === 'household') {
      querySnapshot = await db.collection(props.collection).where('householdCode', '==', finalSearchId).get()
      if (querySnapshot.empty) {
        if (fromVoice) speak(`查無戶號 ${finalSearchId}`);
        householdToCreate.value = { id: finalSearchId, name: '', features: '' }
        isNewHouseholdModalOpen.value = true
      }
    } else {
      if (finalSearchId.includes('-') && !finalSearchId.includes(' ')) {
        const docRef = db.collection(props.collection).doc(finalSearchId)
        const docSnap = await docRef.get()
        if (docSnap.exists) {
          const result = { id: docSnap.id, ...docSnap.data() }; 
          searchResults.value = [result]; 
          selectItem(result, fromVoice); // <--- 將語音旗標傳下去
        } else {
          const msg = `查無車牌 ${finalSearchId}`;
          message.value = msg; 
          if (fromVoice) speak(msg); // 只有語音模式才報讀
          showCreateForm.value = true; 
          plateToCreate.value = finalSearchId; 
          selectedItem.value = { householdCode: '', notes: '' }
        }
        isLoading.value = false; 
        return;
      } else {
        const searchTerms = finalSearchId.split(' ').filter(term => term.length > 0)
        querySnapshot = await db.collection(props.collection).where('searchKeywords', 'array-contains-any', searchTerms).get()
      }
    }

    if (querySnapshot && !querySnapshot.empty) {
      searchResults.value = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      if (searchResults.value.length === 1) {
        selectItem(searchResults.value[0], fromVoice); // <--- 將語音旗標傳下去
      } else {
        if (fromVoice) speak(`找到 ${searchResults.value.length} 筆資料`);
      }
    } else if (!showCreateForm.value && !searchResults.value.length && !isNewHouseholdModalOpen.value) {
        if (fromVoice) {
         // [優化] 結合輸入的字串唸出，且 speak 函式會自動處理字母拆讀 (例如 A B C)
         speak(`查無 ${searchInputString} 的車牌`);
        }
    }
  } catch (error) {
    if (fromVoice) speak("系統查詢出錯");
  } finally {
    isLoading.value = false
  }
}

const selectItem = async (item, isVoice = false) => {
  const fromVoice = isVoice === true; // 確保布林值
  if (!item) return;
  
  message.value = '正在載入詳細資料...';
  isLoading.value = true;
  
  let completeItemData = { ...item };

  if (item.householdCode) {
    try {
      const householdDocRef = db.collection(householdCollectionName.value).doc(item.householdCode);
      const householdDocSnap = await householdDocRef.get();
      if (householdDocSnap.exists) {
        completeItemData.householdInfo = householdDocSnap.data();
      }
    } catch (error) { console.error(error); }
  }

  selectedItem.value = completeItemData;
  isEditing.value = false;
  message.value = '';
  isLoading.value = false;

  // --- 關鍵判斷：只有語音模式才報讀 ---
  if (fromVoice) {
    const plateId = item.id || '未知車牌';
    const unitCode = completeItemData.householdCode || '尚未登記戶號';
    const userName = completeItemData.householdInfo?.name ? `，住戶 ${completeItemData.householdInfo.name}` : '';
    const finalSpeechText = `查詢成功。車牌 ${plateId}。屬於 ${unitCode} ${userName}`;

    speak(finalSpeechText, true); // 只有這裡會觸發高品質報讀
  }

  nextTick(() => {
    if (editSectionRef.value) {
      editSectionRef.value.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
};

const saveAllChanges = async () => {
  if (!selectedItem.value || !selectedItem.value.id) return
  isLoading.value = true
  
  const plateDocRef = db.collection(props.collection).doc(selectedItem.value.id)
  const householdDocRef = db.collection(householdCollectionName.value).doc(selectedItem.value.householdCode)

  const plateData = {
    householdCode: selectedItem.value.householdCode,
    notes: selectedItem.value.notes,
    lastUpdatedBy: auth.currentUser.email,
    updatedAt: new Date()
  }
  
  const householdData = {
    name: selectedItem.value.householdInfo.name || '',
    features: selectedItem.value.householdInfo.features || '',
    parking_number: selectedItem.value.householdInfo.parking_number || ''
  }

try {
    const batch = db.batch();
    const plateDocRef = db.collection(props.collection).doc(selectedItem.value.id);
    const householdDocRef = db.collection(householdCollectionName.value).doc(selectedItem.value.householdCode);

    // 1. 取得舊有的車位清單 (從編輯前的備份 itemBeforeEdit 取得)
    const oldParkingStr = itemBeforeEdit.value.householdInfo?.parking_number || '';
    const oldParkingArray = oldParkingStr.split('/').map(s => s.trim()).filter(Boolean);

    // 2. 取得新輸入的車位清單
    const newParkingStr = selectedItem.value.householdInfo.parking_number || '';
    const newParkingArray = newParkingStr.split('/').map(s => s.trim()).filter(Boolean);

    // 3. 找出「哪些車位被刪掉了」(在舊清單有，但新清單沒有)
    const spotsToDelete = oldParkingArray.filter(spot => !newParkingArray.includes(spot));

    // 4. 更新主表資料
    const plateData = {
      householdCode: selectedItem.value.householdCode,
      notes: selectedItem.value.notes,
      lastUpdatedBy: auth.currentUser.email,
      updatedAt: new Date()
    };
    
    const householdData = {
      name: selectedItem.value.householdInfo.name || '',
      features: selectedItem.value.householdInfo.features || '',
      parking_number: newParkingStr,
      parking: newParkingArray // 同步更新 Array 欄位
    };

    batch.update(plateDocRef, plateData);
    batch.set(householdDocRef, householdData, { merge: true });

    // 5. 【核心修正】刪除不再使用的舊車位索引
    const targetLookup = lookupCollectionName.value;
    spotsToDelete.forEach(spot => {
      const lookupRef = db.collection(targetLookup).doc(spot.toUpperCase());
      batch.delete(lookupRef);
      console.log(`🗑️ 移除舊索引: ${spot}`);
    });

    // 6. 新增或更新現在的車位索引
    newParkingArray.forEach(spot => {
      const lookupRef = db.collection(targetLookup).doc(spot.toUpperCase());
      batch.set(lookupRef, { 
        ownerId: selectedItem.value.householdCode,
        updatedAt: new Date()
      }, { merge: true });
      console.log(`✨ 更新索引: ${spot}`);
    });

    await batch.commit();
    
    message.value = '所有資料與車位反查索引已同步完成！';
    isSuccess.value = true;
    
    // 更新搜尋結果清單中的顯示
    const index = searchResults.value.findIndex(item => item.id === selectedItem.value.id);
    if (index !== -1) { 
      searchResults.value[index] = { ...selectedItem.value };
    }
    
    isEditing.value = false;
    isLoading.value = false;
    
  } catch (error) {
    console.error("儲存失敗:", error);
    message.value = '儲存失敗，請稍後再試。';
    isSuccess.value = false;
    isLoading.value = false;
  } finally {
    await checkPendingCount(); 
  }
}

const syncExistingParkingData = async () => {
  const targetLookup = lookupCollectionName.value;
  if (!window.confirm(`這將會掃描所有舊資料並建立「${targetLookup}」索引，確定執行嗎？`)) return;
  
  isLoading.value = true;
  message.value = `正在同步 ${targetLookup} 舊車位資料...`;

  try {
    const batch = db.batch();
    // 1. 抓取目前選定社區的所有戶號資料
    const snapshot = await db.collection(householdCollectionName.value).get();
    
    let count = 0;
    snapshot.forEach(doc => {
      const data = doc.data();
      const householdId = doc.id;
      // 拆解該戶原本存好的車位號碼字串
      const parkingArray = data.parking_number 
        ? data.parking_number.split('/').map(s => s.trim()).filter(Boolean) 
        : [];

      parkingArray.forEach(spot => {
        // 使用動態 Suffix 集合名稱
        const lookupRef = db.collection(targetLookup).doc(spot.toUpperCase());
        batch.set(lookupRef, { 
          ownerId: householdId,
          updatedAt: new Date(),
          note: "由系統維護腳本自動補齊"
        }, { merge: true });
        count++;
      });
    });

    await batch.commit();
    message.value = `同步完成！已成功為 ${targetLookup} 建立 ${count} 個車位索引。`;
    isSuccess.value = true;
  } catch (error) {
    console.error("同步失敗:", error);
    message.value = "同步失敗，請檢查權限或網路。";
    isSuccess.value = false;
  } finally {
    isLoading.value = false;
  }
};
const handleCreate = async () => {
   if (!plateToCreate.value) return
  isLoading.value = true
  try {
    const docRef = db.collection(props.collection).doc(plateToCreate.value)
    const keywords = plateToCreate.value.toUpperCase().split('-').filter(Boolean)
    const dataToCreate = { 
      // 加入 .toUpperCase() 強制轉大寫，並加上 || '' 防止出錯
      householdCode: (selectedItem.value.householdCode || '').toUpperCase(), 
      notes: selectedItem.value.notes, 
      createdBy: auth.currentUser.email, 
      createdAt: new Date(), 
      searchKeywords: keywords, 
      imageUrl: '' 
    }
    await docRef.set(dataToCreate)
    message.value = `車牌「${plateToCreate.value}」已成功新增！`; isSuccess.value = true
    showCreateForm.value = false; selectedItem.value = null; searchPlate.value = plateToCreate.value
  } catch (error) { console.error("新增失敗:", error); message.value = '新增失敗'; isSuccess.value = false }
  finally { 
    isLoading.value = false 
    await checkPendingCount(); 
   }
}

const handleDelete = async () => {
  if (!selectedItem.value || !selectedItem.value.id) return
  if (!window.confirm(`確定要永久刪除車牌「${selectedItem.value.id}」的資料嗎？`)) { return }
  isLoading.value = true
  
  try {
    const batch = db.batch(); // 使用 Batch 確保清理與刪除同步完成
    
    // 1. 取得目前該社區的車位反查表名稱
    const targetLookup = lookupCollectionName.value;

    // 2. 取得要刪除的車位列表 (從目前選中的資料中拆解)
    const parkingStr = selectedItem.value.householdInfo?.parking_number || '';
    const parkingArray = parkingStr.split('/').map(s => s.trim()).filter(Boolean);

    // 3. 將清理反查表的動作加入批次
    parkingArray.forEach(spot => {
      console.log(spot);
      const lookupRef = db.collection(targetLookup).doc(spot.toUpperCase());
      batch.delete(lookupRef);
    });

    // 4. 加入刪除車牌主檔的動作
    const plateRef = db.collection(props.collection).doc(selectedItem.value.id);
    batch.delete(plateRef);

    // 5. 處理圖片刪除 (圖片刪除不支援 Batch，維持原本做法)
    if (selectedItem.value.imageUrl) {
      const imageRef = storage.refFromURL(selectedItem.value.imageUrl);
      await imageRef.delete();
    }

    // 6. 提交所有刪除動作
    await batch.commit();

    message.value = `車牌 ${selectedItem.value.id} 及其車位索引已成功清理。`;
    isSuccess.value = true
    searchResults.value = searchResults.value.filter(item => item.id !== selectedItem.value.id)
    selectedItem.value = null
  } catch (error) {
    console.error("刪除失敗:", error);
    message.value = '刪除失敗，請確認資料狀態';
    isSuccess.value = false
  }  finally { 
    isLoading.value = false 
    await checkPendingCount(); 
  }
}

const handleFileSelect = (event) => {
  selectedFile.value = event.target.files[0]
}

const handleImageUpload = async () => {
  if (!selectedFile.value) { alert('請先選擇圖片檔案！'); return }
  if (!selectedItem.value || !selectedItem.value.id) { alert('請先選擇資料項目'); return }
  isUploading.value = true; 
  message.value = '圖片壓縮上傳中...';
  isSuccess.value = false
  try {
    const compressedFile = await compressImage(selectedFile.value); // --- 【新增】 壓縮圖片 ---
    const imagePath = `plates/${props.collection}/${selectedItem.value.id}`
    const imageRef = storage.ref().child(imagePath)
    const uploadTask = await imageRef.put(compressedFile)// 上傳壓縮後的檔案
    const downloadURL = await uploadTask.ref.getDownloadURL()
    const docRef = db.collection(props.collection).doc(selectedItem.value.id)
    await docRef.update({ imageUrl: downloadURL })
    selectedItem.value.imageUrl = downloadURL
    const index = searchResults.value.findIndex(item => item.id === selectedItem.value.id)
    if (index !== -1) { searchResults.value[index].imageUrl = downloadURL }
    message.value = '圖片上傳成功！'; isSuccess.value = true; selectedFile.value = null
  } catch (error) { console.error("圖片上傳失敗:", error); message.value = '圖片上傳失敗'; isSuccess.value = false }
  finally { isUploading.value = false }
}
</script>

<template>
  <div class="dashboard">
    <div class="search-mode-selector">
      <button :class="{ active: searchMode === 'plate' }" @click="changeSearchMode('plate')">查車牌</button>
      <button :class="{ active: searchMode === 'household' }" @click="changeSearchMode('household')">查戶號</button>
      <button :class="{ active: searchMode === 'parking' }" @click="changeSearchMode('parking')">查車位</button>
      <button :class="{ active: searchMode === 'residentList' }" @click="changeSearchMode('residentList')">住戶名單</button>
      <button 
        v-if="pendingCount > 0" 
        :class="{ active: searchMode === 'pending' }" 
        @click="handlePendingClick"
        style="color: #dc3545; font-weight: bold;"
      >
        待查 ({{ pendingCount }})
      </button>
    </div>
    <template v-if="searchMode !== 'residentList'">
<div class="search-section" v-if="searchMode !== 'pending'">
  <input 
    ref="searchInput" 
    v-model="searchPlate" 
    @keyup.enter="handleSearch" 
    :placeholder="searchMode === 'plate' ? '請輸入車牌 (例如 123-BNC)' : '請輸入查詢內容'" 
    :inputmode="isNumericMode ? 'numeric' : 'text'" 
  />

  <div class="controls-row">
    <button 
      @click="startVoiceSearch" 
      :class="{ 'voice-active': isVoiceListening }"
      class="voice-btn-round"
    >
      {{ isVoiceListening ? '🛑' : '🎤' }}
    </button>

    <div v-if="searchMode === 'plate'" class="toggle-switch-container">
      <input type="checkbox" id="inputModeToggle" v-model="isNumericMode" @change="toggleInputMode" />
      <label for="inputModeToggle" class="switch">
        <span class="text-off">英文</span>
        <span class="text-on">數字</span>
      </label>
    </div>
  </div>

  <button @click="handleSearch(false)" :disabled="isLoading">{{ isLoading ? '處理中...' : '查詢' }}</button>
</div>

      <div v-if="searchMode === 'pending'" class="search-section" style="text-align: center; border: 1px dashed #dc3545; background-color: #fff5f5;">
        <h3 style="color: #dc3545; margin: 0;">⚠️ 異常/待查車輛清單</h3>
      </div>
      <div v-if="searchResults.length > 0" class="results-list">
        <h4>找到了 {{ searchResults.length }} 筆結果：</h4>
      <ul>
        <li v-for="item in searchResults" :key="item.id" @click="selectItem(item,false)" :class="{ active: selectedItem && selectedItem.id === item.id }">
          <div class="list-item-content">
            <span class="plate-id">{{ item.id }}</span>
            
            <span class="household-part">
              (戶號: 
              <a href="#" @click.prevent.stop="quickSearch(item.householdCode, 'household')">{{ item.householdCode }}</a>
              )
            </span>
          </div>
        </li>
      </ul>
        <hr>
      </div>

      <div v-if="selectedItem && !isEditing && !showCreateForm" class="result-section view-mode" ref="editSectionRef">
        <h3>資料詳情：{{ selectedItem.id }}</h3>
        <div class="actions">
          <button @click="enterEditMode" class="edit-button">✏️ 編輯</button>
          <button @click="handleDelete" :disabled="isLoading" class="delete-button">🗑️ 刪除</button>
        </div>
        <div class="form-group">
          <label>戶別代碼:</label>
          <p>{{ selectedItem.householdCode }}</p>
        </div>
        <div class="form-group">
          <label>綜合備註:</label>
          <div class="combined-notes">
            <div v-if="selectedItem.householdInfo" class="household-notes">
              <div class="notes-header">
                <h4>住戶資訊</h4>
              </div>
              <p v-if="selectedItem.householdInfo.name"> {{ selectedItem.householdInfo.name }}</p>
              <p v-if="selectedItem.householdInfo.features">{{ selectedItem.householdInfo.features }}</p>
              <p v-if="!selectedItem.householdInfo.name && !selectedItem.householdInfo.features">尚無住戶資訊。</p>
            </div>
            <div v-if="selectedItem.notes" class="vehicle-notes">
              <div class="notes-header">
                <h4>車輛備註</h4>
              </div>
              <p class="notes-display">{{ selectedItem.notes }}</p>
            </div>
             <p v-if="!selectedItem.householdInfo && !selectedItem.notes">無任何備註。</p>
          </div>
        </div>
        <div class="form-group">
          <label>車位號碼:</label>
          <p v-if="selectedItem.householdInfo && selectedItem.householdInfo.parking_number">{{ selectedItem.householdInfo.parking_number }}</p>
        </div>
        <div class="form-group">
          <label>相關圖片:</label>
          <div class="image-preview">
            <img v-if="selectedItem.imageUrl" :src="selectedItem.imageUrl" alt="車牌圖片"/>
            <p v-else>尚無圖片</p>
          </div>
          <div class="image-upload">
            <input type="file" @change="handleFileSelect" accept="image/*" />
            <button @click="handleImageUpload" :disabled="isUploading || !selectedFile">{{ isUploading ? '上傳中...' : '上傳圖片' }}</button>
          </div>
        </div>
      </div>
    
      <div v-if="selectedItem && isEditing && !showCreateForm" class="result-section edit-mode" ref="editSectionRef">
        <h3>編輯資料：{{ selectedItem.id }}</h3>
        <div class="form-group">
          <label>戶別代碼:</label>
          <input v-model="selectedItem.householdCode" />
        </div>
        <div class="form-group">
          <label>車輛備註:</label>
          <textarea ref="notesTextarea" v-model="selectedItem.notes" rows="3" @input="adjustTextareaHeight"></textarea>
        </div>
        <hr>
        <h4>住戶資訊</h4>
        <div class="form-group">
          <label>戶長姓名:</label>
          <input v-model="selectedItem.householdInfo.name" />
        </div>
        <div class="form-group">
          <label>車位號碼:</label>
          <input v-model="selectedItem.householdInfo.parking_number" />
        </div>
        <div class="form-group">
          <label>家庭特徵:</label>
          <textarea ref="featuresTextarea" v-model="selectedItem.householdInfo.features" rows="4" @input="adjustTextareaHeight"></textarea>
        </div>
        <div class="actions">
          <button @click="saveAllChanges" :disabled="isLoading" class="save-button">✅ 儲存全部修改</button>
          <button @click="cancelEdit" :disabled="isLoading" class="cancel-button">❌ 取消</button>
        </div>
      </div>

      <div v-if="showCreateForm" class="result-section">
        <h3>新增車牌：{{ plateToCreate }}</h3>
        <div class="form-group"><label>戶別代碼:</label>
        <input 
          v-model="selectedItem.householdCode" 
          @input="selectedItem.householdCode = selectedItem.householdCode.toUpperCase()"
          placeholder="請輸入戶別代碼" />
        </div>
        <div class="form-group"><label>備註:</label><textarea v-model="selectedItem.notes" rows="3" placeholder="請輸入備註"></textarea></div>
        <div class="actions"><button @click="handleCreate" :disabled="isLoading" class="save-button">確認新增</button></div>
      </div>

      <div v-if="message" class="message-section" :class="{ success: isSuccess }">
        <p>{{ message }}</p>
      </div>

      <div v-if="isNewHouseholdModalOpen" class="modal-overlay" @click.self="isNewHouseholdModalOpen = false">
        <div class="modal-content">
          <h3>為新戶號建立資料 ({{ householdToCreate.id }})</h3>
          <p>此戶號目前没有任何登记车辆，您可以先為它建立住户资讯。</p>
          <div class="form-group">
            <label>户长姓名:</label>
            <input v-model="householdToCreate.name" />
          </div>
          <div class="form-group">
            <label>家庭特徵:</label>
            <textarea v-model="householdToCreate.features" rows="4"></textarea>
          </div>
          <div class="actions">
            <button @click="handleHouseholdCreate" :disabled="isLoading" class="save-button">✅ 建立</button>
            <button @click="isNewHouseholdModalOpen = false" :disabled="isLoading" class="cancel-button">❌ 取消</button>
          </div>
        </div>
      </div>
    </template>

    <div v-if="searchMode === 'residentList'" class="resident-list-view">
      <h2>住戶名單總表</h2>

      <div class="image-wrapper">
        <img v-if="residentListImageUrl" :src="residentListImageUrl" alt="住戶名單總表圖">
        <p v-else>正在載入圖片...</p>
      </div>

      <div class="upload-section">
        <input type="file" @change="handleResidentListFileSelect" accept="image/*" />
        <button @click="uploadResidentListImage" :disabled="isResidentListUploading || !residentListFile">
          {{ isResidentListUploading ? '上傳中...' : '上傳並更新圖片' }}
        </button>
      </div>
       <p class="image-caption">
          提示：您可以<a :href="residentListImageUrl" target="_blank">點此在新分頁開啟圖片</a>進行縮放。
       </p>
    </div>
    
    <div v-if="searchMode === 'residentList'" style="margin-top: 40px; padding: 15px; border: 1px dashed #aaa; border-radius: 8px; background-color: #fcfcfc;">
      <p style="color: #666; font-size: 0.85rem; margin-bottom: 10px;">🛠️ 系統維護：補齊舊有資料的車位索引</p>
      <button 
        @click="syncExistingParkingData" 
        :disabled="isLoading" 
        style="background-color: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer;"
      >
        {{ isLoading ? '同步中...' : '一鍵同步全社區車位' }}
      </button>
    </div>

  </div>
</template>

<style scoped>
/* 新增：控制列並排邏輯 */
.controls-row {
  display: flex;
  align-items: center; /* 垂直置中 */
  gap: 20px;           /* 按鈕與開關的間距 */
  margin: 5px 0;
}

/* 語音按鈕樣式優化：改為圓形且與開關高度相稱 */
.voice-btn-round {
  width: 45px !important;  /* 稍微縮小以配合開關高度 */
  height: 45px !important;
  padding: 0 !important;
  background-color: #f8f9fa !important;
  border: 1px solid #ccc !important;
  border-radius: 50% !important; /* 圓形 */
  font-size: 20px !important;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  cursor: pointer;
}

/* 當語音啟動時的閃爍效果依舊保留 */
.voice-active {
  background-color: #ffc107 !important;
  animation: pulse 1.5s infinite;
  border-color: #e0a800 !important;
}

/* 確保切換容器內部不要有額外的 margin 影響並排 */
.toggle-switch-container {
  margin: 0 !important;
}

@keyframes pulse {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.7); }
  70% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(255, 193, 7, 0); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 193, 7, 0); }
}

.resident-list-view {
  margin-top: 20px;
  padding: 20px;
  border: 1px solid #eee;
  border-radius: 8px;
  text-align: center;
}
.resident-list-view .image-wrapper {
  margin: 1rem auto;
  max-width: 900px;
  border: 1px solid #ddd;
  min-height: 200px; 
  display: flex;
  align-items: center;
  justify-content: center;
}
.resident-list-view .image-wrapper img {
  width: 100%;
  height: auto;
  display: block;
}
.resident-list-view .upload-section {
  margin-top: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
}
.resident-list-view .image-caption {
  margin-top: 1rem;
  color: #6c757d;
  font-size: 0.9rem;
}
.resident-list-view .image-caption a {
  color: #007bff;
}

.dashboard { margin-top: 20px; }
.search-section { display: flex;
  flex-direction: column; /* 改成直向 */
  gap: 15px;              /* 增加間距 */
  align-items: stretch;   /* 拉伸寬度 */
  margin-bottom: 20px; }
.search-section > input:not([type="checkbox"]) {
  flex-grow: 1;
  height: 60px;        /* 加高 */
  font-size: 20px;     /* 字體加大 */
  padding: 10px 15px;
  border: 1px solid #ccc;
  border-radius: 8px;
}
/* 這是新增的，原本可能沒有獨立寫出來 */
.search-section > button {
  height: 60px;        /* 跟輸入框一樣高 */
  font-size: 22px;     /* 字體加大 */
  font-weight: bold;
  border-radius: 8px;
  background-color: #007bff; /* 確保顏色明顯 */
  color: white;
  border: none;
  cursor: pointer;
}
.result-section { margin-top: 20px; padding: 20px; border: 1px solid #eee; border-radius: 8px; }
.form-group { margin-bottom: 15px; }
.form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
.actions { margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 0; }
.save-button { background-color: #28a745; }
.delete-button { background-color: #dc3545; }
.message-section { margin-top: 20px; text-align: center; color: #888; }
.message-section.success p { color: #28a745; font-weight: bold; }
.results-list ul { list-style: none; padding: 0; margin: 0; }
.results-list li { padding: 12px 15px; border: 1px solid #ddd; border-radius: 5px; margin-bottom: 5px; cursor: pointer; transition: background-color 0.2s; }
.results-list li:hover { background-color: #f5f5f5; }
.results-list li.active { background-color: #007bff; color: white; border-color: #007bff; }
.image-preview { margin-top: 10px; width: 100%; max-width: 300px; }
.image-preview img { width: 100%; height: auto; border-radius: 5px; border: 1px solid #eee; }
.image-upload { margin-top: 10px; }
.image-upload button { margin-left: 10px; }
.search-mode-selector { display: flex; justify-content: center; margin-bottom: 15px; background-color: #e9ecef; border-radius: 8px; padding: 5px; }
.search-mode-selector button { flex: 1; padding: 8px 10px; border: none; background-color: transparent; color: #495057; font-size: 1rem; font-weight: 500; border-radius: 6px; transition: background-color 0.2s, color 0.2s; }
.search-mode-selector button.active { background-color: white; color: #007bff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
@media (max-width: 480px) { .search-section { flex-direction: column; align-items: stretch; } }
.toggle-switch-container {
  flex-shrink: 0;
  position: relative;
  height: 34px;
  display: flex;
  align-items: center;
  margin: 5px 0;      /* 增加一點上下空間 */
}
.toggle-switch-container input[type="checkbox"] { display: none; }
.switch { position: relative; display: inline-block; width: 90px; height: 34px; background-color: #ccc; border-radius: 34px; transition: background-color 0.2s; cursor: pointer; overflow: hidden; }
.switch:before { content: ""; position: absolute; height: 26px; width: 26px; left: 4px; bottom: 4px; background-color: white; border-radius: 50%; transition: transform 0.2s; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2); pointer-events: none; }
.toggle-switch-container input[type="checkbox"]:checked + .switch { background-color: #007bff; }
.toggle-switch-container input[type="checkbox"]:checked + .switch:before { transform: translateX(56px); }
.text-off, .text-on { position: absolute; color: white; font-size: 14px; font-weight: bold; line-height: 34px; text-align: center; width: 50%; transition: opacity 0.2s; pointer-events: none; }
.text-off { right: 0; opacity: 1; }
.text-on { left: 0; opacity: 0; }
.toggle-switch-container input[type="checkbox"]:checked + .switch .text-off { opacity: 0; }
.toggle-switch-container input[type="checkbox"]:checked + .switch .text-on { opacity: 1; }

.list-item-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}
.plate-id {
  font-weight: bold;
  white-space: normal; 
  word-break: break-all;
}
.household-part {
  font-weight: normal;
  color: #6c757d;
  white-space: nowrap; 
  flex-shrink: 0; 
}
.household-part a {
  font-weight: bold;
  color: #007bff;
  text-decoration: none;
}
.results-list li.active .household-part,
.results-list li.active .household-part a { color: white; }
textarea {transition: height 0.1s ease-out;resize: none;overflow-y: hidden;}
.view-mode .form-group p {padding: 12px;background-color: #f8f9fa;border-radius: 5px; border: 1px solid #dee2e6;margin: 8px 0;min-height: 20px;}
.view-mode .notes-display {white-space: pre-wrap;word-break: break-word;}
.edit-button {background-color: #ffc107;font-size: 0.9rem;padding: 8px 12px;}
.cancel-button {background-color: #6c757d;}
.combined-notes {padding: 12px;background-color: #f8f9fa;border-radius: 5px;border: 1px solid #dee2e6;margin: 8px 0;}
.notes-header {display: flex;justify-content: space-between;align-items: center;border-bottom: 1px solid #e9ecef;padding-bottom: 5px;margin-bottom: 8px}
.notes-header h4 {margin: 0;padding: 0;border: none;font-size: 0.9rem;color: #6c757d;text-align: left;}
.inline-edit-button {background: none;border: none;font-size: 1.2rem;cursor: pointer;padding: 0 5px;}
.combined-notes p {margin: 0 0 5px 0;white-space: pre-wrap;word-break: break-word;}
.modal-overlay {position: fixed;top: 0;left: 0;width: 100%;height: 100%;background-color: rgba(0, 0, 0, 0.5);display: flex;justify-content: center;align-items: center;z-index: 1000;
}
.modal-content {background: white;padding: 20px 30px;border-radius: 8px;box-shadow: 0 5px 15px rgba(0,0,0,0.3);width: 90%;max-width: 500px;}
hr {border: none;border-top: 1px solid #eee;margin: 20px 0;}
</style>
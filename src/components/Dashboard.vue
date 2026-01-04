<script setup>
import { ref, onMounted, nextTick, watch, computed } from 'vue'
import { auth, db, storage, functions } from '../firebase.js';
import imageCompression from 'browser-image-compression';// 這是用來壓縮圖片的套件

// --- 新增：住戶名單功能相關的狀態變數 ---
const residentListImageUrl = ref('') // 預設是空的，我們會從 Firebase 讀取
const residentListFile = ref(null)
const isResidentListUploading = ref(false)

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

// --- 核心：語音辨識 (STT) ---
// --- 新增：自定義問候語清單 ---
const greetings = [
  "大哥辛苦了，請說車牌",
  "吃飽了嗎，系統準備好了",
  "現在可以開始查詢車牌"
];
// --- 1. 優化後的 speak 函式 (區分問候與結果) ---
const speak = async (text, isResult = false) => {
  if (!text || text.trim() === "") return;

  // 模式 A：一般問候 (使用瀏覽器內建 TTS，免費且反應快)
  if (!isResult) {
    return new Promise((resolve) => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-TW';
      utter.pitch = 1.0;
      utter.rate = 1.0; 
      utter.onend = () => resolve(); // 唸完才回傳，讓辨識接手
      window.speechSynthesis.speak(utter);
    });
  }

  isLoading.value = true;
  try {
    // --- 修正後的文字處理：移除「字母」二字 ---
    // 我們保留 split('').join(' ') 的邏輯，這能確保語音是一字一字讀 (如：1 6 6 8 A R Y)
    // 而不會把 A R Y 當成一個單字讀錯
    const clearText = text.toUpperCase().split('').map(char => {
      if (/[A-Z0-9]/.test(char)) return ` ${char} `; 
      return char;
    }).join('');

    const getVoice = functions.httpsCallable('getHighQualityVoice'); 
    const result = await getVoice({ text: clearText });
    
    if (result.data && result.data.audioContent) {
      const audio = new Audio("data:audio/mp3;base64," + result.data.audioContent);
      audio.play();
    }
  } catch (error) {
    console.error("雲端語音失敗:", error);
    const utter = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utter);
  } finally {
    isLoading.value = false;
  }
};

// --- 2. 優化後的 startVoiceSearch 函式 (唸完才聽) ---
const startVoiceSearch = async () => { 
  if (!Recognition) {
    alert("您的瀏覽器不支援語音功能");
    return;
  }

  // 手動關閉功能：如果正在執行，點擊就停止
  if (isVoiceListening.value) {
    if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    if (recognition) recognition.stop();
    isVoiceListening.value = false;
    message.value = "語音監聽已取消";
    return; 
  }

  // 1. 準備流程
  const welcomeMessage = greetings[Math.floor(Math.random() * greetings.length)];
  message.value = `系統準備中：${welcomeMessage}`;
  isVoiceListening.value = true; 

  // 【核心修改】等待手機唸完問候語，麥克風才「嗶」一聲啟動
  await speak(welcomeMessage); 

  // 如果在唸問候語的過程中被手動取消，就不啟動麥克風
  if (!isVoiceListening.value) return;

  // 2. 啟動辨識
  recognition = new Recognition();
  recognition.lang = 'zh-TW';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    message.value = "系統聽取中，請說車牌或點擊停止...";
    searchPlate.value = ''; 
  };

// --- 修改後的 recognition.onresult ---
recognition.onresult = (event) => {
  let fullTranscript = "";
  let isFinalResult = false; // 新增：用來標記是否有最終結果
  
  const isPC = !/Android|iPhone|iPad/i.test(navigator.userAgent);
  const minConfidence = isPC ? 0 : 0.1;

  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i][0];
    const item = event.results[i];
    console.log(`辨識結果: ${result.transcript} (信心指數: ${result.confidence})`, item);
    if (item.isFinal) {
      isFinalResult = true; // 標記這是一個最終確定的片段
    }

    if (result.confidence >= minConfidence || result.transcript.includes('查詢')) {
      fullTranscript += result.transcript;
    }
  }

  const displayResult = fullTranscript.toUpperCase().replace(/[。，！？\.?]/g, '').trim();
  searchPlate.value = displayResult;

  // --- 關鍵修正：必須同時滿足「包含查詢」且「辨識結束」 ---
  if (displayResult.includes('查詢') && isFinalResult) {
    let finalCode = displayResult
      .replace(/\s+/g, '')
      .replace(/DASH|槓|點/g, '-')
      .replace('查詢', '');

    if (finalCode) {
      searchPlate.value = finalCode;
      
      // 先關閉監聽與旗標，避免重複入
      recognition.stop();
      isVoiceListening.value = false; 
      
      console.log("🎤 語音確認，準備搜尋:", finalCode);
      handleSearch(); // 執行搜尋
    }
  }
};

  recognition.onend = () => {
    isVoiceListening.value = false;
  };
  
  recognition.start();
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
  nextTick(() => { if (searchInput.value) searchInput.value.focus() })
})

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

const handleSearch = async () => {
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

    // --- 車位搜尋模式 ---
    if (searchMode.value === 'parking') {
      const lookupDoc = await db.collection(lookupCollectionName.value).doc(searchInputString).get();
      if (lookupDoc.exists) {
        finalSearchId = lookupDoc.data().ownerId;
        searchMode.value = 'household';
        targetMode = 'household';
        const msg = `車位搜尋成功，正在導向戶號：${finalSearchId}`;
        message.value = msg;
        speak(msg); // 語音回報成功
      } else {
        const errorMsg = `查無車位「${searchInputString}」的登記資料。`;
        message.value = errorMsg;
        speak(errorMsg); // 語音回報失敗
        isLoading.value = false; 
        return; // 結束，不再往下跑
      }
    }

    // --- 執行實際查詢 ---
    let querySnapshot;
    if (targetMode === 'household') {
      querySnapshot = await db.collection(props.collection).where('householdCode', '==', finalSearchId).get()
      if (querySnapshot.empty) {
        const msg = `查無戶號 ${finalSearchId}`;
        message.value = `查無戶號為「${finalSearchId}」的車輛，您可以為此戶號建立住戶資料。`;
        speak(msg);
        householdToCreate.value = { id: finalSearchId, name: '', features: '' }
        isNewHouseholdModalOpen.value = true
      }
    } else {
      // 查車牌模式
      if (finalSearchId.includes('-')) {
        const docRef = db.collection(props.collection).doc(finalSearchId)
        const docSnap = await docRef.get()
        if (docSnap.exists) {
          const result = { id: docSnap.id, ...docSnap.data() }; 
          searchResults.value = [result]; 
          selectItem(result); // 此函數內部會執行語音報讀
        } else {
          const msg = `查無車牌 ${finalSearchId}`;
          message.value = msg; 
          speak(msg);
          isSuccess.value = false; 
          showCreateForm.value = true; 
          plateToCreate.value = finalSearchId; 
          selectedItem.value = { householdCode: '', notes: '' }
        }
        isLoading.value = false; 
        return;
      } else {
        // 關鍵字搜尋
        const searchTerms = finalSearchId.split(' ').filter(term => term.length > 0)
        if (searchTerms.length > 10) { alert('批次查詢最多10個關鍵字。'); isLoading.value = false; return }
        querySnapshot = await db.collection(props.collection).where('searchKeywords', 'array-contains-any', searchTerms).get()
      }
    }

    // --- 處理查詢結果清單 ---
    if (querySnapshot && !querySnapshot.empty) {
      searchResults.value = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      message.value = '';
      if (searchResults.value.length === 1) {
        selectItem(searchResults.value[0]);
      } else {
        speak(`找到 ${searchResults.value.length} 筆資料`);
      }
    } else if (!showCreateForm.value && !searchResults.value.length && !isNewHouseholdModalOpen.value) {
       const msg = `查無符合內容`;
       message.value = `查無任何符合「${searchInputString}」的資料。`;
       speak(msg);
       isSuccess.value = false
    }
  } catch (error) {
    console.error("查詢失敗:", error)
    message.value = '查詢時發生錯誤。'
    speak("系統查詢出錯");
  } finally {
    isLoading.value = false
    if (searchMode.value !== 'residentList') {
      nextTick(() => { if (searchInput.value) searchInput.value.focus() })
    }
  }
}

const selectItem = async (item) => {
  if (!item) return;
  
  message.value = '正在載入詳細資料...';
  isSuccess.value = false;
  isLoading.value = true;
  
  let completeItemData = { ...item };

  // 1. 抓取住戶詳細資料
  if (item.householdCode) {
    try {
      const householdDocRef = db.collection(householdCollectionName.value).doc(item.householdCode);
      const householdDocSnap = await householdDocRef.get();
      if (householdDocSnap.exists) {
        completeItemData.householdInfo = householdDocSnap.data();
      } else {
        completeItemData.householdInfo = { name: '', features: '', parking_number: '' };
      }
    } catch (error) {
      console.error("載入住戶資料失敗:", error);
    }
  }

  selectedItem.value = completeItemData;
  isEditing.value = false;
  message.value = '';
  isLoading.value = false;

  // --- 2. 【核心修正】語音報讀文字防彈處理 ---
  // 確保每個變數都有預設值，避免出現 undefined
  const plateId = item.id || '未知車牌';
  const unitCode = completeItemData.householdCode || '尚未登記戶號';
  const userName = completeItemData.householdInfo?.name ? `，住戶 ${completeItemData.householdInfo.name}` : '';

  // 組合最終文字
  const finalSpeechText = `查詢成功。車牌 ${plateId}。屬於 ${unitCode} ${userName}`;

  console.log("📢 準備送往雲端報讀的文字:", finalSpeechText);

  // 3. 執行報讀 (傳入 true 代表要用高品質雲端語音)
  // 這裡會檢查 finalSpeechText 是否為空，若是空就不會去打 API
  speak(finalSpeechText, true);

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

  <button @click="handleSearch" :disabled="isLoading">{{ isLoading ? '處理中...' : '查詢' }}</button>
</div>

      <div v-if="searchMode === 'pending'" class="search-section" style="text-align: center; border: 1px dashed #dc3545; background-color: #fff5f5;">
        <h3 style="color: #dc3545; margin: 0;">⚠️ 異常/待查車輛清單</h3>
      </div>
      <div v-if="searchResults.length > 0" class="results-list">
        <h4>找到了 {{ searchResults.length }} 筆結果：</h4>
      <ul>
        <li v-for="item in searchResults" :key="item.id" @click="selectItem(item)" :class="{ active: selectedItem && selectedItem.id === item.id }">
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
          <p v-if="selectedItem.householdInfo.parking_number">{{ selectedItem.householdInfo.parking_number }}</p>
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
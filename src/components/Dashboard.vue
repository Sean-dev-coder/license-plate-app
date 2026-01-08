<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import { auth, db, storage, functions } from '../firebase.js';
import imageCompression from 'browser-image-compression';// 這是用來壓縮圖片的套件
import { useVoiceAssistant } from '../composables/useVoiceAssistant';
import { usePlateManagement } from '../composables/usePlateManagement';
// --- [第一部分] 語音助理 ---
const { 
  isVoiceListening, 
  message: voiceMessage, 
  toggleVoiceSearch, 
  speak 
} = useVoiceAssistant();
// --- [第三部分] 橋樑函式 (語音聽到 -> 搜尋) ---
const onVoiceDetected = (plateString) => {
  searchPlate.value = plateString;
  handleSearch(true); // 觸發 Composable 裡的搜尋
};
// 用來綁定在按鈕上的新函式
const handleVoiceBtnClick = () => {
  toggleVoiceSearch(onVoiceDetected);
};
// --- 新增：住戶名單功能相關的狀態變數 ---
const residentListImageUrl = ref('') // 預設是空的，我們會從 Firebase 讀取
const residentListFile = ref(null)
const isResidentListUploading = ref(false)
const props = defineProps({
  collection: { type: String, required: true }
})
// --- [第二部分] 核心資料管理 (取代原本幾百行程式碼) ---
const collectionRef = computed(() => props.collection);
const {
  // 狀態
  searchPlate, isLoading, message, isSuccess, searchResults, selectedItem,
  searchMode, isNumericMode, showCreateForm, plateToCreate, isEditing,
  isNewHouseholdModalOpen, householdToCreate, pendingCount,
  itemBeforeEdit, // 記得要解構這個出來，因為 template 有用到
  
  // 方法
  handleSearch, selectItem, changeSearchMode, handlePendingClick,
  enterEditMode, cancelEdit, saveAllChanges, handleCreate,
  handleHouseholdCreate, handleDelete, syncExistingParkingData
} = usePlateManagement(collectionRef, speak);
// --- 狀態變數 ---
const searchInput = ref(null)
const selectedFile = ref(null)
const isUploading = ref(false)
const editSectionRef = ref(null)
const notesTextarea = ref(null)
const featuresTextarea = ref(null)

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
onMounted(() => {
  loadResidentListImage();
  nextTick(() => { if (searchInput.value) searchInput.value.focus() })
})
onUnmounted(() => {

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
  searchPlate.value = term;
  changeSearchMode(mode); // 呼叫 Composable 的方法
  handleSearch();
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
const toggleInputMode = () => {
  nextTick(() => { if (searchInput.value) searchInput.value.focus() })
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
      @click="handleVoiceBtnClick" 
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

      <div v-if="message || voiceMessage" class="message-section" :class="{ success: isSuccess }">
        <p>{{ message ? message : voiceMessage }}</p>
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
<script setup>
import { ref, onMounted, nextTick, watch, computed } from 'vue'
import { auth, db, storage } from '../firebase.js'

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
  message.value = '總表圖片上傳中...';
  isSuccess.value = false;

  try {
    const suffix = props.collection.replace('licensePlates', '');
    const configDocName = suffix ? `residentList${suffix}` : 'residentList';

    // 1. 將圖片上傳到 Firebase Storage 的動態路徑
    const imagePath = `system/residentListImage${suffix}`;
    const imageRef = storage.ref().child(imagePath);
    const uploadTask = await imageRef.put(residentListFile.value);
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
  if (mode === 'household') { isNumericMode.value = false } 
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

    // --- 方案 B：查車位邏輯植入 ---
    if (searchMode.value === 'parking') {
      // 將原本固定的 'parking_lookup' 改為 lookupCollectionName.value
      const lookupDoc = await db.collection(lookupCollectionName.value).doc(searchInputString).get();
      if (lookupDoc.exists) {
        finalSearchId = lookupDoc.data().ownerId; // 抓到對應的戶號 (如 C219)
        // --- 同步修正：搜尋成功後，將 UI 模式也切換為 household ---
        searchMode.value = 'household';
        targetMode = 'household';                 // 強制轉向戶號查詢模式
        message.value = `車位搜尋成功，正在導向戶號：${finalSearchId}`;
      } else {
        message.value = `查無車位「${searchInputString}」的登記資料。`;
        isLoading.value = false; return;
      }
    }

    let querySnapshot;
    if (targetMode === 'household') {
      querySnapshot = await db.collection(props.collection).where('householdCode', '==', finalSearchId).get()
      if (querySnapshot.empty) {
        message.value = `查無戶號為「${finalSearchId}」的車輛，您可以為此戶號建立住戶資料。`
        householdToCreate.value = { id: finalSearchId, name: '', features: '' }
        isNewHouseholdModalOpen.value = true
      }
    } else {
      if (finalSearchId.includes('-')) {
        const docRef = db.collection(props.collection).doc(finalSearchId)
        const docSnap = await docRef.get()
        if (docSnap.exists) {
          const result = { id: docSnap.id, ...docSnap.data() }; searchResults.value = [result]; selectItem(result)
        } else {
          message.value = `查無車牌「${finalSearchId}」，您可以新增此筆資料。`; isSuccess.value = false; showCreateForm.value = true; plateToCreate.value = finalSearchId; selectedItem.value = { householdCode: '', notes: '' }
        }
        isLoading.value = false; return;
      } else {
        const searchTerms = finalSearchId.split(' ').filter(term => term.length > 0)
        if (searchTerms.length > 10) { alert('批次查詢最多10個關鍵字。'); isLoading.value = false; return }
        querySnapshot = await db.collection(props.collection).where('searchKeywords', 'array-contains-any', searchTerms).get()
      }
    }
    // ... 後面接你原本的 if (querySnapshot && !querySnapshot.empty) 邏輯
    if (querySnapshot && !querySnapshot.empty) {
      searchResults.value = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      // --- 同步修正：找到結果後，清除掉剛才搜尋車位的暫存訊息，讓畫面保持乾淨 ---
      message.value = '';
    } else {
      if (!showCreateForm.value && !searchResults.value.length && !isNewHouseholdModalOpen.value) {
          message.value = `查無任何符合「${searchInputString}」的資料。`; isSuccess.value = false
      }
    }
  } catch (error) {
    console.error("查詢失敗:", error)
    message.value = '查詢時發生錯誤，請稍後再試。'
    isSuccess.value = false
  } finally {
    isLoading.value = false
    if (searchMode.value !== 'residentList') {
      nextTick(() => { if (searchInput.value) searchInput.value.focus() })
    }
  }
}

const selectItem = async (item) => {
  message.value = '正在載入詳細資料...'
  isSuccess.value = false
  isLoading.value = true
  let completeItemData = { ...item }
  if (item.householdCode) {
    try {
      const householdDocRef = db.collection(householdCollectionName.value).doc(item.householdCode)
      const householdDocSnap = await householdDocRef.get()
      if (householdDocSnap.exists) {
        completeItemData.householdInfo = householdDocSnap.data()
      } else {
        completeItemData.householdInfo = { name: '', features: '', parking_number: ''} 
      }
    } catch (error) {
      console.error("載入住戶資料失敗:", error); message.value = '載入住戶資料時發生錯誤。'
    }
  }
  selectedItem.value = completeItemData
  isEditing.value = false
  selectedFile.value = null
  showCreateForm.value = false
  message.value = ''
  isLoading.value = false
  nextTick(() => {
    if (editSectionRef.value) {
      editSectionRef.value.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  })
}

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
    const batch = db.batch(); // 使用 Batch 確保多表同步

    // 拆解車位號碼為陣列
    const parkingArray = householdData.parking_number 
      ? householdData.parking_number.split('/').map(s => s.trim()).filter(Boolean) 
      : [];

    // 1. 加入主表更新
    batch.update(plateDocRef, plateData);
    batch.set(householdDocRef, { ...householdData, parking: parkingArray }, { merge: true });

    // 2. 加入車位反查表更新
    parkingArray.forEach(spot => {
      // 使用動態名稱 lookupCollectionName.value 確保資料不會存錯社區
      const lookupRef = db.collection(lookupCollectionName.value).doc(spot.toUpperCase());
      batch.set(lookupRef, { 
        ownerId: selectedItem.value.householdCode,
        updatedAt: new Date()
      }, { merge: true });
    });

    await batch.commit(); // 一次性提交
    
    message.value = '所有資料與車位反查索引已更新成功！'
    isSuccess.value = true
    
    const index = searchResults.value.findIndex(item => item.id === selectedItem.value.id)
    if (index !== -1) { 
      searchResults.value[index] = { ...selectedItem.value }
    }
// --- 同步修正：儲存完畢後，確保編輯模式關閉，且重設 isLoading 狀態 ---
    isEditing.value = false
    isLoading.value = false
    
  } catch (error) {
    console.error("儲存失敗:", error)
    message.value = '儲存失敗，請稍後再試。'
    isSuccess.value = false
  }
}

const syncExistingParkingData = async () => {
  if (!window.confirm("這將會掃描所有舊資料並建立車位索引，確定執行嗎？")) return;
  isLoading.value = true;
  message.value = "正在同步舊車位資料...";

  try {
    const batch = db.batch();
    // 1. 抓取所有戶號資料 (請確認 householdCollectionName.value 指向正確的集合)
    const snapshot = await db.collection(householdCollectionName.value).get();
    
    let count = 0;
    snapshot.forEach(doc => {
      const data = doc.data();
      const householdId = doc.id;
      // 拆解該戶原本存好的車位號碼
      const parkingArray = data.parking_number 
        ? data.parking_number.split('/').map(s => s.trim()).filter(Boolean) 
        : [];

      parkingArray.forEach(spot => {
        const lookupRef = db.collection('parking_lookup').doc(spot.toUpperCase());
        batch.set(lookupRef, { 
          ownerId: householdId,
          updatedAt: new Date(),
          note: "由系統自動補齊索引"
        }, { merge: true });
        count++;
      });
    });

    await batch.commit();
    message.value = `同步完成！已成功為 ${count} 個車位建立索引。`;
    isSuccess.value = true;
  } catch (error) {
    console.error("同步失敗:", error);
    message.value = "同步失敗，可能是權限或資料量過大。";
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
    const dataToCreate = { householdCode: selectedItem.value.householdCode, notes: selectedItem.value.notes, createdBy: auth.currentUser.email, createdAt: new Date(), searchKeywords: keywords, imageUrl: '' }
    await docRef.set(dataToCreate)
    message.value = `車牌「${plateToCreate.value}」已成功新增！`; isSuccess.value = true
    showCreateForm.value = false; selectedItem.value = null; searchPlate.value = plateToCreate.value
  } catch (error) { console.error("新增失敗:", error); message.value = '新增失敗'; isSuccess.value = false }
  finally { isLoading.value = false }
}

const handleDelete = async () => {
  if (!selectedItem.value || !selectedItem.value.id) return
  if (!window.confirm(`確定要永久刪除車牌「${selectedItem.value.id}」的資料嗎？`)) { return }
  isLoading.value = true
  try {
    if (selectedItem.value.imageUrl) {
      const imageRef = storage.refFromURL(selectedItem.value.imageUrl); await imageRef.delete()
    }
    await db.collection(props.collection).doc(selectedItem.value.id).delete()
    message.value = '資料已成功刪除。'; isSuccess.value = true
    searchResults.value = searchResults.value.filter(item => item.id !== selectedItem.value.id)
    selectedItem.value = null
  } catch (error) { console.error("刪除失敗:", error); message.value = '刪除失敗'; isSuccess.value = false }
  finally { isLoading.value = false }
}

const handleFileSelect = (event) => {
  selectedFile.value = event.target.files[0]
}

const handleImageUpload = async () => {
  if (!selectedFile.value) { alert('請先選擇圖片檔案！'); return }
  if (!selectedItem.value || !selectedItem.value.id) { alert('請先選擇資料項目'); return }
  isUploading.value = true; message.value = '圖片上傳中...'; isSuccess.value = false
  try {
    const imagePath = `plates/${props.collection}/${selectedItem.value.id}`
    const imageRef = storage.ref().child(imagePath)
    const uploadTask = await imageRef.put(selectedFile.value)
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
    </div>

    <template v-if="searchMode !== 'residentList'">
            <div class="search-section">
        <input ref="searchInput" v-model="searchPlate" @keyup.enter="handleSearch" :placeholder="searchMode === 'plate' ? '請輸入車牌號碼查詢' : (searchMode === 'household' ? '請輸入戶號查詢' : '請輸入車位號碼 (如 B5180)')" :inputmode="isNumericMode ? 'numeric' : 'text'" />
        <div v-if="searchMode === 'plate'" class="toggle-switch-container">
          <input type="checkbox" id="inputModeToggle" v-model="isNumericMode" @change="toggleInputMode" />
          <label for="inputModeToggle" class="switch">
            <span class="text-off">英文</span>
            <span class="text-on">數字</span>
          </label>
        </div>
        <button @click="handleSearch" :disabled="isLoading">{{ isLoading ? '處理中...' : '查詢' }}</button>
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
        <div class="form-group"><label>戶別代碼:</label><input v-model="selectedItem.householdCode" placeholder="請輸入戶別代碼" /></div>
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
    
    <div v-if="searchMode === 'residentList'" style="margin-top: 50px; border-top: 1px dashed #ccc; padding-top: 20px;">
      <p style="color: #888; font-size: 0.8rem;">系統維護區</p>
      <button @click="syncExistingParkingData" :disabled="isLoading" style="background-color: #6c757d; color: white; border: none; padding: 5px 10px; border-radius: 4px; font-size: 0.8rem;">
        🔄 補齊舊資料車位索引
      </button>
    </div>

  </div>
</template>

<style scoped>
/* --- 樣式完全保持原樣 --- */
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
<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { auth, db, storage } from '../firebase.js'

// --- 狀態變數 (維持不變) ---
const searchPlate = ref('')
const isLoading = ref(false)
const message = ref('')
const isSuccess = ref(false)
const searchInput = ref(null)
const searchResults = ref([])
const selectedItem = ref(null)
const showCreateForm = ref(false)
const plateToCreate = ref('')

// --- 生命週期鉤子 (維持不變) ---
onMounted(() => {
  nextTick(() => { if (searchInput.value) searchInput.value.focus() })
})

// --- 核心功能函式 ---

// vvv 這是我們唯一需要修改的函式 vvv
const handleSearch = async () => {
  if (!searchPlate.value) {
    alert('請輸入查詢關鍵字！')
    return
  }

  isLoading.value = true
  searchResults.value = []
  selectedItem.value = null
  message.value = ''
  showCreateForm.value = false

  try {
    const searchInputString = searchPlate.value.toUpperCase().trim()

    // +++ 新增的程式碼：立刻清空輸入框 +++
    searchPlate.value = ''
    
    // 智慧判斷：如果輸入包含 '-', 則執行精準查詢
    if (searchInputString.includes('-')) {
      const docRef = db.collection('licensePlates').doc(searchInputString)
      const docSnap = await docRef.get()

      if (docSnap.exists) {
        // 精準查詢有結果，直接放入列表並選中
        const result = { id: docSnap.id, ...docSnap.data() }
        searchResults.value = [result]
        selectItem(result)
      } else {
        // 精準查詢無結果，顯示新增表單
        message.value = `查無車牌「${searchInputString}」，您可以新增此筆資料。`
        isSuccess.value = false
        showCreateForm.value = true
        plateToCreate.value = searchInputString
        selectedItem.value = { householdCode: '', notes: '' }
      }
    } else {
      // 不含 '-', 執行多關鍵字查詢
      const searchTerms = searchInputString.split(' ').filter(term => term.length > 0)
      if (searchTerms.length === 0) return
      if (searchTerms.length > 10) {
        alert('批次查詢一次最多只能輸入 10 個關鍵字。')
        isLoading.value = false
        return
      }

      const querySnapshot = await db.collection('licensePlates')
                                    .where('searchKeywords', 'array-contains-any', searchTerms)
                                    .get()

      if (!querySnapshot.empty) {
        searchResults.value = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      } else {
        message.value = `查無任何包含關鍵字「${searchTerms.join(', ')}」的資料。`
        isSuccess.value = false
      }
    }
  } catch (error) {
    console.error("查詢失敗:", error)
    message.value = '查詢時發生錯誤，請稍後再試。'
    isSuccess.value = false
  } finally {
    isLoading.value = false
    // +++ 新增的程式碼：將焦點重新設定回輸入框 +++
    nextTick(() => {
      if (searchInput.value) {
        searchInput.value.focus()
      }
    })
  }
}

const selectItem = (item) => {
  selectedItem.value = { ...item }
  showCreateForm.value = false
  message.value = ''
}

// ... handleUpdate, handleCreate, handleDelete 等其他函式維持不變 ...
const handleUpdate = async () => {
  if (!selectedItem.value || !selectedItem.value.id) return
  // ... (此處程式碼不變)
}
const handleCreate = async () => {
   if (!plateToCreate.value) return
  // ... (此處程式碼不變)
}
const handleDelete = async () => {
  if (!selectedItem.value || !selectedItem.value.id) return
  // ... (此處程式碼不變)
}
</script>

<template>
  <div class="dashboard">
    <div class="search-section">
      <input ref="searchInput" v-model="searchPlate" @keyup.enter="handleSearch" placeholder="請輸入車牌號碼查詢或新增" />
      <button @click="handleSearch" :disabled="isLoading">{{ isLoading ? '處理中...' : '查詢' }}</button>
    </div>

    <div v-if="searchResults.length > 0" class="results-list">
      <h4>找到了 {{ searchResults.length }} 筆結果：</h4>
      <ul>
        <li v-for="item in searchResults" :key="item.id" @click="selectItem(item)" :class="{ active: selectedItem && selectedItem.id === item.id }">
          <strong>{{ item.id }}</strong> (戶號: {{ item.householdCode }})
        </li>
      </ul>
      <hr>
    </div>

    <div v-if="selectedItem && !showCreateForm" class="result-section">
      <h3>編輯資料：{{ selectedItem.id }}</h3>
      <div class="form-group">
        <label>戶別代碼:</label>
        <input v-model="selectedItem.householdCode" />
      </div>
      <div class="form-group">
        <label>備註:</label>
        <textarea v-model="selectedItem.notes" rows="3"></textarea>
      </div>
      
      <div class="form-group">
        <label>相關圖片:</label>
        <div class="image-preview">
          <img v-if="selectedItem.imageUrl" :src="selectedItem.imageUrl" alt="車牌圖片"/>
          <p v-else>尚無圖片</p>
        </div>
        <div class="image-upload">
          <input type="file" @change="handleFileSelect" accept="image/*" />
          <button @click="handleImageUpload" :disabled="isUploading || !selectedFile">
            {{ isUploading ? '上傳中...' : '上傳圖片' }}
          </button>
        </div>
      </div>
      
      <div class="actions">
        <button @click="handleUpdate" :disabled="isLoading" class="save-button">儲存更新</button>
        <button @click="handleDelete" :disabled="isLoading" class="delete-button">刪除資料</button>
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
  </div>
</template>

<style scoped>
/* ... (原有樣式不變) ... */
.results-list li.active { background-color: #007bff; color: white; border-color: #007bff;}
@media (max-width: 480px) { .search-section { flex-direction: column; align-items: stretch; } }
ul { list-style: none; padding: 0; }
li { padding: 10px; border: 1px solid #ddd; margin-bottom: 5px; cursor: pointer; border-radius: 5px;}

/* +++ 新增的圖片樣式 +++ */
.image-preview {
  margin-top: 10px;
  width: 100%;
  max-width: 300px;
}
.image-preview img {
  width: 100%;
  height: auto;
  border-radius: 5px;
  border: 1px solid #eee;
}
.image-upload {
  margin-top: 10px;
}
.image-upload button {
  margin-left: 10px;
}
</style>
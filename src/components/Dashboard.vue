<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { auth, db, storage } from '../firebase.js'

// --- 狀態變數 ---
const searchPlate = ref('')
const resultData = ref(null)
const originalPlateId = ref('')
const isLoading = ref(false)
const message = ref('')
const isSuccess = ref(false)
const showCreateForm = ref(false)
const searchInput = ref(null)

// --- 新增：圖片處理相關狀態 ---
const selectedFile = ref(null) // 存放使用者選擇的檔案
const isUploading = ref(false) // 追蹤是否正在上傳

// --- 生命週期鉤子 ---
onMounted(() => {
  nextTick(() => {
    if (searchInput.value) {
      searchInput.value.focus()
    }
  })
})

// --- 共用變數 ---
const dbName = 'licensePlates'

// --- 核心功能函式 ---
const handleSearch = async () => {
  if (!searchPlate.value) {
    alert('請輸入車牌號碼或數字！')
    return
  }
  
  isLoading.value = true
  resultData.value = null
  message.value = ''
  showCreateForm.value = false
  
  try {
    const searchTerm = searchPlate.value.toUpperCase().trim()
    
    // --- 這是修改後的核心查詢邏輯 ---
    // 我們現在查詢 searchKeywords 陣列中是否包含使用者輸入的詞
    const querySnapshot = await db.collection(dbName)
                                  .where('searchKeywords', 'array-contains', searchTerm)
                                  .get()

    if (!querySnapshot.empty) {
      // 如果找到了資料 (可能有多筆，我們先取第一筆)
      const firstDoc = querySnapshot.docs[0]
      resultData.value = firstDoc.data()
      originalPlateId.value = firstDoc.id
    } else {
      // 如果找不到，就顯示新增表單
      message.value = `查無包含「${searchTerm}」的資料，您可以新增此車牌。`
      isSuccess.value = false
      showCreateForm.value = true
      originalPlateId.value = searchTerm // 預設將搜尋的詞作為新車牌號
      resultData.value = { householdCode: '', notes: '' }
    }
  } catch (error) {
    console.error("查詢失敗:", error)
    message.value = '查詢時發生錯誤，請稍後再試。'
    isSuccess.value = false
  } finally {
    isLoading.value = false
  }
}
const handleUpdate = async () => {
  if (!originalPlateId.value) return
  isLoading.value = true
  try {
    const docRef = db.collection(dbName).doc(originalPlateId.value)
    const dataToUpdate = {
      householdCode: resultData.value.householdCode,
      notes: resultData.value.notes,
      lastUpdatedBy: auth.currentUser.email,
      updatedAt: new Date()
    }
    await docRef.update(dataToUpdate)
    message.value = '資料更新成功！'
    isSuccess.value = true
  } catch (error) {
    console.error("更新失敗:", error)
    message.value = '更新失敗，請稍後再試。'
    isSuccess.value = false
  } finally {
    isLoading.value = false
  }
}

const handleCreate = async () => {
  if (!originalPlateId.value) return
  isLoading.value = true
  try {
    const docRef = db.collection(dbName).doc(originalPlateId.value)
    const keywords = originalPlateId.value.split('-').filter(Boolean)
    const dataToCreate = {
      householdCode: resultData.value.householdCode,
      notes: resultData.value.notes,
      createdBy: auth.currentUser.email,
      createdAt: new Date(),
      searchKeywords: keywords,
      imageUrl: '' // 預設圖片URL為空字串
    }
    await docRef.set(dataToCreate)
    message.value = `車牌「${originalPlateId.value}」已成功新增！`
    isSuccess.value = true
    showCreateForm.value = false
  } catch (error) {
    console.error("新增失敗:", error)
    message.value = '新增失敗，請稍後再試。'
    isSuccess.value = false
  } finally {
    isLoading.value = false
  }
}

const handleDelete = async () => {
  if (!originalPlateId.value) return
  if (!window.confirm(`確定要永久刪除車牌「${originalPlateId.value}」的資料嗎？`)) {
    return
  }
  
  isLoading.value = true
  try {
    // 如果有圖片，先從 Storage 刪除
    if (resultData.value.imageUrl) {
      const imageRef = storage.refFromURL(resultData.value.imageUrl)
      await imageRef.delete()
      console.log('圖片已從 Storage 刪除')
    }
    // 再從 Firestore 刪除文件
    await db.collection(dbName).doc(originalPlateId.value).delete()
    
    message.value = '資料已成功刪除。'
    isSuccess.value = true
    resultData.value = null
    originalPlateId.value = ''
    searchPlate.value = ''
    
  } catch (error) {
    console.error("刪除失敗:", error)
    message.value = '刪除失敗，請稍後再試。'
    isSuccess.value = false
  } finally {
    isLoading.value = false
  }
}

// --- 新增：圖片處理函式 ---
const handleFileSelect = (event) => {
  selectedFile.value = event.target.files[0]
}

const handleImageUpload = async () => {
  if (!selectedFile.value) {
    alert('請先選擇要上傳的圖片檔案！')
    return
  }
  if (!originalPlateId.value) {
    alert('請先查詢或建立一筆資料，才能上傳圖片。')
    return
  }
  
  isUploading.value = true
  message.value = '圖片上傳中...'
  isSuccess.value = false

  try {
    // 1. 建立 Firebase Storage 的檔案參考路徑
    const imagePath = `plates/${originalPlateId.value}`
    const imageRef = storage.ref().child(imagePath)
    
    // 2. 上傳檔案
    const uploadTask = await imageRef.put(selectedFile.value)
    
    // 3. 取得檔案的公開下載 URL
    const downloadURL = await uploadTask.ref.getDownloadURL()
    
    // 4. 將 URL 更新回 Firestore
    const docRef = db.collection(dbName).doc(originalPlateId.value)
    await docRef.update({ imageUrl: downloadURL })
    
    // 5. 更新畫面上的資料，讓圖片立刻顯示
    resultData.value.imageUrl = downloadURL
    
    message.value = '圖片上傳成功！'
    isSuccess.value = true
    selectedFile.value = null
    
  } catch (error) {
    console.error("圖片上傳失敗:", error)
    message.value = '圖片上傳失敗，請稍後再試。'
    isSuccess.value = false
  } finally {
    isUploading.value = false
  }
}
</script>

<template>
  <div class="dashboard">
    <div class="search-section">
      <input 
        ref="searchInput"
        v-model="searchPlate" 
        @keyup.enter="handleSearch"
        placeholder="請輸入車牌號碼查詢或新增" 
      />
      <button @click="handleSearch" :disabled="isLoading">
        {{ isLoading ? '處理中...' : '查詢' }}
      </button>
    </div>

    <div v-if="resultData && !showCreateForm" class="result-section">
      <h3>查詢結果：{{ originalPlateId }}</h3>
      <div class="form-group">
        <label>戶別代碼:</label>
        <input v-model="resultData.householdCode" />
      </div>
      <div class="form-group">
        <label>備註:</label>
        <textarea v-model="resultData.notes" rows="3"></textarea>
      </div>

      <div class="form-group">
        <label>相關圖片:</label>
        <div class="image-preview">
          <img v-if="resultData.imageUrl" :src="resultData.imageUrl" alt="車牌圖片"/>
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
      </div>

    <div v-if="message" class="message-section" :class="{ success: isSuccess }">
      <p>{{ message }}</p>
    </div>
  </div>
</template>

<style scoped>
/* ... (原有樣式) ... */
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
</style>
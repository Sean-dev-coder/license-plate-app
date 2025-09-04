<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { auth, db, storage } from '../firebase.js'

const props = defineProps({
  collection: { type: String, required: true }
})

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

onMounted(() => {
  nextTick(() => { if (searchInput.value) searchInput.value.focus() })
})

// +++ 新增的函式 +++
const quickSearch = (term, mode = 'plate') => {
  if (!term) return // 防止點到不存在的部分 (例如沒有'-'的車牌)
  searchPlate.value = term
  searchMode.value = mode
  handleSearch()
}

const changeSearchMode = (mode) => {
  searchMode.value = mode
  if (mode === 'household') {
    isNumericMode.value = false
  } else {
    isNumericMode.value = true
  }
  nextTick(() => {
    if (searchInput.value) searchInput.value.focus()
  })
}

const toggleInputMode = () => {
  //isNumericMode.value = !isNumericMode.value
  nextTick(() => {
    if (searchInput.value) searchInput.value.focus()
  })
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
    let querySnapshot;
    if (searchMode.value === 'household') {
      querySnapshot = await db.collection(props.collection).where('householdCode', '==', searchInputString).get()
    } else {
      if (searchInputString.includes('-')) {
        const docRef = db.collection(props.collection).doc(searchInputString)
        const docSnap = await docRef.get()
        if (docSnap.exists) {
          const result = { id: docSnap.id, ...docSnap.data() }; searchResults.value = [result]; selectItem(result)
        } else {
          message.value = `查無車牌「${searchInputString}」，您可以新增此筆資料。`; isSuccess.value = false; showCreateForm.value = true; plateToCreate.value = searchInputString; selectedItem.value = { householdCode: '', notes: '' }
        }
        isLoading.value = false
        return
      } else {
        const searchTerms = searchInputString.split(' ').filter(term => term.length > 0)
        if (searchTerms.length > 10) { alert('批次查詢最多10個關鍵字。'); isLoading.value = false; return }
        querySnapshot = await db.collection(props.collection).where('searchKeywords', 'array-contains-any', searchTerms).get()
      }
    }
    if (querySnapshot && !querySnapshot.empty) {
      searchResults.value = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    } else {
      if (!showCreateForm.value && !searchResults.value.length) {
         message.value = `查無任何符合「${searchInputString}」的資料。`; isSuccess.value = false
      }
    }
  } catch (error) {
    console.error("查詢失敗:", error)
    message.value = '查詢時發生錯誤，請稍後再試。'
    isSuccess.value = false
  } finally {
    isLoading.value = false
    nextTick(() => { if (searchInput.value) searchInput.value.focus() })
  }
}

const selectItem = (item) => {
  selectedItem.value = { ...item }; selectedFile.value = null; showCreateForm.value = false; message.value = ''
}

const handleUpdate = async () => {
  if (!selectedItem.value || !selectedItem.value.id) return
  isLoading.value = true
  try {
    const docRef = db.collection(props.collection).doc(selectedItem.value.id)
    const dataToUpdate = { householdCode: selectedItem.value.householdCode, notes: selectedItem.value.notes, lastUpdatedBy: auth.currentUser.email, updatedAt: new Date() }
    await docRef.update(dataToUpdate)
    message.value = '資料更新成功！'; isSuccess.value = true
    const index = searchResults.value.findIndex(item => item.id === selectedItem.value.id)
    if (index !== -1) { searchResults.value[index] = { ...searchResults.value[index], ...dataToUpdate } }
  } catch (error) { console.error("更新失敗:", error); message.value = '更新失敗'; isSuccess.value = false }
  finally { isLoading.value = false }
}

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
    </div>

    <div class="search-section">
      <input 
        ref="searchInput"
        v-model="searchPlate" 
        @keyup.enter="handleSearch"
        :placeholder="searchMode === 'plate' ? '請輸入車牌號碼查詢或新增' : '請輸入戶號查詢'"
        :inputmode="isNumericMode ? 'numeric' : 'text'"  
      />
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
            <span class="clickable-part" @click.stop="quickSearch(item.id.split('-')[0])">{{ item.id.split('-')[0] }}</span>
            -
            <span class="clickable-part" @click.stop="quickSearch(item.id.split('-')[1])">{{ item.id.split('-')[1] }}</span>
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

    <div v-if="selectedItem && !showCreateForm" class="result-section">
      <h3>編輯資料：{{ selectedItem.id }}</h3>
      <div class="form-group"><label>戶別代碼:</label><input v-model="selectedItem.householdCode" /></div>
      <div class="form-group"><label>備註:</label><textarea v-model="selectedItem.notes" rows="3"></textarea></div>
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
.dashboard { margin-top: 20px; }
.search-section { display: flex; gap: 10px; align-items: center; }
.search-section input { flex-grow: 1; }
.result-section { margin-top: 20px; padding: 20px; border: 1px solid #eee; border-radius: 8px; }
.form-group { margin-bottom: 15px; }
.form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
.actions { margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px; }
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
.toggle-switch-container { flex-shrink: 0; position: relative; height: 34px; display: flex; align-items: center; }
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

.list-item-content { font-weight: bold; }
.clickable-part, .household-part a { color: #007bff; text-decoration: none; cursor: pointer; }
.household-part { margin-left: 8px; font-weight: normal; color: #6c757d; }
.household-part a { font-weight: bold; }
/* --- 新增：修正 .active 狀態下的文字顏色 --- */
.results-list li.active .clickable-part,
.results-list li.active .household-part,
.results-list li.active .household-part a {
  /* 讓所有內部的文字在 active 狀態下都變成白色 */
  color: white; 
}
</style>
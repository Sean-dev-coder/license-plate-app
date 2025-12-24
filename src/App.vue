<script setup>
import { ref, onMounted } from 'vue'
import { auth } from './firebase.js'
import Login from './components/Login.vue'
import Dashboard from './components/Dashboard.vue'

const isLoggedIn = ref(false)
const collectionName = ref('')
const communityDisplayName = ref('') // 新增：用於顯示中文名稱

onMounted(() => {
  auth.onAuthStateChanged((user) => {
    if (user) {
      // 登入成功後，從 localStorage 抓取剛才選定的後綴
      const suffix = localStorage.getItem('db_suffix') || ''
      collectionName.value = `licensePlates${suffix}`
      // 📍 新增：中文化對照表
      const communityMap = {
        '_test': '測試區域',
        '': '大陸丽格',
        '_epoque': '大陸豐蒔',
        '_treasure': '大陸宝格'
      }
      // 根據後綴抓取中文名，如果找不到就顯示原始 ID
      communityDisplayName.value = communityMap[suffix] || collectionName.value
      console.log('App.vue 切換至資料集：', collectionName.value)
      isLoggedIn.value = true
    } else {
      isLoggedIn.value = false
      collectionName.value = ''
    }
  })
})

const handleLogout = () => {
  auth.signOut()
}
</script>

<template>
  <div v-if="!isLoggedIn">
    <main class="login-main">
      <Login />
    </main>
  </div>

  <div v-else>
    <header class="app-header">
      <div class="header-left">
        <h1 class="app-title">車牌管理系統</h1>
        
        <span v-if="communityDisplayName" class="community-tag">
          📍 {{ communityDisplayName }}
        </span>
      </div>
      <button @click="handleLogout" class="logout-button">登出</button>
    </header>

    <main>
      <Dashboard 
        v-if="collectionName" 
        :key="collectionName" 
        :collection="collectionName" 
      />
    </main>
  </div>
</template>

<style>
/* --- 全域樣式 --- */
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background-color: #f0f2f5;
  margin: 0;
  touch-action: manipulation; 
}

button {
  cursor: pointer;
  padding: 10px 15px;
  border: none;
  border-radius: 5px;
  background-color: #007bff;
  color: white;
  font-size: 16px;
}

input, textarea {
  width: 100%;
  padding: 12px;
  margin: 8px 0;
  border-radius: 5px;
  border: 1px solid #ccc;
  box-sizing: border-box;
  font-size: 16px;
}

h1, h2, h3, h4 {
  text-align: center;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  background-color: white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
  margin-bottom: 20px;
}

/* 修正標題樣式，覆蓋掉全域置中的設定 */
.app-title {
  margin: 0;
  font-size: 1.2rem;
  color: #333;
  text-align: left; /* 強制靠左對齊 */
}


/* 讓標題與標籤並排的容器 */
.header-left {
  display: flex;
  align-items: center;
  gap: 12px; /* 標題與標籤之間的間距 */
}

/* 📍 區域標籤的精美樣式 */
.community-tag {
  background-color: #f0f7ff;
  color: #007bff;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: bold;
  border: 1px solid #cce5ff;
  white-space: nowrap; /* 確保在手機上文字不會斷行 */
}

.logout-button {
  background-color: #6c757d;
  color: white;
  border: none;
  padding: 8px 15px;
  border-radius: 5px;
}

main {
  max-width: 800px;
  margin: 0 auto;
  padding: 0 20px 20px 20px;
}

.login-main {
    padding-top: 40px;
}

@media (max-width: 600px) {
  .app-header {
    padding: 10px 15px;
  }
  .app-title {
    font-size: 1.1rem;
  }
}
</style>
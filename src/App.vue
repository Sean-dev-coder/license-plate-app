<script setup>
import { ref, onMounted } from 'vue'
import { auth } from './firebase.js'
import Login from './components/Login.vue'
import Dashboard from './components/Dashboard.vue'

const isLoggedIn = ref(false)
const collectionName = ref('')

onMounted(() => {
  auth.onAuthStateChanged((user) => {
    if (user) {
      // 登入成功後，從 localStorage 抓取剛才選定的後綴
      const suffix = localStorage.getItem('db_suffix') || ''
      collectionName.value = `licensePlates${suffix}`
      
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
      <h1 class="app-title">車牌管理系統</h1>
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

.app-title {
  margin: 0;
  font-size: 1.2rem;
  color: #333;
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
<script setup>
import { ref, onMounted } from 'vue'
import { auth } from './firebase.js'
import Login from './components/Login.vue'
import Dashboard from './components/Dashboard.vue'

const isLoggedIn = ref(false)
const collectionName = ref('licensePlates')
const householdName = ref('households')

onMounted(() => {
  auth.onAuthStateChanged((user) => {
    if (user) {
      isLoggedIn.value = true
      if (user.email === 'test@gmail.com') {
        collectionName.value = 'licensePlates_test'
      } else {
        collectionName.value = 'licensePlates_treasure'
        householdName.value = 'households_treasure'
      }
    } else {
      isLoggedIn.value = false
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
      <Dashboard :collection="collectionName" :household="householdName" />
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

/* --- App Header 樣式 --- */
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
  text-align: left; /* 讓標題靠左 */
}

.logout-button {
  background-color: #6c757d;
  margin: 0;
}

/* --- 主要內容區塊樣式 --- */
main {
  max-width: 800px;
  margin: 0 auto; /* 水平置中 */
  padding: 0 20px 20px 20px; /* 左右和下方留白 */
}

/* 登入頁的卡片樣式 */
.login-main {
    padding-top: 40px;
}
.login-main > div {
    max-width: 500px;
    margin: 0 auto;
    background-color: white;
    padding: 30px;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}

/* --- 響應式設計 --- */
@media (max-width: 600px) {
  main {
    padding: 0 15px 15px 15px;
  }
  .app-header {
    padding: 10px 15px;
    margin-bottom: 15px;
  }
  .app-title {
    font-size: 1.1rem;
  }
}
</style>
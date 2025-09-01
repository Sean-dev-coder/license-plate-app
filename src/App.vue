<script setup>
import { ref, onMounted } from 'vue'
import { auth } from './firebase.js' // 這是我們自己建立的 v8 auth 物件
import Login from './components/Login.vue'
import Dashboard from './components/Dashboard.vue'

const isLoggedIn = ref(false)

// v8 的正確語法是直接使用 auth 物件的方法
onMounted(() => {
  auth.onAuthStateChanged((user) => {
    isLoggedIn.value = !!user
  })
})

// v8 的正確登出語法
const handleLogout = () => {
  auth.signOut()
}
</script>

<template>
  <main>
    <div v-if="!isLoggedIn">
      <Login />
    </div>
    <div v-else>
      <Dashboard />
      <hr style="margin-top: 30px; border: 1px solid #eee;">
      <button @click="handleLogout" style="background-color: #6c757d;">登出</button>
    </div>
  </main>
</template>

<style>
/* --- 新增的響應式設計 --- */
@media (max-width: 600px) {
  body {
    /* 在手機上，讓頁面左右邊距小一點 */
    padding: 10px;
  }

  main {
    /* 在手機上，讓卡片上下左右的邊距都變小 */
    margin: 10px;
    padding: 20px;
  }

  h1, h2 {
    /* 在手機上，標題字體可以稍微小一點 */
    font-size: 1.5rem;
  }
}
</style>
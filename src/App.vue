<script setup>
import { ref, onMounted } from 'vue'
import { auth } from './firebase.js'
import Login from './components/Login.vue'
import Dashboard from './components/Dashboard.vue'

const isLoggedIn = ref(false)
const collectionName = ref('licensePlates') // 預設為正式資料

onMounted(() => {
  auth.onAuthStateChanged((user) => {
    if (user) {
      isLoggedIn.value = true
      
      if (user.email === 'test@gmail.com') {
        console.log('測試人員登入，切換到 licensePlates_test 集合')
        collectionName.value = 'licensePlates_test'
      } else {
        console.log('一般使用者登入，使用 licensePlates 集合')
        collectionName.value = 'licensePlates'
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
  <main>
    <div v-if="!isLoggedIn">
      <Login />
    </div>
    <div v-else>
      <Dashboard :collection="collectionName" />
      <hr style="margin-top: 30px; border: 1px solid #eee;">
      <button @click="handleLogout" style="background-color: #6c757d; display: block; margin: 20px auto 0;">登出</button>
    </div>
  </main>
</template>

<style>
body {
  font-family: sans-serif;
  background-color: #f0f2f5;
  margin: 0;
  padding: 10px;
}
main {
  max-width: 800px;
  margin: 20px auto;
  background-color: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
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
}
h1, h2, h3, h4 {
  text-align: center;
}
@media (max-width: 600px) {
  main {
    margin: 10px;
    padding: 15px;
  }
  h1, h2 {
    font-size: 1.5rem;
  }
}
</style>
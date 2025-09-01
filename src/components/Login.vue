<script setup>
import { ref } from 'vue'
import { auth } from '../firebase.js' // 路徑不變

const email = ref('')
const password = ref('')
const errorMessage = ref('')

// 在元件建立時，立刻嘗試從 localStorage 讀取儲存的 email
const savedEmail = localStorage.getItem('lastLoginEmail')
if (savedEmail) {
  email.value = savedEmail
}

const handleLogin = async () => {
  try {
    await auth.signInWithEmailAndPassword(email.value, password.value)
    // 登入成功後，將 email 存入 localStorage
    localStorage.setItem('lastLoginEmail', email.value)
    // 登入成功後，可以透過路由導向到主頁面
    // 例如：router.push('/dashboard');
    errorMessage.value = '';
    alert('登入成功！');
  } catch (error) {
    errorMessage.value = '登入失敗，請檢查帳號密碼。';
    console.error(error);
  }
};
</script>
<style scoped>
.login-container {
  /* 加上一些 CSS 樣式 */
}
.error {
  color: red;
}
</style>

<template>
  <div class="login-container">
    <h2>管理系統登入</h2>
    <input v-model="email" type="email" placeholder="電子郵件" />
    <input v-model="password" type="password" placeholder="密碼" />
    <button @click="handleLogin">登入</button>
    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
  </div>
</template>
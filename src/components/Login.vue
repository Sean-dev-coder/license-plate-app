<script setup>
import { ref } from 'vue'
import { auth } from '../firebase.js'

const email = ref('')
const password = ref('')
const errorMessage = ref('')

// --- 保持原本的資料集後綴選擇邏輯 ---
const selectedSuffix = ref(localStorage.getItem('db_suffix') || '') 

const suffixOptions = [
  { label: '大陸麗格', value: '' },
  { label: '大陸豐蒔', value: '_test' },
  { label: '大陸宝格', value: '_treasure' }
]

const savedEmail = localStorage.getItem('lastLoginEmail')
if (savedEmail) {
  email.value = savedEmail
}

const handleLogin = async () => {
  try {
    errorMessage.value = '';
    // 功能修正：先存入選擇的後綴
    localStorage.setItem('db_suffix', selectedSuffix.value);
    
    // 執行登入 (App.vue 會自動切換畫面)
    await auth.signInWithEmailAndPassword(email.value, password.value)
    
    localStorage.setItem('lastLoginEmail', email.value)
  } catch (error) {
    errorMessage.value = '登入失敗，請檢查帳號密碼。'
    console.error(error)
  }
};
</script>

<template>
  <div class="login-wrapper">
    <div class="login-container">
      <h2>管理系統登入</h2>

      <div class="form-group">
        <label>社區名稱</label>
        <select v-model="selectedSuffix" class="custom-input">
          <option v-for="opt in suffixOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <div class="form-group">
        <input 
          v-model="email" 
          type="email" 
          placeholder="電子郵件" 
          class="custom-input"
          @keyup.enter="handleLogin" 
        />
      </div>

      <div class="form-group">
        <input 
          v-model="password" 
          type="password" 
          placeholder="密碼" 
          class="custom-input"
          @keyup.enter="handleLogin" 
        />
      </div>

      <button @click="handleLogin" class="login-btn">登入</button>
      
      <p v-if="errorMessage" class="error-msg">{{ errorMessage }}</p>
    </div>
  </div>
</template>

<style scoped>
/* --- 完整還原你原本好的視覺設計 --- */
.login-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 80vh;
  background-color: #f5f7fa;
}

.login-container {
  width: 100%;
  max-width: 400px;
  padding: 40px;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05);
  text-align: center;
}

h2 {
  margin-bottom: 30px;
  font-size: 24px;
  color: #333;
}

.form-group {
  margin-bottom: 20px;
  text-align: left;
}

.form-group label {
  font-size: 14px;
  color: #999;
  margin-bottom: 8px;
  display: block;
}

/* 恢復原本 Input 的加大樣式與發光效果 */
.custom-input {
  width: 100%;
  height: 50px;
  padding: 0 15px;
  font-size: 16px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-sizing: border-box;
  background-color: #fff;
  transition: all 0.3s ease; /* 確保發光動畫平滑 */
}

/* 核心美化：點擊時的綠色發光邊框 */
.custom-input:focus {
  border-color: #42b983;
  box-shadow: 0 0 0 3px rgba(66, 185, 131, 0.1);
  outline: none;
}

/* 讓 Select 也有下拉箭頭 */
select.custom-input {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 15px center;
  background-size: 15px;
}

.login-btn {
  width: 100%;
  height: 50px;
  background-color: #42b983;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 18px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.3s;
}

.login-btn:hover {
  background-color: #3aa876;
}

.error-msg {
  color: #ff4d4f;
  margin-top: 20px;
  font-size: 14px;
}
</style>
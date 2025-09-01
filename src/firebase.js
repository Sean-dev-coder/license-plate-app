import firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/firestore';
import 'firebase/storage';

// 這裡貼上您之前複製的 firebaseConfig
const firebaseConfig = {
  apiKey: "AIzaSyDjGddfnSolu4rAyQc_xtsG9J9gjmYmbzk",
  authDomain: "license-plate-app-4b7d8.firebaseapp.com",
  projectId: "license-plate-app-4b7d8",
  storageBucket: "license-plate-app-4b7d8.firebasestorage.app",
  messagingSenderId: "302451412754",
  appId: "1:302451412754:web:24c75faeeb9521fdee6dcb"
};

// 初始化 Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// 匯出需要的服務
export const auth = firebase.auth();
export const db = firebase.firestore();
export const storage = firebase.storage();
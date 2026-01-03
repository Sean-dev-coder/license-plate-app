// 全部統一使用 compat 路徑
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';
import 'firebase/compat/functions'; 

const firebaseConfig = {
  apiKey: "AIzaSyDjGddfnSolu4rAyQc_xtsG9J9gjmYmbzk",
  authDomain: "license-plate-app-4b7d8.firebaseapp.com",
  projectId: "license-plate-app-4b7d8",
  storageBucket: "license-plate-app-4b7d8.firebasestorage.app",
  messagingSenderId: "302451412754",
  appId: "1:302451412754:web:24c75faeeb9521fdee6dcb"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();
const functions = firebase.functions(); 

export { auth, db, storage, functions, firebase };
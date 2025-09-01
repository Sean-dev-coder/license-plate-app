const admin = require('firebase-admin');
const fs = require('fs');
const csv = require('csv-parser');

// 1. 初始化 Firebase Admin SDK
//    請確認您的金鑰檔名和路徑正確
const serviceAccount = require('./license-plate-app-4b7d8-firebase-adminsdk-fbsvc-58ae535e25.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const results = [];

// 2. 讀取 CSV 檔案
fs.createReadStream('data.csv')
  .pipe(csv())
  .on('data', (data) => results.push(data))
  .on('end', async () => {
    console.log('CSV 檔案讀取完成，總共', results.length, '筆資料。');
    console.log('準備開始寫入 Firestore...');

    // 3. 使用批次寫入 (Batch Write)，效率更高
    const batch = db.batch();

    results.forEach((record) => {
      const docId = record.DocumentID;
      if (docId) {
        const docRef = db.collection('licensePlates').doc(docId);

        // 4. 準備要寫入的資料，並自動產生 searchKeywords
        const keywords = docId.toUpperCase().split('-').filter(Boolean);

        batch.set(docRef, {
          householdCode: record.HouseholdCode || '',
          notes: record.Notes || '',
          searchKeywords: keywords, // 自動產生搜尋關鍵字
          createdBy: 'batch-import-script',
          createdAt: new Date()
        });
        console.log(`準備寫入: ${docId}`);
      }
    });

    // 5. 提交批次寫入
    try {
      await batch.commit();
      console.log('🎉 所有資料已成功匯入 Firestore！');
    } catch (error) {
      console.error('批次寫入失敗:', error);
    }
  });
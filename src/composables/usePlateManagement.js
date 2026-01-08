import { ref, computed, watch, nextTick } from 'vue';
import { db, auth, storage } from '../firebase';

export function usePlateManagement(collectionRef, speak) {
  // --- 狀態變數 ---
  const searchPlate = ref('');
  const isLoading = ref(false);
  const message = ref('');
  const isSuccess = ref(false);
  const searchResults = ref([]);
  const selectedItem = ref(null);
  
  // 模式與表單狀態
  const searchMode = ref('plate'); // 'plate', 'household', 'parking', 'residentList', 'pending'
  const isNumericMode = ref(true);
  const showCreateForm = ref(false);
  const plateToCreate = ref('');
  const isEditing = ref(false);
  const itemBeforeEdit = ref(null);
  
  // 新戶號 Modal 狀態
  const isNewHouseholdModalOpen = ref(false);
  const householdToCreate = ref({ id: '', name: '', features: '' });
  
  // 待查數量
  const pendingCount = ref(0);

  // --- 計算屬性 (對應原本的 computed) ---
  const householdCollectionName = computed(() => {
    const suffix = collectionRef.value.replace('licensePlates', '');
    return `households${suffix}`;
  });

  const lookupCollectionName = computed(() => {
    const suffix = collectionRef.value.replace('licensePlates', '');
    return `parking_lookup${suffix}`;
  });

  // --- 輔助函式：切換模式 ---
  const changeSearchMode = (mode) => {
    searchMode.value = mode;
    message.value = '';
    // 如果是查戶號或查車位，自動切換成英文輸入
    if (mode === 'household' || mode === 'parking') {
      isNumericMode.value = false;
    } else {
      isNumericMode.value = true;
    }
  };

  // --- 功能 1: 檢查待查數量 ---
  const checkPendingCount = async () => {
    if (!collectionRef.value) return;
    try {
      const snapshot = await db.collection(collectionRef.value)
        .where('householdCode', '==', '-')
        .get();
      pendingCount.value = snapshot.size;
    } catch (e) {
      console.error("檢查待查數量失敗", e);
    }
  };

  // --- 功能 2: 載入待查清單 ---
  const handlePendingClick = async () => {
    changeSearchMode('pending');
    isLoading.value = true;
    searchResults.value = [];
    message.value = '正在載入待查清單...';

    try {
      const snapshot = await db.collection(collectionRef.value)
        .where('householdCode', '==', '-')
        .get();

      if (!snapshot.empty) {
        searchResults.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        message.value = `查詢完成，共有 ${searchResults.value.length} 筆待查資料。`;
      } else {
        message.value = '目前沒有待查資料。';
        pendingCount.value = 0;
      }
    } catch (error) {
      console.error("載入待查清單失敗:", error);
      message.value = '載入失敗';
    } finally {
      isLoading.value = false;
    }
  };

  // --- 功能 3: 選擇項目 (SelectItem) ---
  const selectItem = async (item, isVoice = false) => {
    if (!item) return;
    message.value = '正在載入詳細資料...';
    isLoading.value = true;
    
    let completeItemData = { ...item };

    // 撈取住戶資訊
    if (item.householdCode) {
      try {
        const householdDocRef = db.collection(householdCollectionName.value).doc(item.householdCode);
        const householdDocSnap = await householdDocRef.get();
        if (householdDocSnap.exists) {
          completeItemData.householdInfo = householdDocSnap.data();
        }
      } catch (error) { console.error(error); }
    }

    selectedItem.value = completeItemData;
    isEditing.value = false;
    message.value = '';
    isLoading.value = false;

    // 語音報讀邏輯
    if (isVoice && speak) {
      const plateId = item.id || '未知車牌';
      const unitCode = completeItemData.householdCode || '尚未登記戶號';
      const userName = completeItemData.householdInfo?.name ? `，住戶 ${completeItemData.householdInfo.name}` : '';
      const finalSpeechText = `查詢成功。車牌 ${plateId}。屬於 ${unitCode} ${userName}`;
      speak(finalSpeechText, true);
    }
  };

  // --- 功能 4: 核心搜尋 (HandleSearch) ---
  const handleSearch = async (isVoice = false) => {
    const fromVoice = isVoice === true;
    if (!searchPlate.value) { alert('請輸入查詢內容！'); return; }
    
    const searchInputString = searchPlate.value.toUpperCase().trim();
    searchPlate.value = ''; // 清空輸入框
    isLoading.value = true;
    searchResults.value = [];
    selectedItem.value = null;
    message.value = '';
    showCreateForm.value = false;

    try {
      let finalSearchId = searchInputString;
      let targetMode = searchMode.value;

      // 4-1. 查車位 (Parking -> Household)
      if (searchMode.value === 'parking') {
        const lookupDoc = await db.collection(lookupCollectionName.value).doc(searchInputString).get();
        if (lookupDoc.exists) {
          finalSearchId = lookupDoc.data().ownerId;
          searchMode.value = 'household'; // 自動切換模式
          targetMode = 'household';
          const msg = `車位搜尋成功，正在導向戶號：${finalSearchId}`;
          message.value = msg;
          if (fromVoice && speak) speak(msg);
        } else {
          const errorMsg = `查無車位「${searchInputString}」`;
          message.value = errorMsg;
          if (fromVoice && speak) speak(errorMsg);
          isLoading.value = false;
          return;
        }
      }

      let querySnapshot;
      
      // 4-2. 查戶號 (Household)
      if (targetMode === 'household') {
        querySnapshot = await db.collection(collectionRef.value).where('householdCode', '==', finalSearchId).get();
        if (querySnapshot.empty) {
          if (fromVoice && speak) speak(`查無戶號 ${finalSearchId}`);
          // 開啟建立新戶號 Modal
          householdToCreate.value = { id: finalSearchId, name: '', features: '' };
          isNewHouseholdModalOpen.value = true;
        }
      } 
      // 4-3. 查車牌 (Plate)
      else {
        // [修正] 改回原本的邏輯：只有包含 "-" 才是精確 ID 搜尋，否則都走模糊搜尋
        if (finalSearchId.includes('-') && !finalSearchId.includes(' ')) {
           const docRef = db.collection(collectionRef.value).doc(finalSearchId);
           const docSnap = await docRef.get();
           if (docSnap.exists) {
             const result = { id: docSnap.id, ...docSnap.data() };
             searchResults.value = [result];
             selectItem(result, fromVoice); // 自動選取
           } else {
             const msg = `查無車牌 ${finalSearchId}`;
             message.value = msg;
             if (fromVoice && speak) speak(msg);
             showCreateForm.value = true;
             plateToCreate.value = finalSearchId;
             selectedItem.value = { householdCode: '', notes: '' };
           }
           isLoading.value = false;
           return;
        } else {
           // 模糊搜尋 (關鍵字)：這才是 "1668" 應該走的路
           const searchTerms = finalSearchId.split(' ').filter(term => term.length > 0);
           querySnapshot = await db.collection(collectionRef.value)
             .where('searchKeywords', 'array-contains-any', searchTerms)
             .get();
        }
      }

      // 處理搜尋結果
      if (querySnapshot && !querySnapshot.empty) {
        searchResults.value = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (searchResults.value.length === 1) {
          selectItem(searchResults.value[0], fromVoice);
        } else {
          if (fromVoice && speak) speak(`找到 ${searchResults.value.length} 筆資料`);
        }
      } else if (!showCreateForm.value && !searchResults.value.length && !isNewHouseholdModalOpen.value) {
         if (fromVoice && speak) speak(`查無 ${searchInputString} 的資料`);
      }

    } catch (error) {
      console.error(error);
      if (fromVoice && speak) speak("系統查詢出錯");
    } finally {
      isLoading.value = false;
    }
  };

  // --- 功能 5: 編輯與儲存 ---
  const enterEditMode = () => {
    itemBeforeEdit.value = JSON.parse(JSON.stringify(selectedItem.value));
    isEditing.value = true;
  };

  const cancelEdit = () => {
    selectedItem.value = { ...itemBeforeEdit.value };
    isEditing.value = false;
  };

  const saveAllChanges = async () => {
    if (!selectedItem.value || !selectedItem.value.id) return;
    isLoading.value = true;

    try {
      const batch = db.batch();
      const plateDocRef = db.collection(collectionRef.value).doc(selectedItem.value.id);
      const householdDocRef = db.collection(householdCollectionName.value).doc(selectedItem.value.householdCode);

      // 處理車位索引變更
      const oldParkingStr = itemBeforeEdit.value.householdInfo?.parking_number || '';
      const oldParkingArray = oldParkingStr.split('/').map(s => s.trim()).filter(Boolean);
      
      const newParkingStr = selectedItem.value.householdInfo.parking_number || '';
      const newParkingArray = newParkingStr.split('/').map(s => s.trim()).filter(Boolean);
      
      const spotsToDelete = oldParkingArray.filter(spot => !newParkingArray.includes(spot));

      // 更新資料物件
      const plateData = {
        householdCode: selectedItem.value.householdCode,
        notes: selectedItem.value.notes,
        lastUpdatedBy: auth.currentUser?.email || 'admin',
        updatedAt: new Date()
      };
      
      const householdData = {
        name: selectedItem.value.householdInfo.name || '',
        features: selectedItem.value.householdInfo.features || '',
        parking_number: newParkingStr,
        parking: newParkingArray
      };

      batch.update(plateDocRef, plateData);
      batch.set(householdDocRef, householdData, { merge: true });

      // 刪除舊車位索引
      spotsToDelete.forEach(spot => {
        const lookupRef = db.collection(lookupCollectionName.value).doc(spot.toUpperCase());
        batch.delete(lookupRef);
      });

      // 新增/更新新車位索引
      newParkingArray.forEach(spot => {
        const lookupRef = db.collection(lookupCollectionName.value).doc(spot.toUpperCase());
        batch.set(lookupRef, { 
          ownerId: selectedItem.value.householdCode,
          updatedAt: new Date()
        }, { merge: true });
      });

      await batch.commit();

      message.value = '資料儲存成功！';
      isSuccess.value = true;
      isEditing.value = false;
      
      // 更新列表中的顯示
      const index = searchResults.value.findIndex(item => item.id === selectedItem.value.id);
      if (index !== -1) searchResults.value[index] = { ...selectedItem.value };

    } catch (error) {
      console.error("儲存失敗:", error);
      message.value = '儲存失敗';
      isSuccess.value = false;
    } finally {
      isLoading.value = false;
      checkPendingCount();
    }
  };

  // --- 功能 6: 新增車牌 ---
  const handleCreate = async () => {
    if (!plateToCreate.value) return;
    isLoading.value = true;
    try {
      const docRef = db.collection(collectionRef.value).doc(plateToCreate.value);
      const keywords = plateToCreate.value.toUpperCase().split('-').filter(Boolean);
      const dataToCreate = { 
        householdCode: (selectedItem.value.householdCode || '').toUpperCase(), 
        notes: selectedItem.value.notes, 
        createdBy: auth.currentUser?.email, 
        createdAt: new Date(), 
        searchKeywords: keywords, 
        imageUrl: '' 
      };
      await docRef.set(dataToCreate);
      message.value = `車牌「${plateToCreate.value}」新增成功！`;
      isSuccess.value = true;
      showCreateForm.value = false;
      selectedItem.value = null;
      searchPlate.value = plateToCreate.value;
      handleSearch(); // 新增完自動查一次
    } catch (error) {
      console.error("新增失敗:", error);
      message.value = '新增失敗';
    } finally {
      isLoading.value = false;
      checkPendingCount();
    }
  };

  // --- 功能 7: 建立新戶號 ---
  const handleHouseholdCreate = async () => {
    if (!householdToCreate.value.id) { alert('戶號不能為空！'); return; }
    isLoading.value = true;
    try {
      const docRef = db.collection(householdCollectionName.value).doc(householdToCreate.value.id);
      await docRef.set({
        name: householdToCreate.value.name || '',
        features: householdToCreate.value.features || ''
      });
      message.value = `戶號「${householdToCreate.value.id}」建立成功！`;
      isSuccess.value = true;
      isNewHouseholdModalOpen.value = false;
    } catch (error) {
      console.error("建立住戶失敗:", error);
      message.value = '建立住戶失敗';
    } finally {
      isLoading.value = false;
    }
  };

  // --- 功能 8: 刪除資料 ---
  const handleDelete = async () => {
    if (!selectedItem.value || !selectedItem.value.id) return;
    if (!window.confirm(`確定要永久刪除車牌「${selectedItem.value.id}」嗎？`)) return;
    isLoading.value = true;

    try {
      const batch = db.batch();
      
      // 清理車位索引
      const parkingStr = selectedItem.value.householdInfo?.parking_number || '';
      const parkingArray = parkingStr.split('/').map(s => s.trim()).filter(Boolean);
      parkingArray.forEach(spot => {
        const lookupRef = db.collection(lookupCollectionName.value).doc(spot.toUpperCase());
        batch.delete(lookupRef);
      });

      // 刪除車牌
      const plateRef = db.collection(collectionRef.value).doc(selectedItem.value.id);
      batch.delete(plateRef);

      // 圖片刪除 (獨立處理)
      if (selectedItem.value.imageUrl) {
        try {
           const imageRef = storage.refFromURL(selectedItem.value.imageUrl);
           await imageRef.delete();
        } catch(e) { console.warn("圖片刪除失敗或不存在"); }
      }

      await batch.commit();
      message.value = '刪除成功';
      isSuccess.value = true;
      searchResults.value = searchResults.value.filter(item => item.id !== selectedItem.value.id);
      selectedItem.value = null;
    } catch (error) {
      console.error("刪除失敗:", error);
      message.value = '刪除失敗';
    } finally {
      isLoading.value = false;
      checkPendingCount();
    }
  };
  
  // --- 功能 9: 同步舊車位資料 (維護用) ---
  const syncExistingParkingData = async () => {
    const targetLookup = lookupCollectionName.value;
    if (!window.confirm(`即將掃描所有資料並重建「${targetLookup}」，確定嗎？`)) return;
    isLoading.value = true;
    message.value = '正在同步車位索引...';

    try {
      const batch = db.batch();
      const snapshot = await db.collection(householdCollectionName.value).get();
      let count = 0;
      snapshot.forEach(doc => {
        const data = doc.data();
        const parkingArray = data.parking_number ? data.parking_number.split('/').map(s => s.trim()).filter(Boolean) : [];
        parkingArray.forEach(spot => {
          const lookupRef = db.collection(targetLookup).doc(spot.toUpperCase());
          batch.set(lookupRef, { 
             ownerId: doc.id, 
             updatedAt: new Date(),
             note: "系統自動維護"
          }, { merge: true });
          count++;
        });
      });
      await batch.commit();
      message.value = `同步完成！共處理 ${count} 個車位。`;
      isSuccess.value = true;
    } catch (error) {
      console.error(error);
      message.value = '同步失敗';
    } finally {
      isLoading.value = false;
    }
  };

  // --- 監聽 Collection 變更，自動重算待查數量 ---
  watch(collectionRef, () => {
     checkPendingCount();
     // 切換社區時，重置搜尋模式為查車牌
     changeSearchMode('plate');
  }, { immediate: true });

  return {
    // 狀態
    searchPlate, isLoading, message, isSuccess, searchResults, selectedItem,
    searchMode, isNumericMode, showCreateForm, plateToCreate, isEditing,
    isNewHouseholdModalOpen, householdToCreate, pendingCount,
    householdCollectionName, lookupCollectionName, itemBeforeEdit,
    
    // 方法
    handleSearch, selectItem, changeSearchMode, handlePendingClick,
    enterEditMode, cancelEdit, saveAllChanges, handleCreate,
    handleHouseholdCreate, handleDelete, syncExistingParkingData,
    checkPendingCount
  };
}
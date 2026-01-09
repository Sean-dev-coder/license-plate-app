// src/utils/textUtils.js

// 語音校正字典
const typoMap = {
  '茶尋': '查詢', '茶行': '查詢', '查尋': '查詢', '搜尋': '查詢', '查': '查詢', '尋找': '查詢',
  '一': '1', '妖': '1', '么': '1', '要': '1', '依': '1',
  '二': '2', '愛': '2', '餓': '2', '兩': '2',
  '三': '3', '山': '3', '散': '3',
  '四': '4', '是': '4', '世': '4',
  '五': '5', '舞': '5', '無': '5',
  '六': '6', '溜': '6', '路': '6',
  '七': '7', '去': '7', '起': '7', '氣': '7', '拐': '7',
  '八': '8', '巴': '8', '發': '8', '爸': '8',
  '九': '9', '酒': '9', '久': '9', '勾': '9',
  '洞': '0', '動': '0', '孔': '0', '懂': '0', '零': '0',
  // ... (保留你原本完整的 A-Z 對應表) ...
  'A': 'A', 'ㄟ': 'A', 'B': 'B', '逼': 'B', // 請自行補完你原本的清單以節省版面
  '還有': ' ', '以及': ' ', '再來': ' ', '下一台': ' ', '接著': ' ', '和': ' ', '跟': ' ', '空白': ' ', 'SPACE': ' ', '個': ' ', '、': ' ', '，': ' '
};

// 校正輔助函式
export const correctTranscript = (text) => {
  let corrected = text;
  Object.keys(typoMap).forEach(key => {
    const regex = new RegExp(key, 'g');
    corrected = corrected.replace(regex, typoMap[key]);
  });
  return corrected.toUpperCase().replace(/[^\w\s\u4e00-\u9fa5]/g, '');
};

// 車牌整形
export const formatLicensePlate = (input) => {
  let clean = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^\d+$/.test(clean)) return clean;
  if (/^\d+[A-Z]+$/.test(clean)) return clean.replace(/^(\d+)([A-Z]+)$/, '$1-$2');
  if (/^[A-Z]+\d+$/.test(clean)) return clean.replace(/^([A-Z]+)(\d+)$/, '$1-$2');
  return clean;
};

// 批次提取
export const extractBatchPlates = (text) => {
  let content = text.split('查詢').pop() || "";
  let tokens = content.split(/[^A-Z0-9]/).filter(t => t.length > 0);
  let results = [];
  tokens.forEach(token => {
    if (token.length >= 2) {
      results.push(formatLicensePlate(token));
    }
  });
  return results;
};
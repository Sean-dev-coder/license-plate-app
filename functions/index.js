// 使用二代函式的標準寫法
const { onCall } = require("firebase-functions/v2/https");
const textToSpeech = require('@google-cloud/text-to-speech');
const client = new textToSpeech.TextToSpeechClient();

exports.getHighQualityVoice = onCall(async (request) => {
  // --- 【二代函式關鍵】資料是在 request.data 裡面 ---
  const speechText = request.data.text;
  
  console.log('--- 收到報讀請求 ---');
  console.log('實際收到的文字內容:', speechText);

  // 防呆檢查
  if (!speechText || speechText.trim() === "") {
    console.error('錯誤：收到空文字');
    // 這就是您在截圖中看到的報錯來源
    throw new Error('文字內容不能為空'); 
  }

  const ttsRequest = {
    input: { text: speechText },
    voice: { languageCode: 'cmn-TW', name: 'cmn-TW-Wavenet-A' },
    audioConfig: { 
      audioEncoding: 'MP3', 
      pitch: 1.1, 
      speakingRate: 0.85 
    },
  };

  try {
    const [response] = await client.synthesizeSpeech(ttsRequest);
    console.log('語音生成成功');
    return { audioContent: response.audioContent.toString('base64') };
  } catch (error) {
    console.error('Google TTS API 報錯:', error.message);
    throw new Error(`TTS 引擎錯誤: ${error.message}`);
  }
});
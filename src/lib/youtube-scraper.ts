// YouTube 웹 스크래핑 기반 대체 수집 방법
// 이 모듈은 API 할당량 초과 시 웹 스크래핑을 통해 기본적인 정보를 수집합니다

export interface ScrapedVideoInfo {
  title?: string;
  viewCount?: number;
  isLive?: boolean;
  concurrentViewers?: number;
  likeCount?: number;
  duration?: string;
}

export interface ScrapedChannelInfo {
  subscriberCount?: number;
  isLive?: boolean;
  videoCount?: number;
}

// 웹 스크래핑 기반 시청자 수 추출
export async function scrapeConcurrentViewers(videoId: string): Promise<number | null> {
  try {
    // 개발 환경에서만 로그 출력
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[YouTube Scraper] 시청자 수 스크래핑 시도: ${videoId}`);
    }
    
    // CORS 우회를 위한 프록시 서버 사용 (선택적)
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
    
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[YouTube Scraper] 프록시 요청 실패: ${response.status}`);
      }
      return null;
    }
    
    const data = await response.json();
    const html = data.contents;
    
    // 정규식을 통한 시청자 수 추출
    const patterns = [
      /"concurrentViewers":\s*"([^"]+)"/,
      /"viewCount":\s*{[^}]*"text":\s*"([^"]+)"/,
      /"videoViewCountRenderer":\s*{[^}]*"viewCount":\s*{[^}]*"simpleText":\s*"([^"]+)"/,
      /"liveViewers":\s*"([^"]+)"/
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const viewerText = match[1];
        const viewers = parseViewerCount(viewerText);
        if (viewers !== null) {
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[YouTube Scraper] 시청자 수 추출 성공: ${viewers}`);
          }
          return viewers;
        }
      }
    }
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[YouTube Scraper] 시청자 수 추출 실패: 패턴 매칭 없음`);
    }
    return null;
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[YouTube Scraper] 시청자 수 추출 오류:`, error);
    }
    return null;
  }
}

// 웹 스크래핑 기반 라이브 채팅 ID 추출
export async function scrapeLiveChatId(videoId: string): Promise<string | null> {
  try {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[YouTube Scraper] 라이브 채팅 ID 스크래핑 시도: ${videoId}`);
    }
    
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
    
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[YouTube Scraper] 라이브 채팅 ID 프록시 요청 실패: ${response.status}`);
      }
      return null;
    }
    
    const data = await response.json();
    const html = data.contents;
    
    // 라이브 채팅 ID 추출 패턴
    const patterns = [
      /"activeLiveChatId":"([^"]+)"/,
      /"liveChatId":"([^"]+)"/,
      /"liveChatRenderer":\s*{[^}]*"liveChatId":"([^"]+)"/
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const chatId = match[1];
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[YouTube Scraper] 라이브 채팅 ID 추출 성공: ${chatId}`);
        }
        return chatId;
      }
    }
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[YouTube Scraper] 라이브 채팅 ID 추출 실패: 패턴 매칭 없음`);
    }
    return null;
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[YouTube Scraper] 라이브 채팅 ID 추출 오류:`, error);
    }
    return null;
  }
}

// 시청자 수 텍스트 파싱
function parseViewerCount(text: string): number | null {
  if (!text) return null;
  
  // "1,234" -> 1234
  const cleanText = text.replace(/,/g, '');
  
  // "1.2K" -> 1200
  const kMatch = cleanText.match(/([\d.]+)\s*K/i);
  if (kMatch) {
    return Math.floor(parseFloat(kMatch[1]) * 1000);
  }
  
  // "1.2M" -> 1200000
  const mMatch = cleanText.match(/([\d.]+)\s*M/i);
  if (mMatch) {
    return Math.floor(parseFloat(mMatch[1]) * 1000000);
  }
  
  // 숫자만 있는 경우
  const numMatch = cleanText.match(/(\d+)/);
  if (numMatch) {
    return parseInt(numMatch[1], 10);
  }
  
  return null;
}
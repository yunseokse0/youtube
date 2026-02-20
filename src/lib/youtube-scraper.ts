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
    console.log(`[YouTube Scraper] 시청자 수 스크래핑 시도: ${videoId}`);
    
    // CORS 우회를 위한 프록시 서버 사용 (선택적)
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
    
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      console.log(`[YouTube Scraper] 프록시 요청 실패: ${response.status}`);
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
          console.log(`[YouTube Scraper] 시청자 수 추출 성공: ${viewers}`);
          return viewers;
        }
      }
    }
    
    console.log(`[YouTube Scraper] 시청자 수 추출 실패`);
    return null;
  } catch (error) {
    console.error(`[YouTube Scraper] 스크래핑 오류:`, error);
    return null;
  }
}

// 웹 스크래핑 기반 라이브 채팅 ID 추출
export async function scrapeLiveChatId(videoId: string): Promise<string | null> {
  try {
    console.log(`[YouTube Scraper] 라이브 채팅 ID 스크래핑 시도: ${videoId}`);
    
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
    
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      console.log(`[YouTube Scraper] 프록시 요청 실패: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const html = data.contents;
    
    // 라이브 채팅 ID 추출 패턴
    const patterns = [
      /"liveChatRenderer":\s*{[^}]*"liveChatId":\s*"([^"]+)"/,
      /"activeLiveChatId":\s*"([^"]+)"/,
      /"liveChatId":\s*"([^"]+)"/
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const chatId = match[1];
        console.log(`[YouTube Scraper] 라이브 채팅 ID 추출 성공: ${chatId}`);
        return chatId;
      }
    }
    
    console.log(`[YouTube Scraper] 라이브 채팅 ID 추출 실패`);
    return null;
  } catch (error) {
    console.error(`[YouTube Scraper] 스크래핑 오류:`, error);
    return null;
  }
}

// oEmbed API를 통한 기본 정보 수집 (할당량 소모 없음)
export async function fetchOEmbedInfo(videoId: string): Promise<ScrapedVideoInfo | null> {
  try {
    console.log(`[YouTube oEmbed] oEmbed 정보 요청: ${videoId}`);
    
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    
    const response = await fetch(oembedUrl);
    if (!response.ok) {
      console.log(`[YouTube oEmbed] 요청 실패: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    return {
      title: data.title,
      isLive: data.title?.toLowerCase().includes('live') || false
    };
  } catch (error) {
    console.error(`[YouTube oEmbed] 오류:`, error);
    return null;
  }
}

// YouTube Data API v3의 할당량 효율적인 엔드포인트 사용
export async function fetchVideoInfoLite(videoId: string): Promise<ScrapedVideoInfo | null> {
  try {
    console.log(`[YouTube Lite] 경량 정보 요청: ${videoId}`);
    
    // iFrame API를 통한 기본 정보 수집
    const iframeUrl = `https://www.youtube.com/embed/${videoId}`;
    const response = await fetch(iframeUrl);
    
    if (!response.ok) {
      console.log(`[YouTube Lite] 요청 실패: ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    
    // 기본 정보 추출
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(' - YouTube', '') : undefined;
    
    return {
      title,
      isLive: title?.toLowerCase().includes('live') || false
    };
  } catch (error) {
    console.error(`[YouTube Lite] 오류:`, error);
    return null;
  }
}

// 시청자 수 텍스트 파싱
function parseViewerCount(text: string): number | null {
  if (!text) return null;
  
  // "1,234 watching", " watching" 등의 형식 처리
  const cleaned = text.toLowerCase().replace(/watching|watch|시청| viewers| viewer/g, '').trim();
  
  // 숫자와 쉼표만 남기기
  const numberStr = cleaned.replace(/[^\d,]/g, '');
  if (!numberStr) return null;
  
  try {
    return parseInt(numberStr.replace(/,/g, ''), 10);
  } catch {
    return null;
  }
}

// 채널 정보 스크래핑
export async function scrapeChannelInfo(channelId: string): Promise<ScrapedChannelInfo | null> {
  try {
    console.log(`[YouTube Scraper] 채널 정보 스크래핑 시도: ${channelId}`);
    
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://www.youtube.com/channel/${channelId}`)}`;
    
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      console.log(`[YouTube Scraper] 채널 프록시 요청 실패: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const html = data.contents;
    
    // 구독자 수 추출
    const subscriberMatch = html.match(/"subscriberCountText":\s*{[^}]*"simpleText":\s*"([^"]+)"/);
    const subscriberCount = subscriberMatch ? parseViewerCount(subscriberMatch[1]) : undefined;
    
    // 라이브 상태 확인
    const isLive = html.toLowerCase().includes('live now') || html.toLowerCase().includes('streaming now');
    
    return {
      subscriberCount: subscriberCount || undefined,
      isLive
    };
  } catch (error) {
    console.error(`[YouTube Scraper] 채널 스크래핑 오류:`, error);
    return null;
  }
}

// 복합 전략: API → 스크래핑 → oEmbed 순서로 시도
export async function fetchVideoInfoWithFallback(videoId: string): Promise<ScrapedVideoInfo | null> {
  // 1. 먼저 oEmbed 시도 (할당량 소모 없음)
  const oembedInfo = await fetchOEmbedInfo(videoId);
  if (oembedInfo?.isLive) {
    // 2. 라이브인 경우 스크래핑으로 시청자 수 시도
    const scrapedViewers = await scrapeConcurrentViewers(videoId);
    return {
      ...oembedInfo,
      concurrentViewers: scrapedViewers || undefined
    };
  }
  
  // 3. 일반 영상인 경우 기본 정보만 반환
  return oembedInfo;
}
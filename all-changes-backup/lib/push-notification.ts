// 브라우저 푸시 알림 유틸리티

interface NotificationAction {
  action: string;
  title: string;
  icon?: string;
}

export interface PushNotificationOptions {
  title: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  requireInteraction?: boolean;
  silent?: boolean;
}

// 푸시 알림 권한 상태
export type NotificationPermission = 'granted' | 'denied' | 'default';

// 푸시 알림 권한 요청
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    console.log('[Push Notification] 이 브라우저는 푸시 알림을 지원하지 않습니다');
    return 'denied';
  }

  try {
    const permission = await Notification.requestPermission();
    console.log(`[Push Notification] 권한 요청 결과: ${permission}`);
    return permission;
  } catch (error) {
    console.error('[Push Notification] 권한 요청 중 오류:', error);
    return 'denied';
  }
}

// 현재 푸시 알림 권한 확인
export function getNotificationPermission(): NotificationPermission {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

// 푸시 알림 표시
export async function showNotification(options: PushNotificationOptions): Promise<void> {
  if (!('Notification' in window)) {
    console.log('[Push Notification] 이 브라우저는 푸시 알림을 지원하지 않습니다');
    return;
  }

  // 권한 확인
  if (Notification.permission !== 'granted') {
    console.log('[Push Notification] 푸시 알림 권한이 없습니다');
    return;
  }

  try {
    const notificationOptions: NotificationOptions = {
      body: options.body,
      icon: options.icon || '/favicon.ico'
    };
    
    // 선택적 속성 추가 (브라우저 호환성 고려)
    if (options.tag) notificationOptions.tag = options.tag;
    if (options.requireInteraction) notificationOptions.requireInteraction = options.requireInteraction;
    if (options.silent !== undefined) notificationOptions.silent = options.silent;
    if (options.badge) notificationOptions.badge = options.badge;
    
    const notification = new Notification(options.title, notificationOptions);

    // 알림 클릭 이벤트
    notification.onclick = (event) => {
      console.log('[Push Notification] 알림 클릭됨:', event);
      // 창 포커스 또는 새 탭 열기
      if (window.parent) {
        window.parent.focus();
      } else {
        window.focus();
      }
      notification.close();
    };

    // 알림 닫기 이벤트
    notification.onclose = () => {
      console.log('[Push Notification] 알림 닫힘');
    };

    // 알림 표시 이벤트
    notification.onshow = () => {
      console.log('[Push Notification] 알림 표시됨');
    };

    // 알림 에러 이벤트
    notification.onerror = (event) => {
      console.error('[Push Notification] 알림 에러:', event);
    };

  } catch (error) {
    console.error('[Push Notification] 알림 표시 중 오류:', error);
  }
}

// 금칙어 감지 알림
export async function showForbidWordAlert(word: string, author: string, message: string): Promise<void> {
  await showNotification({
    title: `🚫 금칙어 감지: "${word}"`,
    body: `${author}: ${message}`,
    icon: '/warning-icon.png',
    badge: '/warning-badge.png',
    tag: 'forbid-word',
    requireInteraction: true
  });
}

// 시청자 수 급증 알림
export async function showViewerSpikeAlert(currentViewers: number, increase: number): Promise<void> {
  await showNotification({
    title: `📈 시청자 수 급증!`,
    body: `현재 ${currentViewers.toLocaleString()}명 시청 중 (+${increase.toLocaleString()})`,
    icon: '/trending-icon.png',
    badge: '/trending-badge.png',
    tag: 'viewer-spike'
  });
}

// 라이브 방송 시작 알림
export async function showLiveStartAlert(streamTitle: string): Promise<void> {
  await showNotification({
    title: `🔴 라이브 방송 시작!`,
    body: streamTitle,
    icon: '/live-icon.png',
    badge: '/live-badge.png',
    tag: 'live-start',
    requireInteraction: true
  });
}

// 알림 설정 저장/불러오기
const NOTIFICATION_SETTINGS_KEY = 'youtube_notification_settings';

export interface NotificationSettings {
  enabled: boolean;
  forbidWord: boolean;
  viewerSpike: boolean;
  liveStart: boolean;
  viewerSpikeThreshold: number; // 시청자 수 급증 기준치
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  forbidWord: true,
  viewerSpike: true,
  liveStart: true,
  viewerSpikeThreshold: 1000 // 1000명 이상 증가 시 알림
};

// 알림 설정 저장
export function saveNotificationSettings(settings: NotificationSettings): void {
  try {
    localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
    console.log('[Push Notification] 알림 설정 저장됨');
  } catch (error) {
    console.error('[Push Notification] 설정 저장 중 오류:', error);
  }
}

// 알림 설정 불러오기
export function loadNotificationSettings(): NotificationSettings {
  try {
    const saved = localStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (saved) {
      return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (error) {
    console.error('[Push Notification] 설정 불러오기 중 오류:', error);
  }
  return DEFAULT_NOTIFICATION_SETTINGS;
}

// 푸시 알림 서비스 워커 등록 (향후 확장용)
export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    console.log('[Push Notification] 이 브라우저는 서비스 워커를 지원하지 않습니다');
    return;
  }

  try {
    // 서비스 워커 파일 경로는 프로젝트 루트의 public 폴더에 위치해야 함
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    console.log('[Push Notification] 서비스 워커 등록 성공:', registration);
  } catch (error) {
    console.error('[Push Notification] 서비스 워커 등록 실패:', error);
  }
}
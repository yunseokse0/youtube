import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.finalent.app',
  appName: 'FinalEnt',
  webDir: 'www',
  server: {
    url: 'https://youtube-5g1a.onrender.com',
    cleartext: false
  }
};

export default config;

// storage.js — Chrome local storage helpers

export const Storage = {
  async get(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  },

  async set(data) {
    return new Promise(resolve => chrome.storage.local.set(data, resolve));
  },

  async getSettings() {
    const data = await this.get([
      'provider', 'anthropicKey', 'openaiKey', 'geminiKey',
      'watchedMembers', 'communityUrl', 'lastDigest', 'lastDigestDate',
    ]);
    return {
      provider:       data.provider       || 'anthropic',
      anthropicKey:   data.anthropicKey   || '',
      openaiKey:      data.openaiKey      || '',
      geminiKey:      data.geminiKey      || '',
      watchedMembers: data.watchedMembers || [],
      communityUrl:   data.communityUrl   || 'https://www.skool.com/earlyaidopters?c=&s=newest&fl=',
      lastDigest:     data.lastDigest     || null,
      lastDigestDate: data.lastDigestDate || null,
    };
  },

  async saveSettings(s) {
    await this.set({
      provider:       s.provider,
      anthropicKey:   s.anthropicKey,
      openaiKey:      s.openaiKey,
      geminiKey:      s.geminiKey,
      watchedMembers: s.watchedMembers,
      communityUrl:   s.communityUrl,
    });
  },

  async saveDigest(digest) {
    await this.set({ lastDigest: digest, lastDigestDate: new Date().toDateString() });
  },

  async getCachedDigest() {
    const data = await this.get(['lastDigest', 'lastDigestDate']);
    if (data.lastDigestDate === new Date().toDateString() && data.lastDigest) {
      return data.lastDigest;
    }
    return null;
  },

  getActiveKey(settings) {
    if (settings.provider === 'openai')  return settings.openaiKey;
    if (settings.provider === 'gemini')  return settings.geminiKey;
    return settings.anthropicKey;
  },
};

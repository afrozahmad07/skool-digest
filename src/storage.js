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
      'watchedMembers', 'lastDigest', 'lastDigestDate',
    ]);
    return {
      provider:       data.provider       || 'anthropic',
      anthropicKey:   data.anthropicKey   || '',
      openaiKey:      data.openaiKey      || '',
      geminiKey:      data.geminiKey      || '',
      watchedMembers: data.watchedMembers || [],
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
    });
  },

  // Derive a safe storage key from a community URL
  // e.g. https://www.skool.com/earlyaidopters?s=newest → "earlyaidopters"
  communityKey(url) {
    try {
      const slug = new URL(url).pathname.replace(/\//g, '').trim();
      return slug || 'default';
    } catch {
      return 'default';
    }
  },

  // Extract a readable community name from URL
  communityName(url) {
    try {
      const slug = new URL(url).pathname.replace(/\//g, '').trim();
      return slug || url;
    } catch {
      return url || 'Unknown Community';
    }
  },

  async saveDigest(digest, pageUrl) {
    const key = this.communityKey(pageUrl);
    digest._communityUrl  = pageUrl;
    digest._communityName = this.communityName(pageUrl);
    await this.set({
      [`digest_${key}`]:     digest,
      [`digestDate_${key}`]: new Date().toDateString(),
    });
  },

  async getCachedDigest(pageUrl) {
    const key  = this.communityKey(pageUrl);
    const data = await this.get([`digest_${key}`, `digestDate_${key}`]);
    if (data[`digestDate_${key}`] === new Date().toDateString() && data[`digest_${key}`]) {
      return data[`digest_${key}`];
    }
    return null;
  },

  getActiveKey(settings) {
    if (settings.provider === 'openai')  return settings.openaiKey;
    if (settings.provider === 'gemini')  return settings.geminiKey;
    return settings.anthropicKey;
  },
};

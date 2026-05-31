var api = require('../../utils/api');
Page({
  data: { apiBase: 'http://localhost:3000/api', version: '1.0.0' },
  onLoad: function() { this.setData({ apiBase: getApp().globalData.apiBase }); },
  onApiBaseInput: function(e) { this.setData({ apiBase: e.detail.value }); },
  saveSettings: function() {
    getApp().globalData.apiBase = this.data.apiBase;
    wx.setStorageSync('apiBase', this.data.apiBase);
    wx.showToast({ title: '保存成功', icon: 'success' });
  },
  clearCache: function() {
    wx.showModal({ title: '确认', content: '清除所有本地缓存？', success: function(r) { if (r.confirm) { wx.clearStorageSync(); wx.showToast({ title: '已清除', icon: 'success' }); } } });
  },
  checkHealth: function() {
    api.health().then(function() { wx.showToast({ title: '后端连接正常', icon: 'success' }); }).catch(function() { wx.showToast({ title: '后端连接失败', icon: 'none' }); });
  }
});
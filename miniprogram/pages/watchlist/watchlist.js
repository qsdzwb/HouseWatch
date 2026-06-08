var api = require('../../utils/api');

Page({
  data: {
    list: []
  },

  onLoad: function() {
    this.loadWatchlist();
  },

  onShow: function() {
    this.loadWatchlist();
  },

  onPullDownRefresh: function() {
    this.loadWatchlist().then(function() { wx.stopPullDownRefresh(); });
  },

  loadWatchlist: function() {
    var self = this;
    return api.getWatchlist(true).then(function(res) {
      var items = (res.data && res.data.items) ? res.data.items : [];
      var watchedIds = new Set();
      items = items.map(function(item) {
        item.showStats = (item.total_units > 0);
        if (item.showStats) {
          item.rate = item.total_units > 0
            ? (item.sold_units / item.total_units * 100).toFixed(1) + '%'
            : '0%';
        }
        // 均价格式化：元/㎡ → 万元/㎡
        if (item.avg_price && item.avg_price > 1000) {
          item.avgPriceText = (item.avg_price / 10000).toFixed(2) + '万/㎡';
        } else if (item.avg_price && item.avg_price > 0) {
          item.avgPriceText = Math.round(item.avg_price) + '元/㎡';
        } else {
          item.avgPriceText = '';
        }
        if (item.project_id) watchedIds.add(item.project_id);
        return item;
      });
      self.setData({ list: items, watchedIds: watchedIds });
    }).catch(function() {
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  goDetail: function(e) {
    var projectId = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/project-detail/project-detail?id=' + projectId });
  },

  goToProjects: function() {
    wx.switchTab({ url: '/pages/projects/projects' });
  }
});

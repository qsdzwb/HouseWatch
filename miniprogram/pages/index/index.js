var api = require('../../utils/api');
Page({
  data: {
    today: {},
    overview: {},
    weeklyTrend: {},
    latestChanges: [],
    lastCrawl: null
  },
  onLoad: function() { this.loadData(); },
  onPullDownRefresh: function() { this.loadData().then(function() { wx.stopPullDownRefresh(); }); },
  loadData: function() {
    var self = this;
    return api.getDashboard().then(function(res) {
      var d = res.data || {};

      // 今日概览
      var today = d.today || {};
      if (today.avgDealPrice) {
        today.avgPriceDisplay = (today.avgDealPrice / 10000).toFixed(1) + '万';
      } else {
        today.avgPriceDisplay = '-';
      }

      // 近7日趋势
      var t = d.weeklyTrend || {};
      if (t.counts && t.counts.length) {
        var mx = Math.max.apply(null, t.counts);
        t.dates = (t.dates || []).map(function(d2) { return d2 && d2.slice ? d2.slice(5) : d2; });
        t.max = mx || 1;
      }

      // 最新变化
      var changes = (d.latestChanges || []).map(function(c) {
        c.change_type = (c.new_status === '已签约' && c.old_status !== '已签约') ? 'new_sale' : 'status_change';
        return c;
      });

      self.setData({
        today: today,
        overview: d.overview || {},
        weeklyTrend: t,
        latestChanges: changes,
        lastCrawl: d.lastCrawl
      });
    }).catch(function() {
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  }
});

var api = require('../../utils/api');
Page({
  data: {
    today: {},
    overview: {},
    weeklyTrend: {},
    lastCrawl: null,
    priceBrief: null
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

      // 价格趋势简报
      var brief = d.priceBrief || null;
      if (brief) {
        if (brief.avgPrice7d) {
          brief.avgPrice7dDisplay = (brief.avgPrice7d / 10000).toFixed(1) + '万/㎡';
        }
        if (brief.avgPrice30d) {
          brief.avgPrice30dDisplay = (brief.avgPrice30d / 10000).toFixed(1) + '万/㎡';
        }
        if (brief.hotProjects) {
          brief.hotProjects = brief.hotProjects.map(function(p) {
            p.avgPriceDisplay = p.avgPrice ? (p.avgPrice / 10000).toFixed(1) + '万/㎡' : '-';
            return p;
          });
        }
      }

      self.setData({
        today: today,
        overview: d.overview || {},
        weeklyTrend: t,
        lastCrawl: d.lastCrawl,
        priceBrief: brief
      });
    }).catch(function() {
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  }
});

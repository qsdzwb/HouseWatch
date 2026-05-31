var api = require('../../utils/api');
Page({
  data: { list: [], page: 1, loading: false, noMore: false, date: '', summary: {} },
  onLoad: function() { this.loadChanges(); },
  onReachBottom: function() { if (!this.data.noMore) { this.setData({ page: this.data.page + 1 }); this.loadChanges(); } },
  onPullDownRefresh: function() { this.setData({ list: [], page: 1, noMore: false }); this.loadChanges().then(function(){ wx.stopPullDownRefresh(); }); },
  loadChanges: function() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    var self = this;
    return api.getChanges({ page: this.data.page, limit: 20, date: this.data.date || undefined }).then(function(res) {
      var d = res.data || {};
      var items = d.items || [];
      var pagination = d.pagination || {};
      var summary = d.summary || {};
      if (summary.avgDealPrice) {
        summary.avgPriceDisplay = (summary.avgDealPrice / 10000).toFixed(1) + '万/㎡';
      }
      var rows = items.map(function(item) {
        if (item.building_avg_price) {
          item.price_display = (item.building_avg_price / 10000).toFixed(1) + '万/㎡';
        }
        return item;
      });
      self.setData({
        list: self.data.page === 1 ? rows : self.data.list.concat(rows),
        noMore: rows.length < 20 || (pagination.page >= pagination.totalPages),
        loading: false,
        summary: summary
      });
    }).catch(function() { self.setData({ loading: false }); });
  },
  onDateChange: function(e) {
    this.setData({ date: e.detail.value, list: [], page: 1, noMore: false });
    this.loadChanges();
  }
});

var api = require('../../utils/api');

Page({
  data: { 
    list: [], 
    trend: [],        // 趋势数据
    trendMax: 0,      // 趋势图最大高度
    page: 1, 
    loading: false, 
    noMore: false, 
    date: '', 
    summary: {} 
  },

  onLoad: function() { 
    this.loadTrend();   // 先加载趋势
    this.loadChanges(); 
  },

  // 加载趋势数据
  loadTrend: function() {
    var self = this;
    api.getTrend({ days: 30 }).then(function(res) {
      var d = res.data || {};
      var trendData = d.dailySales || [];
      // 计算柱状图高度
      var maxCount = 0;
      trendData.forEach(function(item) {
        if (item.count > maxCount) maxCount = item.count;
      });
      var maxHeight = 80; // px
      var list = trendData.map(function(item) {
        return {
          date: item.date,
          shortDate: item.date ? item.date.substring(5) : '', // MM-DD
          count: item.count || 0,
          barHeight: maxCount > 0 ? Math.max(4, Math.round(item.count / maxCount * maxHeight)) : 4,
          avgPrice: item.avgPrice || 0,
        };
      });
      self.setData({ trend: list, trendMax: maxCount });
    }).catch(function() { /* ignore */ });
  },

  onReachBottom: function() { 
    if (!this.data.noMore) { 
      this.setData({ page: this.data.page + 1 }); 
      this.loadChanges(); 
    } 
  },

  onPullDownRefresh: function() { 
    this.setData({ list: [], page: 1, noMore: false, trend: [] }); 
    this.loadTrend();
    this.loadChanges().then(function(){ wx.stopPullDownRefresh(); }); 
  },

  loadChanges: function() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    var self = this;
    return api.getChanges({ 
      page: this.data.page, 
      limit: 20, 
      date: this.data.date || undefined 
    }).then(function(res) {
      var d = res.data || {};
      var items = d.items || [];
      var pagination = d.pagination || {};
      var summary = d.summary || {};

      // 价格显示：后端已返回 price_display，直接用
      var rows = items.map(function(item) {
        // 如果后端没返回 price_display，前端补算
        if (!item.price_display) {
          if (item.deal_unit_price && item.deal_unit_price > 0) {
            item.price_display = Math.round(item.deal_unit_price) + '元/㎡';
          } else if (item.building_avg_price && item.building_avg_price > 0) {
            item.price_display = Math.round(item.building_avg_price) + '元/㎡(楼栋均价)';
          }
        }
        return item;
      });

      self.setData({
        list: self.data.page === 1 ? rows : self.data.list.concat(rows),
        noMore: rows.length < 20 || (pagination.page >= pagination.totalPages),
        loading: false,
        summary: summary
      });
    }).catch(function() { 
      self.setData({ loading: false }); 
    });
  },

  onDateChange: function(e) {
    this.setData({ date: e.detail.value, list: [], page: 1, noMore: false });
    this.loadChanges();
  },

  // 点击趋势图某天
  onBarTap: function(e) {
    var date = e.currentTarget.dataset.date;
    if (date) {
      this.setData({ date: date, list: [], page: 1, noMore: false });
      this.loadChanges();
    }
  }
});

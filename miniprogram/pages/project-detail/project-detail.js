var api = require('../../utils/api');

Page({
  data: {
    project: {},
    buildings: [],
    stats: {},
    activeTab: 'buildings',
    isWatched: false,
    watchId: null
  },

  onLoad: function(opt) {
    this.setData({ projectId: opt.id });
    this.loadDetail();
  },

  onPullDownRefresh: function() {
    this.loadDetail().then(function() {
      wx.stopPullDownRefresh();
    });
  },

  loadDetail: function() {
    var self = this;
    wx.showNavigationBarLoading();
    return api.getProjectDetail(this.data.projectId).then(function(res) {
      wx.hideNavigationBarLoading();
      var d = res.data || {};

      // 楼栋数据预处理：计算状态条 flex 值
      var buildings = (d.buildings || []).map(function(b) {
        var total = b.total_houses || 1;
        var avail = b.available_count || 0;
        var sold = b.sold_count || 0;
        var other = total - avail - sold;
        if (other < 0) other = 0;
        b.flex_avail = avail > 0 ? avail : 1;
        b.flex_sold = sold > 0 ? sold : (other > 0 ? 1 : 0);
        b.flex_other = other > 0 ? other : 1;
        // 楼栋均价（来自 buildings 表字段，非 houses 表计算）
        if (b.avg_price) {
          b.price_display = (b.avg_price / 10000).toFixed(1) + '万/㎡';
        }
        return b;
      });

      var stats = d.stats || {};
      if (stats.avgPrice) {
        stats.priceDisplay = (stats.avgPrice / 10000).toFixed(1) + '万/㎡';
      }

      var stats = d.stats || {};
      var watch = d.watch;

      self.setData({
        project: d.project || {},
        buildings: buildings,
        stats: stats,
        isWatched: watch && watch.is_active ? true : false,
        watchId: watch ? watch.id : null
      });
    }).catch(function() {
      wx.hideNavigationBarLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  switchTab: function(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  goBuilding: function(e) {
    var buildingId = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/building/building?id=' + buildingId });
  },

  toggleWatch: function() {
    var self = this;
    var pid = this.data.project.project_id;
    if (this.data.isWatched) {
      api.removeWatch(pid).then(function() {
        self.setData({ isWatched: false, watchId: null });
        wx.showToast({ title: '已取消关注', icon: 'success' });
      }).catch(function() {
        wx.showToast({ title: '操作失败', icon: 'none' });
      });
    } else {
      var p = this.data.project;
      api.addWatch({
        project_id: p.project_id,
        name: p.name,
        district: p.district || '',
        address: p.address || '',
        developer: p.developer || ''
      }).then(function(res) {
        var data = res.data || {};
        self.setData({ isWatched: true });
        wx.showToast({ title: '已添加关注', icon: 'success' });
      }).catch(function() {
        wx.showToast({ title: '操作失败', icon: 'none' });
      });
    }
  }
});

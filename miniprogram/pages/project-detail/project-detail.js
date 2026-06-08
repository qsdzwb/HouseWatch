var api = require('../../utils/api');
var lineChart = require('../../utils/line-chart.js');

Page({
  data: {
    project: {},
    buildings: [],
    stats: {},
    activeTab: 'buildings',
    isWatched: false,
    watchId: null,
    // 价格走势
    trend: [],
    priceInsight: '',
    hasTrend: false,
    // 历史成交低价提示
    priceTip: '',
    priceTipType: ''
  },

  onLoad: function(opt) {
    this.setData({ projectId: opt.id });
    this.loadDetail();
    this.loadTrend();
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
  },

  loadTrend: function() {
    var self = this;
    // projectId 可能是逗号分隔的多ID，取第一个传给趋势接口
    var pid = (this.data.projectId || '').split(',')[0];
    var params = { projectId: pid, days: 30 };
    api.getTrend(params).then(function(res) {
      var d = (res && res.data) || {};
      var dailySales = d.dailySales || [];

      // 过滤有成交价的日期
      var priceData = dailySales.filter(function(item) {
        return item.avgPrice > 0;
      }).map(function(item) {
        var wan = (item.avgPrice / 10000).toFixed(1);
        return {
          date: item.date || '',
          label: item.date ? item.date.substring(5) : '',
          value: item.avgPrice / 10000,
          valueStr: wan
        };
      });

      // 计算价格洞察
      var insight = '';
      if (priceData.length >= 3) {
        var prices = priceData.map(function(d) { return d.value; });
        var current = prices[prices.length - 1];
        var min = Math.min.apply(null, prices);
        var max = Math.max.apply(null, prices);
        var avg = prices.reduce(function(a, b) { return a + b; }, 0) / prices.length;
        var range = max - min;
        if (range === 0) {
          insight = '价格走势平稳';
        } else if (current <= min + range * 0.2) {
          insight = '📉 当前均价处于近30天低位，可能是入手时机';
        } else if (current >= max - range * 0.2) {
          insight = '📈 当前均价处于近30天高位，建议观望';
        } else if (current < avg) {
          insight = '➡️ 当前均价低于近30天均值，值得关注';
        } else {
          insight = '➡️ 当前均价高于近30天均值';
        }
      }

      self.setData({
        trend: priceData,
        priceInsight: insight,
        hasTrend: priceData.length > 0
      });

      // 等 canvas 渲染后绘图
      if (priceData.length > 0) {
        setTimeout(function() {
          self.drawPriceChart();
        }, 300);
      }

      // 查询历史成交极值
      self.loadPriceTip();
    }).catch(function() {
      // 趋势加载失败不影响页面
    });
  },

  loadPriceTip: function() {
    var self = this;
    // projectId 可能是逗号分隔的多ID，取第一个
    var pid = (this.data.projectId || '').split(',')[0];
    api.getProjectPriceExtremes({ projectId: pid }).then(function(res) {
      var d = (res && res.data) || {};
      if (!d.hasData) return;
      var tip = d.tip || '';
      self.setData({
        priceTip: tip,
        priceTipType: d.position || 'mid'
      });
    }).catch(function() {
      // 不影响页面
    });
  },

  drawPriceChart: function() {
    var data = this.data.trend;
    if (!data || !data.length) return;
    var sysInfo = wx.getSystemInfoSync();
    var canvasW = sysInfo.windowWidth - 32;
    lineChart.drawLineChart('priceChart', data, {
      width: canvasW,
      height: 180,
      color: '#FF6600',
      fillColor: 'rgba(255,102,0,0.08)',
      showDots: true,
      showLabels: data.length <= 14
    }, this);
  }
});

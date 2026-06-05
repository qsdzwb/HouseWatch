var api = require('../../utils/api');
var lineChart = require('../../utils/line-chart.js');

Page({
  data: {
    list: [],
    trend: [],
    priceTrend: [],
    projects: [],
    selectedProjectId: '',
    currentProjectName: '全部楼盘',
    page: 1,
    loading: false,
    noMore: false,
    date: '',
    summary: {},
    loadError: ''
  },

  onLoad: function() {
    this.loadProjects();
    this.loadTrend();
    this.loadChanges();
  },

  loadProjects: function() {
    var self = this;
    api.getProjects().then(function(res) {
      var d = (res && res.data) || {};
      var list = d.data || d.items || d || [];
      list.unshift({ project_id: '', name: '全部楼盘' });
      self.setData({ projects: list, currentProjectName: '全部楼盘' });
    }).catch(function() { /* ignore */ });
  },

  loadTrend: function() {
    var self = this;
    var params = { days: 14 };
    if (this.data.selectedProjectId) {
      params.projectId = this.data.selectedProjectId;
    }
    api.getTrend(params).then(function(res) {
      var d = (res && res.data) || {};
      var trendData = d.dailySales || [];

      // 过滤掉无数据的尾部日期
      var lastValidIndex = -1;
      for (var i = trendData.length - 1; i >= 0; i--) {
        if (trendData[i].count > 0) {
          lastValidIndex = i;
          break;
        }
      }
      if (lastValidIndex >= 0) {
        trendData = trendData.slice(0, lastValidIndex + 1);
      }
      if (trendData.length > 14) {
        trendData = trendData.slice(trendData.length - 14);
      }

      // 数量趋势数据（保存完整日期）
      var countData = trendData.map(function(item) {
        return {
          date: item.date || '',
          label: item.date ? item.date.substring(5) : '',
          value: item.count || 0,
          valueStr: item.count > 0 ? String(item.count) : ''
        };
      });

      // 均价趋势数据（只取有成交的日期，保存完整日期）
      var priceData = trendData.filter(function(item) {
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

      self.setData({
        trend: countData,
        priceTrend: priceData,
        summary: d.summary || self.data.summary
      });

      // 等 canvas 渲染完毕再绘图
      setTimeout(function() {
        self.drawCountChart();
        self.drawPriceChart();
      }, 300);
    }).catch(function(err) {
      console.log('趋势加载失败:', err);
    });
  },

  drawCountChart: function() {
    var data = this.data.trend;
    if (!data || !data.length) return;
    var sysInfo = wx.getSystemInfoSync();
    var canvasW = sysInfo.windowWidth - 32;
    lineChart.drawLineChart('countChart', data, {
      width: canvasW,
      height: 200,
      color: '#E74C3C',
      fillColor: 'rgba(231,76,60,0.08)',
      showDots: true,
      showLabels: true
    }, this);
  },

  drawPriceChart: function() {
    var data = this.data.priceTrend;
    if (!data || !data.length) return;
    var sysInfo = wx.getSystemInfoSync();
    var canvasW = sysInfo.windowWidth - 32;
    lineChart.drawLineChart('priceChart', data, {
      width: canvasW,
      height: 200,
      color: '#FF6600',
      fillColor: 'rgba(255,102,0,0.08)',
      showDots: true,
      showLabels: true
    }, this);
  },

  // canvas 点击 → 跳转到对应日期的变化列表
  onChartTap: function(e) {
    var chartType = e.currentTarget.dataset.chart;
    var data = chartType === 'count' ? this.data.trend : this.data.priceTrend;
    if (!data || !data.length) return;

    var touchX = e.detail.x;
    var self = this;
    var canvasId = chartType + 'Chart';

    wx.createSelectorQuery().in(this).select('#' + canvasId).boundingClientRect(function(rect) {
      if (!rect) return;
      var xInCanvas = touchX - rect.left;
      // 限制在 canvas 范围内
      xInCanvas = Math.max(0, Math.min(xInCanvas, rect.width));
      var idx = Math.round((xInCanvas / rect.width) * (data.length - 1));
      idx = Math.max(0, Math.min(idx, data.length - 1));
      var item = data[idx];
      if (item && item.date) {
        self.setData({ date: item.date, list: [], page: 1, noMore: false });
        self.loadChanges();
      }
    }).exec();
  },

  onProjectChange: function(e) {
    var idx = parseInt(e.detail.value, 10);
    var project = this.data.projects[idx] || {};
    this.setData({
      selectedProjectId: project.project_id || '',
      currentProjectName: project.name || '全部楼盘',
      list: [],
      page: 1,
      noMore: false,
      date: ''
    });
    this.loadTrend();
    this.loadChanges();
  },

  onReachBottom: function() {
    if (!this.data.noMore) {
      this.setData({ page: this.data.page + 1 });
      this.loadChanges();
    }
  },

  onPullDownRefresh: function() {
    this.setData({ list: [], page: 1, noMore: false, trend: [], priceTrend: [] });
    this.loadTrend();
    this.loadChanges().then(function(){ wx.stopPullDownRefresh(); });
  },

  loadChanges: function() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    var self = this;
    var params = {
      page: this.data.page,
      limit: 20
    };
    if (this.data.date) {
      params.date = this.data.date;
    }
    if (this.data.selectedProjectId) {
      params.projectId = this.data.selectedProjectId;
    }
    return api.getChanges(params).then(function(res) {
      var body = res || {};
      var d = body.data || {};
      var items = d.items || [];
      var pagination = d.pagination || {};
      var summary = d.summary || {};

      var queryDate = d.queryDate;
      if (!queryDate || queryDate === 'undefined') {
        queryDate = self.data.date || '';
      }

      var rows = items.map(function(item) {
        if (!item.price_display) {
          if (item.deal_unit_price && item.deal_unit_price > 0) {
            item.price_display = Math.round(item.deal_unit_price) + '元/㎡';
          } else if (item.building_avg_price && item.building_avg_price > 0) {
            item.price_display = Math.round(item.building_avg_price) + '元/㎡(楼栋均价)';
          }
        }
        return item;
      });

      if (summary.avgDealPrice && summary.avgDealPrice > 0) {
        summary.avgPriceDisplay = Math.round(summary.avgDealPrice) + '元/㎡';
      }

      self.setData({
        list: self.data.page === 1 ? rows : self.data.list.concat(rows),
        noMore: rows.length < 20 || (pagination.page >= pagination.totalPages),
        loading: false,
        summary: summary,
        date: queryDate,
        loadError: ''
      });
    }).catch(function(err) {
      console.log('变化加载失败:', err);
      self.setData({
        loading: false,
        loadError: '加载失败，请下拉刷新重试'
      });
    });
  },

  onDateChange: function(e) {
    var val = e.detail.value;
    if (!val || val === 'undefined' || val === 'null') {
      val = '';
    }
    this.setData({ date: val, list: [], page: 1, noMore: false });
    this.loadChanges();
  }
});

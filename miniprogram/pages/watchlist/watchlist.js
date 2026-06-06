var api = require('../../utils/api');

// 北京各区（与住建委区域一致）
var DISTRICT_OPTIONS = [
  '全部区域', '朝阳区', '海淀区', '丰台区', '昌平区',
  '大兴区', '通州区', '顺义区', '房山区', '石景山区',
  '东城区', '西城区', '门头沟区', '平谷区', '怀柔区',
  '密云区', '延庆区'
];

Page({
  data: {
    list: [],
    showAdd: false,
    form: { project_id: '', note: '' },
    selectedProject: null,
    watchedIds: new Set(),
    // 区域下拉
    districtOptions: DISTRICT_OPTIONS,
    selectedDistrictIndex: 0,
    // 楼盘列表
    allProjects: [],
    filteredProjects: [],
    loadingProjects: false
  },

  // 内存中保存全部楼盘，不放在 data 里（避免渲染卡顿）
  _allProjects: [],

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

  showAdd: function() {
    var self = this;
    this.setData({
      showAdd: true,
      selectedProject: null,
      selectedDistrictIndex: 0,
      filteredProjects: [],
      loadingProjects: true
    });
    // 加载全部楼盘
    api.getProjects({ limit: 9999, has_data: '0' }).then(function(res) {
      var items = (res.data && res.data.items) ? res.data.items : [];
      self._allProjects = items;
      // 默认展示全部未关注楼盘
      self.applyFilter(0);
      self.setData({ loadingProjects: false });
    }).catch(function() {
      self.setData({ loadingProjects: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  hideAdd: function() {
    this.setData({
      showAdd: false,
      selectedProject: null,
      selectedDistrictIndex: 0,
      filteredProjects: [],
      loadingProjects: false
    });
  },

  clearSelection: function() {
    this.setData({
      selectedProject: null,
      'form.project_id': '',
      'form.note': ''
    });
    // 重新展示筛选列表
    this.applyFilter(this.data.selectedDistrictIndex);
  },

  onDistrictPickerChange: function(e) {
    var idx = parseInt(e.detail.value);
    this.setData({ selectedDistrictIndex: idx });
    this.applyFilter(idx);
  },

  applyFilter: function(districtIndex) {
    var self = this;
    var district = districtIndex > 0 ? DISTRICT_OPTIONS[districtIndex] : null;

    var results = self._allProjects.filter(function(item) {
      // 过滤已关注
      if (self.data.watchedIds.has(item.project_id)) return false;
      // 区域过滤
      if (district && item.district !== district) return false;
      return true;
    });

    self.setData({ filteredProjects: results });
  },

  selectProject: function(e) {
    var idx = e.currentTarget.dataset.index;
    var project = this.data.filteredProjects[idx];
    this.setData({
      selectedProject: project,
      'form.project_id': project.project_id,
      filteredProjects: []
    });
  },

  onNoteInput: function(e) {
    this.setData({ 'form.note': e.detail.value });
  },

  submitAdd: function() {
    var self = this;
    if (!this.data.form.project_id || !this.data.selectedProject) {
      wx.showToast({ title: '请选择楼盘', icon: 'none' });
      return;
    }
    var p = this.data.selectedProject;
    api.addWatch({
      project_id: p.project_id,
      name: p.name,
      note: this.data.form.note,
      district: p.district || '',
      address: p.address || '',
      developer: p.developer || ''
    }).then(function() {
      wx.showToast({ title: '已添加', icon: 'success' });
      self.hideAdd();
      self.loadWatchlist();
    }).catch(function() {
      wx.showToast({ title: '添加失败', icon: 'none' });
    });
  }
});

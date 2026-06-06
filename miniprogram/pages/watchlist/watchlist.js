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
    searchKeyword: '',
    searchResults: [],
    searching: false,
    selectedProject: null,
    watchedIds: new Set(),
    // 区域下拉
    districtOptions: DISTRICT_OPTIONS,
    selectedDistrictIndex: 0,
    // 预加载全部楼盘（内存，非 data）
    allProjectsLoaded: false
  },

  // 内存中保存全部楼盘，不放在 data 里（避免渲染卡顿）
  _allProjects: [],

  searchTimer: null,

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
      searchKeyword: '',
      searchResults: [],
      selectedProject: null,
      selectedDistrictIndex: 0,
      allProjectsLoaded: false
    });
    // 预加载全部楼盘到内存
    if (!this._allProjects || this._allProjects.length === 0) {
      this.setData({ searching: true });
      api.getProjects({ limit: 9999, has_data: '0' }).then(function(res) {
        var items = (res.data && res.data.items) ? res.data.items : [];
        self._allProjects = items;
        self.setData({ searching: false, allProjectsLoaded: true });
        // 如果有搜索词，立即本地筛选
        if (self.data.searchKeyword.length >= 1) {
          self.doLocalSearch(self.data.searchKeyword);
        }
      }).catch(function() {
        self.setData({ searching: false });
      });
    }
  },

  hideAdd: function() {
    this.setData({
      showAdd: false,
      searchKeyword: '',
      searchResults: [],
      searchResultsRaw: [],
      selectedProject: null,
      selectedDistrictIndex: 0
    });
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  },

  clearSelection: function() {
    this.setData({
      selectedProject: null,
      'form.project_id': '',
      searchKeyword: '',
      searchResults: [],
      searchResultsRaw: [],
      selectedDistrictIndex: 0
    });
  },

  onDistrictPickerChange: function(e) {
    var idx = parseInt(e.detail.value);
    this.setData({ selectedDistrictIndex: idx });
    // 如果已有搜索关键词，自动按新区筛选
    if (this.data.searchKeyword.length >= 1) {
      this.doSearch(this.data.searchKeyword);
    }
  },

  onSearchInput: function(e) {
    var keyword = e.detail.value.trim();
    this.setData({ searchKeyword: keyword, searchResults: [] });

    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }

    if (keyword.length < 1) {
      this.setData({ searchResults: [], searchResultsRaw: [], searching: false });
      return;
    }

    var self = this;
    this.searchTimer = setTimeout(function() {
      self.doSearch(keyword);
    }, 300);
  },

  clearSearch: function() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.setData({
      searchKeyword: '',
      searchResults: [],
      searchResultsRaw: [],
      selectedDistrictIndex: 0,
      searching: false
    });
  },

  doSearch: function(keyword) {
    var self = this;
    if (!self._allProjects || self._allProjects.length === 0) {
      // 尚未预加载，降级为 API 搜索
      self._fallbackSearch(keyword);
      return;
    }
    this.setData({ searching: true });
    var idx = this.data.selectedDistrictIndex;
    var district = idx > 0 ? DISTRICT_OPTIONS[idx] : null;

    var results = self._allProjects.filter(function(item) {
      // 过滤已关注
      if (self.data.watchedIds.has(item.project_id)) return false;
      // 关键词过滤
      if (keyword && item.name && item.name.indexOf(keyword) === -1) return false;
      // 区域过滤
      if (district && item.district !== district) return false;
      return true;
    });

    self.setData({ searchResults: results, searching: false });
  },

  _fallbackSearch: function(keyword) {
    var self = this;
    this.setData({ searching: true });
    var params = { search: keyword, limit: 50, has_data: '0' };
    var idx = this.data.selectedDistrictIndex;
    if (idx > 0) params.district = DISTRICT_OPTIONS[idx];
    api.getProjects(params).then(function(res) {
      var items = (res.data && res.data.items) ? res.data.items : [];
      var watchedIds = self.data.watchedIds;
      items = items.map(function(item) {
        item.isWatched = watchedIds.has(item.project_id);
        return item;
      }).filter(function(item) { return !item.isWatched; });
      self.setData({ searchResults: items, searching: false });
    }).catch(function() {
      self.setData({ searching: false });
    });
  },

  selectProject: function(e) {
    var idx = e.currentTarget.dataset.index;
    var project = this.data.searchResults[idx];
    this.setData({
      selectedProject: project,
      'form.project_id': project.project_id,
      searchResults: [],
      searchResultsRaw: []
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

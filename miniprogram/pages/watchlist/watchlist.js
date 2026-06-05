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
    searchResultsRaw: [],
    searching: false,
    selectedProject: null,
    watchedIds: new Set(),
    // 区域下拉
    districtOptions: DISTRICT_OPTIONS,
    selectedDistrictIndex: 0
  },

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
    this.setData({
      showAdd: true,
      searchKeyword: '',
      searchResults: [],
      searchResultsRaw: [],
      selectedProject: null,
      selectedDistrictIndex: 0
    });
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
    this.setData({ searching: true });

    // 组装查询参数，若选中具体区域则带上
    var params = { search: keyword, limit: 50, has_data: '0' };
    var idx = this.data.selectedDistrictIndex;
    if (idx > 0) {
      params.district = DISTRICT_OPTIONS[idx];
    }

    api.getProjects(params).then(function(res) {
      var items = (res.data && res.data.items) ? res.data.items : [];
      var watchedIds = self.data.watchedIds;

      // 过滤掉已关注的楼盘
      items = items.map(function(item) {
        item.isWatched = watchedIds.has(item.project_id);
        return item;
      }).filter(function(item) {
        return !item.isWatched;
      });

      self.setData({
        searchResultsRaw: items,
        searchResults: items,
        searching: false
      });
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

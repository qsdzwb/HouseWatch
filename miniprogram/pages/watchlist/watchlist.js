var api = require('../../utils/api');

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
    districts: [],
    selectedDistrict: '',
    watchedIds: new Set()
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
      districts: [],
      selectedDistrict: ''
    });
  },

  hideAdd: function() {
    this.setData({
      showAdd: false,
      searchKeyword: '',
      searchResults: [],
      searchResultsRaw: [],
      selectedProject: null,
      districts: [],
      selectedDistrict: ''
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
      districts: [],
      selectedDistrict: ''
    });
  },

  onSearchInput: function(e) {
    var keyword = e.detail.value.trim();
    this.setData({ searchKeyword: keyword, selectedDistrict: '', searchResults: [] });

    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }

    if (keyword.length < 1) {
      this.setData({ searchResults: [], searchResultsRaw: [], districts: [], searching: false });
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
      districts: [],
      selectedDistrict: '',
      searching: false
    });
  },

  doSearch: function(keyword) {
    var self = this;
    this.setData({ searching: true });
    api.getProjects({ search: keyword, limit: 50, has_data: '0' }).then(function(res) {
      var items = (res.data && res.data.items) ? res.data.items : [];
      var watchedIds = self.data.watchedIds;

      // 过滤掉已关注的楼盘，标记状态
      items = items.map(function(item) {
        item.isWatched = watchedIds.has(item.project_id);
        return item;
      }).filter(function(item) {
        return !item.isWatched;
      });

      // 提取区域列表用于筛选
      var districtMap = {};
      items.forEach(function(item) {
        if (item.district) districtMap[item.district] = true;
      });
      var districts = Object.keys(districtMap).sort();

      self.setData({
        searchResultsRaw: items,
        searchResults: items,
        districts: districts,
        searching: false
      });
    }).catch(function() {
      self.setData({ searching: false });
    });
  },

  selectDistrict: function(e) {
    var district = e.currentTarget.dataset.district;
    var raw = this.data.searchResultsRaw;
    var filtered = district
      ? raw.filter(function(item) { return item.district === district; })
      : raw;
    this.setData({
      selectedDistrict: district,
      searchResults: filtered
    });
  },

  selectProject: function(e) {
    var idx = e.currentTarget.dataset.index;
    var project = this.data.searchResults[idx];
    this.setData({
      selectedProject: project,
      'form.project_id': project.project_id,
      searchResults: [],
      searchResultsRaw: [],
      districts: [],
      selectedDistrict: ''
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

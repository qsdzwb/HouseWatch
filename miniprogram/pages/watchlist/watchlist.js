var api = require('../../utils/api');

Page({
  data: {
    list: [],
    showAdd: false,
    form: { project_id: '', note: '' },
    searchKeyword: '',
    searchResults: [],
    searching: false,
    selectedProject: null
  },

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
      // 直接用 watchlist 返回的字段
      items = items.map(function(item) {
        item.showStats = (item.total_units > 0);
        if (item.showStats) {
          item.rate = item.total_units > 0
            ? (item.sold_units / item.total_units * 100).toFixed(1) + '%'
            : '0%';
        }
        return item;
      });
      self.setData({ list: items });
    }).catch(function() {
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  goDetail: function(e) {
    var projectId = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/project-detail/project-detail?id=' + projectId });
  },

  showAdd: function() {
    this.setData({ showAdd: true, searchKeyword: '', searchResults: [], selectedProject: null });
  },

  hideAdd: function() {
    this.setData({ showAdd: false, searchKeyword: '', searchResults: [], selectedProject: null });
  },

  clearSelection: function() {
    this.setData({ selectedProject: null, 'form.project_id': '', searchKeyword: '', searchResults: [] });
  },

  onSearchInput: function(e) {
    var keyword = e.detail.value;
    this.setData({ searchKeyword: keyword });
    if (keyword.length < 2) { this.setData({ searchResults: [] }); return; }
    this.doSearch(keyword);
  },

  doSearch: function(keyword) {
    var self = this;
    this.setData({ searching: true });
    api.getProjects({ search: keyword, limit: 20, has_data: '0' }).then(function(res) {
      self.setData({
        searchResults: (res.data && res.data.items) ? res.data.items : [],
        searching: false
      });
    }).catch(function() { self.setData({ searching: false }); });
  },

  selectProject: function(e) {
    var idx = e.currentTarget.dataset.index;
    var project = this.data.searchResults[idx];
    this.setData({
      selectedProject: project,
      'form.project_id': project.project_id,
      searchResults: []
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

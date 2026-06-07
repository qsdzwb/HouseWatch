var api = require('../../utils/api');

Page({
  data: {
    apiBase: 'https://lushi.chat/api',
    version: '1.0.0',
    // 管理员状态
    isAdmin: false,
    notAdmin: true,   // wx:if 兼容性：用独立变量
    openId: '',
    loginLoading: false,
    loginError: '',
    // 推广名编辑
    projectList: [],
    projectIndex: -1,
    selectedProjectId: '',
    selectedProjectName: '',
    displayName: '',
    saving: false,
  },

  onLoad: function () {
    this.setData({ apiBase: getApp().globalData.apiBase });
    this.checkAdmin();
  },

  // 检查管理员身份（优先用缓存的 open_id）
  checkAdmin: function () {
    var that = this;
    var cachedOpenId = wx.getStorageSync('admin_open_id');
    var cachedIsAdmin = wx.getStorageSync('is_admin');

    if (cachedOpenId && cachedIsAdmin) {
      that.setData({ isAdmin: true, openId: cachedOpenId, notAdmin: false });
      that.loadProjects();
      return;
    }

    // 无缓存，自动尝试登录一次
    that.tryAdminLogin(true);
  },

  // 调用 wx.login 获取 code，换 open_id 并鉴权
  // isAuto: true 表示是页面加载时的自动尝试（失败不弹 toast）
  tryAdminLogin: function (isAuto) {
    var that = this;
    that.setData({ loginLoading: true, loginError: '' });

    wx.login({
      success: function (loginRes) {
        if (!loginRes.code) {
          that.setData({ loginLoading: false, loginError: 'wx.login 未返回 code' });
          if (!isAuto) wx.showToast({ title: '登录失败：未获取 code', icon: 'none' });
          return;
        }
        console.log('[Admin] wx.login code:', loginRes.code.substring(0, 10) + '...');

        api.adminLogin(loginRes.code).then(function (res) {
          that.setData({ loginLoading: false });
        if (res.success && res.data) {
          var openId = res.data.open_id;
          var isAdmin = res.data.is_admin;
          wx.setStorageSync('admin_open_id', openId);
          wx.setStorageSync('is_admin', isAdmin);
          that.setData({ isAdmin: isAdmin, openId: openId, notAdmin: !isAdmin });
            if (isAdmin) {
              that.loadProjects();
              wx.showToast({ title: '管理员已登录', icon: 'success' });
            } else {
              // 不是管理员，但已拿到 open_id，提示用户
              if (!isAuto) {
                wx.showModal({
                  title: '登录成功',
                  content: '您的 open_id 为：' + openId + '\n请联系管理员将此 ID 加入白名单。',
                  showCancel: false,
                });
              }
            }
          } else {
            that.setData({ loginError: res.message || '登录失败' });
            if (!isAuto) wx.showToast({ title: res.message || '登录失败', icon: 'none' });
          }
        }).catch(function (err) {
          that.setData({ loginLoading: false, loginError: err.message || '请求失败' });
          if (!isAuto) wx.showToast({ title: err.message || '登录请求失败', icon: 'none' });
          console.error('[Admin] 登录请求失败', err);
        });
      },
      fail: function (err) {
        that.setData({ loginLoading: false, loginError: err.errMsg || 'wx.login 调用失败' });
        if (!isAuto) wx.showToast({ title: err.errMsg || 'wx.login 失败', icon: 'none' });
        console.error('[Admin] wx.login 调用失败', err);
      },
    });
  },

  // 手动触发登录（按钮点击）
  onLoginTap: function () {
    this.tryAdminLogin(false);
  },

  // 加载所有活跃楼盘（用于推广名编辑表单）
  loadProjects: function () {
    var that = this;
    api.getActiveProjects().then(function (res) {
      if (res.success && res.data && res.data.items) {
        var items = res.data.items;
        // 去重（按 name 去重，因为同名项目已合并）
        var seen = {};
        var unique = [];
        items.forEach(function (it) {
          if (!seen[it.name]) {
            seen[it.name] = true;
            unique.push(it);
          }
        });
        that.setData({
          projectList: unique,
          projectIndex: -1,
          selectedProjectId: '',
          displayName: '',
        });
      }
    }).catch(function (err) {
      console.error('[Admin] 加载楼盘列表失败', err);
    });
  },

  // 楼盘选择器变化
  onProjectChange: function (e) {
    var idx = parseInt(e.detail.value, 10);
    var project = this.data.projectList[idx];
    if (!project) return;
    this.setData({
      projectIndex: idx,
      selectedProjectId: project.project_id,
      selectedProjectName: project.name,
      displayName: project.display_name || '',
    });
  },

  // 推广名输入
  onDisplayNameInput: function (e) {
    this.setData({ displayName: e.detail.value });
  },

  // 保存推广名
  saveDisplayName: function () {
    var that = this;
    var pid = this.data.selectedProjectId;
    var name = this.data.displayName;

    if (!pid) {
      wx.showToast({ title: '请先选择楼盘', icon: 'none' });
      return;
    }
    if (!this.data.openId) {
      wx.showToast({ title: '管理员未登录', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    api.updateDisplayName(pid, name, this.data.openId).then(function (res) {
      that.setData({ saving: false });
      if (res.success) {
        wx.showToast({ title: '保存成功', icon: 'success' });
        that.loadProjects();
        that.setData({ projectIndex: -1, selectedProjectId: '', displayName: '' });
      } else {
        wx.showToast({ title: res.message || '保存失败', icon: 'none' });
      }
    }).catch(function (err) {
      that.setData({ saving: false });
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      console.error('[Admin] 保存推广名失败', err);
    });
  },

  // -------- 原有设置功能 --------
  onApiBaseInput: function (e) { this.setData({ apiBase: e.detail.value }); },
  saveSettings: function () {
    getApp().globalData.apiBase = this.data.apiBase;
    wx.setStorageSync('apiBase', this.data.apiBase);
    wx.showToast({ title: '保存成功', icon: 'success' });
  },
  clearCache: function () {
    var that = this;
    wx.showModal({
      title: '确认',
      content: '清除所有本地缓存（含管理员登录状态）？',
      success: function (r) {
        if (r.confirm) {
          wx.clearStorageSync();
          that.setData({ isAdmin: false, openId: '', loginError: '', notAdmin: true });
          wx.showToast({ title: '已清除', icon: 'success' });
        }
      }
    });
  },
  checkHealth: function () {
    api.health().then(function () {
      wx.showToast({ title: '后端连接正常', icon: 'success' });
    }).catch(function () {
      wx.showToast({ title: '后端连接失败', icon: 'none' });
    });
  },
});

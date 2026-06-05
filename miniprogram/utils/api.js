function getBase() {
  var app = getApp();
  return (app && app.globalData && app.globalData.apiBase) || 'https://lushi.chat/api';
}

function getCloudEnv() {
  var app = getApp();
  return (app && app.globalData && app.globalData.cloudEnv) || 'test-d5gosehir1c1bd27e';
}

function getAnyServiceName() {
  var app = getApp();
  return (app && app.globalData && app.globalData.anyServiceName) || 'housewatch';
}

// 判断是否支持 wx.cloud.callContainer
function supportsCloudCall() {
  return false; // 禁用云调用，走 IP 直连
}

function request(url, method, data) {
  var fullUrl = getBase() + url;
  console.log('[API] >>> 请求:', method || 'GET', fullUrl, JSON.stringify(data || {}));

  // 优先使用 AnyService（云开发通道，免备案）
  if (supportsCloudCall()) {
    return requestViaCloud(url, method, data);
  }
  // 降级：直接 HTTPS 请求（Cloudflare 代理已生效）
  return requestViaHttp(url, method, data, fullUrl);
}

// 方式1：通过 AnyService 调用（免备案）
function requestViaCloud(url, method, data) {
  return new Promise(function(resolve, reject) {
    var path = url; // url 如 '/stats/dashboard'，直接作为 path
    wx.cloud.callContainer({
      path: path,
      method: method || 'GET',
      header: {
        'X-WX-SERVICE': 'tcbanyservice',
        'X-AnyService-Name': getAnyServiceName(),
        'Content-Type': 'application/json'
      },
      data: data || {},
      timeout: 15000,
      success: function(res) {
        console.log('[API-Cloud] <<< 响应状态:', res.statusCode, '数据类型:', typeof res.data);
        var body = res.data;
        if (typeof body === 'string') {
          console.log('[API-Cloud] 字符串响应:', body.substring(0, 200));
          try { body = JSON.parse(body); } catch(e) {
            console.error('[API-Cloud] JSON解析失败!');
            reject({ message: '服务器返回异常: ' + body.substring(0, 100), statusCode: res.statusCode });
            return;
          }
        }
        if (body && body.success) {
          console.log('[API-Cloud] 成功!');
          resolve(body);
        } else if (body && res.statusCode === 200) {
          console.log('[API-Cloud] 兼容格式, 直接resolve');
          resolve({ success: true, data: body });
        } else {
          console.error('[API-Cloud] 失败! statusCode:', res.statusCode, 'body:', JSON.stringify(body).substring(0, 200));
          reject(body || { message: '请求失败', statusCode: res.statusCode });
        }
      },
      fail: function(err) {
        console.error('[API-Cloud] !! 网络请求失败:', JSON.stringify(err));
        // 降级到 HTTP 方式
        console.log('[API-Cloud] 降级到直连方式...');
        requestViaHttp(url, method, data, getBase() + url).then(resolve).catch(reject);
      }
    });
  });
}

// 方式2：直接 HTTPS 请求（原方式）
function requestViaHttp(url, method, data, fullUrl) {
  return new Promise(function(resolve, reject) {
    wx.request({
      url: fullUrl,
      method: method || 'GET',
      data: data || {},
      header: { 'Content-Type': 'application/json' },
      timeout: 30000,
      success: function(res) {
        console.log('[API-HTTP] <<< 响应状态:', res.statusCode, '数据类型:', typeof res.data);
        if (typeof res.data === 'string') {
          console.log('[API-HTTP] 字符串响应:', res.data.substring(0, 200));
        } else {
          console.log('[API-HTTP] JSON响应:', JSON.stringify(res.data).substring(0, 300));
        }
        var body = res.data;
        if (typeof body === 'string') {
          try { body = JSON.parse(body); } catch(e) {
            console.error('[API-HTTP] JSON解析失败!');
            reject({ message: '服务器返回异常: ' + body.substring(0, 100), statusCode: res.statusCode });
            return;
          }
        }
        if (body && body.success) {
          var itemCount = (body.data && body.data.items) ? body.data.items.length : 'N/A';
          console.log('[API-HTTP] 成功! items数量:', itemCount);
          resolve(body);
        } else if (body && res.statusCode === 200) {
          console.log('[API-HTTP] 兼容格式, 直接resolve');
          resolve({ success: true, data: body });
        } else {
          console.error('[API-HTTP] 失败! statusCode:', res.statusCode, 'body:', JSON.stringify(body).substring(0, 200));
          reject(body || { message: '请求失败', statusCode: res.statusCode });
        }
      },
      fail: function(err) {
        console.error('[API-HTTP] !! 网络请求失败:', JSON.stringify(err));
        reject(err);
      }
    });
  });
}

module.exports = {
  getDashboard: function() { return request('/stats/dashboard'); },
  getProjects: function(p) { return request('/projects', 'GET', p); },
  getProjectDetail: function(id) { return request('/projects/' + id); },
  getBuildings: function(id) { return request('/buildings?project_id=' + id); },
  getBuildingHouses: function(id) { return request('/buildings/' + id + '/houses'); },
  getHouseHistory: function(id) { return request('/houses/' + id + '/history'); },
  getChanges: function(p) { return request('/changes/daily', 'GET', p); },
  getTrend: function(p) { return request('/changes/trend', 'GET', p); },
  getWatchlist: function(active) { return request('/watchlist?active_only=' + (active ? 1 : 0)); },
  addWatch: function(d) { return request('/watchlist', 'POST', d); },
  removeWatch: function(id) { return request('/watchlist/' + id, 'DELETE'); },
  updateWatch: function(id, d) { return request('/watchlist/' + id, 'PATCH', d); },
  health: function() { return request('/health'); }
};

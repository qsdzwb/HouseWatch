const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const https = require('https');

// 从环境变量读取管理员 open_id 白名单（逗号分隔）
function getAdminOpenIds() {
  const raw = process.env.ADMIN_OPEN_IDS || '';
  return raw.split(',').map(id => id.trim()).filter(Boolean);
}

// 调用微信 code2session 接口，换取 open_id
function code2Session(code) {
  return new Promise((resolve, reject) => {
    const appId = process.env.MP_APPID;
    const appSecret = process.env.MP_APPSECRET;
    if (!appId || !appSecret) {
      return reject(new Error('缺少 MP_APPID 或 MP_APPSECRET 环境变量'));
    }
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${code}&grant_type=authorization_code`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.errcode) {
            reject(new Error(`code2session 失败: ${result.errmsg}`));
          } else {
            resolve({ openid: result.openid, session_key: result.session_key });
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// POST /api/admin/login — 用 wx.login() 换取的 code 登录，返回是否为管理员
router.post('/login', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: '缺少 code 参数' });
    }

    const session = await code2Session(code);
    const openId = session.openid;
    const adminIds = getAdminOpenIds();
    const isAdmin = adminIds.includes(openId);

    console.log(`[Admin] 登录尝试 open_id=${openId} isAdmin=${isAdmin}`);

    res.json({
      success: true,
      data: {
        open_id: openId,
        is_admin: isAdmin,
      },
    });
  } catch (err) {
    console.error('[Admin] 登录失败:', err.message);
    res.status(500).json({ success: false, message: '登录失败: ' + err.message });
  }
});

// GET /api/admin/check — 检查指定 open_id 是否为管理员（用于已缓存 open_id 的情况）
router.get('/check', (req, res) => {
  const { open_id } = req.query;
  if (!open_id) {
    return res.status(400).json({ success: false, message: '缺少 open_id 参数' });
  }
  const adminIds = getAdminOpenIds();
  const isAdmin = adminIds.includes(open_id);
  res.json({
    success: true,
    data: { open_id, is_admin: isAdmin },
  });
});

module.exports = router;

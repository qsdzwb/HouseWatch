const { newPage } = require('./browser');
const config = require('../config');

/**
 * Layer 1: 列表页爬虫 — 获取项目列表
 * 
 * pageId=307670，通过 POST 表单筛选区域并分页遍历
 * 当前版本：从 config.sampleProjects 返回（后续实现完整列表页解析）
 */
async function crawlListPage(options = {}) {
  const { district } = options;

  if (config.crawl.mode === 'test') {
    console.log('[Layer 1] 测试模式，使用样本项目列表');
    return config.sampleProjects.map(p => ({
      project_id: p.projectID,
      name: p.name,
      district: district || '待定',
      source: 'sample',
    }));
  }

  // TODO: 完整的列表页爬取逻辑
  // 1. 访问 pageId=307670
  // 2. 填写搜索表单（区域选择、项目状态等）
  // 3. 解析搜索结果表格 → 提取 projectID
  // 4. 处理分页，遍历所有结果页
  console.log('[Layer 1] 列表页爬取（全量模式）暂未实现');
  return [];
}

module.exports = { crawlListPage };

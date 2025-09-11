import { httpPost } from '@core/http.js';
import { apiPath } from '@core/apiCatalog.js';

/**
 * 3.10 获取设备列表 /api/web/dev/list
 * 支持分页 + 过滤（按需扩展）
 * 后端若不需要的字段可忽略；保留统一字段名方便前端调用。
 *
 * @param {Object} opt
 *  - pageIndex
 *  - pageSize
 *  - userId         (按所属用户过滤；0 或不传表示全部)
 *  - devType        (设备类型过滤)
 *  - devMode        (设备模式过滤)
 *  - searchStr      (模糊搜索编号/名称)
 *  - filterOnline   (是否只看在线 true/false)
 */
export function apiDeviceList(opt = {}) {
  const {
    pageIndex = 1,
    pageSize = 10,
    userId = 0,
    devType = 0,
    devMode = 0,
    searchStr = '',
    filterOnline = false
  } = opt;

  return httpPost(apiPath('3.10'), {
    pageIndex,
    pageSize,
    userId,
    devType,
    devMode,
    filterStr: searchStr,
    filterOnline: !!filterOnline
  });
}

/**
 * (保留) 3.20 设备汇总 /api/web/dev/summary_list
 * 某些其它页面可能仍在使用。
 */
export function apiDeviceSummary(pageIndex = 1, pageSize = 10) {
  return httpPost(apiPath('3.20'), { pageIndex, pageSize });
}

/* 其余接口保持原实现 */

export function apiDevTypes() {
  return httpPost(apiPath('3.13'), {});
}
export function apiDevModes() {
  return httpPost(apiPath('3.14'), {});
}
export function apiGroupedDevices(filters) {
  const { devType, devMode, searchStr, filterOnline } = filters;
  return httpPost(apiPath('3.15'), {
    devType: devType || 0,
    devMode: devMode || 0,
    filterStr: searchStr || '',
    filterOnline: !!filterOnline
  });
}
export function apiUngroupedDevices(filters) {
  const { devType, devMode, searchStr, filterOnline } = filters;
  return httpPost(apiPath('3.16'), {
    devType: devType || 0,
    devMode: devMode || 0,
    filterStr: searchStr || '',
    filterOnline: !!filterOnline
  });
}
export function apiDeviceInfo(devId) {
  return httpPost(apiPath('3.17'), { devId });
}
export function apiOnlineList() {
  return httpPost(apiPath('3.21'), {});
}